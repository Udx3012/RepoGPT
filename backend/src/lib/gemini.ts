import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

const apiKey = process.env.GEMINI_API_KEY || "";
if (!apiKey) {
  console.warn("⚠️ Warning: GEMINI_API_KEY is not defined in the environment.");
}

const ai = new GoogleGenAI({ apiKey });

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelay(error: any): number | null {
  const errMsg = typeof error?.message === "string" ? error.message : JSON.stringify(error);
  const match = errMsg.match(/retry in\s+([\d.]+)\s*s/i);
  if (match && match[1]) {
    const seconds = parseFloat(match[1]);
    if (!isNaN(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000);
    }
  }
  return null;
}

function isRateLimitError(error: any): boolean {
  if (!error) return false;
  const status = error.status || error.code || error.statusCode;
  if (status === 429 || status === "RESOURCE_EXHAUSTED") return true;
  const errMsg = (error.message || "").toLowerCase();
  return (
    errMsg.includes("resource_exhausted") ||
    errMsg.includes("429") ||
    errMsg.includes("quota exceeded") ||
    errMsg.includes("rate limit")
  );
}

function cleanErrorMessage(error: any): string {
  if (!error) return "Unknown Gemini API error.";
  let msg = error.message || String(error);
  try {
    const parsed = JSON.parse(msg);
    if (parsed?.error?.message) {
      msg = parsed.error.message;
    }
  } catch {
    // not JSON
  }
  if (isRateLimitError(error)) {
    const firstLine = msg.split("\n")[0] || "Quota exceeded.";
    return `Gemini API Rate Limit / Quota Exceeded: ${firstLine}`;
  }
  return msg;
}

async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 4,
  initialBackoff = 2500
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      if (attempt > maxRetries || !isRateLimitError(error)) {
        throw new Error(cleanErrorMessage(error));
      }

      const suggestedDelay = parseRetryDelay(error);
      let delayMs = suggestedDelay
        ? suggestedDelay + 1500
        : initialBackoff * Math.pow(2, attempt - 1) + Math.random() * 1000;

      if (delayMs > 65000) {
        delayMs = 60000;
      }

      console.warn(
        `⚠️ [Gemini API] Rate limited (attempt ${attempt}/${maxRetries}). Waiting ${(delayMs / 1000).toFixed(1)}s before retry...`
      );
      await sleep(delayMs);
    }
  }
}

/**
 * Generate 768-dimensional embeddings for a query.
 */
export async function embedQuery(text: string): Promise<number[]> {
  try {
    const response = await callWithRetry(async () => {
      return await ai.models.embedContent({
        model: "gemini-embedding-001",
        contents: text,
      });
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
    const BATCH_SIZE = 50;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const response = await callWithRetry(async () => {
        return await ai.models.embedContent({
          model: "gemini-embedding-001",
          contents: batch,
        });
      });

      if (Array.isArray(response.embeddings)) {
        response.embeddings.forEach((emb: any) => {
          if (emb.values) results.push(emb.values);
        });
      }

      // Add a slight delay between successive batches to avoid burst limit exhaustion
      if (i + BATCH_SIZE < texts.length) {
        await sleep(350);
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
    const response = await callWithRetry(async () => {
      return await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: systemInstruction ? { systemInstruction } : undefined,
      });
    });
    return response.text || "";
  } catch (error) {
    console.error("Error in generateResponse:", error);
    throw error;
  }
}
