import { Router, type Request, type Response } from "express";
import { embedQuery, generateResponse } from "../lib/gemini.js";
import { querySimilarChunks } from "../lib/vectorStore.js";
import { supabase } from "../lib/supabase.js";

const router = Router();

function getUserId(req: Request): string {
  return (req as any).user?.id || "unauthenticated-user";
}

/**
 * Detect if the query is asking about high-level structure, files, folder hierarchy, or overall repository rating/summarization.
 */
function isStructuralQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return (
    lower.includes("files") ||
    lower.includes("folders") ||
    lower.includes("directory") ||
    lower.includes("structure") ||
    lower.includes("architecture") ||
    lower.includes("hld") ||
    lower.includes("overview") ||
    lower.includes("components") ||
    lower.includes("file tree") ||
    lower.includes("package.json") ||
    lower.includes("rate") ||
    lower.includes("review") ||
    lower.includes("about") ||
    lower.includes("explain the repo") ||
    lower.includes("summarize") ||
    lower.includes("what does this")
  );
}

// ─────────────────────────────────────────────────────────────
// POST /chat/query
// ─────────────────────────────────────────────────────────────
router.post("/query", async (req: Request, res: Response) => {
  const { query, repoName, chatId } = req.body as {
    query?: string;
    repoName?: string;
    chatId?: string;
  };
  const userId = getUserId(req);

  if (!query || !query.trim()) {
    return res.status(400).json({ error: "Query is required." });
  }

  try {
    let activeChatId = chatId;

    // 1. Fetch conversation history if chatId is provided
    let conversationContext = "";
    if (activeChatId) {
      const { data: messages, error: msgError } = await supabase
        .from("messages")
        .select("query, answer")
        .eq("chat_id", activeChatId)
        .order("created_at", { ascending: true });

      if (!msgError && messages) {
        conversationContext = messages
          .map((m: any) => `User: ${m.query}\nAssistant: ${m.answer}`)
          .join("\n\n");
      }
    }

    // 2. Fetch codebase context
    let contextText = "";
    let fileTreeText = "";

    if (repoName) {
      // 2a. Fetch vector similarity chunks
      const queryVector = await embedQuery(query);
      let chunks = await querySimilarChunks(queryVector, repoName, userId, 10);

      let chunksTextList = chunks.map((c) => `--- File: ${c.filePath} ---\n${c.text}`);

      // 2b. If structural/summary query, fetch and append core manifests & docs (README, Cargo.toml, package.json, main files)
      if (isStructuralQuery(query)) {
        const { data: coreChunks } = await supabase
          .from("repo_chunks")
          .select("content, file_path")
          .eq("user_id", userId)
          .eq("repo_name", repoName)
          .or("file_path.ilike.%readme.md%,file_path.ilike.%cargo.toml%,file_path.ilike.%package.json%,file_path.ilike.%main.rs%,file_path.ilike.%main.ts%,file_path.ilike.%main.py%,file_path.ilike.%app.py%,file_path.ilike.%server.ts%")
          .limit(10);

        if (coreChunks && coreChunks.length > 0) {
          const coreText = coreChunks
            .map((c: any) => `--- File (Core Docs / Entrypoint): ${c.file_path} ---\n${c.content}`)
            .join("\n\n");
          chunksTextList.unshift(coreText);
        }
      }

      contextText = chunksTextList.join("\n\n");

      // 2c. If structural, inject the repo file list tree
      if (isStructuralQuery(query)) {
        const { data: repoTree } = await supabase
          .from("repo_trees")
          .select("tree")
          .eq("user_id", userId)
          .eq("repo_name", repoName)
          .maybeSingle();

        if (repoTree && Array.isArray(repoTree.tree)) {
          fileTreeText = repoTree.tree
            .map((file: any) => `- ${file.path} (${file.size} bytes)`)
            .join("\n");
        }
      }
    }

    // 3. Format the grounding prompt for Gemini
    const systemInstruction = `You are RepoGPT, a production-grade AI codebase assistant. Your goal is to provide highly accurate, technical, and strictly code-grounded answers based ONLY on the retrieved repository file chunks and file tree structure provided.

CRITICAL Anti-Hallucination Rules:
1. ALWAYS base your summary, architecture, and technology description STRICTLY on the actual files and file paths provided in the prompt context (e.g. if files are Rust .rs or .toml files, do NOT describe Python .py files).
2. NEVER invent, assume, or hallucinate file names (like server.py, client.py) or functionalities that are not present in the provided file structure or context.
3. If no file context or file tree is provided in the prompt, state clearly: "No indexed file context found for this repository."
4. Output concise, accurate technical summaries referencing exact file paths.`;

    const prompt = `You are answering questions about the repository: "${repoName || "General Knowledge"}".

${fileTreeText ? `### Repository File Structure:\n${fileTreeText}\n\n` : ""}
${contextText ? `### Relevant Retrieved Code Context:\n${contextText}\n\n` : ""}
${conversationContext ? `### Conversation History:\n${conversationContext}\n\n` : ""}
### User Question:
${query}

Please answer the user's question, grounding your response strictly in the provided context and codebase structure.`;

    const answer = await generateResponse(prompt, systemInstruction);

    // 4. Create chat record if it doesn't exist
    if (!activeChatId) {
      const { data: newChat, error: chatError } = await supabase
        .from("chats")
        .insert({
          user_id: userId,
          title: query.slice(0, 60),
        })
        .select()
        .single();

      if (chatError) throw chatError;
      activeChatId = newChat.id;
    }

    // 5. Save message record
    const { error: msgError } = await supabase.from("messages").insert({
      chat_id: activeChatId,
      user_id: userId,
      query,
      answer,
      had_pdf: false,
    });

    if (msgError) {
      console.warn("⚠️ Warning: Failed to save message in Supabase messages:", msgError.message);
    }

    return res.json({
      chatId: activeChatId,
      text: answer,
    });
  } catch (error: any) {
    console.error("Error in chat query router:", error);
    return res.status(500).json({ error: error.message || "Failed to process chat query." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /chat/chats
// ─────────────────────────────────────────────────────────────
router.get("/chats", async (req: Request, res: Response) => {
  const userId = getUserId(req);

  try {
    const { data, error } = await supabase
      .from("chats")
      .select("id, title, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.json({ chats: data ?? [] });
  } catch (error: any) {
    console.error("Failed to fetch chats:", error.message);
    return res.status(500).json({ error: "Failed to fetch chats." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /chat/messages/:chatId
// ─────────────────────────────────────────────────────────────
router.get("/messages/:chatId", async (req: Request, res: Response) => {
  const { chatId } = req.params;
  const userId = getUserId(req);

  try {
    // Verify chat ownership first
    const { data: chat, error: chatErr } = await supabase
      .from("chats")
      .select("id")
      .eq("id", chatId)
      .eq("user_id", userId)
      .maybeSingle();

    if (chatErr || !chat) {
      return res.status(403).json({ error: "Access denied or chat not found." });
    }

    const { data: messages, error } = await supabase
      .from("messages")
      .select("query, answer, created_at")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return res.json({
      messages: (messages ?? []).map((m: any) => ({
        q: m.query,
        a: m.answer,
      })),
    });
  } catch (error: any) {
    console.error(`Failed to fetch messages for chat ${chatId}:`, error.message);
    return res.status(500).json({ error: "Failed to fetch messages." });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /chat/chats/:chatId
// ─────────────────────────────────────────────────────────────
router.delete("/chats/:chatId", async (req: Request, res: Response) => {
  const { chatId } = req.params;
  const userId = getUserId(req);

  try {
    const { error } = await supabase
      .from("chats")
      .delete()
      .eq("id", chatId)
      .eq("user_id", userId);

    if (error) throw error;

    return res.json({ success: true });
  } catch (error: any) {
    console.error(`Failed to delete chat ${chatId}:`, error.message);
    return res.status(500).json({ error: "Failed to delete chat." });
  }
});

export default router;
