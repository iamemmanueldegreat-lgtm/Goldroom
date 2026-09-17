-- Additive. Run once in Supabase SQL Editor after schema.sql.

create table if not exists goldroom_users (
  chat_id bigint primary key,
  username text not null default '',
  balance_cents int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists goldroom_deposits (
  id text primary key,
  chat_id bigint not null,
  username text not null default '',
  pay_amount text not null,
  pay_asset text not null,
  address text not null,
  credit_cents int not null,
  status text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  credited_at timestamptz
);

create table if not exists goldroom_purchases (
  id text primary key,
  chat_id bigint not null,
  denom int not null,
  retail_cents int not null,
  cost_usd text,
  fazer_order_id text,
  pin text,
  serial text,
  status text not null,
  created_at timestamptz not null default now()
);

alter table goldroom_users enable row level security;
alter table goldroom_deposits enable row level security;
alter table goldroom_purchases enable row level security;
