import { supabase } from "./supabase.js";
import { Pinecone } from "@pinecone-database/pinecone";
import "dotenv/config";

const usePinecone = Boolean(process.env.PINECONE_API_KEY && process.env.PINECONE_INDEX_NAME);

let pineconeIndex: any = null;
if (usePinecone) {
  try {
    const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    pineconeIndex = pc.index(process.env.PINECONE_INDEX_NAME!);
    console.log("🌲 Using Pinecone for vector storage.");
  } catch (error) {
    console.error("Failed to initialize Pinecone, falling back to Supabase:", error);
  }
} else {
  console.log("💾 Using Supabase database (repo_chunks table) for vector storage.");
}

export interface ChunkRecord {
  text: string;
  vector: number[];
  filePath: string;
}

/**
 * Stores repository chunks and their dense embeddings.
 */
export async function storeRepoChunks(
  chunks: ChunkRecord[],
  userId: string,
  repoName: string
): Promise<void> {
  if (usePinecone && pineconeIndex) {
    const BATCH = 100;
    const ts = Date.now();
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const records = batch.map((chunk, j) => ({
        id: `${userId}-${repoName.replace(/\//g, "-")}-${ts}-${i + j}`,
        values: chunk.vector,
        metadata: {
          text: chunk.text,
          userId,
          source: `github:${repoName}`,
          sourceType: "github_repo",
          repoName,
          filePath: chunk.filePath,
          uploadedAt: ts,
        },
      }));
      await pineconeIndex.upsert(records);
    }
    console.log(`📌 Upserted ${chunks.length} chunks to Pinecone.`);
  } else {
    // Save to Supabase repo_chunks table
    const records = chunks.map((chunk) => ({
      user_id: userId,
      repo_name: repoName,
      file_path: chunk.filePath,
      content: chunk.text,
      embedding: chunk.vector, // Supabase handles float8[] natively from number[]
    }));

    // Delete existing chunks for this repository/user to avoid duplicates
    const { error: deleteError } = await supabase
      .from("repo_chunks")
      .delete()
      .eq("user_id", userId)
      .eq("repo_name", repoName);

    if (deleteError) {
      console.warn("⚠️ Warning: Failed to clean old repo_chunks in Supabase:", deleteError.message);
    }

    // Insert new chunks in batches to avoid payload constraints
    const BATCH = 200;
    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      const { error } = await supabase.from("repo_chunks").insert(batch);
      if (error) {
        throw new Error(`Failed to store chunks in Supabase: ${error.message}`);
      }
    }
    console.log(`📌 Stored ${chunks.length} chunks in Supabase repo_chunks table.`);
  }
}

/**
 * Computes cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const valA = a[i] ?? 0;
    const valB = b[i] ?? 0;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface RetrievedChunk {
  text: string;
  filePath: string;
  score: number;
}

/**
 * Queries similar chunks for a specific repository.
 */
export async function querySimilarChunks(
  queryVector: number[],
  repoName: string,
  userId: string,
  topK: number = 8
): Promise<RetrievedChunk[]> {
  if (usePinecone && pineconeIndex) {
    const response = await pineconeIndex.query({
      vector: queryVector,
      topK,
      filter: {
        $and: [
          { userId: { $eq: userId } },
          { repoName: { $eq: repoName } },
        ],
      },
      includeMetadata: true,
    });

    return (response.matches ?? []).map((m: any) => ({
      text: m.metadata?.text || "",
      filePath: m.metadata?.filePath || "",
      score: m.score || 0,
    }));
  } else {
    // Retrieve all chunks for this repository from Supabase
    const { data, error } = await supabase
      .from("repo_chunks")
      .select("content, file_path, embedding")
      .eq("user_id", userId)
      .eq("repo_name", repoName);

    if (error) {
      throw new Error(`Failed to query chunks from Supabase: ${error.message}`);
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Rank chunks in-memory using cosine similarity
    const ranked = data
      .map((row: any) => {
        const score = cosineSimilarity(queryVector, row.embedding);
        return {
          text: row.content,
          filePath: row.file_path,
          score,
        };
      })
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
      .slice(0, topK);

    return ranked;
  }
}

/**
 * Deletes all chunks for a source.
 */
export async function deleteChunksForSource(
  source: string,
  userId: string
): Promise<void> {
  const isRepo = source.startsWith("github:");
  const repoName = isRepo ? source.replace("github:", "") : source;

  if (usePinecone && pineconeIndex) {
    // Retrieve IDs matching search metadata first
    const response = await pineconeIndex.query({
      vector: new Array(768).fill(0),
      topK: 10000,
      filter: {
        $and: [
          { userId: { $eq: userId } },
          isRepo ? { repoName: { $eq: repoName } } : { source: { $eq: source } }
        ],
      },
    });

    const ids = (response.matches ?? []).map((m: any) => m.id);
    if (ids.length > 0) {
      await pineconeIndex.deleteMany(ids);
    }
  } else {
    const { error } = await supabase
      .from("repo_chunks")
      .delete()
      .eq("user_id", userId)
      .eq("repo_name", repoName);

    if (error) {
      throw new Error(`Failed to delete chunks from Supabase: ${error.message}`);
    }
  }
}
