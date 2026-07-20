import { embedChunks } from "../lib/gemini.js";
import { chunkCodeContent, extractExt } from "./codeChunker.js";
import { storeRepoChunks } from "../lib/vectorStore.js";
import "dotenv/config";

export interface RepoFile {
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha?: string;
}

export interface IndexResult {
  repoName: string;
  fileCount: number;
  chunkCount: number;
  skippedCount: number;
  tree: RepoFile[];
}

const SKIP_DIR_SEGMENTS = new Set([
  "node_modules", "dist", "build", ".next", ".git",
  "coverage", ".cache", "out", "__pycache__", ".pytest_cache",
  ".turbo", ".vercel", ".output", "vendor", "target",
  "bin", "obj", ".gradle", ".idea", ".vscode",
  ".yarn", ".pnp",
]);

const SKIP_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".bmp", ".tiff",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".wasm",
  ".zip", ".tar", ".gz", ".rar", ".7z",
  ".mp4", ".mp3", ".wav", ".avi", ".mov", ".pdf",
  ".csv", ".parquet", ".sqlite", ".db",
  ".min.js", ".min.css",
  ".map",
  ".ttf", ".woff", ".woff2", ".eot",
  ".lock",
]);

const SKIP_FILENAMES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "composer.lock", "Gemfile.lock", "poetry.lock",
  ".DS_Store", "Thumbs.db", ".gitkeep",
]);

const KEEP_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs",
  ".java", ".cpp", ".c", ".cs", ".rb", ".php", ".swift",
  ".kt", ".scala", ".vue", ".svelte",
  ".mjs", ".cjs",
  ".json", ".yaml", ".yml", ".toml",
  ".md", ".mdx", ".txt", ".rst",
  ".html", ".css", ".scss", ".sass",
  ".env.example",
]);

const MAX_FILE_SIZE = 500000; // 500 KB

function shouldSkipPath(filePath: string, size = 0): boolean {
  const parts    = filePath.split("/");
  const fileName = parts[parts.length - 1] ?? "";

  const dotIdx      = fileName.lastIndexOf(".");
  const ext         = dotIdx > 0 ? fileName.slice(dotIdx).toLowerCase() : "";

  const nameParts   = fileName.split(".");
  const compoundExt = nameParts.length > 2
    ? ("." + nameParts.slice(1).join(".")).toLowerCase()
    : "";

  if (size > MAX_FILE_SIZE) return true;

  for (const seg of parts.slice(0, -1)) {
    if (SKIP_DIR_SEGMENTS.has(seg)) return true;
    if (seg.startsWith(".") && seg !== ".github") return true;
  }

  if (SKIP_FILENAMES.has(fileName)) return true;
  if (SKIP_EXTENSIONS.has(ext) || SKIP_EXTENSIONS.has(compoundExt)) return true;
  if (!KEEP_EXTENSIONS.has(ext) && !KEEP_EXTENSIONS.has(compoundExt)) return true;

  return false;
}

function buildHeaders(): Record<string, string> {
  const serverToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN?.trim();
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "RepoGPT-Backend/1.0",
  };

  if (serverToken) {
    headers["Authorization"] = `Bearer ${serverToken}`;
  }

  return headers;
}

export function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const cleanUrl = url.trim().replace(/\/$/, "");
    const match = cleanUrl.match(/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/i);
    if (!match) return null;
    const owner = match[1];
    const repo = match[2]?.replace(/\.git$/i, "");
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

async function fetchWithAuthFallback(url: string, headers: Record<string, string>): Promise<Response> {
  let res = await fetch(url, { headers });
  if ((res.status === 401 || res.status === 403) && headers.Authorization) {
    console.warn(`⚠️ GitHub API request to ${url} failed with status ${res.status}. Retrying unauthenticated...`);
    const fallbackHeaders = { ...headers };
    delete fallbackHeaders.Authorization;
    res = await fetch(url, { headers: fallbackHeaders });
  }
  return res;
}

