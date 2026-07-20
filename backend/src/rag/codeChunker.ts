// ============================================================
// Code-Aware Chunker
// Chunks code files by function/class boundaries
// Falls back to line-based chunking for other files
// ============================================================

const MAX_CHUNK_SIZE = 1500;   // code chunks can be bigger
const MIN_CHUNK_SIZE = 50;
const OVERLAP_LINES  = 3;      // lines of overlap between chunks

function isCodeFile(ext: string): boolean {
  return [
    '.ts', '.tsx', '.js', '.jsx', '.py', '.go',
    '.rs', '.java', '.cpp', '.c', '.cs', '.rb',
    '.php', '.swift', '.kt', '.scala',
  ].includes(ext);
}

function isMarkdown(ext: string): boolean {
  return ['.md', '.mdx', '.txt', '.rst'].includes(ext);
}

function isCodeBoundary(line: string): boolean {
  const trimmed = line.trim();
  return (
    /^(export\s+)?(default\s+)?(async\s+)?function\s+/.test(trimmed) ||
    /^(export\s+)?(abstract\s+)?class\s+/.test(trimmed)              ||
    /^(export\s+)?const\s+\w+\s*=\s*(async\s+)?\(/.test(trimmed)    ||
    /^(export\s+)?const\s+\w+\s*=\s*(async\s+)?function/.test(trimmed) ||
    /^def\s+\w+/.test(trimmed)                                        ||  // Python
    /^func\s+\w+/.test(trimmed)                                       ||  // Go
    /^fn\s+\w+/.test(trimmed)                                         ||  // Rust
    /^(public|private|protected|static).*\(/.test(trimmed)               // Java/C#
  );
}

function chunkCodeFile(content: string, filePath: string): string[] {
  const lines    = content.split('\n');
  const chunks:  string[] = [];
  let   current: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Hit a boundary AND current chunk has content → save it
    if (isCodeBoundary(line) && current.length > 0) {
      const text = current.join('\n').trim();
      if (text.length >= MIN_CHUNK_SIZE) {
        chunks.push(`// File: ${filePath}\n${text}`);
      }
      current = lines.slice(Math.max(0, i - OVERLAP_LINES), i);
    }

    current.push(line);

    // If chunk is getting too large → force split
    if (current.join('\n').length > MAX_CHUNK_SIZE) {
      const text = current.join('\n').trim();
      if (text.length >= MIN_CHUNK_SIZE) {
        chunks.push(`// File: ${filePath}\n${text}`);
      }
      current = lines.slice(Math.max(0, i - OVERLAP_LINES), i + 1);
    }
  }

  if (current.length > 0) {
    const text = current.join('\n').trim();
    if (text.length >= MIN_CHUNK_SIZE) {
      chunks.push(`// File: ${filePath}\n${text}`);
    }
  }

  return chunks;
}

function chunkMarkdownFile(content: string, filePath: string): string[] {
  const sections = content.split(/^#{1,3}\s+/m);
  const chunks:   string[] = [];

  for (const section of sections) {
    const text = section.trim();
    if (text.length < MIN_CHUNK_SIZE) continue;

    if (text.length <= MAX_CHUNK_SIZE) {
      chunks.push(`// File: ${filePath}\n${text}`);
    } else {
      const paras = text.split(/\n\n+/);
      let current = '';
      for (const para of paras) {
        if ((current + '\n\n' + para).length <= MAX_CHUNK_SIZE) {
          current = current ? current + '\n\n' + para : para;
        } else {
          if (current.length >= MIN_CHUNK_SIZE) {
            chunks.push(`// File: ${filePath}\n${current}`);
          }
          current = para;
        }
      }
      if (current.length >= MIN_CHUNK_SIZE) {
        chunks.push(`// File: ${filePath}\n${current}`);
      }
    }
  }

  return chunks;
}

function chunkConfigFile(content: string, filePath: string): string[] {
  if (content.length <= MAX_CHUNK_SIZE) {
    return content.length >= MIN_CHUNK_SIZE
      ? [`// File: ${filePath}\n${content}`]
      : [];
  }

  const lines   = content.split('\n');
  const chunks: string[] = [];
  let   current = '';

  for (const line of lines) {
    if ((current + '\n' + line).length <= MAX_CHUNK_SIZE) {
      current = current ? current + '\n' + line : line;
    } else {
      if (current.length >= MIN_CHUNK_SIZE) {
        chunks.push(`// File: ${filePath}\n${current}`);
      }
      current = line;
    }
  }

  if (current.length >= MIN_CHUNK_SIZE) {
    chunks.push(`// File: ${filePath}\n${current}`);
  }

  return chunks;
}

export function extractExt(filePath: string): { ext: string; compoundExt: string } {
  const fileName    = filePath.split('/').pop() ?? '';
  const dotIdx      = fileName.lastIndexOf('.');
  const ext         = dotIdx > 0 ? fileName.slice(dotIdx).toLowerCase() : '';

  const parts       = fileName.split('.');
  const compoundExt = parts.length > 2
    ? ('.' + parts.slice(1).join('.')).toLowerCase()
    : '';

  return { ext, compoundExt };
}

export function chunkCodeContent(
  content:  string,
  filePath: string,
  ext:      string
): string[] {
  if (isCodeFile(ext))     return chunkCodeFile(content, filePath);
  if (isMarkdown(ext))     return chunkMarkdownFile(content, filePath);
  return                          chunkConfigFile(content, filePath);
}
