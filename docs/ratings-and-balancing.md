# Ratings and team balancing

## Elo (`compute()` in `core.js`)

- Everyone starts at `START = 1000`.
- Team strength = average rating. Team 1's expected score = `1 / (1 + 10^((avgRed − avgBlue) / 400))`.
- Every player on a team moves by `round(K × (result − expected))`, `K = 200` (an even game ≈ ±100; high on purpose
  because few customs are played).
- **MVP** (winning team) gains ×1.5, **ACE** (losing team) loses ÷1.5 (`AWARD = 1.5`).
- The UI's "+X / −Y" per team (team screen, match cards) uses this exact formula on **ladder ratings**, never on
  blended ratings, because that's what the game will actually do.

## Rank bands

One band per 100 points, centred so 1000 sits in **The Observer** (950–1049). `RANKS` in `core.js` lists them from
Make-A-Wish Kid (<350) to Dark Triad (1450+). **Ayanokoji** isn't a band: it's the title of whoever is #1
(`rankOf(rating, place)`). `rankIdx`, `rankFloor`, `rankRange` give band index / floor / label.

## Team balancer (`balanceTeams()` in `core.js`)

Input: an even group (10 for 5v5) of `{ id, rating, side? }`. Output: up to 5 options
`{ blue, red, p (Team 1 win chance), gap, inRange }`.

1. Enumerate every split (126 for 10 players; player 0 fixed to avoid mirror duplicates).
2. **Locks:** a player with `side` must be on that team; splits breaking a lock are dropped. Locks decide which
   group is Team 1. At most 5 locks per side.
3. Keep splits with win chance in **[40%, 60%]**. If none qualify, fall back to all splits sorted by closeness to 50%.
4. Rank by **rank-by-rank gap**: sort each team best → worst, sum `|a[i] − b[i]|`. The minimum is the "pair draft"
   (each team gets one of the top 2, one of #3–4, …), i.e. an even mix of strong and weak players. Tie-break by
   closeness to 50%.
5. Skip near-copies: two splits whose sorted lineups match within 30 points at every position (either orientation
   when unlocked) count as the same option.

**Agreed priorities:** even good/bad split first; within the 40–60% band, exact 50/50 is secondary. Ratings are taken
as given (no uncertainty modelling). Without locks the UI randomly flips each option's sides (stable per Balance
press) so no player is stuck on Team 1.

## Solo/Duo rank blend (`blendRatings()` in `core.js`)

Ranks never change the ladder. They only feed balancing.

- `soloScore(rank)`: Iron IV 0 LP = 0, +100 per division (400 per tier), Master+ continues by LP from 2800.
- `soloFor(player, ranks)`: best rank across the player's accounts (main + alts).
- **Estimate** what a rank means *in these customs*: least-squares fit `estimate = a + b × soloScore` over players with
  a rank and ≥ 5 games (recomputed on every load). Fallback if fewer than 8 such players or a non-positive slope:
  `b = 0.15`, Plat IV ≈ 1000. With the first fit (22 players): Gold IV ≈ 969, Emerald IV ≈ 1116, Diamond IV ≈ 1190,
  Master ≈ 1263, a weak correlation (r ≈ 0.34). That's why rank only *nudges* ratings.
- **Balance rating** `= w × ladder + (1 − w) × estimate`, `w = games / (games + BLEND_K)`. Unranked players use their
  ladder rating; someone not on the ladder yet uses their estimate (or 1000).
- `BLEND_K = 25` (rank share 100% at 0 games, 76% at 8, 60% at 17, 50% at 25), passed as `blendRatings(stats, ranks, k)`.
- **Adjusted / Normal** (team screen switch, per device in `cl.balMode`): `balRatingOf(id)` returns the blend in
  Adjusted (default) and the ladder rating in Normal. Team boxes show the rating in use (hover shows both); "+/−"
  always uses ladder ratings. There is deliberately no adjusted Rankings tab.

## Roles in balancing (`balanceTeams()`, `bestRoles()`, `roleCost()` in `core.js`)

- Preferences: 1–5 different roles, favourite first (Supabase `roles` table, alts share their main's).
  `roleCost(prefs, role)` = position in the list (0 = favourite); unlisted roles cost `prefs.length` (just after the
  listed ones); no preferences = 1 for every role.
- Team role cost = cheapest of the 120 assignments (`bestRoles`).
- Order: the 40–60% band and fairness ranking exactly as above → among the **fairest** splits (gap within 10% of the
  best gap **and** win chance 45–55%), lower total role cost first, then the smaller difference between the teams'
  costs. All other splits keep pure fairness order. With no preferences the output is identical to before (tested).
- Options carry `roles` (`{ id: role }`) and `cost`; choosing one fills the team screen's role pickers.

## Ideas considered and parked

Solo rank as a new player's starting ladder rating (rejected: the ladder should reflect customs only). Uncertainty
shrinkage of ratings for players with few games (parked: "assume current ratings are accurate").