async function fetchRepoMetadata(
  owner: string,
  repo: string,
  headers: Record<string, string>
): Promise<{ defaultBranch: string }> {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const res = await fetchWithAuthFallback(url, headers);
  if (!res.ok) {
    throw new Error(`Failed to fetch repo metadata: ${res.statusText}`);
  }
  const data = await res.json() as { default_branch?: string };
  return {
    defaultBranch: data.default_branch || "main",
  };
}

async function fetchRepoTree(
  owner: string,
  repo: string,
  branch: string,
  headers: Record<string, string>
): Promise<RepoFile[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const res = await fetchWithAuthFallback(url, headers);
  if (!res.ok) {
    throw new Error(`Failed to fetch repo tree: ${res.statusText}`);
  }
  const data = await res.json() as { tree?: any[] };
  if (!data.tree || !Array.isArray(data.tree)) {
    return [];
  }
  return data.tree
    .filter((item: any) => item.type === "blob")
    .map((item: any) => ({
      path: item.path,
      type: "blob",
      size: item.size || 0,
      sha: item.sha,
    }));
}

async function fetchRawFile(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  headers: Record<string, string>
): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const text = await res.text();
  return text.includes("\x00") ? null : text;
}

async function fetchBlob(
  owner: string,
  repo: string,
  sha: string,
  headers: Record<string, string>
): Promise<string | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`;
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const data = await res.json() as { content?: string; encoding?: string };
  if (data.encoding !== "base64" || !data.content) return null;
  const text = Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8");
  return text.includes("\x00") ? null : text;
}

async function fetchFilesInBatches(
  owner: string,
  repo: string,
  branch: string,
  files: RepoFile[],
  headers: Record<string, string>,
  concurrency = 6
): Promise<{ file: RepoFile; content: string }[]> {
  const results: { file: RepoFile; content: string }[] = [];
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const fetched = await Promise.all(
      batch.map(async (file) => {
        if (!file.sha) return null;
        const content =
          await fetchRawFile(owner, repo, branch, file.path, headers) ??
          await fetchBlob(owner, repo, file.sha, headers);
        return content ? { file, content } : null;
      })
    );
    fetched.forEach((r) => {
      if (r) results.push(r);
    });
    if (i + concurrency < files.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return results;
}

export async function indexGithubRepo(
  repoUrl: string,
  userId: string
): Promise<IndexResult> {
  const parsed = parseGithubUrl(repoUrl);
  if (!parsed) {
    throw new Error("Invalid GitHub repository URL.");
  }
  const { owner, repo } = parsed;
  const repoName = `${owner}/${repo}`;

  const headers = buildHeaders();
  const metadata = await fetchRepoMetadata(owner, repo, headers);
  const allFiles = await fetchRepoTree(owner, repo, metadata.defaultBranch, headers);

  const validFiles = allFiles.filter((f) => !shouldSkipPath(f.path, f.size));
  const skippedCount = allFiles.length - validFiles.length;

  if (validFiles.length === 0) {
    throw new Error("No indexable text files found in the repository.");
  }

  const fileContents = await fetchFilesInBatches(owner, repo, metadata.defaultBranch, validFiles, headers);
  if (fileContents.length === 0) {
    throw new Error("Failed to fetch repository file contents.");
  }

  const allChunks: { text: string; filePath: string }[] = [];
  for (const { file, content } of fileContents) {
    const { ext, compoundExt } = extractExt(file.path);
    const effectiveExt = compoundExt || ext;
    const chunks = chunkCodeContent(content, file.path, effectiveExt);
    chunks.forEach((text) => {
      allChunks.push({ text, filePath: file.path });
    });
  }

  if (allChunks.length === 0) {
    throw new Error("No indexable contents extracted from repository.");
  }

  // Embed chunks in batches via Gemini
  const texts = allChunks.map((c) => c.text);
  const embeddings = await embedChunks(texts);

  const chunkRecords = embeddings.map((vector, i) => {
    const chunk = allChunks[i];
    if (!chunk) throw new Error("Index mismatch in embeddings mapping.");
    return {
      text: chunk.text,
      vector,
      filePath: chunk.filePath,
    };
  });

  await storeRepoChunks(chunkRecords, userId, repoName);

  return {
    repoName,
    fileCount: fileContents.length,
    chunkCount: chunkRecords.length,
    skippedCount,
    tree: validFiles,
  };
}
