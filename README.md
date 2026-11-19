# Customs League

A simple Elo ladder for our 5v5 League of Legends custom games. It's a static site (plain HTML/CSS/JS, no build step) that runs free on GitHub Pages.

- One page: the ladder, a **+ Record game** button and the last few games.
- Each player is their **Riot ID** (`Name#TAG`), and their name on the ladder links to their op.gg profile.
- Anyone who plays a recorded game joins the ladder automatically, starting at **1000**.

## Why games are entered by hand

Riot's API doesn't return custom games, apart from tournament-code games, which need a special production key. That's why op.gg and similar sites can't show customs either. So after each game, someone types the 10 Riot IDs and picks the winner. It takes about 20 seconds, and names autocomplete after the first game.

## How the rating works

- Everyone starts at 1000.
- Each team's strength is the average rating of its players. The expected result is `1 / (1 + 10^((theirs − ours)/400))`.
- Every player on a team gains or loses `32 × (result − expected)`. Beating a stronger team pays more, and losing to a weaker team costs more.
- Ratings are recomputed from the full game list, so editing or deleting an old game is always safe.

## Setup (about 5 minutes)

1. Create a GitHub repo (e.g. `customs-league`) and push these files to it.
2. In the repo, go to **Settings → Pages**. Under Source, pick **Deploy from a branch**, then branch `main` and folder `/ (root)`.
3. The site goes live at `https://<your-username>.github.io/customs-league/`.

### Letting the site save games

Games are stored in `data/league.json` in the repo. Anyone can view the site. To record games:

1. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with **Only select repositories** → this repo, and **Contents: Read and write**.
2. On the site, click **Setup** (at the bottom of the page), paste the token and click **Save & test**.
3. After recording a game, click **Publish** in the banner. The live site updates in about a minute.

The token is stored only in that browser. To let a friend record games, add them as a repo collaborator and have them make their own token.

**Setup** also has the op.gg region for the profile links, renaming a player whose Riot ID changed, and JSON export/import for backups.

## Running locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.
