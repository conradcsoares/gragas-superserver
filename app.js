'use strict';
/* Customs League — Elo ladder for 5v5 League of Legends customs.
 * Static site: data lives in data/league.json in the repo. Ratings are recomputed
 * from the full match history on every load, so editing/deleting a match is always safe. */

// ---------- Constants ----------
const ROLES = ['TOP', 'JGL', 'MID', 'BOT', 'SUP'];
const ROLE_NAMES = { TOP: 'Top', JGL: 'Jungle', MID: 'Mid', BOT: 'Bot', SUP: 'Support' };
// Tier thresholds are offsets from the starting rating, so changing the start rating keeps tiers sensible.
const TIERS = [
  { name: 'Iron', short: 'I', off: -210, color: '#8b7d74' },
  { name: 'Bronze', short: 'B', off: -150, color: '#b97a4f' },
  { name: 'Silver', short: 'S', off: -90, color: '#aab6c3' },
  { name: 'Gold', short: 'G', off: -30, color: '#e3b34f' },
  { name: 'Platinum', short: 'P', off: 30, color: '#4fc1b0' },
  { name: 'Emerald', short: 'E', off: 90, color: '#34c77b' },
  { name: 'Diamond', short: 'D', off: 150, color: '#7f9dff' },
  { name: 'Master', short: 'M', off: 210, color: '#c06bf0', apex: true },
  { name: 'Grandmaster', short: 'GM', off: 270, color: '#ef5a5f', apex: true },
  { name: 'Challenger', short: 'C', off: 330, color: '#f6d77e', apex: true },
];
const UNRANKED = { name: 'Unranked', short: '?', color: '#5d677d' };
const DIVS = ['IV', 'III', 'II', 'I'];
const DEFAULT_SETTINGS = { leagueName: 'Customs League', season: 'Season 1', startRating: 1000, kFactor: 32, placementGames: 5, placementK: 48 };
const LS = { gh: 'lcl.github', draft: 'lcl.draft', champs: 'lcl.champs', pick: 'lcl.pick' };
const DD = 'https://ddragon.leagueoflegends.com';

// ---------- Utils ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = p => p + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 7);
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = s => { if (!s) return ''; const d = new Date(s + 'T12:00:00'); return isNaN(d) ? s : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
const pct = (w, g) => g ? Math.round((w / g) * 100) + '%' : '—';
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n);
const deltaHtml = n => `<span class="delta ${n > 0 ? 'pos' : n < 0 ? 'neg' : 'muted'}">${signed(n)}</span>`;
const clone = o => JSON.parse(JSON.stringify(o));
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const canon = t => { try { return JSON.stringify(JSON.parse(t)); } catch { return t; } };
const serialize = d => JSON.stringify(d, null, 2) + '\n';
const b64enc = s => { const b = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]); return btoa(bin); };
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// ---------- State ----------
const S = {
  data: null,        // league data (players, matches, settings)
  base: null,        // hash of the last published league.json we loaded
  dirty: false,      // local changes not yet published
  remoteChanged: false,
  stats: null,
  form: null,        // add/edit match form state
  editing: null,     // match id being edited
  pick: new Set(store.get(LS.pick) || []),
  balance: null,
  matchFilter: '',
  busy: false,
};

function normalize(d) {
  d = d && typeof d === 'object' ? d : {};
  const settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  for (const k of ['startRating', 'kFactor', 'placementGames', 'placementK']) {
    const n = Number(settings[k]); settings[k] = Number.isFinite(n) ? n : DEFAULT_SETTINGS[k];
  }
  return {
    version: 1,
    settings,
    players: (Array.isArray(d.players) ? d.players : []).filter(p => p && p.id && p.name),
    matches: (Array.isArray(d.matches) ? d.matches : []).filter(m => m && m.id && Array.isArray(m.blue) && Array.isArray(m.red)),
  };
}

// ---------- Rating engine ----------
function tierFor(rating, st, games) {
  if (games < st.placementGames) return { ...UNRANKED, label: 'Unranked' };
  const d = rating - st.startRating;
  let t = TIERS[0];
  for (const x of TIERS) if (d >= x.off) t = x;
  if (t.apex) return { ...t, label: t.name };
  const idx = Math.max(0, Math.min(3, Math.floor((d - t.off) / 15)));
  return { ...t, label: `${t.name} ${DIVS[idx]}` };
}

function compute(data) {
  const st = data.settings;
  const P = {};
  for (const p of data.players) {
    P[p.id] = { ...p, rating: st.startRating, games: 0, wins: 0, losses: 0, peak: st.startRating, streak: 0, bestStreak: 0,
      history: [], champs: {}, roles: {}, with: {}, vs: {}, form: [], lastDelta: 0 };
  }
  const results = {};
  const ordered = data.matches.map((m, i) => ({ m, i }))
    .sort((a, b) => (a.m.date || '').localeCompare(b.m.date || '') || a.i - b.i).map(x => x.m);

  for (const m of ordered) {
    const sides = { blue: m.blue.filter(s => P[s.player]), red: m.red.filter(s => P[s.player]) };
    if (!sides.blue.length || !sides.red.length || !['blue', 'red'].includes(m.winner)) continue;
    const avg = side => sides[side].reduce((a, s) => a + P[s.player].rating, 0) / sides[side].length;
    const bAvg = avg('blue'), rAvg = avg('red');
    const expBlue = 1 / (1 + Math.pow(10, (rAvg - bAvg) / 400));
    const deltas = {}, after = {};

    for (const side of ['blue', 'red']) {
      const won = m.winner === side;
      const exp = side === 'blue' ? expBlue : 1 - expBlue;
      for (const s of sides[side]) {
        const p = P[s.player];
        const K = p.games < st.placementGames ? st.placementK : st.kFactor;
        deltas[s.player] = Math.round(K * ((won ? 1 : 0) - exp));
      }
    }
    for (const side of ['blue', 'red']) {
      const won = m.winner === side;
      const other = side === 'blue' ? 'red' : 'blue';
      for (const s of sides[side]) {
        const p = P[s.player], d = deltas[s.player];
        p.rating += d; p.games++; p.lastDelta = d;
        if (won) { p.wins++; p.streak = p.streak > 0 ? p.streak + 1 : 1; }
        else { p.losses++; p.streak = p.streak < 0 ? p.streak - 1 : -1; }
        p.bestStreak = Math.max(p.bestStreak, p.streak);
        p.peak = Math.max(p.peak, p.rating);
        p.form.push(won ? 'W' : 'L');
        p.history.push({ matchId: m.id, date: m.date, rating: p.rating, delta: d, won, side, role: s.role, champ: s.champ });
        after[s.player] = p.rating;
        const bump = (obj, key) => { const o = obj[key] || (obj[key] = { g: 0, w: 0 }); o.g++; if (won) o.w++; };
        if (s.champ) bump(p.champs, s.champ);
        if (s.role) bump(p.roles, s.role);
        for (const t of sides[side]) if (t.player !== s.player) bump(p.with, t.player);
        for (const o of sides[other]) bump(p.vs, o.player);
      }
    }
    results[m.id] = { bAvg, rAvg, expBlue, deltas, after };
  }

  const active = Object.values(P).filter(p => !p.retired);
  const ranked = active.filter(p => p.games >= st.placementGames).sort((a, b) => b.rating - a.rating || b.wins - a.wins);
  ranked.forEach((p, i) => { p.rank = i + 1; });
  const unranked = active.filter(p => p.games < st.placementGames).sort((a, b) => b.games - a.games || b.rating - a.rating);
  return { P, results, ordered, ranked, unranked };
}

