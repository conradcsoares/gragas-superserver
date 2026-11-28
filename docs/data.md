# Data

## `data/league.json` (written by the site)

```jsonc
{
  "version": 2,
  "settings": { "leagueName": "Gragas Superserver", "region": "na", "crownImg": "assets/crown-….webp" },
  "games": [
    { "id": "g…", "date": "2026-11-27", "blue": ["Name#TAG", …5], "red": [… 5],
      "winner": "blue" | "red",
      "series": "s…",          // optional: games recorded together (Bo3 etc.) share it
      "mvp": "Name#TAG",       // optional: on the winning team
      "ace": "Name#TAG" }      // optional: on the losing team
  ],
  "links": [ { "alt": "Karna#0322", "main": "WidePeepoTired#NA1" } ],  // alt accounts count toward a main
  "nicks": [ { "id": "Jola#ten", "nick": "Conrad" } ]                  // real names, display only
}
```

- `blue` is shown as **Team 1** (left), `red` as **Team 2** (right) everywhere.
- Games keep the account that was actually played; alt links are applied at compute time, so unlinking is always safe.
- `normalize()` in `core.js` fills defaults and drops malformed entries. Always pass loaded data through it.
- Games are ordered by `date`, then file order. Game numbers (`n`, 1-based) come from that order and can shift if
  an older game is added or deleted.

## `data/ranks.json` (written by `tools/fetch-ranks.mjs`)

```jsonc
{ "updated": "2026-11-28",
  "players": {
    "jola#ten": { "id": "Jola#ten", "tier": "DIAMOND", "division": "I", "lp": 75, "wins": 60, "losses": 52 },
    "jerry#hey": { "id": "Jerry#hey", "status": "unranked" }      // or "not found"
  } }
```

Keyed by `keyOf(id)`, one entry per account (alts included). Solo/Duo queue only. Refreshed rarely, by hand.

## Identity

- A player is a **Riot ID** `Name#TAG`. `keyOf(id)` = lowercase with spaces removed. This is the identity key
  everywhere (maps, comparisons, URLs resolve through it).
- `resolveWith(links, id)` / `resolveId(id)` map an alt to its main (up to 5 hops).
- Display: `fullName(id)` → `RiotName#TAG (Nickname)`, alts shown as their main.

## What `compute(data)` returns (`core.js`)

| Field | Meaning |
|---|---|
| `P` | `{ [key]: player }`. Insertion order = order of first game (the chart uses this for stable styles) |
| player | `{ id, rating, wins, losses, last, seen, alts, nick, hist }` |
| `hist` | One entry per game played: `{ n, game, date, won, delta, rating, award: 'mvp'|'ace'|null }` |
| `deltas` | `{ [gameId]: { blue, red } }`: team change before MVP/ACE multipliers |
| `ordered` | Games in rating order (date, then file order) |
| `ladder` | Players sorted by rating (ties: wins, then name) |
| `links` | The alt → main map |

Ratings are always recomputed from the full game list, so editing or deleting any game is safe.
