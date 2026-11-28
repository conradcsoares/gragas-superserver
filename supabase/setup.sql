-- Gragas Superserver: personal links (login without accounts) + role preferences.
-- Paste this whole file into Supabase → SQL Editor → Run. Safe to re-run.
--
-- Nothing secret is in this file or the repo. Visitors can read role preferences but cannot touch any table
-- directly: every change goes through the functions below, which check the caller's personal code.
-- Codes are kept so admins can copy a player's link again later; only admin-checked functions return them.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- replaces the earlier (unused) voting setup ----------
drop function if exists whoami(text), cast_vote(text, text, text, text), my_votes(text),
  open_poll(text, text, text[], text[], text), close_poll(text, text), reopen_poll(text, text), delete_poll(text, text),
  create_link(text, text, boolean), revoke_link(text, text), list_links(text), set_admin(text, text, boolean),
  first_admin(text), link_for(text), admin_for(text), new_code(), pick_from(text[], text), recount(text), leader(jsonb) cascade;
drop table if exists votes, polls cascade;
-- The old links table stored only hashes (links couldn't be copied again). Replace it if it's that version.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'links' and column_name = 'code_hash') then
    drop table links cascade;
  end if;
end $$;

-- ---------- tables ----------
create table if not exists links (
  id uuid primary key default extensions.gen_random_uuid(),
  player text not null,                 -- Riot ID of the player (their main account), e.g. 'ArsDerps#NA1'
  code text not null unique,            -- the secret in their link: …/#me=<code>
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists links_one_active on links (lower(replace(player, ' ', ''))) where revoked_at is null;

create table if not exists roles (
  player_key text primary key,          -- normalised Riot ID (lowercase, no spaces), same as keyOf() in core.js
  player text not null,                 -- Riot ID as written
  roles text[] not null,                -- favourite first; any 1–5 different roles (unlisted = least wanted)
  updated_at timestamptz not null default now()
);
-- Earlier versions required all five roles; allow a partial list (e.g. just a main and a second pick).
alter table roles drop constraint if exists roles_roles_check;
alter table roles drop constraint if exists roles_valid;
create or replace function roles_ok(r text[]) returns boolean language sql immutable set search_path = public as $$
  select coalesce(array_length(r, 1), 0) between 1 and 5
    and r <@ array['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']
    and array_length(r, 1) = (select count(distinct x) from unnest(r) x)
$$;
alter table roles add constraint roles_valid check (roles_ok(roles));

alter table links enable row level security;
alter table roles enable row level security;
-- Role preferences are public (the team balancer uses them); links are private (no policy = no access).
drop policy if exists "roles are public" on roles;
create policy "roles are public" on roles for select to anon, authenticated using (true);
grant select on roles to anon, authenticated;
revoke all on links from anon, authenticated;
revoke insert, update, delete on roles from anon, authenticated;

-- ---------- helpers ----------
-- Riot IDs: ignore case and spaces (same as keyOf() in core.js).
create or replace function norm(t text) returns text language sql immutable set search_path = public as $$ select lower(replace(t, ' ', '')) $$;

create or replace function new_code() returns text language sql volatile set search_path = public, extensions as $$
  select encode(gen_random_bytes(16), 'hex')
$$;

-- The working link for a code, or an error.
create or replace function link_for(p_code text) returns links
language plpgsql security definer set search_path = public as $$
declare l links;
begin
  select * into l from links where code = coalesce(p_code, '') and revoked_at is null;
  if not found then raise exception 'This link isn''t valid any more. Ask an admin for a new one.'; end if;
  return l;
end $$;

create or replace function admin_for(p_code text) returns links
language plpgsql security definer set search_path = public as $$
declare l links := link_for(p_code);
begin
  if not l.is_admin then raise exception 'Only admins can do that.'; end if;
  return l;
end $$;

-- ---------- anyone with a link ----------
-- Who a link belongs to (the site checks this when a link is opened, and once per visit).
create or replace function whoami(p_code text) returns table (player text, is_admin boolean)
language plpgsql security definer set search_path = public as $$
declare l links := link_for(p_code);
begin
  return query select l.player, l.is_admin;
end $$;

-- Save your own role order, favourite first: 1–5 different roles. An empty list clears your preferences.
create or replace function set_roles(p_code text, p_roles text[]) returns void
language plpgsql security definer set search_path = public as $$
declare l links := link_for(p_code); r text[] := array(select upper(x) from unnest(coalesce(p_roles, '{}')) x);
begin
  if coalesce(array_length(r, 1), 0) = 0 then
    delete from roles where player_key = norm(l.player);
    return;
  end if;
  if not roles_ok(r) then
    raise exception 'Pick each role at most once: Top, Jungle, Mid, ADC, Support.';
  end if;
  insert into roles (player_key, player, roles) values (norm(l.player), l.player, r)
  on conflict (player_key) do update set player = excluded.player, roles = excluded.roles, updated_at = now();
end $$;

-- ---------- admins ----------
-- A player's link code: their current one, or a new one if they don't have a link yet.
create or replace function get_link(p_code text, p_player text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare c text;
begin
  perform admin_for(p_code);
  select code into c from links where norm(player) = norm(p_player) and revoked_at is null;
  if c is null then
    c := new_code();
    insert into links (player, code) values (p_player, c);
  end if;
  return c;
end $$;

-- Replace a player's link: the old one stops working at once. Keeps their admin setting. Returns the new code.
create or replace function reissue_link(p_code text, p_player text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare me links := admin_for(p_code); c text := new_code(); was_admin boolean;
begin
  if norm(me.player) = norm(p_player) then raise exception 'You can''t reissue your own link from here.'; end if;
  select is_admin into was_admin from links where norm(player) = norm(p_player) and revoked_at is null;
  update links set revoked_at = now() where norm(player) = norm(p_player) and revoked_at is null;
  insert into links (player, code, is_admin) values (p_player, c, coalesce(was_admin, false));
  return c;
end $$;

-- Turn admin on/off for a player (creates their link if they don't have one).
create or replace function set_admin(p_code text, p_player text, p_admin boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare me links := admin_for(p_code);
begin
  if norm(me.player) = norm(p_player) and not p_admin then raise exception 'You can''t remove your own admin.'; end if;
  if not exists (select 1 from links where norm(player) = norm(p_player) and revoked_at is null) then
    insert into links (player, code) values (p_player, new_code());
  end if;
  update links set is_admin = p_admin where norm(player) = norm(p_player) and revoked_at is null;
end $$;

-- Everyone who has a working link (no codes; use get_link to copy one).
create or replace function list_links(p_code text) returns table (player text, is_admin boolean, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform admin_for(p_code);
  return query select l.player, l.is_admin, l.created_at from links l where l.revoked_at is null order by lower(l.player);
end $$;

-- ---------- first admin (run once, by hand, in the SQL editor) ----------
--   select first_admin('YourName#TAG');
-- It returns your code; your link is  https://conradcsoares.github.io/gragas-superserver/#me=<code>
-- Only works while nobody has a link yet, and visitors can't call it.
create or replace function first_admin(p_player text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare c text := new_code();
begin
  if exists (select 1 from links) then raise exception 'There are already links. Use an admin link to make more.'; end if;
  insert into links (player, code, is_admin) values (p_player, c, true);
  return c;
end $$;

-- ---------- who can call what ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function whoami(text), set_roles(text, text[]), get_link(text, text), reissue_link(text, text),
  set_admin(text, text, boolean), list_links(text) to anon, authenticated;