// Projected deltas for a hypothetical match (used by the match form + team builder)
function project(blueIds, redIds) {
  const st = S.data.settings, P = S.stats.P;
  if (!blueIds.length || !redIds.length) return null;
  const avg = ids => ids.reduce((a, id) => a + P[id].rating, 0) / ids.length;
  const bAvg = avg(blueIds), rAvg = avg(redIds);
  const expBlue = 1 / (1 + Math.pow(10, (rAvg - bAvg) / 400));
  const k = id => (P[id].games < st.placementGames ? st.placementK : st.kFactor);
  const typical = ids => Math.round(ids.reduce((a, id) => a + k(id), 0) / ids.length);
  return { bAvg, rAvg, expBlue, blueWin: Math.round(typical(blueIds) * (1 - expBlue)), redWin: Math.round(typical(redIds) * expBlue) };
}

// ---------- Champion data (Riot Data Dragon) ----------
const CH = { ver: null, map: {}, lower: {} };
function applyChamps(c) {
  CH.ver = c.ver; CH.map = c.map; CH.lower = {};
  for (const n in c.map) CH.lower[n.toLowerCase()] = n;
  $('#champList').innerHTML = Object.keys(c.map).sort().map(n => `<option value="${esc(n)}">`).join('');
}
async function loadChamps() {
  const cached = store.get(LS.champs);
  if (cached && cached.ver && Date.now() - cached.at < 3 * 864e5) { applyChamps(cached); return; }
  try {
    const vers = await (await fetch(`${DD}/api/versions.json`)).json();
    const ver = vers[0];
    const j = await (await fetch(`${DD}/cdn/${ver}/data/en_US/champion.json`)).json();
    const map = {};
    for (const k in j.data) map[j.data[k].name] = j.data[k].id;
    const c = { ver, map, at: Date.now() };
    store.set(LS.champs, c); applyChamps(c);
    const r = route().name;
    if (r !== 'add' && r !== 'admin') render();
  } catch { if (cached) applyChamps(cached); }
}
const canonChamp = n => { n = (n || '').trim(); return CH.lower[n.toLowerCase()] || n; };
function champIcon(name, size = 26) {
  if (!name) return `<span class="champ-ph" style="width:${size}px;height:${size}px"></span>`;
  const id = CH.map[canonChamp(name)];
  if (!id || !CH.ver) return `<span class="champ-ph" style="width:${size}px;height:${size}px" title="${esc(name)}">${esc(name.slice(0, 2))}</span>`;
  return `<img class="champ" src="${DD}/cdn/${CH.ver}/img/champion/${id}.png" width="${size}" height="${size}" alt="${esc(name)}" title="${esc(name)}" loading="lazy">`;
}

// ---------- GitHub sync ----------
function ghDefaults() {
  const h = location.hostname; let owner = '', repo = '';
  if (h.endsWith('.github.io')) {
    owner = h.split('.')[0];
    const seg = location.pathname.split('/').filter(Boolean)[0];
    repo = seg && !seg.includes('.') ? seg : `${owner}.github.io`;
  }
  return { owner, repo, branch: 'main', path: 'data/league.json', token: '' };
}
const ghCfg = () => ({ ...ghDefaults(), ...(store.get(LS.gh) || {}) });
const ghReady = (c = ghCfg()) => !!(c.owner && c.repo && c.token);

async function ghRequest(method, c, body) {
  const path = c.path.split('/').map(encodeURIComponent).join('/');
  let url = `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path}`;
  if (method === 'GET') url += `?ref=${encodeURIComponent(c.branch)}&t=${Date.now()}`;
  const r = await fetch(url, {
    method, cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${c.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let msg = `GitHub said ${r.status}`;
    try { const j = await r.json(); if (j.message) msg += `: ${j.message}`; } catch { /* no body */ }
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return r.json();
}
async function ghFetchFile(c) {
  try { const j = await ghRequest('GET', c); return { sha: j.sha, text: b64dec(j.content) }; }
  catch (e) { if (e.status === 404) return { sha: null, text: null }; throw e; }
}

async function publish() {
  const c = ghCfg();
  if (!ghReady(c)) { toast('Connect GitHub in Admin first.', true); location.hash = '#/admin'; return; }
  if (S.busy) return;
  S.busy = true; renderBanner();
  try {
    const remote = await ghFetchFile(c);
    if (remote.text && S.base && hash(canon(remote.text)) !== S.base &&
      !confirm('Someone else published changes since you loaded the page.\n\nPublishing now will overwrite their changes. Continue?')) return;
    const text = serialize(S.data);
    await ghRequest('PUT', c, {
      message: `Update league: ${S.data.matches.length} matches, ${S.data.players.length} players`,
      content: b64enc(text), branch: c.branch, ...(remote.sha ? { sha: remote.sha } : {}),
    });
    S.base = hash(canon(text)); S.dirty = false; S.remoteChanged = false; store.del(LS.draft);
    toast('Published! The live site updates in about a minute.');
  } catch (e) {
    toast(`Publish failed — ${e.message}`, true);
  } finally { S.busy = false; render(); }
}

// ---------- Load / mutate ----------
async function load() {
  let text = null, err = null;
  const c = ghCfg();
  if (ghReady(c)) { try { text = (await ghFetchFile(c)).text; } catch (e) { err = e; } }
  if (text == null) {
    try {
      const r = await fetch(`data/league.json?t=${Date.now()}`, { cache: 'no-store' });
      if (r.ok) text = await r.text(); else if (r.status !== 404) err = new Error(`HTTP ${r.status}`);
    } catch (e) { err = err || e; }
  }
  let remote = { settings: DEFAULT_SETTINGS, players: [], matches: [] };
  if (text) { try { remote = JSON.parse(text); } catch { err = new Error('data/league.json is not valid JSON'); } }
  S.base = text ? hash(canon(text)) : null;
  const draft = store.get(LS.draft);
  if (draft && draft.data) {
    S.data = normalize(draft.data); S.dirty = true; S.remoteChanged = draft.base !== S.base;
  } else S.data = normalize(remote);
  if (err) toast(`Couldn't load league data (${err.message}). Showing local copy.`, true);
  recompute(); render();
}
function recompute() { S.stats = compute(S.data); }
function commit(fn, msg) {
  fn(S.data);
  S.dirty = true;
  store.set(LS.draft, { data: S.data, base: S.base, at: Date.now() });
  recompute(); render();
  if (msg) toast(msg);
}
function addPlayer(name, mainRole = '') {
  name = (name || '').trim().slice(0, 32);
  if (!name) return null;
  if (S.data.players.some(p => p.name.toLowerCase() === name.toLowerCase())) { toast(`"${name}" already exists.`, true); return null; }
  const p = { id: uid('p'), name, mainRole, joined: today() };
  commit(d => d.players.push(p), `Added ${name}`);
  return p;
}

// ---------- UI helpers ----------
let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = err ? 'err' : ''; }, err ? 5000 : 2800);
}
function crest(t, size = 32) {
  const c = t.color;
  const fs = t.short.length > 1 ? 9 : 12;
  return `<svg class="crest" viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true">
    <path d="M20 2 36 11v18L20 38 4 29V11Z" fill="${c}" fill-opacity=".14" stroke="${c}" stroke-width="2"/>
    <path d="M20 8.5 30 14.2v11.6L20 31.5 10 25.8V14.2Z" fill="${c}"/>
    <text x="20" y="${20 + fs * .36}" text-anchor="middle" font-size="${fs}" font-weight="800" font-family="Inter,sans-serif" fill="#0a0e17">${t.short}</text></svg>`;
}
const pTier = p => tierFor(p.rating, S.data.settings, p.games);
const pLink = id => `#/player/${encodeURIComponent(id)}`;
const pName = id => esc(S.stats.P[id]?.name || 'Unknown');
function formPills(form, n = 5) {
  const f = form.slice(-n);
  if (!f.length) return '<span class="dim">—</span>';
  return `<span class="form">${f.map(r => `<span class="${r}">${r}</span>`).join('')}</span>`;
}
function streakHtml(s) {
  if (!s) return '<span class="dim">—</span>';
  return s > 0 ? `<span class="streak pos">${s}W${s >= 3 ? ' 🔥' : ''}</span>` : `<span class="streak neg">${-s}L</span>`;
}
function playerOptions(selected, exclude = new Set()) {
  const ps = S.data.players.filter(p => !p.retired || p.id === selected).sort((a, b) => a.name.localeCompare(b.name));
  return `<option value="">— empty —</option>` + ps.map(p =>
    `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}${exclude.has(p.id) && p.id !== selected ? ' (picked)' : ''} · ${S.stats.P[p.id].rating}</option>`).join('') +
    `<option value="__new">+ New player…</option>`;
}

