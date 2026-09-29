# 🤖 RepoGPT — Ask Grounded Questions Over GitHub Codebases

**RepoGPT** is a production-grade codebase intelligence assistant that allows you to chat with any GitHub repository in real-time. It retrieves relevant file chunks and repository structures using Google Gemini embeddings and answers questions with fully grounded, contextual codebase knowledge (powered by Google Gemini Flash).

The application requires **no authentication wall** (opens directly to the core features via guest-sessions) and operates on a **100% free and cloud-first stack**.

---

## ✨ Features

- **Double-Mode Ingest**: Input a direct GitHub repository URL OR type a GitHub username to list public repositories and select one to index.
- **Micro-Animated Transitions**: Sleek sliding mode switches, responsive cards, and step-by-step indexing status checklists (powered by Framer Motion).
- **Dual Vector Store Strategy**: Auto-detects and uses Pinecone if keys are provided; otherwise, it stores chunks and embeddings directly in Supabase (`repo_chunks` table) and ranks them using in-memory cosine similarity (100% free and fast).
- **Structure-Aware Code Chunking**: Custom AST-like chunk boundaries separate function/class declarations, preventing out-of-context parsing.
- **Code-Grounded Generation**: Feeds structural repository mappings (directories and files) alongside relevant code context to Gemini for highly accurate, codeblock-rich explanations.

---

## 🏗 Tech Stack

### Frontend
- **Framework**: React 19, Vite, TypeScript
- **Styling**: Tailwind CSS, PostCSS (configured for deep dark themes and Inter + Playfair Display typography)
- **Animations**: Framer Motion
- **Icons**: Lucide React

### Backend
- **Framework**: Node.js, Express, TypeScript
- **AI Models**: Google Gemini (`text-embedding-004` and `gemini-2.5-flash`)
- **Database**: Supabase (PostgreSQL)

---

## 🚀 Setup & Execution

### 1. Database Setup (Supabase)
1. Head to [Supabase](https://supabase.com) and create a free project.
2. In the SQL Editor, copy and execute the contents of [supabase_schema.sql](file:///d:/node_prj/RepoGPT/supabase_schema.sql) to create the required tables (`chats`, `messages`, `repo_trees`, `repo_chunks`).
3. Retrieve your project's URL and Service Role API Key.

### 2. Backend Setup
1. Create a `.env` file in the `backend/` directory and populate it:
   ```env
   PORT=3009
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_KEY=your_service_role_key
   GEMINI_API_KEY=your_google_gemini_api_key
   # Optional: GITHUB_PERSONAL_ACCESS_TOKEN=your_token
   # Optional: PINECONE_API_KEY=, PINECONE_INDEX_NAME=
   ```
2. Open a terminal, install dependencies, and start development:
   ```bash
   cd backend
   npm install
   npm run dev
   ```

### 3. Frontend Setup
1. Create a `.env` file in the `frontend/` directory and populate it:
   ```env
   VITE_API_URL=http://localhost:3009
   ```
2. Open another terminal, install dependencies, and start development:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
3. Open `http://localhost:5173` in your browser.

---
