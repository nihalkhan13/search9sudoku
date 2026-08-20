-- Search Nine production data model.
-- Run this once in Supabase SQL Editor, then add the service-role key only to
-- Vercel server-side environment variables. Never ship that key to the browser.

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  password_hash text not null,
  country text not null default 'US',
  state text,
  created_at timestamptz not null default now()
);

-- Safe migration for accounts created before profile locations were added.
alter table public.users add column if not exists country text not null default 'US';
alter table public.users add column if not exists state text;

create unique index if not exists users_username_lower_idx on public.users (lower(username));

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  puzzle_id text not null,
  date_seed date,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  time_ms integer not null check (time_ms > 0),
  check_count integer not null default 0 check (check_count >= 0),
  grid text not null,
  created_at timestamptz not null default now(),
  unique (user_id, puzzle_id)
);

create index if not exists scores_puzzle_idx on public.scores (puzzle_id, created_at);

create table if not exists public.friendships (
  user_id uuid not null references public.users(id) on delete cascade,
  friend_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

alter table public.users enable row level security;
alter table public.scores enable row level security;
alter table public.friendships enable row level security;

-- The Vercel API uses the Supabase service-role key and performs all access
-- checks server-side. No public anon policies are needed for this design.
