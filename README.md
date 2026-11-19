# Customs League

An Elo ladder for our 5v5 League of Legends custom games. It's a static site (plain HTML/CSS/JS, no build step), so it runs free on GitHub Pages.

## What it does

- **Ladder**: ratings, LoL-style tiers (Iron → Challenger), W–L, win %, last 5 games and streaks.
- **Player pages**: rating graph, best teammates, toughest opponents, champions and roles.
- **Match history**: every game with the rating change for each player, plus upsets.
- **Team builder**: pick the 10 people playing and it finds the fairest 5v5 split (or shuffles between near-fair ones). "Play this →" fills in the match form, putting people on their main roles where it can.
- **Record match**: date, sides, roles, champions (autocompleted, with icons from Riot's Data Dragon) and notes. Old matches can be edited or deleted.

## How the rating works

- Everyone starts at **1000**.
- Team strength is the average rating of its players. The expected result is `1 / (1 + 10^((opp − team)/400))`.
- Each player's change is `K × (result − expected)`. Beating a stronger team pays more.
- Your first **5** games are placements with **K = 48**. After that, **K = 32**.
- Ratings are **recomputed from the full match history** every time, so editing or deleting an old game is safe.
- You can change all of these numbers in **Admin → League settings**.

## Setup (about 5 minutes)

1. Create a new GitHub repo (e.g. `customs-league`) and push these files to it.
2. In the repo, go to **Settings → Pages**. Under Source, pick **Deploy from a branch**, then branch `main` and folder `/ (root)`.
3. After about a minute, the site is live at `https://<your-username>.github.io/customs-league/`.

### Letting the site save games

All the data lives in `data/league.json` in the repo. Anyone can **view** the site. To **record** games, a person needs write access:

1. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new):
   - Repository access: **Only select repositories** → this repo
   - Permissions → Repository → **Contents: Read and write**
2. On the site, open **Admin → Publishing**, paste the token and click **Save & test**. Owner and repo fill themselves in on github.io.
3. From then on, after you record games, click **Publish** in the yellow banner. That commits `data/league.json`, and the live site updates in about a minute.

The token is stored only in that browser's localStorage. To let a friend record games too, add them as a repo collaborator and have them make their own token.

Friends without access can still record games locally, **Export JSON** from Admin and send you the file. You then **Import** it and Publish.

## Running locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

---

Customs League isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties.
