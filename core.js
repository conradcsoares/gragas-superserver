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
// The last rank (Ayanokoji) isn't earned by rating: it's a title held by whoever is #1 on the ladder.
const CROWN = RANKS.length - 1;
const rankIdx = r => Math.max(0, Math.min(CROWN - 1, MID + Math.floor((r - (START - 50)) / 100)));
const rankFor = r => RANKS[rankIdx(r)];
// place = 0-based position on the ladder
const rankOf = (rating, place) => (place === 0 ? CROWN : rankIdx(rating));
const rankFloor = i => (i === 0 || i === CROWN ? null : START - 50 + (i - MID) * 100);
const rankRange = i => (i === CROWN ? '#1 only' : i === 0 ? `under ${rankFloor(1)}` : `${rankFloor(i)}+`);

const LEAGUE_NAME = 'Gragas Superserver';
const DEFAULTS = { leagueName: LEAGUE_NAME, region: 'na' };

const keyOf = id => id.toLowerCase().replace(/\s+/g, ''); // Riot IDs: ignore case + spaces
const NICK_MAX = 20;
// Name to show for a player: their nickname, else the game name without the #TAG.
const displayName = p => p.nick || p.id.split('#')[0];

function normalize(d) {
  d = d && typeof d === 'object' ? d : {};
  return {
    version: 2,
    settings: { ...DEFAULTS, ...(d.settings || {}) },
    games: (Array.isArray(d.games) ? d.games : []).filter(g => g && g.id && Array.isArray(g.blue) && Array.isArray(g.red) && ['blue', 'red'].includes(g.winner)),
    // Alt accounts: games keep the account actually played; ratings count toward the main player.
    links: (Array.isArray(d.links) ? d.links : []).filter(l => l && l.alt && l.main),
    // Nicknames: shown instead of the Riot ID; the player is still that account (op.gg link, ratings).
    nicks: (Array.isArray(d.nicks) ? d.nicks : []).filter(n => n && n.id && typeof n.nick === 'string' && n.nick.trim()),
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
  const get = id => { id = resolveWith(links, id); return P[keyOf(id)] || (P[keyOf(id)] = { id, rating: START, wins: 0, losses: 0, last: 0, seen: 0, alts: [], hist: [] }); };
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
        // Rating history for charts and player pages: n is the game's number (1-based) in date order.
        p.hist.push({ n, game: g.id, date: g.date, won, delta: dp, rating: p.rating, award: keyOf(p.id) === awardKey ? (won ? 'mvp' : 'ace') : null });
      }
    }
  }
  for (const l of data.links || []) { const p = P[keyOf(resolveWith(links, l.main))]; if (p) p.alts.push(l.alt); }
  for (const n of data.nicks || []) { const p = P[keyOf(resolveWith(links, n.id))]; if (p) p.nick = n.nick.trim(); }
  const ladder = Object.values(P).sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.id.localeCompare(b.id));
  return { P, deltas, ordered, ladder, links };
}

