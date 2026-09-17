-- Paste this once in Supabase → SQL Editor → Run.
-- Service role bypasses RLS; the shop never uses the anon key.

create table if not exists goldroom_pins (
  id text primary key,
  denom int not null,
  pin text not null,
  serial text not null,
  status text not null default 'stock',
  order_id text,
  created_at timestamptz not null default now()
);

create table if not exists goldroom_orders (
  id text primary key,
  chat_id bigint not null,
  username text not null default '',
  denom int not null,
  network text not null,
  pay_amount text not null,
  pay_asset text not null,
  address text not null,
  status text not null,
  pin_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  delivered_at timestamptz
);

create table if not exists goldroom_meta (
  key text primary key,
  value int not null
);

alter table goldroom_pins enable row level security;
alter table goldroom_orders enable row level security;
alter table goldroom_meta enable row level security;