// ---------- Router ----------
function route() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [name, ...rest] = h.split('/');
  return { name: name || 'leaderboard', arg: rest.join('/') };
}
function render() {
  if (!S.data) return;
  const r = route();
  const st = S.data.settings;
  $('#leagueName').textContent = st.leagueName;
  $('#seasonName').textContent = st.season;
  document.title = st.leagueName;
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.dataset.route === (r.name === 'player' ? 'leaderboard' : r.name));
  renderBanner();
  const views = { leaderboard: viewLeaderboard, player: viewPlayer, matches: viewMatches, balance: viewBalance, add: viewAdd, admin: viewAdmin };
  $('#view').innerHTML = (views[r.name] || viewLeaderboard)(r.arg);
}
function renderBanner() {
  const b = $('#banner');
  if (!S.dirty) { b.innerHTML = ''; return; }
  const ready = ghReady();
  b.innerHTML = `<div class="banner ${S.remoteChanged ? 'warn' : ''}"><div class="wrap">
    <div class="msg">${S.remoteChanged
      ? '<b>Heads up:</b> the published league changed since you started editing on this device. Publishing will overwrite it — discard your draft if unsure.'
      : '<b>Unpublished changes.</b> They’re saved on this device only — publish so your friends can see them.'}</div>
    <button class="btn ghost sm danger" data-act="discard">Discard</button>
    <button class="btn gold sm" data-act="publish" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Publishing…' : ready ? 'Publish' : 'Set up publishing'}</button>
  </div></div>`;
}

// ---------- Views ----------
function viewLeaderboard() {
  const { ranked, unranked, P } = S.stats;
  const st = S.data.settings;
  if (!S.data.players.length) {
    return `<div class="panel empty"><h2>No summoners yet</h2><p>Add your squad, then record your first custom game.</p>
      <a class="btn gold" href="#/admin">Add players</a></div>`;
  }
  const all = Object.values(P);
  const hot = all.filter(p => !p.retired && p.streak > 0).sort((a, b) => b.streak - a.streak)[0];
  const best = all.filter(p => p.games).sort((a, b) => b.bestStreak - a.bestStreak)[0];
  const top = ranked[0];
  const podium = ranked.slice(0, 3);
  const order = podium.length === 3 ? [podium[1], podium[0], podium[2]] : podium;

  const row = p => {
    const t = pTier(p);
    return `<tr class="link" data-href="${pLink(p.id)}" style="--tier:${t.color}">
      <td class="rank">${p.rank ?? '–'}</td>
      <td><div class="player-cell">${crest(t, 30)}<div><div class="nm">${esc(p.name)}</div><div class="tn">${t.label}${p.rank ? '' : ` · ${p.games}/${st.placementGames} placements`}</div></div></div></td>
      <td class="r num"><b>${p.rating}</b>${p.games ? deltaHtml(p.lastDelta) : ''}</td>
      <td class="c num">${p.wins}–${p.losses}</td>
      <td class="c num hide-sm">${pct(p.wins, p.games)}</td>
      <td class="hide-sm">${formPills(p.form)}</td>
      <td class="c hide-sm">${streakHtml(p.streak)}</td>
    </tr>`;
  };
  const table = (list, title) => list.length ? `<div class="section"><h3 style="margin:22px 0 10px">${title}</h3><div class="table-wrap"><table>
      <thead><tr><th class="c">#</th><th>Summoner</th><th class="r">Rating</th><th class="c">W–L</th><th class="c hide-sm">Win %</th><th class="hide-sm">Last 5</th><th class="c hide-sm">Streak</th></tr></thead>
      <tbody>${list.map(row).join('')}</tbody></table></div></div>` : '';

  return `
    <div class="page-head"><div><h1>Ladder</h1><p>${esc(st.season)} · ${S.data.matches.length} games played</p></div>
      <div class="row"><a class="btn" href="#/balance">Build teams</a><a class="btn gold" href="#/add">+ Record match</a></div></div>
    <div class="grid cols-4">
      <div class="stat"><div class="label">Games</div><div class="value num">${S.data.matches.length}</div><div class="sub">${S.stats.ordered[S.stats.ordered.length - 1] ? 'Last: ' + fmtDate(S.stats.ordered[S.stats.ordered.length - 1].date) : 'None yet'}</div></div>
      <div class="stat"><div class="label">Top of the ladder</div><div class="value">${top ? esc(top.name) : '—'}</div><div class="sub">${top ? `${top.rating} · ${pTier(top).label}` : `Finish ${st.placementGames} placements`}</div></div>
      <div class="stat"><div class="label">On fire</div><div class="value">${hot ? esc(hot.name) : '—'}</div><div class="sub">${hot ? `${hot.streak} wins in a row` : 'No active streaks'}</div></div>
      <div class="stat"><div class="label">Best streak</div><div class="value">${best && best.bestStreak ? esc(best.name) : '—'}</div><div class="sub">${best && best.bestStreak ? `${best.bestStreak} straight wins` : '—'}</div></div>
    </div>
    ${podium.length ? `<div class="podium">${order.map(p => {
      const t = pTier(p);
      return `<a class="pod ${p.rank === 1 ? 'first' : ''}" href="${pLink(p.id)}" style="--tier:${t.color}">
        <span class="place">#${p.rank}</span>${crest(t, p.rank === 1 ? 64 : 52).replace('class="crest"', 'class="crest" style="margin:0 auto"')}
        <div class="name">${esc(p.name)}</div><div class="tier-name">${t.label}</div>
        <div class="rating num">${p.rating}</div><div class="wl num">${p.wins}W ${p.losses}L · ${pct(p.wins, p.games)}</div></a>`;
    }).join('')}</div>` : ''}
    ${table(ranked, 'Ranked')}
    ${table(unranked, 'In placements')}
    <details class="explain"><summary>How ratings work</summary><div class="help">
      Everyone starts at <b>${st.startRating}</b>. Each game compares the average rating of both teams to work out the
      expected result, then every player gains or loses <code>K × (result − expected)</code> points.
      Beating a stronger team pays more; losing to a weaker team costs more.
      Your first <b>${st.placementGames}</b> games are placements with a bigger K (<b>${st.placementK}</b> vs <b>${st.kFactor}</b>)
      so you find your level fast. Ratings are recalculated from the full match history, so fixing a mistake in an old game is always safe.
      <br>Tiers: ${TIERS.map(t => `<span style="color:${t.color}">${t.name} ${st.startRating + t.off}+</span>`).join(' · ')}
    </div></details>`;
}

