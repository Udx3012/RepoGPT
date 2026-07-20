
-- 1. Create chats table
create table if not exists chats (
  id uuid default gen_random_uuid() primary key,
  user_id text not null,
  title text not null,
  created_at timestamptz default now()
);

-- 2. Create messages table
create table if not exists messages (
  id uuid default gen_random_uuid() primary key,
  chat_id uuid references chats(id) on delete cascade,
  user_id text not null,
  query text not null,
  answer text not null,
  had_pdf boolean default false,
  created_at timestamptz default now()
);

-- 3. Create repo_trees metadata table
create table if not exists repo_trees (
  id uuid default gen_random_uuid() primary key,
  user_id text not null,
  repo_name text not null,
  repo_url text not null,
  file_count integer not null,
  tree jsonb not null,
  indexed_at timestamptz default now(),
  constraint unique_user_repo unique(user_id, repo_url)
);

-- 4. Create repo_chunks database table for vector storage
create table if not exists repo_chunks (
  id uuid default gen_random_uuid() primary key,
  user_id text not null,
  repo_name text not null,
  file_path text not null,
  content text not null,
  embedding float8[] not null, -- double precision array for vector weights
  created_at timestamptz default now()
);

-- 5. Add indexes for performance optimization
create index if not exists idx_chats_user on chats(user_id);
create index if not exists idx_messages_chat on messages(chat_id);
create index if not exists idx_repo_trees_user on repo_trees(user_id);
create index if not exists idx_repo_chunks_search on repo_chunks(user_id, repo_name);
