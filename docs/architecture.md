# Architecture

## Overview

```
GitHub Pages ── serves ──► index.html + core.js, emblems.js, stats.js, app.js, style.css
                                │
browser (app.js) ── reads ────► GitHub Contents API: data/league.json   (live, no Pages delay)
                 ── reads ────► data/ranks.json (Pages copy; changes rarely)
                 ── writes ───► GitHub Contents API (PUT) on Publish, with the user's fine-grained token
                 ── rings / ──► Supabase Realtime broadcast channel "ladder" (doorbell for live updates)
                    listens
```

No server of our own. Everything runs in the visitor's browser; outside services are called directly from there.

## State and rendering

- One global state object `S` in `app.js`: `data` (the ladder, possibly with local edits), `base`/`baseData` (the live
  copy those edits started from), `stats` (`compute(S.data)`), `blend`, `ranks`, `form` (team screen), `tab`,
  `page`, flags.
- `update()` recomputes `S.stats` and `S.blend`, then `render()`.
- `render()` rebuilds `#view` from template strings (`innerHTML`), then `drawCharts()` draws any `.rchart`
  containers (charts need the measured width, so they are drawn after insertion).
- All clicks go through one delegated listener keyed on `data-act` attributes (`switch (act)` near the end of `app.js`).
- Per-device conveniences use `localStorage` through `store.get/set/del` (all wrapped in try/catch):
  `cl.github` (token), `cl.draft` (unpublished edits), `cl.form2` (team screen, incl. `roles` and `locks`),
  `cl.admin`, `cl.chartSel2` (chart selection), `cl.crownImg` (cached #1 picture), `cl.me` (personal link
  `{ code, player, admin }`), `cl.balMode` (Adjusted/Normal).

## Routing (hash based)

| Hash | View |
|---|---|
| `#rankings` (default, also empty) | Podium + ladder (+ admin panels) |
| `#history` | Rating history chart |
| `#games` | Match cards |
| `#p/<encoded Riot ID>` | Player page (alts resolve to their main at render time) |
| `#admin` | One-time: unlocks recording on this device, then removed from the URL (legacy; admin links do the same) |
| `#me=<code>` | Personal link: stores the code, removes it from the URL at once, checks `whoami` |

The team screen (`S.form`) renders above the tab bar on any tab. Opening it from a player page jumps back to the tabs.

## Loading the ladder

`load()` → `fetchLive()` reads `data/league.json` through the **GitHub Contents API** (authenticated with the token if
present, raw media type otherwise), so a reload is never behind a publish. If that fails (offline, rate limit: 60
unauthenticated requests/hour per network, and 304s *do* count), it falls back to the GitHub Pages copy.

## Publishing (multi-writer safe)

- Any edit (`commit(fn)`) changes `S.data` locally and saves a **draft** of *edits* (data + the base it came from),
  not a whole-ladder copy. The "Not published yet" banner offers Publish / Discard.
- `publish()` fetches the live file, and if it moved on, re-applies this device's edits on top (`applyEdits`: a
  three-way merge of games, links, nicks, settings), then PUTs with the file's `sha`. A 409/422 race is retried.
  One person's publish never wipes another's.
- Only collaborators can publish: the token is a fine-grained PAT with Contents read/write on this repo, stored only
  in that browser.

## Live updates

1. **Doorbell (instant).** After a successful publish the publisher sends a broadcast `updated` on the Supabase
   Realtime channel `ladder`. Every open page hears it and fetches the ladder from GitHub's API. The message carries
   no data, so a fake ring can only cause a harmless re-check. Config: `LIVE = { url, key }` in `app.js`
   (supabase-js loaded from jsDelivr on demand).
2. **Fallback (~1 min).** Every 15 s (`PAGES_EVERY`) and on tab focus, check the Pages copy (no rate limit). A
   different copy is confirmed through GitHub's API once per change before it's shown, so a page never rolls back to
   an older ladder while Pages is still deploying.
3. Updates never redraw while the user is typing in a field; unpublished local edits are kept (`load()` re-applies them).

## Personal links and roles (Supabase)

`sb()` loads supabase-js once (shared with the doorbell); `rpc(fn, args)` calls the database functions in
docs/supabase.md. On each visit `checkMe()` calls `whoami`: a refused code (Postgres error `P0001`) logs out with a
message; network errors keep the saved login. `loadRoles()` reads the public `roles` table once per load into
`S.roleRows`; `update()` maps them to `S.roles` by main player's key. `canEdit()` is true for admin links too.

## #1 picture

An admin can upload an image for the #1 emblem: saved as a new file under `assets/` (unique name, no cache issues),
`settings.crownImg` points at it, old file deleted. `emblems.js` loads it as a data URL (so the trailer's canvas can
draw it), caches it in `localStorage`, and retries for a while after a live update because Pages may not have
deployed the file yet.

## Other pieces

- **Screenshot import** (`app.js`): Tesseract.js (CDN) reads the post-game scoreboard locally; names are fuzzy-matched
  to known players; unknown names ask for a `#TAG` once.
- **Trailer** (`trailer.html`): canvas animation from `compute()`; records to video with MediaRecorder.
- **Solo/Duo ranks** are fetched by hand: `RIOT_API_KEY=RGAPI-... node tools/fetch-ranks.mjs` (account-v1 on
  `americas` → league-v4 by PUUID on `na1`), writing `data/ranks.json`. The browser can't call Riot's API (key must
  stay private, no CORS). See docs/ratings-and-balancing.md for how ranks are used.
