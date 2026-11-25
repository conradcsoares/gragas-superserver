# Gragas Superserver

A simple Elo ladder for our 5v5 League of Legends custom games. It's a static site (plain HTML/CSS/JS, no build step) that runs free on GitHub Pages.

- One page: the ladder, a **+ Record game** button and the last few games.
- **Screenshot import:** in the record form, tap **📷 From screenshots** and pick the post-game Scoreboard screenshots (a whole Bo3 at once), or paste one. The site reads the names, the winner and the date in your browser and fills the form for you to check. Names are matched to known players; new players just need their `#TAG` once.
- **Nicknames:** as the admin, open **Nicknames & alt accounts** under the ladder to give a player a real name. Everywhere on the site, players show as their Riot ID with the name after it, e.g. `ArsDerps#NA1 (Arjun)`. The trailer shows just the nickname.
- **Tabs:** **Rankings** (podium + ladder), **Rating history** and **Games**, each with its own link (`#rankings`, `#history`, `#games`).
- **Rating history:** every player's rating game by game on one chart, each with their own color, line style and marker. Tap a line or a legend name to show just those players; the scale stays fixed.
- **Games:** op.gg-style match cards: both teams side by side with each player's rank emblem, rating after and change, MVP ★ / ACE ◆.
- **Player pages:** tap any name for rating, rank progress, win rate, streak, peak, awards, recent results, a rating chart, their match cards and win–loss with and against everyone (`#p/Name%23TAG`).
- **Balance teams:** pick the 10 players and tap **⚖ Balance** to get 5 fair 5v5 splits to compare. Each option gives both teams an even mix of strong and weak players (one of the top 2, one of #3–4, and so on), then gets as close to 50/50 as it can within 40–60%. Tap 🔓 to lock a player to their team (⇄ moves them across) and the options rebalance around the locks. Each team shows its average rating and how much each player gains / loses. It's the same screen as recording a game: visitors open it with **⚖ Balance teams** and see only the team picking; admins get it inside **+ Record game**.
- **Podium:** the top 3 stand on gold, silver and bronze steps above the rest of the ladder.
- **#1 picture:** as the admin, open **Nicknames & alt accounts** and use **Upload picture…** to put any image inside the #1 emblem. It's cropped to fit the frame and saved in `assets/`; **Use the drawn one** switches back.
- **Alt accounts:** as the admin, tap **Link alt accounts** under the ladder to make an alt count toward a main player. Games keep the account that was played, so unlinking is always safe.
- **Fast recording:** tap players to put them on Team 1 / Team 2, or use **Same teams as last game** / **Rematch**. Tap the winner once per game, so a Bo3 is three taps and one save.
- Each player is their **Riot ID** (`Name#TAG`), and their name on the ladder links to their op.gg profile.
- Anyone who plays a recorded game joins the ladder automatically, starting at **1000**.
- Every 100 points is a rank: **Make-A-Wish Kid** (<350) · **Wood** 350+ · **Moron** 450+ · **Tool** 550+ · **Pawn** 650+ · **Peasant** 750+ · **NPC** 850+ · **The Observer** 950+ (start) · **Manipulator** 1050+ · **Lone Wolf** 1150+ · **Puppet Master** 1250+ · **Mastermind** 1350+ · **Dark Triad** 1450+. **Ayanokoji** isn't a rating band: it's the title held by whoever is #1 on the ladder. Each rank has its own emblem (`emblems.js`); the frame gets fancier as you climb.
- **Trailer:** `trailer.html` is a 25-second hype trailer with sound, built from the live ladder (top 3, ranks, who holds the crown). **⬇ Save as video** records it to an MP4/WebM you can post in Discord.

## Why games are entered by hand

Riot's API doesn't return custom games, apart from tournament-code games, which need a special production key. That's why op.gg and similar sites can't show customs either. A new player's Riot ID is typed once. After that, they're a one-tap button.

## Several people publishing

Anyone with a key can publish. Unpublished changes are saved per device as *edits*, not as a copy of the whole ladder. Reloading always shows the live ladder with your edits on top, and Publish re-applies your edits to whatever is live at that moment, so one person's publish never wipes out another's games.

## Live updates

Open pages update by themselves when someone publishes, without reloading:

- **Instant:** after a publish, the publisher's browser sends a "ladder updated" ping over a free [Supabase](https://supabase.com) Realtime broadcast channel. Every open page hears it within a second or two and fetches the new `data/league.json` from GitHub's API. The ping carries no data, so a fake one can't change anything. The Supabase URL and publishable key in `app.js` are public by design; the doorbell uses no tables.
- **Fallback:** every 15 seconds pages also check the copy GitHub Pages serves, which catches up about a minute after a publish (e.g. if Supabase is unreachable). A different copy is confirmed through GitHub's API first, so a page never rolls back to an older ladder.
- Page loads read the ladder from GitHub's API too, so a reload never shows a stale copy. Without a key GitHub allows 60 API requests an hour per network, which is why nothing polls the API on a timer.

## How the rating works

- Everyone starts at 1000.
- Each team's strength is the average rating of its players. The expected result is `1 / (1 + 10^((theirs − ours)/400))`.
- Every player on a team gains or loses `200 × (result − expected)`, so an even game is about ±100. The K is high on purpose because not many customs get played. Beating a stronger team pays more, and losing to a weaker team costs more.
- **MVP / ACE:** for each game you can pick the group's MVP (winning team) and ACE (losing team). The MVP gains ×1.5, and the ACE loses ÷1.5.
- Ratings are recomputed from the full game list, so editing or deleting an old game is always safe.

## Setup (about 5 minutes)

1. Create a GitHub repo (e.g. `gragas-superserver`) and push these files to it.
2. In the repo, go to **Settings → Pages**. Under Source, pick **Deploy from a branch**, then branch `main` and folder `/ (root)`.
3. The site goes live at `https://<your-username>.github.io/gragas-superserver/`.

### Saving games

Games are stored in `data/league.json` in the repo. Visitors see a read-only ladder. To edit, open `https://conradcsoares.github.io/gragas-superserver/#admin` once on your device. That unlocks **+ Record game** there. The first time you press **Publish**, the site asks for a GitHub key:

1. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new). Pick **Only select repositories** → this repo. Under Permissions, click **+ Add permissions** → **Contents**, then set it to **Read and write**.
2. Paste it into the box and click **Save & publish**. Everyone with the site open sees it within a couple of seconds (see *Live updates*).

The key is stored only in that browser. To let a friend record games, add them as a repo collaborator and have them make their own key.

## Running locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.