// ---------- autobalance ----------
// Suggests fair team splits for an even group (e.g. 10 players → 5v5).
// Priority is an even split of strong and weak players: sort each team best→worst and compare
// rank by rank (1st vs 1st, 2nd vs 2nd…); the smaller the summed gap, the better. The best possible
// score is the "pair draft": each team gets one of the top 2, one of #3–4, and so on.
// Win chance (same Elo formula as the ladder) only has to land in [lo, hi]; among equal splits, closer to 50% wins.
// Locks: a player with side 'blue' (Team 1) or 'red' (Team 2) is only ever put on that team; splits that break a
// lock are dropped and the rest are ranked as usual. Locks on both sides at once are fine.
// Roles: a player may carry `prefs` (role preferences, favourite first; see roleCost). Roles never override
// fairness: they only reorder the fairest splits (rank-by-rank gap within 10% of the best and a 45–55% win chance),
// lowest total role cost first, then the smaller difference between the teams. Everything else follows pure fairness,
// so with no preferences the result is the same as without roles.
// players: [{ id, rating, side?, prefs? }]. Returns up to `count` options:
// { blue: [ids], red: [ids], p (Team 1 win chance), gap, inRange (p within [lo, hi]),
//   roles: { [id]: role } (only when someone has preferences), cost: { blue, red } }.
// Without locks, which group is Team 1 is arbitrary (the caller may swap sides); with locks the sides are as returned.
function balanceTeams(players, { lo = 0.4, hi = 0.6, count = 5, near = 30, fairGap = 0.1, fairLo = 0.45, fairHi = 0.55 } = {}) {
  const n = players.length, half = n / 2;
  if (n < 2 || n % 2 || n > 16) return [];
  if (['blue', 'red'].some(sd => players.filter(p => p.side === sd).length > half)) return [];
  const locked = players.some(p => p.side);
  const fits = (team, sd) => team.every(p => !p.side || p.side === sd);
  const avg = t => t.reduce((s, p) => s + p.rating, 0) / t.length;
  const all = [];
  // Player 0 always lands in group A, so mirror images aren't counted twice (126 splits for 10 players);
  // the locks then decide whether A is Team 1 or Team 2.
  for (let m = 1; m < 1 << n; m += 2) {
    let A = [], B = [];
    for (let i = 0; i < n; i++) (m >> i & 1 ? A : B).push(players[i]);
    if (A.length !== half) continue;
    if (!(fits(A, 'blue') && fits(B, 'red'))) {
      if (fits(A, 'red') && fits(B, 'blue')) [A, B] = [B, A];
      else continue; // breaks a lock either way round
    }
    A.sort((x, y) => y.rating - x.rating); B.sort((x, y) => y.rating - x.rating);
    const p = 1 / (1 + Math.pow(10, (avg(B) - avg(A)) / 400));
    const gap = A.reduce((s, x, i) => s + Math.abs(x.rating - B[i].rating), 0);
    all.push({ A, B, p, gap, inRange: p >= lo && p <= hi });
  }
  let pool = all.filter(s => s.inRange);
  if (pool.length) pool.sort((x, y) => x.gap - y.gap || Math.abs(x.p - 0.5) - Math.abs(y.p - 0.5));
  // Nothing in range (extreme groups or heavy locks): offer the splits closest to 50/50 instead.
  else pool = all.sort((x, y) => Math.abs(x.p - 0.5) - Math.abs(y.p - 0.5) || x.gap - y.gap);
  const useRoles = players.some(p => p.prefs && p.prefs.length);
  if (useRoles) {
    for (const s of pool) { s.rA = bestRoles(s.A.map(p => p.prefs)); s.rB = bestRoles(s.B.map(p => p.prefs)); s.cost = s.rA.cost + s.rB.cost; }
    const best = pool[0].gap;
    const fair = s => s.gap <= best * (1 + fairGap) + 1e-9 && s.p >= fairLo && s.p <= fairHi;
    const top = pool.filter(fair), rest = pool.filter(s => !fair(s)); // pool order is kept within each part
    top.sort((x, y) => x.cost - y.cost || Math.abs(x.rA.cost - x.rB.cost) - Math.abs(y.rA.cost - y.rB.cost));
    pool = [...top, ...rest];
  }
  // Skip near-copies: same lineup shape rank by rank (within `near` points), e.g. just swapping 1455 and 1450.
  // With locks the sides matter, so a mirror image isn't a copy.
  const close = (a, b) => a.every((x, i) => Math.abs(x.rating - b[i].rating) <= near);
  const same = (s, t) => (close(s.A, t.A) && close(s.B, t.B)) || (!locked && close(s.A, t.B) && close(s.B, t.A));
  const picked = [];
  for (const s of pool) {
    if (picked.every(t => !same(s, t))) picked.push(s);
    if (picked.length === count) break;
  }
  return picked.map(s => {
    const o = { blue: s.A.map(p => p.id), red: s.B.map(p => p.id), p: s.p, gap: s.gap, inRange: s.inRange };
    if (useRoles) {
      o.roles = {};
      s.A.forEach((p, i) => { o.roles[p.id] = s.rA.roles[i]; });
      s.B.forEach((p, i) => { o.roles[p.id] = s.rB.roles[i]; });
      o.cost = { blue: s.rA.cost, red: s.rB.cost };
    }
    return o;
  });
}

