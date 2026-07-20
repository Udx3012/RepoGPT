import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

const apiKey = process.env.GEMINI_API_KEY || "";
if (!apiKey) {
  console.warn("⚠️ Warning: GEMINI_API_KEY is not defined in the environment.");
}

const ai = new GoogleGenAI({ apiKey });

/**
 * Generate 768-dimensional embeddings for a query.
 */
export async function embedQuery(text: string): Promise<number[]> {
  try {
    const response = await ai.models.embedContent({
      model: "gemini-embedding-001",
      contents: text,
    });
    const embedding = response.embeddings?.[0];
    if (!embedding || !embedding.values) {
      throw new Error("Failed to generate embedding values.");
    }
    return embedding.values;
  } catch (error) {
    console.error("Error in embedQuery:", error);
    throw error;
  }
}

/**
 * Generate embeddings for multiple text chunks.
 */
export async function embedChunks(texts: string[]): Promise<number[][]> {
  try {
    const BATCH_SIZE = 100;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const response = await ai.models.embedContent({
        model: "gemini-embedding-001",
        contents: batch,
      });

      if (Array.isArray(response.embeddings)) {
        response.embeddings.forEach((emb) => {
          if (emb.values) results.push(emb.values);
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error("Error in embedChunks:", error);
    throw error;
  }
}

/**
 * Generate text content using Gemini.
 */
export async function generateResponse(
  prompt: string,
  systemInstruction?: string
): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: systemInstruction ? { systemInstruction } : undefined,
    });
    return response.text || "";
  } catch (error) {
    console.error("Error in generateResponse:", error);
    throw error;
  }
}
