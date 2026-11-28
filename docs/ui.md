# UI and design decisions

The owner iterates on looks by eye. These are the decisions made so far; follow them unless asked to change them.

## General

- Dark theme only (navy surfaces, gold accents), tokens in `:root` in `style.css`. Mobile matters: test at ~400–500 px.
- Names: `RiotName#TAG (Nickname)` via `fullName()`, tag dimmed in HTML via `fullNameHtml()`. Exceptions where
  space is tight: match cards and chart labels show the Riot name only (full name in the tooltip).
- Every player name is a link to their page (`playerHref(id)` → `#p/…`); op.gg is linked from the player page.
- Solo/Duo rank badge (`soloBadge(p)`): short tier+division (G1, P3, D1, M 20) in tier colour; long form on player
  pages ("Diamond I · 75 LP").
- Wide content (rating chart card `#history`) breaks out of the 720 px column up to 1120 px.

## Rankings tab

Podium (top 3 on gold/silver/bronze steps) + ladder table with rank emblem, rank band chip, Solo/Duo badge, W–L,
rating and last change. Admin-only: Nicknames & alt accounts panel, #1 picture upload.

## Rating history tab (`stats.js`)

- One line per player on a shared x-axis (game number). A line starts at 1000 just before the player's first game,
  moves game by game (level through games they sat out) and **stops at their last game**.
- Identity: 8 validated categorical hues × 4 line styles (solid, dashed, dotted, dash-dot) with matching markers,
  assigned by order of first game, so a player keeps their style forever. Palette validated against the card surface
  `#111827` (dataviz method; don't add hues).
- **Fixed y-scale** from all players, whatever is shown. Gridlines on rank-band floors with rank names on the right.
- Name tags at line ends, skipped where they'd overlap; numbered legend below (`1. Name · rating`).
- **Hover highlights the nearest line only** (no tooltip list), with its name tag and legend entry. **Click a line or
  a legend name to show only those players** (others hidden, not greyed); click again to remove; "Show everyone"
  resets. Selection persists per device. No table view.
- The player-page chart is the same component for one player (with a one-row tooltip and its own fitted scale).

## Games tab: op.gg-style match cards (`matchCard()` in `app.js`)

One compact card per match (a game, or a series recorded together): left column with game number, date, series
strip and admin actions (↺ rematch, ✎ edit, ✕ delete); then Team 1 and Team 2 columns tinted by result. Each player
is one 19 px row: rank emblem (as of after the match), name, ★/◆, rating after, change. Previous attempts (big
boxes, text lines) were rejected as too spacious or too wordy. Delete asks for confirmation naming the game, date
and both teams.

## Player page (`viewPlayer()` in `stats.js`)

The Balance tile shows the Adjusted rating, with "Adjusted · Normal <ladder>" under it. A **Roles** card sits under
the header: read-only order ("Mid › Top") for everyone; on your own page (logged in) an editor: tap roles in order
(numbered), Clear, Save (`set_roles`).

Header: "PLAYER", big name + tag + nickname, Solo/Duo badge, op.gg, big rating on the right; rank band with a
progress bar to the next band. Tiles (4×2) + Recent games list: Rank, Balance (blended rating), Record (with win %),
Streak, Peak, MVP, ACE, Last game. Then the rating chart, the player's match cards (their side tinted, their row
highlighted), and a With/Against table.

## Header: who you are

A logged-in device (personal link) shows a chip in the header: rank emblem, `fullName`, gold **ADMIN** tag. Its menu:
My page, My roles (scrolls to the roles card), Log out (forgets the code on this device only). Right after opening a
link, a one-time card says "You're logged in as … Not you? Log out".

## Player links panel (admins with an admin link)

**Player links** under the ladder: one row per ladder player with link status, **Copy link** (creates on first use,
then the same link), **Reissue** (confirm; old link dies, copies the new one), **Admin** checkbox. Not for yourself:
no Reissue, Admin can't be unticked. If the clipboard refuses, the link shows in a read-only box under the row.

## Team screen (record + balance in one)

- Visitors open it with **⚖ Balance teams** (team picking only); admins via **+ Record game** (also date, screenshots,
  winner, MVP/ACE, save).
- Player list is alphabetical and never moves; tapping toggles a player on/off a team (gold = picked, blue/red edge = team).
- Team boxes show average, "+win / −loss" (ladder Elo), member ratings and Solo/Duo badges.
- **Adjusted | Normal** segmented switch next to ⚖ Balance (only when ranks are loaded), remembered per device.
- **Roles, like a League lobby:** each member row starts with a small role picker (Top/Jg/Mid/ADC/Sup/—). Rows
  are shown Top → Support, players without a role last. Anyone can switch roles freely: two players on one role
  (red picker) or a missing role ("No Mid, Support" under the team header) is allowed, only flagged. Picker colour:
  green = their 1st pick, gold = 2nd; "1st"/"2nd" text next to the name on wider screens. Choosing a Balance option
  fills the roles; **Auto roles** refills both teams from preferences. Each option shows "9/10 top-2".
- On phones (≤520 px) the ✕ in member rows is hidden (tapping the row still removes) to leave room for names.
- **⚖ Balance** appears with exactly 10 players (hidden when editing a game or after a winner is tapped): 5 option
  buttons above the teams; choosing one rearranges the boxes. 🔓 locks a player to their team, ⇄ moves a locked
  player across, Unlock all. Options disappear if the group of 10 changes.
