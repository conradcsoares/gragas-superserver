# Supabase

Project: `https://dxwretijaangbpwxkvbk.supabase.co` (free plan). The URL and **publishable** key live in `app.js`
(`LIVE`) and are public by design; never put the secret/service_role key or a personal access token in the repo.

## In use today: the live-update doorbell

Realtime **broadcast** on channel `ladder`, event `updated`, no tables. See docs/architecture.md → Live updates. If the
project is unreachable or paused, pages fall back to the ~1-minute Pages check, so nothing breaks.

Free projects pause after about a week without database activity; resume from the dashboard. (Broadcast-only use may
not count as activity.)

## Personal links and roles: `supabase/setup.sql` (applied 2026-11-28)

Personal links (login without accounts) and role preferences. The file is re-runnable (SQL Editor → Run) and is the
source of truth for the schema; it removed the earlier voting setup. Verified on the live project through the public
API: bad codes get `P0001`, `links` and `first_admin` are closed to visitors, `roles` is readable, partial role lists
save, duplicates/unknown roles are refused. (A revoked test link for `ZZTest#TEST` remains in `links`; harmless.)
The security advisor's "anon can execute SECURITY DEFINER" warnings are expected: those functions check the code.

### Tables

| Table | Contents | Access |
|---|---|---|
| `links` | `player` (Riot ID of a main), `code` (the secret in `#me=<code>`), `is_admin`, `revoked_at` | none directly |
| `roles` | `player_key` (`keyOf`), `player`, `roles` (1–5 different roles, favourite first; `roles_ok()`), `updated_at` | public read |

Codes are stored as-is (not hashed) so admins can copy a player's link again; only admin-checked functions return them.

### Functions (all `security definer`, granted to `anon`)

| Function | Who | Does |
|---|---|---|
| `whoami(code)` | link owner | → `player`, `is_admin`; errors if invalid/revoked |
| `set_roles(code, roles[])` | link owner | save own order: 1–5 of TOP, JUNGLE, MID, ADC, SUPPORT, each at most once; empty clears |
| `get_link(code, player)` | admin | that player's current code, creating one if needed |
| `reissue_link(code, player)` | admin | new code, old one dead, admin flag kept; not for yourself |
| `set_admin(code, player, bool)` | admin | creates a link if needed; can't remove your own admin |
| `list_links(code)` | admin | players with a working link + admin flag (no codes) |
| `first_admin(player)` | dashboard only | first admin link; only while no links exist |

The site calls these through supabase-js `rpc()` with the code stored on the device. Tables are protected by RLS with
no policies except public read on `roles`.

### One-time setup (done)

1. `supabase/setup.sql` run in the SQL Editor.
2. `select first_admin('ArsDerps#NA1');` run by the owner; the link is
   `https://conradcsoares.github.io/gragas-superserver/#me=<code>`.

## Agent access

The owner has added the official Supabase MCP server for this project
(`claude mcp add --transport http supabase "https://mcp.supabase.com/mcp?project_ref=dxwretijaangbpwxkvbk"`). Its tools
only appear in sessions started after it was added. The owner wants agents to do the database work
themselves; confirm before anything destructive. Write tools may still need to be allowed in Claude Code's permissions.
