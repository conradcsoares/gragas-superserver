# Gragas Superserver

A simple Elo ladder for our 5v5 League of Legends custom games. It's a static site (plain HTML/CSS/JS, no build step) that runs free on GitHub Pages.

- One page: the ladder, a **+ Record game** button and the last few games.
- **Screenshot import:** in the record form, tap **📷 From screenshots** and pick the post-game Scoreboard screenshots (a whole Bo3 at once), or paste one. The site reads the names, the winner and the date in your browser and fills the form for you to check. Names are matched to known players; new players just need their `#TAG` once.
- **Nicknames:** as the admin, open **Nicknames & alt accounts** under the ladder to give a player a display name. The ladder, games and trailer show the nickname; the Riot ID still shows underneath and links to op.gg.
- **Alt accounts:** as the admin, tap **Link alt accounts** under the ladder to make an alt count toward a main player. Games keep the account that was played, so unlinking is always safe.
- **Fast recording:** tap players to put them on Team 1 / Team 2, or use **Same teams as last game** / **Rematch**. Tap the winner once per game, so a Bo3 is three taps and one save.
- Each player is their **Riot ID** (`Name#TAG`), and their name on the ladder links to their op.gg profile.
- Anyone who plays a recorded game joins the ladder automatically, starting at **1000**.
- Every 100 points is a rank: **Make-A-Wish Kid** (<350) · **Wood** 350+ · **Moron** 450+ · **Tool** 550+ · **Pawn** 650+ · **Peasant** 750+ · **NPC** 850+ · **The Observer** 950+ (start) · **Manipulator** 1050+ · **Lone Wolf** 1150+ · **Puppet Master** 1250+ · **Mastermind** 1350+ · **Dark Triad** 1450+. **Ayanokoji** isn't a rating band: it's the title held by whoever is #1 on the ladder. Each rank has its own emblem (`emblems.js`); the frame gets fancier as you climb.
- **Trailer:** `trailer.html` is a 25-second hype trailer with sound, built from the live ladder (top 3, ranks, who holds the crown). **⬇ Save as video** records it to an MP4/WebM you can post in Discord.

## Why games are entered by hand

Riot's API doesn't return custom games, apart from tournament-code games, which need a special production key. That's why op.gg and similar sites can't show customs either. A new player's Riot ID is typed once. After that, they're a one-tap button.

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
2. Paste it into the box and click **Save & publish**. The live site updates in about a minute.

The key is stored only in that browser. To let a friend record games, add them as a repo collaborator and have them make their own key.

## Running locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.