// ---------- roles ----------
const ROLES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
const ROLE_NAME = { TOP: 'Top', JUNGLE: 'Jungle', MID: 'Mid', ADC: 'ADC', SUPPORT: 'Support' };
// How much a player minds playing a role: 0 for their favourite, 1 for the next… A partial list (say just a main and
// a second pick) puts every role they didn't list just after the ones they did. No preferences: 1 for every role.
function roleCost(prefs, role) {
  if (!prefs || !prefs.length) return 1;
  const i = prefs.indexOf(role);
  return i >= 0 ? i : prefs.length;
}
// All 120 ways to hand five roles to five players (index = player, value = role).
const ROLE_PERMS = (function perms(a) {
  if (a.length <= 1) return [a];
  return a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(r => [x, ...r]));
})(ROLES);
// Cheapest role assignment for one team (prefsList: each member's preferences, in team order).
// Teams other than five players get no roles. Ties keep the first permutation, so results are stable.
function bestRoles(prefsList) {
  if (prefsList.length !== ROLES.length) return { cost: 0, roles: prefsList.map(() => null) };
  let best = null, bc = Infinity;
  for (const perm of ROLE_PERMS) {
    let c = 0;
    for (let i = 0; i < perm.length && c < bc; i++) c += roleCost(prefsList[i], perm[i]);
    if (c < bc) { bc = c; best = perm; }
  }
  return { cost: bc, roles: [...best] };
}

// ---------- Solo/Duo ranks (data/ranks.json, fetched rarely by tools/fetch-ranks.mjs) ----------
// Ranks never change the ladder; they only feed team balancing, blended with ladder ratings.
const SOLO_TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
const SOLO_DIV = { IV: 0, III: 1, II: 2, I: 3 };
// A rank as one number: 100 per division (Iron IV 0 LP = 0, Silver I 50 LP = 1150 …); Master+ carries on by LP.
function soloScore(r) {
  if (!r || !r.tier) return null;
  const i = SOLO_TIERS.indexOf(r.tier);
  return i >= 0 ? i * 400 + (SOLO_DIV[r.division] ?? 0) * 100 + (r.lp || 0) : 2800 + (r.lp || 0);
}
// A player's best Solo/Duo rank across their accounts (main + alts), or null.
function soloFor(p, ranks) {
  let best = null;
  for (const id of [p.id, ...(p.alts || [])]) {
    const r = ranks && ranks[keyOf(id)];
    if (soloScore(r) != null && (!best || soloScore(r) > soloScore(best))) best = r;
  }
  return best;
}
// Balance rating per player (by key): ladder rating blended with what their rank predicts here.
//   estimate = a + b × soloScore, fitted on players with a rank and >= 5 customs (fixed fallback if too few)
//   balance  = w × ladder + (1 − w) × estimate,  w = games / (games + K)
// So newcomers lean on their rank and regulars on their customs results. Unranked: ladder rating only.
// The team screen's "Adjusted" mode uses K = 25: rank share 100% at 0 games, 76% at 8, 60% at 17, 50% at 25.
// ("Normal" mode skips the blend and balances on ladder ratings.)
const BLEND_K = 25;
function blendRatings(stats, ranks, k = BLEND_K) {
  const rows = stats.ladder.map(p => ({ p, s: soloScore(soloFor(p, ranks)), n: p.hist.length }));
  const fit = rows.filter(r => r.s != null && r.n >= 5);
  let a = START - 1600 * 0.15, b = 0.15; // fallback: Plat IV 0 LP ≈ 1000, a tier ≈ 60 points
  if (fit.length >= 8) {
    const mx = fit.reduce((t, r) => t + r.s, 0) / fit.length, my = fit.reduce((t, r) => t + r.p.rating, 0) / fit.length;
    const sxx = fit.reduce((t, r) => t + (r.s - mx) ** 2, 0), sxy = fit.reduce((t, r) => t + (r.s - mx) * (r.p.rating - my), 0);
    if (sxx > 0 && sxy > 0) { b = sxy / sxx; a = my - b * mx; }
  }
  const out = {};
  for (const { p, s, n } of rows) {
    const est = s == null ? null : Math.round(a + b * s), w = n / (n + k);
    out[keyOf(p.id)] = { ladder: p.rating, estimate: est, weight: w, balance: est == null ? p.rating : Math.round(w * p.rating + (1 - w) * est) };
  }
  return { players: out, a, b, fitted: fit.length };
}
