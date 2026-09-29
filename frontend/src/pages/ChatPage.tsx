import React, { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Github,
  ArrowRight,
  Loader2,
  MessageSquare,
  Plus,
  Trash2,
  Code,
  Sparkles,
  CornerDownLeft,
  Database,
  RefreshCw,
  FolderOpen,
  User
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";

// API Base URL
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3009";

interface Repository {
  name: string;
  fullName: string;
  htmlUrl: string;
  description: string;
  language: string;
  stars: number;
}

interface IndexedRepo {
  repoName: string;
  repoUrl: string;
  fileCount: number;
  indexedAt: string;
}

interface ChatSession {
  id: string;
  title: string;
  created_at: string;
}

interface Message {
  q: string;
  a: string;
}

function getOrCreateGuestSession() {
  const KEY = "repogpt_guest_session_id";
  let id = "";
  if (typeof window !== "undefined" && window.localStorage) {
    id = localStorage.getItem(KEY) || "";
    if (!id) {
      id = "guest_" + (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15) + Date.now().toString(36));
      localStorage.setItem(KEY, id);
    }
  } else {
    id = "guest_temp";
  }
  return {
    access_token: `token_${id}`,
    user: {
      id,
      email: `${id}@guest.repogpt`
    }
  };
}

const ChatPage = () => {
  // Dynamic persistent guest session per user/browser profile
  const [session] = useState(getOrCreateGuestSession);

  // Mode: "url" or "username"
  const [searchMode, setSearchMode] = useState<"url" | "username">("url");
  const [repoUrl, setRepoUrl] = useState("");
  const [username, setUsername] = useState("");
  const [searchedRepos, setSearchedRepos] = useState<Repository[]>([]);
  const [searchingRepos, setSearchingRepos] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);

  // App workflow states
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexingStep, setIndexingStep] = useState(0);
  const [chatStarted, setChatStarted] = useState(false);

  // Active chat state
  const [indexedRepos, setIndexedRepos] = useState<IndexedRepo[]>([]);
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeRepo, setActiveRepo] = useState<string>("");
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [sendingQuery, setSendingQuery] = useState(false);
  const [repoToDelete, setRepoToDelete] = useState<string | null>(null);

  // Vanta Waves background callback ref
  const vantaEffect = useRef<any>(null);

  const vantaRefCallback = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      if (!vantaEffect.current && (window as any).VANTA) {
        try {
          vantaEffect.current = (window as any).VANTA.WAVES({
            el: el,
            mouseControls: true,
            touchControls: true,
            gyroControls: false,
            minHeight: 200.00,
            minWidth: 200.00,
            scale: 1.00,
            scaleMobile: 1.00,
            color: 0x08090a, // Sleek, near-black slate wave swells
            backgroundColor: 0x09090b, // Zinc-950 background
            shininess: 15.00, // Minimalist matte finish
            waveHeight: 8.00, // Low, non-distracting wave height
            waveSpeed: 0.40, // Slow, elegant ambient movement
            zoom: 1.20 // Wide, subtle perspective
          });

          // Force a canvas resize after the sidebar transition completes (500ms)
          // This eliminates the black bar on the right side of the screen
          setTimeout(() => {
            if (vantaEffect.current && typeof vantaEffect.current.resize === "function") {
              vantaEffect.current.resize();
            }
          }, 500);
        } catch (err) {
          console.warn("Failed to initialize Vanta.js waves:", err);
        }
      }
    } else {
      if (vantaEffect.current) {
        vantaEffect.current.destroy();
        vantaEffect.current = null;
      }
    }
  }, []);

  // UI state
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Headers helper
  const getHeaders = () => ({
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session?.access_token || ""}`,
      "x-user-id": session?.user?.id || "",
    },
  });

  // Indexing sequence steps
  const indexingStepsList = [
    "Contacting GitHub API...",
    "Retrieving repository file tree...",
    "Downloading text & source files...",
    "Parsing & segmenting code chunks...",
    "Generating Google Gemini embeddings...",
    "Indexing database records...",
    "Starting chat workspace!"
  ];

  // Fetch indexed repos and chats when session is active
  useEffect(() => {
    if (session) {
      fetchIndexedRepos();
      fetchChats();
    }
  }, [session]);

  // Scroll to bottom of chat when new messages arrive
  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, sendingQuery]);

  const fetchIndexedRepos = async () => {
    try {
      const res = await axios.get(`${API_URL}/github/repos`, getHeaders());
      setIndexedRepos(res.data.repos || []);
      if (res.data.repos && res.data.repos.length > 0 && !activeRepo) {
        setActiveRepo(res.data.repos[0].repoName);
      }
    } catch (err) {
      console.error("Failed to load indexed repos:", err);
    }
  };

  const fetchChats = async () => {
    setLoadingChats(true);
    try {
      const res = await axios.get(`${API_URL}/chat/chats`, getHeaders());
      setChats(res.data.chats || []);
    } catch (err) {
      console.error("Failed to load chats:", err);
    } finally {
      setLoadingChats(false);
    }
  };

  const handlePurgeSession = async () => {
    if (!confirm("Are you sure you want to purge all indexed repositories and chats? This action cannot be undone.")) {
      return;
    }
    try {
      await axios.delete(`${API_URL}/github/purge`, getHeaders());
      window.location.reload();
    } catch (err) {
      console.error("Failed to purge session:", err);
      alert("Failed to purge session data.");
    }
  };

  const handleSearchRepos = async () => {
    if (!username.trim()) return;
    setSearchingRepos(true);
    setSelectedRepo(null);
    setSearchedRepos([]);
    try {
      const res = await axios.get(`${API_URL}/github/user/${username.trim()}/repos`, getHeaders());
      setSearchedRepos(res.data.repos || []);
    } catch (err: any) {
      console.error("Failed to fetch repos:", err);
      let errMsg = err.response?.data?.error || err.message || "Failed to search GitHub repositories.";
      if (typeof errMsg === "string" && errMsg.startsWith("{")) {
        try {
          const parsed = JSON.parse(errMsg);
          if (parsed?.error?.message) errMsg = parsed.error.message;
        } catch {}
      }
      alert(errMsg);
    } finally {
      setSearchingRepos(false);
    }
  };

  const handleIndexRepo = async (targetUrl: string) => {
    setIsIndexing(true);
    setIndexingStep(0);

    // Simulate progress through the indexing sequence
    const interval = setInterval(() => {
      setIndexingStep((prev) => {
        if (prev < indexingStepsList.length - 2) {
          return prev + 1;
        }
        return prev;
      });
    }, 2000);

    try {
      const res = await axios.post(`${API_URL}/github/index`, { repoUrl: targetUrl }, getHeaders());
      setIndexingStep(indexingStepsList.length - 1);

      // Short delay to show completed step
      setTimeout(async () => {
        clearInterval(interval);
        setIsIndexing(false);
        setChatStarted(true);
        await fetchIndexedRepos();
        setActiveRepo(res.data.repoName);
        handleNewChat(res.data.repoName);
      }, 1000);

    } catch (err: any) {
      clearInterval(interval);
      setIsIndexing(false);
      console.error("Indexing failed:", err);
      let errMsg = err.response?.data?.error || err.message || "Failed to index repository.";
      if (typeof errMsg === "string" && errMsg.startsWith("{")) {
        try {
          const parsed = JSON.parse(errMsg);
          if (parsed?.error?.message) errMsg = parsed.error.message;
        } catch {}
      }
      alert(errMsg);
    }
  };

  const handleSelectIndexedRepo = async (repoName: string) => {
    setActiveRepo(repoName);
    setChatStarted(true);
    handleNewChat(repoName);
  };

  const handleNewChat = (repo = activeRepo) => {
    setActiveChatId(null);
    setMessages([]);
    setInputMessage("");
  };

  const handleLoadChat = async (chatId: string) => {
    setLoadingMessages(true);
    setActiveChatId(chatId);
    setChatStarted(true);
    try {
      const chat = chats.find(c => c.id === chatId);
      const res = await axios.get(`${API_URL}/chat/messages/${chatId}`, getHeaders());
      setMessages(res.data.messages || []);
    } catch (err) {
      console.error("Failed to load chat messages:", err);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleDeleteChat = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await axios.delete(`${API_URL}/chat/chats/${chatId}`, getHeaders());
      setChats(prev => prev.filter(c => c.id !== chatId));
      if (activeChatId === chatId) {
        handleNewChat();
      }
    } catch (err) {
      console.error("Failed to delete chat:", err);
    }
  };

  const handleDeleteRepoClick = (repoName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRepoToDelete(repoName);
  };

  const confirmDeleteRepo = async () => {
    if (!repoToDelete) return;
    try {
      await axios.delete(`${API_URL}/github/repos`, {
        headers: getHeaders().headers,
        data: { repoName: repoToDelete }
      });
      setIndexedRepos(prev => prev.filter(r => r.repoName !== repoToDelete));
      if (activeRepo === repoToDelete) {
        setActiveRepo("");
        setChatStarted(false);
      }
    } catch (err) {
      console.error("Failed to delete repository:", err);
    } finally {
      setRepoToDelete(null);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputMessage.trim() || sendingQuery) return;

    const userQ = inputMessage.trim();
    setInputMessage("");
    setSendingQuery(true);

    // Optimistically push user message
    setMessages(prev => [...prev, { q: userQ, a: "" }]);

    try {
      const res = await axios.post(`${API_URL}/chat/query`, {
        query: userQ,
        repoName: activeRepo,
        chatId: activeChatId || undefined
      }, getHeaders());

      if (!activeChatId && res.data.chatId) {
        setActiveChatId(res.data.chatId);
        fetchChats();
      }

      setMessages(prev => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last) {
          last.a = res.data.text;
        }
        return copy;
      });
    } catch (err) {
      console.error("Failed to get answer:", err);
      setMessages(prev => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last) {
          last.a = "⚠️ Sorry, I encountered an error answering your question. Please make sure the backend is active and try again.";
        }
        return copy;
      });
    } finally {
      setSendingQuery(false);
    }
  };

  // Simple Markdown Renderer
  const renderMarkdown = (text: string) => {
    if (!text) return null;

    // Split by code blocks
    const parts = text.split(/(```[a-z]*\n[\s\S]*?\n```)/g);

    return parts.map((part, index) => {
      if (part.startsWith("```")) {
        const lines = part.split("\n");
        const lang = lines[0]?.replace("```", "") || "code";
        const code = lines.slice(1, -1).join("\n");
        return (
          <div key={index} className="my-3 overflow-hidden rounded-lg border border-border bg-black/60 font-mono text-xs md:text-sm">
            <div className="flex items-center justify-between bg-zinc-900/60 px-4 py-1.5 text-[10px] uppercase tracking-wider text-zinc-400 border-b border-border">
              <span>{lang}</span>
              <button
                onClick={() => navigator.clipboard.writeText(code)}
                className="hover:text-foreground transition-colors"
              >
                Copy
              </button>
            </div>
            <pre className="overflow-x-auto p-4 text-zinc-300">
              <code>{code}</code>
            </pre>
          </div>
        );
      }

      // Handle simple formatting line by line
      const lines = part.split("\n");
      return (
        <div key={index} className="space-y-1.5">
          {lines.map((line, lIdx) => {
            let renderedLine: React.ReactNode = line;

            // Header tags
            if (line.startsWith("### ")) {
              return <h3 key={lIdx} className="text-base font-semibold text-foreground mt-4 mb-2">{line.replace("### ", "")}</h3>;
            }
            if (line.startsWith("## ")) {
              return <h2 key={lIdx} className="text-lg font-bold text-foreground mt-5 mb-2">{line.replace("## ", "")}</h2>;
            }
            if (line.startsWith("# ")) {
              return <h1 key={lIdx} className="text-xl font-extrabold text-foreground mt-6 mb-3">{line.replace("# ", "")}</h1>;
            }

            // Bullet items
            if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
              const content = line.trim().substring(2);
              return (
                <li key={lIdx} className="list-disc ml-5 text-zinc-300 font-normal">
                  {renderInlineFormatting(content)}
                </li>
              );
            }

            return (
              <p key={lIdx} className="text-zinc-300 font-normal leading-relaxed break-words">
                {renderInlineFormatting(line)}
              </p>
            );
          })}
        </div>
      );
    });
  };

  const renderInlineFormatting = (text: string) => {
    // Basic bold **text** matching
    const boldParts = text.split(/(\*\*.*?\*\*)/g);
    return boldParts.map((p, i) => {
      if (p.startsWith("**") && p.endsWith("**")) {
        return <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>;
      }
      // Inline code `code` matching
      const codeParts = p.split(/(`.*?`)/g);
      return codeParts.map((cp, ci) => {
        if (cp.startsWith("`") && cp.endsWith("`")) {
          const val = cp.slice(1, -1);

          // Check if the backtick content is a file path or known configuration file
          const isFileRegex = /\.(md|py|js|ts|tsx|jsx|json|html|css|sh|yml|yaml|sql|txt|ini|conf)$/i;
          const commonFiles = ["dockerfile", "makefile", "license", "gemfile", "pipfile", "gitignore", "package.json"];
          const isFile = isFileRegex.test(val.toLowerCase()) || commonFiles.includes(val.toLowerCase()) || (val.includes("/") && !val.includes(" "));

          if (activeRepo && isFile) {
            const cleanPath = val.replace(/^\.\//, "");
            const gitHubLink = `https://github.com/${activeRepo}/blob/main/${cleanPath}`;
            return (
              <a
                key={ci}
                href={gitHubLink}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/40 px-1.5 py-0.5 rounded text-xs text-accent font-mono transition-colors underline decoration-accent/40 hover:decoration-accent"
                title={`Open ${val} on GitHub`}
              >
                {val}
              </a>
            );
          }

          return <code key={ci} className="bg-zinc-800/80 px-1.5 py-0.5 rounded text-xs text-accent font-mono">{val}</code>;
        }
        return cp;
      });
    });
  };





  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground font-sans">
      {/* 1. SIDEBAR */}
      <AnimatePresence>
        {chatStarted && sidebarOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="h-full shrink-0 border-r border-border bg-card/60 flex flex-col min-w-0"
          >
            {/* Logo */}
            <div className="h-16 flex items-center px-6 border-b border-border gap-2 shrink-0">
              <Code className="h-5 w-5 text-accent" />
              <span className="font-serif font-bold text-lg tracking-wide text-foreground">RepoGPT</span>
            </div>

            {/* Main sidebar contents */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* Repos list */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-medium tracking-wider text-zinc-400 uppercase px-2">
                  <span>Indexed Codebases</span>
                  <button
                    onClick={() => setChatStarted(false)}
                    className="hover:text-accent transition-colors"
                    title="Add new repository"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="space-y-1">
                  {indexedRepos.map((r) => (
                    <div
                      key={r.repoName}
                      onClick={() => handleSelectIndexedRepo(r.repoName)}
                      className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-all ${activeRepo === r.repoName
                        ? "bg-zinc-800 text-foreground"
                        : "text-zinc-400 hover:bg-zinc-900/60 hover:text-foreground"
                        }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FolderOpen className={`h-4 w-4 shrink-0 ${activeRepo === r.repoName ? "text-accent" : ""}`} />
                        <span className="text-sm truncate font-medium">{r.repoName}</span>
                      </div>
                      <button
                        onClick={(e) => handleDeleteRepoClick(r.repoName, e)}
                        className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all p-1"
                        title="Delete codebase"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {indexedRepos.length === 0 && (
                    <div className="text-xs text-zinc-400 italic px-2 py-1">No indexed repositories.</div>
                  )}
                </div>
              </div>

              {/* Chats list */}
              <div className="space-y-2">
                <div className="text-[11px] font-medium tracking-wider text-zinc-400 uppercase px-2">
                  <span>Recent Conversations</span>
                </div>
                <div className="space-y-1">
                  {chats.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => handleLoadChat(c.id)}
                      className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-all ${activeChatId === c.id
                        ? "bg-zinc-800/60 text-foreground border border-zinc-700/50"
                        : "text-zinc-400 hover:bg-zinc-900/40 hover:text-foreground"
                        }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <MessageSquare className="h-4 w-4 shrink-0" />
                        <span className="text-sm truncate font-normal">{c.title}</span>
                      </div>
                      <button
                        onClick={(e) => handleDeleteChat(c.id, e)}
                        className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all p-1"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {chats.length === 0 && (
                    <div className="text-xs text-zinc-400 italic px-2 py-1">No past chats.</div>
                  )}
                </div>
              </div>
            </div>

            {/* Sidebar Footer */}
            <div className="p-4 border-t border-border shrink-0 text-center space-y-2">
              <div className="text-[11px] font-mono tracking-wider text-zinc-400">
                RepoGPT Workspace
              </div>
              <button
                onClick={handlePurgeSession}
                className="w-full text-[11px] py-1.5 px-3 rounded-lg border border-border bg-card/40 hover:bg-red-950/20 hover:text-red-400 text-zinc-300 font-medium transition-all cursor-pointer"
              >
                Reset Workspace
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. MAIN WORKSPACE CONTENT */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        <AnimatePresence mode="wait">
          {/* Landing State */}
          {!chatStarted ? (
            <motion.div
              key="landing"
              initial={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.4 }}
              className="relative flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto bg-zinc-950"
            >
              {/* Vanta.js 3D WebGL Canvas Backdrop */}
              <div ref={vantaRefCallback} className="absolute inset-0 z-0 pointer-events-none" />

              {/* Header navbar Workspace toggle */}
              <div className="absolute top-6 right-6 flex items-center gap-3 z-10">
                {indexedRepos.length > 0 && (
                  <button
                    onClick={() => setChatStarted(true)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border bg-card/60 hover:bg-muted text-sm font-medium transition-all text-zinc-300 cursor-pointer"
                  >
                    Open Workspace <ArrowRight className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Main Landing panel */}
              <div className="w-full max-w-2xl text-center space-y-8 py-12 relative z-10">

                {/* HEADING (Playfair Serif font, customized premium gradient keyword) */}
                <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white font-serif leading-tight">
                  Understand any <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 italic font-serif font-bold">codebase</span> instantly.
                </h1>

                <p className="text-zinc-300 text-base md:text-lg max-w-lg mx-auto font-normal leading-relaxed">
                  Provide a direct GitHub repository link or search a username to fetch and chat with repositories in real-time.
                </p>

                {/* Sliding Search Mode Selector */}
                <div className="flex justify-center mt-6">
                  <div className="relative flex bg-zinc-950 p-1.5 rounded-xl border border-border w-80">
                    <button
                      type="button"
                      onClick={() => { setSearchMode("url"); setSelectedRepo(null); }}
                      className={`flex-1 text-center py-2 text-sm font-medium rounded-lg relative z-10 transition-all ${searchMode === "url" ? "text-white" : "text-zinc-400 hover:text-white"
                        }`}
                    >
                      Repository URL
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSearchMode("username"); setSearchedRepos([]); }}
                      className={`flex-1 text-center py-2 text-sm font-medium rounded-lg relative z-10 transition-all ${searchMode === "username" ? "text-white" : "text-zinc-400 hover:text-white"
                        }`}
                    >
                      GitHub Username
                    </button>
                    {/* Sliding indicator bg */}
                    <motion.div
                      className="absolute inset-y-1.5 bg-zinc-800 rounded-lg shadow-md"
                      layout
                      style={{
                        width: "calc(50% - 12px)",
                        left: searchMode === "url" ? "8px" : "calc(50% + 4px)",
                      }}
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    />
                  </div>
                </div>

                {/* Inputs area */}
                <div className="relative min-h-[90px]">
                  {/* Mode: URL */}
                  {searchMode === "url" && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex gap-2 max-w-lg mx-auto bg-zinc-950/80 p-2 rounded-2xl border border-border glowing-glow"
                    >
                      <div className="flex-1 flex items-center px-3 gap-2">
                        <Github className="h-5 w-5 text-zinc-400" />
                        <input
                          type="url"
                          placeholder="https://github.com/owner/repo"
                          value={repoUrl}
                          onChange={(e) => setRepoUrl(e.target.value)}
                          className="bg-transparent border-0 outline-none w-full text-sm text-foreground placeholder:text-zinc-400"
                          disabled={isIndexing}
                        />
                      </div>
                      <button
                        onClick={() => handleIndexRepo(repoUrl)}
                        disabled={isIndexing || !repoUrl.trim()}
                        className="bg-accent hover:bg-sky-500 text-black px-6 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center gap-1.5 disabled:opacity-50 select-none cursor-pointer"
                      >
                        Index Repo
                      </button>
                    </motion.div>
                  )}

                  {/* Mode: USERNAME */}
                  {searchMode === "username" && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-4"
                    >
                      <div className="flex gap-2 max-w-lg mx-auto bg-zinc-950/80 p-2 rounded-2xl border border-border glowing-glow">
                        <div className="flex-1 flex items-center px-3 gap-2">
                          <Search className="h-5 w-5 text-zinc-400" />
                          <input
                            type="text"
                            placeholder="Enter GitHub username (e.g. Udx3012)"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSearchRepos()}
                            className="bg-transparent border-0 outline-none w-full text-sm text-foreground placeholder:text-zinc-400"
                            disabled={isIndexing}
                          />
                        </div>
                        <button
                          onClick={handleSearchRepos}
                          disabled={searchingRepos || !username.trim()}
                          className="bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center gap-1.5 disabled:opacity-50 select-none cursor-pointer"
                        >
                          {searchingRepos ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
                        </button>
                      </div>

                      {/* Username repos list */}
                      {searchedRepos.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="max-w-xl mx-auto border border-border bg-card/40 rounded-2xl overflow-hidden max-h-64 overflow-y-auto"
                        >
                          <div className="text-left text-xs font-semibold text-zinc-400 border-b border-border bg-zinc-950/60 px-4 py-2 flex items-center justify-between">
                            <span>Found {searchedRepos.length} public repositories</span>
                            {selectedRepo && <span className="text-accent">Selected: {selectedRepo.name}</span>}
                          </div>
                          <div className="divide-y divide-border/60">
                            {searchedRepos.map((r) => (
                              <div
                                key={r.fullName}
                                onClick={() => setSelectedRepo(r)}
                                className={`flex items-center justify-between p-3 text-left cursor-pointer transition-all ${selectedRepo?.fullName === r.fullName
                                  ? "bg-zinc-800/40"
                                  : "hover:bg-zinc-900/40"
                                  }`}
                              >
                                <div className="min-w-0 pr-4">
                                  <div className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                                    <span>{r.name}</span>
                                    {r.language && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium">
                                        {r.language}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-zinc-400 truncate mt-0.5 max-w-sm">
                                    {r.description || "No description provided."}
                                  </div>
                                </div>
                                <div className="flex items-center gap-4 shrink-0">
                                  <div className="text-xs text-zinc-300 flex items-center gap-1 select-none font-medium">
                                    ★ {r.stars}
                                  </div>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleIndexRepo(r.htmlUrl);
                                    }}
                                    className="bg-accent hover:bg-sky-500 text-black text-xs font-semibold px-3 py-1.5 rounded-lg select-none"
                                  >
                                    Index
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </motion.div>
                  )}
                </div>
              </div>

              {/* INDEXING LOADER MODAL */}
              <AnimatePresence>
                {isIndexing && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
                  >
                    <div className="w-full max-w-md bg-card border border-border rounded-3xl p-6 text-center space-y-6 shadow-2xl glassmorphism">
                      <div className="flex justify-center">
                        <div className="relative flex items-center justify-center">
                          <Loader2 className="h-12 w-12 text-accent animate-spin" />
                          <Database className="h-5 w-5 text-white absolute" />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <h2 className="text-lg font-bold text-white font-serif">Indexing Repository</h2>
                        <p className="text-zinc-400 text-sm font-normal">This takes a few seconds while we ingest & embed the codebase.</p>
                      </div>

                      {/* Steps list */}
                      <div className="text-left bg-zinc-950/80 rounded-2xl p-4 border border-border/80 space-y-2.5">
                        {indexingStepsList.map((step, idx) => {
                          const isActive = idx === indexingStep;
                          const isDone = idx < indexingStep;
                          return (
                            <div
                              key={step}
                              className={`flex items-center gap-3 text-xs transition-all ${isActive
                                ? "text-accent font-semibold"
                                : isDone
                                  ? "text-emerald-400"
                                  : "text-zinc-400"
                                }`}
                            >
                              <div className="w-4 flex justify-center">
                                {isDone ? (
                                  <span>✓</span>
                                ) : isActive ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <span className="text-[10px] text-zinc-400 font-mono">•</span>
                                )}
                              </div>
                              <span className="truncate">{step}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ) : (
            /* Chat Workspace State */
            <motion.div
              key="chat"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
              className="flex-1 flex flex-col h-full min-h-0 bg-background"
            >
              {/* Workspace Header */}
              <header className="h-16 border-b border-border bg-card/25 flex items-center justify-between px-6 shrink-0 z-10">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={() => setSidebarOpen(prev => !prev)}
                    className="p-2 -ml-2 rounded-lg hover:bg-zinc-900 text-zinc-400 hover:text-foreground transition-colors"
                  >
                    <FolderOpen className="h-4 w-4" />
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground truncate">{activeRepo}</span>
                    </div>
                    <p className="text-[10px] text-zinc-400 font-mono">
                      {activeChatId ? `Session: #${activeChatId.substring(0, 8)}` : "New Conversation"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleNewChat()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-zinc-900/50 hover:bg-zinc-800 text-xs font-semibold text-zinc-300 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New Chat
                  </button>
                  <button
                    onClick={() => setChatStarted(false)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-border text-xs font-semibold text-zinc-300 transition-colors"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Change Repo
                  </button>
                </div>
              </header>

              {/* Message List */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {messages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4">
                    <div className="p-3 bg-zinc-900/80 rounded-2xl border border-border">
                      <MessageSquare className="h-6 w-6 text-accent" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-foreground">Workspace Initialized</h3>
                      <p className="text-xs text-zinc-400 font-normal leading-relaxed">
                        I have parsed, chunked, and embedded the files of <span className="font-semibold text-zinc-300">{activeRepo}</span>.
                        Ask me anything about this codebase.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-2 w-full pt-4">
                      {[
                        "How does this codebase handle entry points?",
                        "What is the system design and file structure?",
                        "Search where databases or clients are initialized.",
                        "Are there any configuration or env variables?"
                      ].map((suggestion) => (
                        <button
                          key={suggestion}
                          onClick={() => { setInputMessage(suggestion); }}
                          className="p-3 text-left text-xs bg-card/40 border border-border rounded-xl hover:bg-zinc-900/40 text-zinc-400 hover:text-zinc-200 transition-colors truncate"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {loadingMessages ? (
                  <div className="h-full flex items-center justify-center">
                    <Loader2 className="h-8 w-8 text-accent animate-spin" />
                  </div>
                ) : (
                  messages.map((m, idx) => (
                    <div key={idx} className="space-y-4 max-w-3xl mx-auto">
                      {/* User message */}
                      <div className="flex justify-end">
                        <div className="bg-zinc-800 text-foreground px-4 py-3 rounded-2xl rounded-tr-sm max-w-[85%] text-sm font-medium shadow-sm">
                          {m.q}
                        </div>
                      </div>

                      {/* Assistant message */}
                      <div className="flex justify-start">
                        <div className="bg-card/40 border border-border/80 px-5 py-4 rounded-2xl rounded-tl-sm max-w-[90%] text-sm shadow-sm space-y-2">
                          <div className="flex items-center gap-1.5 text-zinc-400 text-[10px] font-bold uppercase tracking-wider mb-2 select-none">
                            <Sparkles className="h-3 w-3 text-accent" />
                            <span>RepoGPT</span>
                          </div>
                          {m.a ? (
                            <div className="markdown-body select-text">{renderMarkdown(m.a)}</div>
                          ) : (
                            <div className="flex items-center gap-2 text-zinc-400 py-1 font-normal italic">
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                              Thinking...
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}

                {/* Scroll Anchor */}
                <div ref={chatBottomRef} />
              </div>

              {/* Chat Input */}
              <div className="p-4 border-t border-border shrink-0 bg-card/10">
                <form onSubmit={handleSendMessage} className="max-w-3xl mx-auto flex items-center gap-2 bg-zinc-950 p-2 rounded-2xl border border-border glowing-glow">
                  <input
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder={`Ask a question about ${activeRepo}...`}
                    disabled={sendingQuery}
                    className="flex-1 bg-transparent border-0 outline-none px-3 text-sm text-foreground placeholder:text-zinc-400"
                  />
                  <button
                    type="submit"
                    disabled={!inputMessage.trim() || sendingQuery}
                    className="h-9 w-9 flex items-center justify-center rounded-xl bg-accent text-black hover:bg-sky-500 transition-colors disabled:opacity-50 cursor-pointer shrink-0"
                    title="Send query"
                  >
                    {sendingQuery ? <Loader2 className="h-4 w-4 animate-spin" /> : <CornerDownLeft className="h-4 w-4" />}
                  </button>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {/* Delete Confirmation Modal */}
      {repoToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-zinc-100 mb-2">Delete Codebase</h3>
            <p className="text-zinc-400 text-sm mb-6 leading-relaxed font-normal">
              Are you sure you want to delete <span className="font-semibold text-zinc-200">{repoToDelete}</span> from your index? This will remove all associated vector embeddings and chat history.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRepoToDelete(null)}
                className="px-4 py-2 text-sm font-medium rounded-xl bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-300 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteRepo}
                className="px-4 py-2 text-sm font-medium rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/20 transition-colors cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ChatPage;
