'use strict';
/* Shared by the ladder (app.js) and the trailer: ranks, rating rules and the Elo calculation. */

const START = 1000;
const K = 200; // an even match swings about ±100 — few customs get played, so ratings need to move fast
// One rank per 100 points; 1000 sits in the middle of Mid.
const RANKS = [
  { name: 'Make-A-Wish Kid', color: '#9a6f86' },
  { name: 'Wood', color: '#8b6b45' },
  { name: 'Moron', color: '#a5773f' },
  { name: 'Tool', color: '#b5835e' },
  { name: 'Pawn', color: '#a8957f' },
  { name: 'Peasant', color: '#929d7c' },
  { name: 'NPC', color: '#8f9bb0' },
  { name: 'The Observer', color: '#c9ccd4' },
  { name: 'Manipulator', color: '#4fc1b0' },
  { name: 'Lone Wolf', color: '#5fa8e8' },
  { name: 'Puppet Master', color: '#9b7bff' },
  { name: 'Mastermind', color: '#c86bf0' },
  { name: 'Dark Triad', color: '#ef5a5f' },
  { name: 'Ayanokoji', color: '#f0c75e' },
];
const MID = 7; // The Observer (950–1049); 1000 sits in its middle
// Group-voted awards per game: MVP (winning team) gains ×1.5, ACE (losing team) loses ÷1.5.
const AWARD = 1.5;
const rankIdx = r => Math.max(0, Math.min(RANKS.length - 1, MID + Math.floor((r - (START - 50)) / 100)));
const rankFor = r => RANKS[rankIdx(r)];
const rankFloor = i => (i === 0 ? null : START - 50 + (i - MID) * 100);

const LEAGUE_NAME = 'Gragas Superserver';
const DEFAULTS = { leagueName: LEAGUE_NAME, region: 'na' };

const keyOf = id => id.toLowerCase().replace(/\s+/g, ''); // Riot IDs: ignore case + spaces

function normalize(d) {
  d = d && typeof d === 'object' ? d : {};
  return {
    version: 2,
    settings: { ...DEFAULTS, ...(d.settings || {}) },
    games: (Array.isArray(d.games) ? d.games : []).filter(g => g && g.id && Array.isArray(g.blue) && Array.isArray(g.red) && ['blue', 'red'].includes(g.winner)),
    // Alt accounts: games keep the account actually played; ratings count toward the main player.
    links: (Array.isArray(d.links) ? d.links : []).filter(l => l && l.alt && l.main),
  };
}

// ---------- Elo ----------
function linkMap(links) { const m = {}; for (const l of links || []) m[keyOf(l.alt)] = l.main; return m; }
function resolveWith(m, id) { for (let i = 0; i < 5 && m[keyOf(id)]; i++) id = m[keyOf(id)]; return id; }

function compute(data) {
  const links = linkMap(data.links);
  const P = {};        // key -> { id, rating, wins, losses, last }
  const deltas = {};   // game id -> { blue, red }
  const ordered = data.games.map((g, i) => ({ g, i })).sort((a, b) => a.g.date.localeCompare(b.g.date) || a.i - b.i).map(x => x.g);
  const get = id => { id = resolveWith(links, id); return P[keyOf(id)] || (P[keyOf(id)] = { id, rating: START, wins: 0, losses: 0, last: 0, seen: 0, alts: [] }); };
  let n = 0;
  for (const g of ordered) {
    n++;
    const blue = [...new Set(g.blue.map(get))], red = [...new Set(g.red.map(get))];
    const avg = t => t.reduce((a, p) => a + p.rating, 0) / t.length;
    const expBlue = 1 / (1 + Math.pow(10, (avg(red) - avg(blue)) / 400));
    const dBlue = Math.round(K * ((g.winner === 'blue' ? 1 : 0) - expBlue));
    deltas[g.id] = { blue: dBlue, red: -dBlue };
    for (const [team, d, won] of [[blue, dBlue, g.winner === 'blue'], [red, -dBlue, g.winner === 'red']]) {
      const award = won ? g.mvp : g.ace;
      const awardKey = award ? keyOf(resolveWith(links, award)) : null;
      for (const p of team) {
        const dp = keyOf(p.id) === awardKey ? Math.round(won ? d * AWARD : d / AWARD) : d;
        p.rating += dp; p.last = dp; p.seen = n; won ? p.wins++ : p.losses++;
      }
    }
  }
  for (const l of data.links || []) { const p = P[keyOf(resolveWith(links, l.main))]; if (p) p.alts.push(l.alt); }
  const ladder = Object.values(P).sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.id.localeCompare(b.id));
  return { P, deltas, ordered, ladder, links };
}
