# Gragas Superserver: guide for agents

An Elo ladder for a friend group's 5v5 League of Legends customs. Static site (plain HTML/CSS/JS, **no build step,
no package.json**) on GitHub Pages, with game data in `data/league.json` in this repo. The site itself commits to
the repo when someone publishes, so `main` changes underneath you. Read `README.md` for the user-facing feature
list; this file and `docs/` cover how it works.

## Docs

| File | What it covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Files, state, rendering, routing, loading, publishing, live updates |
| [docs/data.md](docs/data.md) | `league.json`, `ranks.json`, what `compute()` returns, identity rules |
| [docs/ratings-and-balancing.md](docs/ratings-and-balancing.md) | Elo, rank bands, the team balancer, Solo/Duo blend |
| [docs/ui.md](docs/ui.md) | Screens, UI conventions and the owner's design decisions |
| [docs/supabase.md](docs/supabase.md) | What Supabase is used for, `supabase/setup.sql`, security model |
| [docs/roadmap.md](docs/roadmap.md) | Agreed-but-unbuilt work, with the decided specs |

## Files

| File | Role |
|---|---|
| `index.html` | Shell: header, `#view`, script tags (load order: core → emblems → stats → app) |
| `core.js` | Pure logic shared with the trailer: ranks, `compute()` (Elo), `balanceTeams()`, Solo/Duo blend |
| `emblems.js` | SVG rank emblems, custom #1 picture loading |
| `stats.js` | Rating history chart, player pages, shared player links |
| `app.js` | Everything else: state, GitHub sync, rendering, team screen, screenshot OCR, admin panels, live updates |
| `style.css` | All styles. Dark only, tokens in `:root` |
| `trailer.html` | Self-contained hype trailer built from the live ladder |
| `data/league.json` | The ladder. **Written by the site's Publish**, rarely by hand |
| `data/ranks.json` | Solo/Duo ranks, refreshed by hand with `tools/fetch-ranks.mjs` |
| `assets/` | Uploaded #1 pictures (written by the site) |
| `supabase/setup.sql` | Database setup for planned personal links + roles (see docs/supabase.md) |

## Working rules

- **Cache busting:** every script/stylesheet tag has `?v=N`. After changing any of `core.js`, `emblems.js`,
  `stats.js`, `app.js` or `style.css`, bump **all** `?v=` in `index.html` and `trailer.html` to one new number
  higher than any seen (check `origin/main` too). Merge conflicts on `main` are almost always these numbers:
  keep the side that has the full script list, then set every `?v=` to a fresh higher number.
- **Pull before push.** Expect `Update ladder (N games)` / `Update #1 picture` commits from the site. They only touch
  `data/` and `assets/`; never overwrite them with a stale copy.
- **Pushing `main` deploys** (GitHub Pages, about a minute). Commit/push only when the owner asks.
- **Secrets:** nothing secret belongs in the repo. The Supabase URL and publishable key in `app.js` are public by
  design. The Riot API key and any Supabase personal access token are passed via environment for one run and never
  written to files.
- **Local run:** `python3 -m http.server 8000`, open http://localhost:8000 (`#admin` unlocks recording on that
  device). Off github.io, the repo falls back to `conradcsoares/gragas-superserver`, so **Publish with a key
  writes to the live ladder**, and page loads read the live ladder from GitHub's API, not the local file.
- **Testing:** there's no test suite. Check syntax with `node --check <file>`. Test behaviour in headless Chrome
  (`/Applications/Google Chrome.app/...` with `--headless=new --dump-dom` / `--screenshot`) against a scratch copy
  of `index.html` that injects a test script. Pure logic in `core.js` can be loaded in Node with `eval`. Use
  `--virtual-time-budget` and report results via `document.title`. Screenshots after `scrollTo` come out blank:
  hide the cards above instead.
- **Names in user-facing text:** a player is shown as `RiotName#TAG (Nickname)` via `fullName()`; the compact
  match cards and chart labels are the agreed exceptions (see docs/ui.md).
- **Style of code:** small functions, template-string rendering, `esc()` on every interpolated value, comments
  explain *why*. Keep `core.js` free of DOM access so the trailer and Node can use it.