function ratingChart(p) {
  const st = S.data.settings;
  const pts = [{ rating: st.startRating, date: p.joined }, ...p.history];
  if (pts.length < 2) return '<div class="empty small">Play a game to start your rating history.</div>';
  const W = 800, H = 230, L = 46, R = 14, T = 14, B = 26;
  const vals = pts.map(x => x.rating);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (max - min < 60) { const c = (max + min) / 2; min = c - 30; max = c + 30; }
  min -= 8; max += 8;
  const x = i => L + (i / (pts.length - 1)) * (W - L - R);
  const y = v => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const line = pts.map((q, i) => `${x(i).toFixed(1)},${y(q.rating).toFixed(1)}`).join(' ');
  const area = `${L},${H - B} ${line} ${x(pts.length - 1).toFixed(1)},${H - B}`;
  const step = (max - min) > 240 ? 100 : (max - min) > 120 ? 50 : 25;
  let grid = '';
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#1f2a40" stroke-dasharray="3 4"/>
      <text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#5d677d">${v}</text>`;
  }
  let bands = '';
  for (const t of TIERS) {
    const v = st.startRating + t.off;
    if (v > min && v < max) bands += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${t.color}" stroke-opacity=".35"/>
      <text x="${W - R - 4}" y="${y(v) - 4}" text-anchor="end" font-size="10" fill="${t.color}" fill-opacity=".8">${t.name}</text>`;
  }
  const dots = pts.slice(1).map((q, i) => `<circle cx="${x(i + 1)}" cy="${y(q.rating)}" r="${pts.length > 40 ? 2 : 3.5}" fill="${q.won ? '#3ccf91' : '#ef5b5b'}"><title>${fmtDate(q.date)} · ${q.won ? 'Win' : 'Loss'} ${signed(q.delta)} → ${q.rating}</title></circle>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rating history">
    <defs><linearGradient id="ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#c8aa6e" stop-opacity=".28"/><stop offset="1" stop-color="#c8aa6e" stop-opacity="0"/></linearGradient></defs>
    ${grid}${bands}<polygon points="${area}" fill="url(#ga)"/>
    <polyline points="${line}" fill="none" stroke="#c8aa6e" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>${dots}
    <text x="${L}" y="${H - 6}" font-size="11" fill="#5d677d">Game 1</text><text x="${W - R}" y="${H - 6}" text-anchor="end" font-size="11" fill="#5d677d">Game ${pts.length - 1}</text></svg>`;
}

function viewPlayer(id) {
  const p = S.stats.P[id];
  if (!p) return `<div class="panel empty"><h2>Player not found</h2><a class="btn" href="#/">Back to ladder</a></div>`;
  const st = S.data.settings, t = pTier(p), P = S.stats.P;
  const relList = (obj, dir) => {
    const list = Object.entries(obj).filter(([pid, v]) => P[pid] && v.g >= 2)
      .map(([pid, v]) => ({ pid, ...v, wr: v.w / v.g }))
      .sort((a, b) => dir * (b.wr - a.wr) || b.g - a.g).slice(0, 5);
    if (!list.length) return '<div class="empty small">Need 2+ games together.</div>';
    return list.map(r => `<a class="list-row" href="${pLink(r.pid)}">${crest(pTier(P[r.pid]), 22)}<span class="grow">${pName(r.pid)}</span>
      <span class="small muted num">${r.w}–${r.g - r.w}</span><b class="num" style="width:44px;text-align:right">${pct(r.w, r.g)}</b></a>`).join('');
  };
  const champs = Object.entries(p.champs).sort((a, b) => b[1].g - a[1].g || b[1].w - a[1].w).slice(0, 8);
  const maxRole = Math.max(1, ...Object.values(p.roles).map(r => r.g));
  const recent = [...p.history].reverse().slice(0, 15);
  return `
    <div class="panel hero" style="--tier:${t.color}">
      ${crest(t, 92)}
      <div class="who"><div class="tier-line">${t.label}${p.rank ? ` · #${p.rank} on the ladder` : ` · ${p.games}/${st.placementGames} placements`}</div>
        <h1>${esc(p.name)}</h1>
        <div class="muted small">${p.mainRole ? `Main ${ROLE_NAMES[p.mainRole]} · ` : ''}${p.retired ? 'Retired · ' : ''}${p.games} games</div></div>
      <div class="big"><div class="rating num">${p.rating}</div><div class="muted small">Peak ${p.peak}</div></div>
    </div>
    <div class="grid cols-4" style="margin-top:14px">
      <div class="stat"><div class="label">Record</div><div class="value num">${p.wins}W ${p.losses}L</div><div class="sub">${pct(p.wins, p.games)} win rate</div></div>
      <div class="stat"><div class="label">Streak</div><div class="value">${streakHtml(p.streak)}</div><div class="sub">Best: ${p.bestStreak || 0} wins</div></div>
      <div class="stat"><div class="label">Last 10</div><div class="value">${formPills(p.form, 10)}</div><div class="sub">${p.form.slice(-10).filter(x => x === 'W').length}W in last ${Math.min(10, p.form.length)}</div></div>
      <div class="stat"><div class="label">Last game</div><div class="value num">${p.games ? signed(p.lastDelta) : '—'}</div><div class="sub">${p.history.length ? fmtDate(p.history[p.history.length - 1].date) : 'No games'}</div></div>
    </div>
    <div class="panel" style="margin-top:14px"><h3 style="margin-bottom:8px">Rating history</h3>${ratingChart(p)}</div>
    <div class="grid cols-3" style="margin-top:14px">
      <div class="panel"><h3 style="margin-bottom:6px">Best teammates</h3>${relList(p.with, 1)}</div>
      <div class="panel"><h3 style="margin-bottom:6px">Toughest opponents</h3>${relList(p.vs, -1)}</div>
      <div class="panel"><h3 style="margin-bottom:6px">Roles</h3>${ROLES.map(r => {
        const v = p.roles[r] || { g: 0, w: 0 };
        return `<div class="list-row"><span class="role">${r}</span><span class="grow small">${ROLE_NAMES[r]}</span><span class="bar"><i style="width:${(v.g / maxRole) * 100}%"></i></span>
          <span class="small muted num" style="width:64px;text-align:right">${v.g ? `${v.g}g · ${pct(v.w, v.g)}` : '—'}</span></div>`;
      }).join('')}</div>
    </div>
    <div class="grid cols-2" style="margin-top:14px">
      <div class="panel"><h3 style="margin-bottom:6px">Champions</h3>${champs.length ? champs.map(([n, v]) =>
        `<div class="list-row">${champIcon(n, 28)}<span class="grow">${esc(n)}</span><span class="small muted num">${v.g} games</span><b class="num" style="width:44px;text-align:right">${pct(v.w, v.g)}</b></div>`).join('')
        : '<div class="empty small">No champions recorded.</div>'}</div>
      <div class="panel"><h3 style="margin-bottom:6px">Recent games</h3>${recent.length ? recent.map(h =>
        `<a class="list-row" href="#/matches">${champIcon(h.champ, 28)}<span class="grow"><b class="${h.won ? 'pos' : 'neg'}">${h.won ? 'Win' : 'Loss'}</b>
          <span class="small muted"> · ${h.champ ? esc(h.champ) + ' · ' : ''}${h.role ? ROLE_NAMES[h.role] + ' · ' : ''}${fmtDate(h.date)}</span></span>
          ${deltaHtml(h.delta)}<span class="num small muted" style="width:40px;text-align:right">${h.rating}</span></a>`).join('')
        : '<div class="empty small">No games yet.</div>'}</div>
    </div>`;
}

function matchCard(m, opts = {}) {
  const res = S.stats.results[m.id];
  const sideHtml = side => {
    const won = m.winner === side;
    return `<div class="team ${side} ${won ? 'win' : 'lose'}">
      <div class="t-head"><span class="wl">${side === 'blue' ? 'Blue side' : 'Red side'}</span><span class="num">${res ? Math.round(side === 'blue' ? res.bAvg : res.rAvg) : ''}</span></div>
      ${m[side].map(s => `<div class="mp"><span class="role">${esc(s.role || '')}</span>${champIcon(s.champ, 24)}
        <a class="nm" href="${pLink(s.player)}">${pName(s.player)}${s.champ ? ` <span class="ch">${esc(s.champ)}</span>` : ''}</a>
        ${res && res.deltas[s.player] != null ? deltaHtml(res.deltas[s.player]) : ''}</div>`).join('')}
    </div>`;
  };
  const fav = res ? (res.expBlue >= .5 ? ['Blue', res.expBlue] : ['Red', 1 - res.expBlue]) : null;
  return `<div class="match">
    <div class="match-head"><span class="res ${m.winner}">${m.winner === 'blue' ? 'Blue' : 'Red'} victory</span>
      <span class="muted">${fmtDate(m.date)}${m.duration ? ` · ${m.duration} min` : ''}</span>
      ${fav ? `<span class="dim small hide-sm">${fav[0]} favored ${Math.round(fav[1] * 100)}%${(fav[0].toLowerCase() !== m.winner) && fav[1] > .55 ? ' · upset!' : ''}</span>` : ''}
      ${opts.tools !== false ? `<span class="tools"><button class="icon-btn" data-act="edit-match" data-id="${esc(m.id)}">Edit</button><button class="icon-btn" data-act="del-match" data-id="${esc(m.id)}">Delete</button></span>` : ''}
    </div>
    <div class="teams">${sideHtml('blue')}${sideHtml('red')}</div>
    ${m.notes ? `<div class="notes">${esc(m.notes)}</div>` : ''}
  </div>`;
}

function viewMatches() {
  const f = S.matchFilter;
  const list = [...S.stats.ordered].reverse()
    .filter(m => !f || [...m.blue, ...m.red].some(s => s.player === f));
  const players = [...S.data.players].sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="page-head"><div><h1>Match history</h1><p>${S.data.matches.length} games · newest first</p></div>
      <div class="row"><select id="matchFilter" style="width:auto;min-width:170px"><option value="">All players</option>${players.map(p => `<option value="${esc(p.id)}" ${p.id === f ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <a class="btn gold" href="#/add">+ Record match</a></div></div>
    ${list.length ? list.map(m => matchCard(m)).join('') : `<div class="panel empty"><h2>No games yet</h2><p>Record your first custom.</p><a class="btn gold" href="#/add">+ Record match</a></div>`}`;
}

// ---------- Team builder ----------
function splits(ids) {
  const n = ids.length, k = n / 2, out = [];
  const rec = (start, chosen) => {
    if (chosen.length === k) { const set = new Set(chosen); out.push([chosen.map(i => ids[i]), ids.filter((_, i) => !set.has(i))]); return; }
    for (let i = start; i < n; i++) { chosen.push(i); rec(i + 1, chosen); chosen.pop(); }
  };
  rec(1, [0]); // fix player 0 on team A so mirrored splits aren't duplicated
  return out;
}
function runBalance(randomize) {
  const ids = [...S.pick].filter(id => S.stats.P[id]);
  const P = S.stats.P;
  const sum = arr => arr.reduce((a, id) => a + P[id].rating, 0);
  const all = splits(ids).map(([a, b]) => ({ a, b, diff: Math.abs(sum(a) - sum(b)) / a.length })).sort((x, y) => x.diff - y.diff);
  let pool = all;
  if (randomize) {
    const near = all.filter(o => o.diff <= all[0].diff + 12);
    pool = (near.length >= 3 ? near : all.slice(0, Math.max(3, Math.min(10, all.length)))).sort(() => Math.random() - .5);
  }
  S.balance = pool.slice(0, 3).map(o => {
    const flip = randomize ? Math.random() < .5 : false; // random side assignment when shuffling
    const byRating = arr => [...arr].sort((x, y) => P[y].rating - P[x].rating);
    return { blue: byRating(flip ? o.b : o.a), red: byRating(flip ? o.a : o.b), diff: o.diff };
  });
}
function viewBalance() {
  const P = S.stats.P;
  const ps = S.data.players.filter(p => !p.retired).sort((a, b) => P[b.id].rating - P[a.id].rating);
  const n = [...S.pick].filter(id => P[id] && !P[id].retired).length;
  const ok = n >= 2 && n % 2 === 0 && n <= 10;
  const option = (o, i) => {
    const pr = project(o.blue, o.red);
    const col = side => `<div class="team ${side}"><div class="t-head"><span>${side === 'blue' ? 'Blue' : 'Red'} · avg ${Math.round(side === 'blue' ? pr.bAvg : pr.rAvg)}</span>
        <span class="muted">win ${side === 'blue' ? `+${pr.blueWin}` : `+${pr.redWin}`} / lose −${side === 'blue' ? pr.redWin : pr.blueWin}</span></div>
      ${o[side].map(id => `<div class="mp">${crest(pTier(P[id]), 22)}<a class="nm" href="${pLink(id)}">${pName(id)}</a>
        ${P[id].mainRole ? `<span class="role">${P[id].mainRole}</span>` : ''}<span class="num small muted">${P[id].rating}</span></div>`).join('')}</div>`;
    return `<div class="option"><div class="match-head"><span class="tag">${i === 0 && S.balance.tag !== 'shuffle' ? 'Most balanced' : `Option ${i + 1}`}</span>
      <span class="muted small">Gap ${Math.round(o.diff)} pts</span>
      <span class="odds" title="Blue ${Math.round(pr.expBlue * 100)}%"><i style="width:${pr.expBlue * 100}%"></i></span>
      <span class="small"><span style="color:var(--blue)">${Math.round(pr.expBlue * 100)}%</span> – <span style="color:var(--red)">${100 - Math.round(pr.expBlue * 100)}%</span></span>
      <span class="tools"><button class="btn sm gold" data-act="use-teams" data-i="${i}">Play this →</button></span></div>
      <div class="teams">${col('blue')}${col('red')}</div></div>`;
  };
  return `<div class="page-head"><div><h1>Team builder</h1><p>Pick who's playing and get the fairest 5v5 split by rating.</p></div></div>
    ${ps.length ? `<div class="panel">
      <div class="spread" style="margin-bottom:12px"><h3>Who's playing? <span class="${ok ? 'pos' : 'muted'}">${n}/10</span></h3>
        <div class="row"><button class="btn sm ghost" data-act="pick-none">Clear</button></div></div>
      <div class="chips">${ps.map(p => `<span class="chip ${S.pick.has(p.id) ? 'on' : ''}" data-act="pick" data-id="${esc(p.id)}" style="--tier:${pTier(P[p.id]).color}">${crest(pTier(P[p.id]), 22)}${esc(p.name)} <span class="rt num">${P[p.id].rating}</span></span>`).join('')}</div>
      <div class="row" style="margin-top:16px"><button class="btn gold" data-act="balance" ${ok ? '' : 'disabled'}>Balance teams</button>
        <button class="btn" data-act="shuffle" ${ok ? '' : 'disabled'}>Shuffle fair teams</button>
        <span class="small muted">${n > 10 ? 'Max 10 players.' : n % 2 ? 'Pick an even number of players.' : ''}</span></div>
    </div>` : `<div class="panel empty"><h2>No players yet</h2><a class="btn gold" href="#/admin">Add players</a></div>`}
    ${S.balance && S.balance.length ? `<div style="margin-top:18px">${S.balance.map(option).join('')}</div>` : ''}`;
}

// ---------- Add / edit match ----------
function emptyForm() {
  const slot = (r) => ({ player: '', role: r, champ: '' });
  return { date: today(), duration: '', notes: '', winner: '', blue: ROLES.map(slot), red: ROLES.map(slot) };
}
function formFromMatch(m) {
  const f = { date: m.date || today(), duration: m.duration || '', notes: m.notes || '', winner: m.winner, blue: [], red: [] };
  for (const side of ['blue', 'red']) {
    f[side] = ROLES.map((r, i) => ({ player: m[side][i]?.player || '', role: m[side][i]?.role || r, champ: m[side][i]?.champ || '' }));
  }
  return f;
}
function viewAdd() {
  if (!S.form) S.form = emptyForm();
  const f = S.form, P = S.stats.P;
  const used = [...f.blue, ...f.red].map(s => s.player).filter(Boolean);
  const usedSet = new Set(used);
  const dups = new Set(used.filter((id, i) => used.indexOf(id) !== i));
  const ids = side => f[side].map(s => s.player).filter(id => P[id]);
  const pr = project(ids('blue'), ids('red'));
  const sideForm = side => `<div class="side ${side}">
    <div class="side-head"><h2>${side === 'blue' ? 'Blue' : 'Red'} side</h2>${pr ? `<span class="small muted">avg <b class="num">${Math.round(side === 'blue' ? pr.bAvg : pr.rAvg)}</b></span>` : ''}</div>
    ${f[side].map((s, i) => `<div class="slot ${dups.has(s.player) ? 'dup' : ''}">
      <select data-f="role" data-side="${side}" data-i="${i}" aria-label="Role">${ROLES.map(r => `<option value="${r}" ${s.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <select data-f="player" data-side="${side}" data-i="${i}" aria-label="Player">${playerOptions(s.player, usedSet)}</select>
      <input data-f="champ" data-side="${side}" data-i="${i}" list="champList" placeholder="Champion" value="${esc(s.champ)}" autocomplete="off" aria-label="Champion">
      <span class="ic">${champIcon(s.champ, 26)}</span>
    </div>`).join('')}
  </div>`;
  return `<div class="page-head"><div><h1>${S.editing ? 'Edit match' : 'Record match'}</h1><p>Champions are optional. Leave a slot empty for 4v4s.</p></div>
      <div class="row">${S.editing ? '<button class="btn ghost" data-act="cancel-edit">Cancel edit</button>' : '<button class="btn ghost" data-act="clear-form">Clear</button>'}
      <button class="btn" data-act="swap-sides">⇄ Swap sides</button></div></div>
    <div class="panel">
      <div class="grid cols-3">
        <label class="field">Date<input type="date" data-f="date" value="${esc(f.date)}"></label>
        <label class="field">Length (min)<input type="number" min="0" max="120" data-f="duration" value="${esc(f.duration)}" placeholder="optional"></label>
        <div class="field" style="display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.06em">Winner
          <div class="winner-pick"><button class="btn blue ${f.winner === 'blue' ? 'on' : ''}" data-act="winner" data-side="blue">Blue won</button>
          <button class="btn red ${f.winner === 'red' ? 'on' : ''}" data-act="winner" data-side="red">Red won</button></div></div>
      </div>
    </div>
    <div class="slots" style="margin-top:14px">${sideForm('blue')}${sideForm('red')}</div>
    <div class="panel" style="margin-top:14px">
      <label class="field">Notes<textarea data-f="notes" placeholder="Pentakill? Baron steal? Throw of the century?">${esc(f.notes)}</textarea></label>
      <div class="spread" style="margin-top:14px">
        <div class="preview">${pr ? `Blue <b>${Math.round(pr.expBlue * 100)}%</b> to win. If Blue wins: <b class="pos">+${pr.blueWin}</b> / <b class="neg">−${pr.blueWin}</b> · If Red wins: <b class="pos">+${pr.redWin}</b> / <b class="neg">−${pr.redWin}</b> <span class="dim">(typical)</span>` : 'Pick players on both sides to see the stakes.'}
          ${dups.size ? '<div class="neg">Someone is on the roster twice.</div>' : ''}</div>
        <button class="btn gold" data-act="save-match">${S.editing ? 'Save changes' : 'Save match'}</button>
      </div>
    </div>`;
}
function saveMatch() {
  const f = S.form;
  const clean = side => f[side].filter(s => s.player && S.stats.P[s.player]).map(s => ({ player: s.player, role: s.role, ...(s.champ.trim() ? { champ: canonChamp(s.champ) } : {}) }));
  const blue = clean('blue'), red = clean('red');
  const all = [...blue, ...red].map(s => s.player);
  if (!blue.length || !red.length) return toast('Add at least one player to each side.', true);
  if (new Set(all).size !== all.length) return toast('A player can only be in the game once.', true);
  if (!f.winner) return toast('Pick the winning side.', true);
  if (!f.date) return toast('Pick a date.', true);
  const m = { id: S.editing || uid('m'), date: f.date, blue, red, winner: f.winner,
    ...(Number(f.duration) > 0 ? { duration: Number(f.duration) } : {}), ...(f.notes.trim() ? { notes: f.notes.trim() } : {}) };
  const editing = S.editing;
  S.form = null; S.editing = null;
  location.hash = '#/matches';
  commit(d => {
    if (editing) { const i = d.matches.findIndex(x => x.id === editing); if (i >= 0) d.matches[i] = m; else d.matches.push(m); }
    else d.matches.push(m);
  }, editing ? 'Match updated — ratings recalculated.' : 'Match saved!');
}

// ---------- Admin ----------
function viewAdmin() {
  const c = ghCfg(), st = S.data.settings, P = S.stats.P;
  const ps = [...S.data.players].sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="page-head"><div><h1>Admin</h1><p>Players, publishing and league settings.</p></div></div>
    <div class="grid cols-2">
      <div class="panel">
        <h2 style="margin-bottom:12px">Players</h2>
        <form class="row" data-form="add-player" style="flex-wrap:nowrap">
          <input id="newName" placeholder="Summoner name" maxlength="32" autocomplete="off" style="flex:1">
          <select id="newRole" style="width:110px"><option value="">Main role</option>${ROLES.map(r => `<option value="${r}">${ROLE_NAMES[r]}</option>`).join('')}</select>
          <button class="btn gold" type="submit">Add</button>
        </form>
        <div style="margin-top:10px">${ps.length ? ps.map(p => `<div class="list-row">${crest(pTier(P[p.id]), 24)}
          <a class="grow" href="${pLink(p.id)}">${esc(p.name)} ${p.retired ? '<span class="pill">retired</span>' : ''}</a>
          <select data-act-change="player-role" data-id="${esc(p.id)}" style="width:96px;padding:4px 22px 4px 8px;font-size:12px"><option value="">—</option>${ROLES.map(r => `<option value="${r}" ${p.mainRole === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
          <span class="small muted num" style="width:54px;text-align:right">${P[p.id].games}g</span>
          <button class="icon-btn" data-act="rename-player" data-id="${esc(p.id)}">Rename</button>
          ${P[p.id].games ? `<button class="icon-btn" data-act="retire-player" data-id="${esc(p.id)}">${p.retired ? 'Unretire' : 'Retire'}</button>`
            : `<button class="icon-btn" data-act="del-player" data-id="${esc(p.id)}">Delete</button>`}</div>`).join('')
          : '<div class="empty small">Add your first player above.</div>'}</div>
        <p class="help">Players with games can't be deleted (it would rewrite everyone's ratings) — retire them to hide them from the ladder instead.</p>
      </div>

      <div>
        <div class="panel">
          <h2 style="margin-bottom:6px"><span class="status-dot ${ghReady(c) ? 'on' : ''}"></span>Publishing</h2>
          <p class="help" style="margin-top:0">Anyone can view the site. To <b>save</b> changes for everyone, the person recording games connects a GitHub token once on their device.
            The token is kept in this browser only.</p>
          <form data-form="gh" class="grid cols-2">
            <label class="field">Repo owner<input id="ghOwner" value="${esc(c.owner)}" placeholder="your-github-username" autocomplete="off"></label>
            <label class="field">Repo name<input id="ghRepo" value="${esc(c.repo)}" placeholder="customs-league" autocomplete="off"></label>
            <label class="field">Branch<input id="ghBranch" value="${esc(c.branch)}"></label>
            <label class="field">Data file<input id="ghPath" value="${esc(c.path)}"></label>
            <label class="field" style="grid-column:1/-1">Token<input id="ghToken" type="password" value="${esc(c.token)}" placeholder="github_pat_…" autocomplete="off"></label>
            <div class="row" style="grid-column:1/-1"><button class="btn gold" type="submit">Save &amp; test</button>
              ${c.token ? '<button class="btn ghost danger" type="button" data-act="gh-clear">Forget token</button>' : ''}</div>
          </form>
          <details class="explain" style="margin-top:14px"><summary>How do I get a token?</summary><div class="help"><ol>
            <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener" style="color:var(--gold)">GitHub → Fine-grained tokens → Generate new token</a>.</li>
            <li>Repository access: <b>Only select repositories</b> → pick this site's repo.</li>
            <li>Permissions → Repository → <b>Contents: Read and write</b>.</li>
            <li>Generate, copy, paste it above. Friends who should be able to record games need to be repo collaborators and make their own token.</li></ol></div></details>
        </div>

        <div class="panel">
          <h2 style="margin-bottom:12px">League settings</h2>
          <form data-form="settings" class="grid cols-2">
            <label class="field">League name<input id="sName" value="${esc(st.leagueName)}" maxlength="40"></label>
            <label class="field">Season<input id="sSeason" value="${esc(st.season)}" maxlength="40"></label>
            <label class="field">Starting rating<input id="sStart" type="number" value="${st.startRating}" min="0" step="50"></label>
            <label class="field">K-factor<input id="sK" type="number" value="${st.kFactor}" min="1" max="200"></label>
            <label class="field">Placement games<input id="sPG" type="number" value="${st.placementGames}" min="0" max="20"></label>
            <label class="field">Placement K<input id="sPK" type="number" value="${st.placementK}" min="1" max="200"></label>
            <div class="row" style="grid-column:1/-1"><button class="btn gold" type="submit">Save settings</button><span class="help">Changing these recalculates every rating from scratch.</span></div>
          </form>
        </div>

        <div class="panel">
          <h2 style="margin-bottom:12px">Backup</h2>
          <div class="row"><button class="btn" data-act="export">Export JSON</button><button class="btn" data-act="import">Import JSON</button>
            ${S.dirty ? '<button class="btn ghost danger" data-act="discard">Discard local changes</button>' : ''}</div>
          <p class="help">No GitHub access? Record games anyway, export the file and send it to whoever runs the site — they can import it and publish.</p>
        </div>
      </div>
    </div>`;
}

// ---------- Events ----------
document.addEventListener('click', e => {
  const tr = e.target.closest('tr[data-href]');
  if (tr && !e.target.closest('a,button')) { location.hash = tr.dataset.href; return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const { act, id } = a.dataset;
  const P = S.stats?.P;
  switch (act) {
    case 'publish': ghReady() ? publish() : (location.hash = '#/admin', toast('Add a GitHub token to publish.')); break;
    case 'discard':
      if (confirm('Throw away all unpublished changes on this device?')) { store.del(LS.draft); S.form = null; S.editing = null; S.dirty = false; load(); }
      break;
    case 'pick':
      S.pick.has(id) ? S.pick.delete(id) : S.pick.add(id);
      store.set(LS.pick, [...S.pick]); S.balance = null; render(); break;
    case 'pick-none': S.pick.clear(); store.set(LS.pick, []); S.balance = null; render(); break;
    case 'balance': runBalance(false); render(); break;
    case 'shuffle': runBalance(true); S.balance.tag = 'shuffle'; render(); break;
    case 'use-teams': {
      const o = S.balance[Number(a.dataset.i)];
      const slots = ids => ROLES.map((r, i) => ({ player: ids[i] || '', role: r, champ: '' }));
      // Try to put players in their main role
      const fit = ids => {
        const out = Array(5).fill(null), rest = [];
        for (const pid of ids) { const ri = ROLES.indexOf(P[pid].mainRole); if (ri >= 0 && !out[ri]) out[ri] = pid; else rest.push(pid); }
        for (let i = 0; i < 5; i++) if (!out[i]) out[i] = rest.shift() || '';
        return out;
      };
      S.editing = null;
      S.form = { ...emptyForm(), blue: slots(fit(o.blue)), red: slots(fit(o.red)) };
      location.hash = '#/add'; break;
    }
    case 'winner': S.form.winner = a.dataset.side; render(); break;
    case 'swap-sides': { const b = S.form.blue; S.form.blue = S.form.red; S.form.red = b; if (S.form.winner) S.form.winner = S.form.winner === 'blue' ? 'red' : 'blue'; render(); break; }
    case 'clear-form': S.form = emptyForm(); render(); break;
    case 'cancel-edit': S.form = null; S.editing = null; location.hash = '#/matches'; break;
    case 'save-match': saveMatch(); break;
    case 'edit-match': {
      const m = S.data.matches.find(x => x.id === id); if (!m) break;
      S.editing = id; S.form = formFromMatch(m); location.hash = '#/add'; break;
    }
    case 'del-match':
      if (confirm('Delete this match? Ratings will be recalculated.')) commit(d => { d.matches = d.matches.filter(m => m.id !== id); }, 'Match deleted.');
      break;
    case 'rename-player': {
      const p = S.data.players.find(x => x.id === id);
      const name = prompt('New name', p.name);
      if (name && name.trim() && name.trim() !== p.name) {
        if (S.data.players.some(x => x.id !== id && x.name.toLowerCase() === name.trim().toLowerCase())) return toast('That name is taken.', true);
        commit(d => { d.players.find(x => x.id === id).name = name.trim().slice(0, 32); }, 'Renamed.');
      }
      break;
    }
    case 'retire-player': commit(d => { const p = d.players.find(x => x.id === id); p.retired = !p.retired; if (!p.retired) delete p.retired; }); break;
    case 'del-player':
      if (confirm(`Delete ${P[id].name}?`)) { S.pick.delete(id); commit(d => { d.players = d.players.filter(p => p.id !== id); }, 'Player deleted.'); }
      break;
    case 'gh-clear': { const c = ghCfg(); c.token = ''; store.set(LS.gh, c); render(); toast('Token removed from this browser.'); break; }
    case 'export': {
      const blob = new Blob([serialize(S.data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement('a'), { href: url, download: `league-${today()}.json` });
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      break;
    }
    case 'import': $('#importFile').click(); break;
  }
});

document.addEventListener('submit', async e => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  if (kind === 'add-player') {
    if (addPlayer($('#newName').value, $('#newRole').value)) setTimeout(() => $('#newName')?.focus(), 0);
  } else if (kind === 'settings') {
    const num = (sel, min, max) => Math.min(max, Math.max(min, Math.round(Number($(sel).value) || 0)));
    commit(d => {
      d.settings = { leagueName: $('#sName').value.trim() || DEFAULT_SETTINGS.leagueName, season: $('#sSeason').value.trim() || DEFAULT_SETTINGS.season,
        startRating: num('#sStart', 0, 5000), kFactor: num('#sK', 1, 200), placementGames: num('#sPG', 0, 20), placementK: num('#sPK', 1, 200) };
    }, 'Settings saved — ratings recalculated.');
  } else if (kind === 'gh') {
    const c = { owner: $('#ghOwner').value.trim(), repo: $('#ghRepo').value.trim(), branch: $('#ghBranch').value.trim() || 'main',
      path: $('#ghPath').value.trim().replace(/^\/+/, '') || 'data/league.json', token: $('#ghToken').value.trim() };
    store.set(LS.gh, c);
    if (!ghReady(c)) { toast('Saved. Fill in owner, repo and token to enable publishing.'); render(); return; }
    toast('Testing connection…');
    try {
      const r = await ghFetchFile(c);
      if (!S.dirty && r.text) { S.data = normalize(JSON.parse(r.text)); S.base = hash(canon(r.text)); recompute(); }
      toast(r.text ? 'Connected! You can publish from this device.' : 'Connected — the data file will be created on first publish.');
    } catch (err) {
      toast(`Couldn't connect — ${err.message}`, true);
    }
    render();
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'matchFilter') { S.matchFilter = el.value; render(); return; }
  if (el.id === 'importFile') {
    const file = el.files[0]; el.value = '';
    if (!file) return;
    file.text().then(t => {
      const d = normalize(JSON.parse(t));
      if (!confirm(`Import ${d.players.length} players and ${d.matches.length} matches? This replaces the current data on this device (publish afterwards to share).`)) return;
      commit(x => { x.settings = d.settings; x.players = d.players; x.matches = d.matches; }, 'Imported.');
    }).catch(() => toast('That file isn’t valid league JSON.', true));
    return;
  }
  if (el.dataset.actChange === 'player-role') {
    commit(d => { const p = d.players.find(x => x.id === el.dataset.id); if (el.value) p.mainRole = el.value; else delete p.mainRole; });
    return;
  }
  const f = el.dataset.f;
  if (!f || !S.form) return;
  if (el.dataset.side) {
    const slot = S.form[el.dataset.side][Number(el.dataset.i)];
    if (f === 'player' && el.value === '__new') {
      const name = prompt('New player name');
      const p = name ? addPlayer(name) : null;
      slot.player = p ? p.id : slot.player;
      render(); return;
    }
    slot[f] = f === 'champ' ? canonChamp(el.value) : el.value;
    if (f === 'champ') el.value = slot.champ;
    if (f === 'player') render();
  } else S.form[f] = el.value;
});
document.addEventListener('input', e => {
  const el = e.target;
  if (!S.form || !el.dataset.f) return;
  if (el.dataset.f === 'champ' && el.dataset.side) {
    S.form[el.dataset.side][Number(el.dataset.i)].champ = el.value;
    // Update the icon without a full re-render (keeps focus while typing)
    const known = CH.lower[el.value.trim().toLowerCase()];
    if (known) el.parentElement.querySelector('.ic').innerHTML = champIcon(known, 26);
  } else if (['date', 'duration', 'notes'].includes(el.dataset.f)) S.form[el.dataset.f] = el.value;
});

window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
window.addEventListener('beforeunload', e => { if (S.busy) e.preventDefault(); });

loadChamps();
load();
