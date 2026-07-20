import { Router, type Request, type Response } from "express";
import { indexGithubRepo } from "../rag/githubIndexer.js";
import { supabase } from "../lib/supabase.js";
import axios from "axios";

const router = Router();

// Middleware to extract guest or logged-in user ID
function getUserId(req: Request): string {
  return (req as any).user?.id || "unauthenticated-user";
}

// ─────────────────────────────────────────────────────────────
// GET /github/user/:username/repos
// Fetch all public repos for a user from GitHub
// ─────────────────────────────────────────────────────────────
router.get("/user/:username/repos", async (req: Request, res: Response) => {
  const { username } = req.params;
  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }

  try {
    const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN?.trim();
    const headers: Record<string, string> = {
      "User-Agent": "RepoGPT-Backend/1.0",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    let response;
    try {
      response = await axios.get(
        `https://api.github.com/users/${username}/repos?per_page=100&sort=updated`,
        { headers }
      );
    } catch (apiErr: any) {
      if ((apiErr.response?.status === 401 || apiErr.response?.status === 403) && headers["Authorization"]) {
        console.warn(`⚠️ GitHub API token failed (${apiErr.response?.status}). Retrying request unauthenticated...`);
        delete headers["Authorization"];
        response = await axios.get(
          `https://api.github.com/users/${username}/repos?per_page=100&sort=updated`,
          { headers }
        );
      } else {
        throw apiErr;
      }
    }

    const repos = response.data.map((r: any) => ({
      name: r.name,
      fullName: r.full_name,
      htmlUrl: r.html_url,
      description: r.description,
      language: r.language,
      stars: r.stargazers_count,
    }));

    return res.json({ repos });
  } catch (error: any) {
    console.error(`Error fetching repos for user ${username}:`, error.message);
    if (error.response?.status === 404) {
      return res.status(404).json({ error: "GitHub user not found." });
    }
    if (error.response?.status === 403) {
      return res.status(403).json({ error: "GitHub API rate limit exceeded. Please try again later." });
    }
    return res.status(500).json({ error: error.response?.data?.message || "Failed to fetch repositories from GitHub." });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /github/index
// ─────────────────────────────────────────────────────────────
router.post("/index", async (req: Request, res: Response) => {
  const { repoUrl } = req.body as { repoUrl?: string };
  const userId = getUserId(req);

  if (!repoUrl || !repoUrl.trim()) {
    return res.status(400).json({ error: "Repository URL is required." });
  }

  try {
    console.log(`\n🐙 Indexing repository: ${repoUrl} for user: ${userId}`);
    const result = await indexGithubRepo(repoUrl.trim(), userId);

    // Save metadata record of this indexed repository in Supabase repo_trees
    const { error: dbError } = await supabase
      .from("repo_trees")
      .upsert({
        user_id: userId,
        repo_name: result.repoName,
        repo_url: repoUrl.trim(),
        file_count: result.fileCount,
        tree: result.tree, // store valid files list
        indexed_at: new Date().toISOString(),
      }, { onConflict: "user_id,repo_url" });

    if (dbError) {
      console.warn("⚠️ Warning: Failed to save repo record in Supabase repo_trees:", dbError.message);
    }

    return res.json({
      success: true,
      repoName: result.repoName,
      fileCount: result.fileCount,
      chunkCount: result.chunkCount,
      skippedCount: result.skippedCount,
    });
  } catch (error: any) {
    console.error("Failed to index repository:", error);
    return res.status(500).json({ error: error.message || "Failed to index repository." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /github/repos
// List all indexed repos for the current user
// ─────────────────────────────────────────────────────────────
router.get("/repos", async (req: Request, res: Response) => {
  const userId = getUserId(req);

  try {
    const { data, error } = await supabase
      .from("repo_trees")
      .select("repo_name, repo_url, file_count, indexed_at")
      .eq("user_id", userId)
      .order("indexed_at", { ascending: false });

    if (error) throw error;

    return res.json({
      repos: (data ?? []).map((row: any) => ({
        repoName: row.repo_name,
        repoUrl: row.repo_url,
        fileCount: row.file_count,
        indexedAt: row.indexed_at,
      })),
    });
  } catch (error: any) {
    console.error("Failed to fetch indexed repositories:", error.message);
    return res.status(500).json({ error: "Failed to fetch indexed repositories." });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /github/repos
// Delete indexed repo from metadata and vector database
// ─────────────────────────────────────────────────────────────
router.delete("/repos", async (req: Request, res: Response) => {
  const { repoName } = req.body as { repoName?: string };
  const userId = getUserId(req);

  if (!repoName) {
    return res.status(400).json({ error: "Repository name is required." });
  }

  try {
    // Delete from Supabase repo_trees metadata
    const { error: dbError } = await supabase
      .from("repo_trees")
      .delete()
      .eq("user_id", userId)
      .eq("repo_name", repoName);

    if (dbError) throw dbError;

    // Delete from vectors database
    const { deleteChunksForSource } = await import("../lib/vectorStore.js");
    await deleteChunksForSource(`github:${repoName}`, userId);

    return res.json({ success: true });
  } catch (error: any) {
    console.error(`Failed to delete repository ${repoName}:`, error.message);
    return res.status(500).json({ error: "Failed to delete repository." });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /github/purge
// Purge all data (repos, chunks, chats) for the current session/user
// ─────────────────────────────────────────────────────────────
router.delete("/purge", async (req: Request, res: Response) => {
  const userId = getUserId(req);
  try {
    // 1. Delete all chunks
    await supabase.from("repo_chunks").delete().eq("user_id", userId);

    // 2. Delete all repo trees
    await supabase.from("repo_trees").delete().eq("user_id", userId);

    // 3. Delete all chats (which cascades to delete messages)
    await supabase.from("chats").delete().eq("user_id", userId);

    return res.json({ success: true });
  } catch (error: any) {
    console.error(`Failed to purge user session ${userId} data:`, error.message);
    return res.status(500).json({ error: "Failed to purge session data." });
  }
});

export default router;
