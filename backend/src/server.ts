import express from "express";
import cors from "cors";
import "dotenv/config";
import githubRouter from "./routes/github.js";
import chatRouter from "./routes/chat.js";
import { requireAuth } from "./middleware/auth.js";

const app = express();
const PORT = process.env.PORT || 3009;

// Enable CORS
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const allowed = [
        /^http:\/\/(localhost|127\.0\.0\.1):\d+$/,
        /^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/,
      ];
      const ok = allowed.some((a) =>
        typeof a === "string" ? origin === a : a.test(origin)
      );
      cb(null, ok);
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "x-user-id"],
  })
);

app.use(express.json());

// API Health Check
app.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

import { rateLimit } from "express-rate-limit";

// Rate limiting middleware to prevent API abuse in production
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100, // Limit each IP to 100 requests per 15 minutes
  message: { error: "Too many requests from this IP. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const indexLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 10, // Limit each IP to 10 codebase indexing requests per hour
  message: { error: "Too many codebase indexing requests from this IP. Please try again after an hour." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Register routers with authentication security
app.use("/github", requireAuth, githubRouter);
app.use("/chat", requireAuth, chatRouter);

// Clean up indexed repositories and chats older than 24 hours to stay within database storage limits
import { supabase } from "./lib/supabase.js";
function startCleanupScheduler() {
  const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

  const performCleanup = async () => {
    console.log("🧹 Running scheduled 24-hour database cleanup...");
    try {
      const cutoff = new Date(Date.now() - CLEANUP_INTERVAL).toISOString();

      // 1. Fetch and delete old repo trees
      const { data: oldTrees, error: treeFetchErr } = await supabase
        .from("repo_trees")
        .select("repo_name, user_id")
        .lt("indexed_at", cutoff);

      if (treeFetchErr) {
        console.error("Cleanup: failed to fetch old repositories:", treeFetchErr);
      } else if (oldTrees && oldTrees.length > 0) {
        console.log(`Cleanup: found ${oldTrees.length} stale repository trees. Deleting chunks and trees...`);
        for (const repo of oldTrees) {
          // Delete chunks (this deletes all embedding vectors for this repo)
          await supabase
            .from("repo_chunks")
            .delete()
            .eq("user_id", repo.user_id)
            .eq("repo_name", repo.repo_name);

          // Delete tree
          await supabase
            .from("repo_trees")
            .delete()
            .eq("user_id", repo.user_id)
            .eq("repo_name", repo.repo_name);
        }
      }

      // 2. Delete chats and conversation messages (cascades automatically) older than 24 hours
      const { error: chatDeleteErr } = await supabase
        .from("chats")
        .delete()
        .lt("created_at", cutoff);

      if (chatDeleteErr) {
        console.error("Cleanup: failed to delete old chat sessions:", chatDeleteErr);
      }

      console.log("🧹 Database cleanup complete!");
    } catch (err) {
      console.error("Error during database cleanup:", err);
    }
  };

  // Run on startup
  performCleanup();
  // Run every 24 hours
  setInterval(performCleanup, CLEANUP_INTERVAL);
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 RepoGPT server listening on port ${PORT}`);
  startCleanupScheduler();
});
