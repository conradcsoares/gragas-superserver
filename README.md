# Customs League

A simple Elo ladder for our 5v5 League of Legends custom games. It's a static site (plain HTML/CSS/JS, no build step) that runs free on GitHub Pages.

- One page: the ladder, a **+ Record game** button and the last few games.
- **Fast recording:** tap players to put them on Team 1 / Team 2, or use **Same teams as last game** / **Rematch**. Tap the winner once per game, so a Bo3 is three taps and one save.
- Each player is their **Riot ID** (`Name#TAG`), and their name on the ladder links to their op.gg profile.
- Anyone who plays a recorded game joins the ladder automatically, starting at **1000**.

## Why games are entered by hand

Riot's API doesn't return custom games, apart from tournament-code games, which need a special production key. That's why op.gg and similar sites can't show customs either. A new player's Riot ID is typed once. After that, they're a one-tap button.

## How the rating works

- Everyone starts at 1000.
- Each team's strength is the average rating of its players. The expected result is `1 / (1 + 10^((theirs − ours)/400))`.
- Every player on a team gains or loses `32 × (result − expected)`. Beating a stronger team pays more, and losing to a weaker team costs more.
- Ratings are recomputed from the full game list, so editing or deleting an old game is always safe.

## Setup (about 5 minutes)

1. Create a GitHub repo (e.g. `customs-league`) and push these files to it.
2. In the repo, go to **Settings → Pages**. Under Source, pick **Deploy from a branch**, then branch `main` and folder `/ (root)`.
3. The site goes live at `https://<your-username>.github.io/customs-league/`.

### Saving games

Games are stored in `data/league.json` in the repo. Anyone can view the site. The first time someone presses **Publish** on a device, the site asks for a GitHub key:

1. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with **Only select repositories** → this repo, and **Contents: Read and write**.
2. Paste it into the box and click **Save & publish**. The live site updates in about a minute.

The key is stored only in that browser. To let a friend record games, add them as a repo collaborator and have them make their own key.

## Running locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.
