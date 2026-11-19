'use strict';
/* Customs League — a minimal Elo ladder for 5v5 League of Legends customs.
 * Players are identified by Riot ID (Name#TAG). Games are entered by hand (Riot's API
 * doesn't expose custom games), stored in data/league.json and published via the GitHub API.
 * Ratings are recomputed from the full game list on every load. */

const START = 1000;
const K = 200; // an even match swings about ±100 — few customs get played, so ratings need to move fast
// One rank per 100 points; 1000 sits in the middle of Mid.
const RANKS = [
  { name: 'Tool', color: '#8a6f5c' },
  { name: 'Pawn', color: '#b07d5a' },
  { name: 'NPC', color: '#8f9bb0' },
  { name: 'The Observer', color: '#c9ccd4' },
  { name: 'Manipulator', color: '#4fc1b0' },
  { name: 'Puppet Master', color: '#9b7bff' },
  { name: 'Ayanokoji', color: '#f0c75e' },
];
const MID = 3;
const rankFor = r => RANKS[Math.max(0, Math.min(RANKS.length - 1, MID + Math.floor((r - (START - 50)) / 100)))];
const rankFloor = i => (i === 0 ? null : START - 50 + (i - MID) * 100);
const LS = { gh: 'cl.github', draft: 'cl.draft', form: 'cl.form2', admin: 'cl.admin' };
// Only the owner edits. Visiting the site once with #admin unlocks editing on that device;
// everyone else sees a read-only ladder.
if (location.hash === '#admin') { try { localStorage.setItem(LS.admin, '1'); } catch { /* ignore */ } history.replaceState(null, '', location.pathname + location.search); }
const DEFAULTS = { leagueName: 'Customs League', region: 'na' };

// ---------- utils ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = s => { const d = new Date(s + 'T12:00:00'); return isNaN(d) ? s : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n);
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const canon = t => { try { return JSON.stringify(JSON.parse(t)); } catch { return t; } };
const serialize = d => JSON.stringify(d, null, 2) + '\n';
const b64enc = s => { const b = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]); return btoa(bin); };
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// Riot IDs: "Game Name#TAG". Case-insensitive identity, original casing for display.
function parseRiotId(s) {
  const m = String(s || '').trim().replace(/\s*#\s*/, '#').match(/^([^#]{1,16})#([^#\s]{2,5})$/);
  return m ? `${m[1].trim()}#${m[2]}` : null;
}
const keyOf = id => id.toLowerCase().replace(/\s+/g, ''); // Riot IDs: ignore case + spaces
const opgg = (id, region) => {
  const [name, tag] = id.split('#');
  return `https://op.gg/lol/summoners/${region}/${encodeURIComponent(name)}-${encodeURIComponent(tag)}`;
};

// ---------- state ----------
const S = { importing: null, data: null, base: null, dirty: false, remoteChanged: false, stats: null, form: (f => (f && Array.isArray(f.results) ? f : null))(store.get(LS.form)), askKey: false, showAll: false, busy: false };

function normalize(d) {
  d = d && typeof d === 'object' ? d : {};
  return {
    version: 2,
    settings: { ...DEFAULTS, ...(d.settings || {}) },
    games: (Array.isArray(d.games) ? d.games : []).filter(g => g && g.id && Array.isArray(g.blue) && Array.isArray(g.red) && ['blue', 'red'].includes(g.winner)),
  };
}

// ---------- Elo ----------
function compute(data) {
  const P = {};        // key -> { id, rating, wins, losses, last }
  const deltas = {};   // game id -> { blue, red }
  const ordered = data.games.map((g, i) => ({ g, i })).sort((a, b) => a.g.date.localeCompare(b.g.date) || a.i - b.i).map(x => x.g);
  const get = id => P[keyOf(id)] || (P[keyOf(id)] = { id, rating: START, wins: 0, losses: 0, last: 0, seen: 0 });
  let n = 0;
  for (const g of ordered) {
    n++;
    const blue = g.blue.map(get), red = g.red.map(get);
    const avg = t => t.reduce((a, p) => a + p.rating, 0) / t.length;
    const expBlue = 1 / (1 + Math.pow(10, (avg(red) - avg(blue)) / 400));
    const dBlue = Math.round(K * ((g.winner === 'blue' ? 1 : 0) - expBlue));
    deltas[g.id] = { blue: dBlue, red: -dBlue };
    for (const [team, d, won] of [[blue, dBlue, g.winner === 'blue'], [red, -dBlue, g.winner === 'red']]) {
      for (const p of team) { p.rating += d; p.last = d; p.seen = n; won ? p.wins++ : p.losses++; }
    }
  }
  const ladder = Object.values(P).sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.id.localeCompare(b.id));
  return { P, deltas, ordered, ladder };
}

// ---------- GitHub sync ----------
function ghDefaults() {
  const h = location.hostname; let owner = 'conradcsoares', repo = 'customs-league'; // fallback when not on github.io
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
  if (!ghReady(c)) { S.askKey = true; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => $('#ghToken')?.focus(), 50); return; }
  if (S.busy) return;
  S.busy = true; renderBanner();
  try {
    const remote = await ghFetchFile(c);
    if (remote.text && S.base && hash(canon(remote.text)) !== S.base &&
      !confirm('Someone else published since you loaded the page. Publishing will overwrite their changes. Continue?')) return;
    const text = serialize(S.data);
    await ghRequest('PUT', c, { message: `Update ladder (${S.data.games.length} games)`, content: b64enc(text), branch: c.branch, ...(remote.sha ? { sha: remote.sha } : {}) });
    S.base = hash(canon(text)); S.dirty = false; S.remoteChanged = false; store.del(LS.draft);
    toast('Published! The live site updates in about a minute.');
  } catch (e) {
    if (e.status === 401) { store.set(LS.gh, { ...c, token: '' }); S.askKey = true; toast('Your GitHub key expired or was revoked — paste a new one.', true); }
    else if (e.status === 403 || e.status === 404) { S.askKey = 'perm'; window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else toast(`Publish failed — ${e.message}`, true);
  }
  finally { S.busy = false; render(); }
}

// ---------- load / save ----------
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
  let remote = {};
  if (text) { try { remote = JSON.parse(text); } catch { err = new Error('data/league.json is not valid JSON'); } }
  S.base = text ? hash(canon(text)) : null;
  const draft = store.get(LS.draft);
  if (draft && draft.data) { S.data = normalize(draft.data); S.dirty = true; S.remoteChanged = draft.base !== S.base; }
  else { S.data = normalize(remote); S.dirty = false; S.remoteChanged = false; }
  if (err) toast(`Couldn't load the ladder (${err.message}).`, true);
  update();
}
function update() {
  S.stats = compute(S.data);
  $('#playerList').innerHTML = S.stats.ladder.map(p => `<option value="${esc(p.id)}">`).join('');
  render();
}
function commit(fn, msg) {
  fn(S.data);
  S.dirty = true;
  store.set(LS.draft, { data: S.data, base: S.base });
  update();
  if (msg) toast(msg);
}

// ---------- render ----------
let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, err ? 5000 : 2600);
}
function nameHtml(id) {
  const [n, t] = id.split('#');
  return `${esc(n)}<span class="tag">#${esc(t)}</span>`;
}
function renderBanner() {
  const b = $('#banner');
  if (!S.dirty) { b.innerHTML = ''; return; }
  b.innerHTML = `<div class="wrap"><span class="msg">${S.remoteChanged
    ? '<b>Heads up:</b> the live ladder changed since you started editing here. Publishing will overwrite it.'
    : '<b>Not published yet.</b> Only you can see these changes.'}</span>
    <button class="btn sm" data-act="discard">Discard</button>
    <button class="btn sm gold" data-act="publish" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Publishing…' : 'Publish'}</button></div>`;
}
const canEdit = () => store.get(LS.admin) === 1 || !!ghCfg().token;
function render() {
  const st = S.data.settings;
  $('#recordBtn').hidden = !canEdit();
  $('#leagueName').textContent = st.leagueName;
  document.title = st.leagueName;
  renderBanner();
  $('#view').innerHTML = (S.askKey ? viewKeyBox() : '') + (S.form ? viewForm() : '') + viewLadder() + viewGames();
}

function viewLadder() {
  const { ladder } = S.stats, region = S.data.settings.region;
  if (!ladder.length) return `<div class="card empty">No games yet.</div>`;
  return `<div class="card"><table class="ladder">
    <thead><tr><th class="rk">#</th><th>Player</th><th class="r">W–L</th><th class="r">Rating</th></tr></thead>
    <tbody>${ladder.map((p, i) => `<tr>
      <td class="rk">${i + 1}</td>
      <td class="pl"><a href="${opgg(p.id, region)}" target="_blank" rel="noopener" title="Open on op.gg">${nameHtml(p.id)}</a>
        <span class="rank" style="--c:${rankFor(p.rating).color}">${rankFor(p.rating).name}</span></td>
      <td class="r num muted">${p.wins}–${p.losses}</td>
      <td class="r num"><span class="rating">${p.rating}</span><span class="d ${p.last > 0 ? 'pos' : p.last < 0 ? 'neg' : 'dim'}">${signed(p.last)}</span></td>
    </tr>`).join('')}</tbody></table>
    <div class="legend">${RANKS.map((r, i) => `<span style="color:${r.color}">${r.name}${rankFloor(i) == null ? '' : ` ${rankFloor(i)}+`}</span>`).reverse().join('')}</div></div>`;
}

// Consecutive games sharing a series id (a Bo3 etc.) are shown as one row. Newest first.
function groupGames() {
  const out = [];
  for (const g of [...S.stats.ordered].reverse()) {
    const last = out[out.length - 1];
    if (g.series && last && last.series === g.series) last.games.unshift(g);
    else out.push({ series: g.series || null, games: [g] });
  }
  return out;
}

function viewGames() {
  const { deltas, P } = S.stats;
  const groups = groupGames();
  if (!groups.length) return '';
  const shown = S.showAll ? groups : groups.slice(0, 5);
  const names = ids => ids.map(id => esc((P[keyOf(id)]?.id || id).split('#')[0])).join(', ');
  return `<div class="card"><h2>Recent games</h2>
    ${shown.map(gr => {
      const g0 = gr.games[0], n = gr.games.length;
      const bw = gr.games.filter(g => g.winner === 'blue').length, rw = n - bw;
      const top = bw > rw || (bw === rw && n > 1) ? 'blue' : 'red', bot = top === 'blue' ? 'red' : 'blue';
      const tw = top === 'blue' ? bw : rw, lw = n - tw;
      const net = gr.games.reduce((a, g) => a + deltas[g.id][top], 0);
      const tie = tw === lw;
      const score = n > 1 ? ` ${tw}–${lw}` : '';
      const ids = gr.games.map(g => g.id).join(',');
      return `<div class="game"><div class="teams">
          <div class="side">${tie ? `<b>Tied${score}</b>` : `<b class="pos">Won${score}</b>`} · ${names(g0[top])}</div>
          <div class="side muted">${tie ? `Tied${score}` : `Lost${n > 1 ? ` ${lw}–${tw}` : ''}`} · ${names(g0[bot])}</div>
          <div class="meta">${n > 1 ? `${n} games · ` : ''}${fmtDate(g0.date)} · ${signed(net)} / ${signed(-net)}</div></div>
        ${canEdit() ? `<div class="right"><button class="x" data-act="rematch" data-ids="${esc(ids)}" title="Record more games with these teams">Rematch</button>
          <button class="x" data-act="edit" data-ids="${esc(ids)}">Edit</button>
          <button class="x" data-act="delete" data-ids="${esc(ids)}" title="Delete">✕</button></div>` : ''}</div>`;
    }).join('')}
    ${groups.length > 5 ? `<div class="row end" style="margin-top:8px"><button class="link" data-act="toggle-all">${S.showAll ? 'Show less' : `Show all ${groups.length}`}</button></div>` : ''}
  </div>`;
}

// ----- record form: tap players into teams, tap the winner once per game -----
const TEAM = { blue: 'Team 1', red: 'Team 2' };
const other = s => (s === 'blue' ? 'red' : 'blue');
function emptyForm(teams) {
  return { editIds: [], date: today(), blue: teams ? [...teams.blue] : [], red: teams ? [...teams.red] : [], results: [], active: 'blue' };
}
const saveFormState = () => store.set(LS.form, S.form);
function fixActive(f) { if (f[f.active].length >= 5 && f[other(f.active)].length < 5) f.active = other(f.active); }
function pick(id) {
  const f = S.form;
  if ([...f.blue, ...f.red].some(x => keyOf(x) === keyOf(id))) return toast('Already on a team.', true);
  fixActive(f);
  if (f[f.active].length >= 5) return toast('Both teams are full.', true);
  f[f.active].push(id);
  fixActive(f); saveFormState(); render();
}
function addNew() {
  const el = $('#newPlayer'), id = parseRiotId(el.value);
  if (!id) { el.classList.add('bad'); return toast('Use Riot ID format: Name#TAG', true); }
  pick(S.stats.P[keyOf(id)]?.id || id);
  setTimeout(() => $('#newPlayer')?.focus(), 0);
}
function gamesByIds(ids) { return S.stats.ordered.filter(g => ids.includes(g.id)); }

function viewForm() {
  const f = S.form, P = S.stats.P;
  const inForm = new Set([...f.blue, ...f.red].map(keyOf));
  const pool = Object.values(P).filter(p => !inForm.has(keyOf(p.id))).sort((a, b) => b.seen - a.seen || a.id.localeCompare(b.id));
  const last = S.stats.ordered[S.stats.ordered.length - 1];
  const team = side => `<div class="tbox ${side} ${f.active === side ? 'active' : ''}" data-act="set-active" data-side="${side}">
      <div class="tbox-head"><h3>${TEAM[side]}</h3><span class="small muted">${f[side].length}/5</span></div>
      ${f[side].map(id => `<button class="mem" data-act="unpick" data-side="${side}" data-id="${esc(id)}" title="Remove">
        <span class="nm">${esc(id.split('#')[0])}</span><span class="rm">✕</span></button>`).join('')}
      ${Array(Math.max(0, 5 - f[side].length)).fill('<div class="mem empty"></div>').join('')}</div>`;
  const bw = f.results.filter(r => r === 'blue').length, rw = f.results.length - bw;
  const n = f.results.length;
  return `<div class="card form">
    <div class="row" style="justify-content:space-between;margin-bottom:12px"><h2 style="margin:0">${f.editIds.length ? 'Edit' : 'Record games'}</h2>
      <input type="date" data-f="date" value="${esc(f.date)}" style="width:auto;margin:0"></div>
    ${!f.editIds.length ? `<div class="row" style="margin-bottom:6px">
      <button class="btn sm gold" data-act="shots" ${S.importing ? 'disabled' : ''}>📷 From screenshots</button>
      ${last ? '<button class="btn sm" data-act="last-teams">↺ Same teams as last game</button>' : ''}
      ${f.blue.length || f.red.length ? '<button class="btn sm" data-act="swap">⇄ Swap</button><button class="btn sm" data-act="clear-teams">Clear</button>' : ''}</div>
      <p class="hint" style="margin:0 0 12px">${S.importing ? `⏳ ${S.importing}` : 'Pick the post-game Scoreboard screenshots (a whole Bo3 at once works), or paste one with Ctrl/⌘+V.'}</p>` : ''}
    <div class="tboxes">${team('blue')}${team('red')}</div>
    ${(f.pending || []).length ? `<div class="pending"><div class="small" style="margin:10px 0 6px"><b>New players</b> <span class="muted">— screenshots don’t show tags, so add theirs once:</span></div>
      ${f.pending.map((p, i) => `<div class="row nowrap" style="margin-bottom:6px"><span class="small ${p.side}-t" style="width:52px;flex-shrink:0">${TEAM[p.side]}</span>
        <input data-pending="${i}" value="${esc(p.name)}#" autocomplete="off" spellcheck="false" style="margin:0">
        <button class="btn sm" data-act="add-pending" data-i="${i}">Add</button></div>`).join('')}</div>` : ''}

    <div class="pool">
      <div class="small muted" style="margin-bottom:6px">${pool.length ? `Tap a player to add them to <b class="${f.active}-t">${TEAM[f.active]}</b>` : P && Object.keys(P).length ? 'Everyone is on a team.' : 'Add players by Riot ID — next time they’ll be one tap away.'}</div>
      <div class="chips">${pool.map(p => `<button class="chip" data-act="pick" data-id="${esc(p.id)}">${esc(p.id.split('#')[0])}</button>`).join('')}</div>
      <div class="row nowrap" style="margin-top:8px"><input id="newPlayer" list="playerList" placeholder="New player — Name#TAG" autocomplete="off" spellcheck="false" style="margin:0">
        <button class="btn" data-act="add-new">Add</button></div>
    </div>

    <h3 class="sub">Who won? <span class="muted">Tap once per game — Bo3? tap three times.</span></h3>
    <div class="winner"><button class="btn blue" data-act="result" data-side="blue">${TEAM.blue} won</button>
      <button class="btn red" data-act="result" data-side="red">${TEAM.red} won</button></div>
    ${n ? `<div class="results">${f.results.map((r, i) => `<button class="res ${r}" data-act="unresult" data-i="${i}" title="Remove game ${i + 1}">G${i + 1} · ${TEAM[r]} <span class="rm">✕</span></button>`).join('')}
      ${n > 1 ? `<span class="small muted">${TEAM.blue} ${bw}–${rw} ${TEAM.red}</span>` : ''}</div>` : ''}
    <div class="row end" style="margin-top:14px"><button class="btn" data-act="cancel">Cancel</button>
      <button class="btn gold" data-act="save">${n > 1 ? `Save ${n} games` : 'Save game'}</button></div>
  </div>`;
}

function saveForm() {
  const f = S.form;
  if (!f.blue.length || !f.red.length) return toast('Add players to both teams.', true);
  if (!f.results.length) return toast('Tap who won each game.', true);
  const mk = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const series = f.results.length > 1 ? mk('s') : null;
  const games = f.results.map(w => ({ id: mk('g'), date: f.date || today(), blue: [...f.blue], red: [...f.red], winner: w, ...(series ? { series } : {}) }));
  const editIds = f.editIds;
  S.form = null; store.del(LS.form);
  commit(d => {
    let at = d.games.length;
    if (editIds.length) {
      const i = d.games.findIndex(g => editIds.includes(g.id));
      d.games = d.games.filter(g => !editIds.includes(g.id));
      if (i >= 0) at = i; else at = d.games.length;
    }
    d.games.splice(at, 0, ...games);
  }, editIds.length ? 'Updated.' : `${games.length > 1 ? games.length + ' games' : 'Game'} saved — hit Publish to share.`);
}

// Shown only the first time someone presses Publish on a device.
// ----- screenshot import: read the League post-game scoreboard in the browser (Tesseract OCR) -----
// Layout (as fractions of the screenshot): result + date top-left, the 10 names in one column
// (team 1 above the "K / D / A" team-2 header line, team 2 below). The screenshot owner's row has gold stats,
// which tells us whose VICTORY/DEFEAT it is.
const OCR_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let ocrWorker = null;
async function getOcr() {
  if (ocrWorker) return ocrWorker;
  if (!window.Tesseract) {
    await new Promise((res, rej) => {
      const s = Object.assign(document.createElement('script'), { src: OCR_SRC, onload: res, onerror: () => rej(new Error('could not load the text reader')) });
      document.head.appendChild(s);
    });
  }
  ocrWorker = await Tesseract.createWorker('eng');
  return ocrWorker;
}
function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('that file isn’t an image')); };
    img.src = url;
  });
}
// Crop a region, upscale, and turn light-on-dark text into black-on-white for the OCR.
function prep(img, x0, y0, x1, y1, scale = 2.5, thr = 110) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const sx = Math.round(x0 * W), sy = Math.round(y0 * H), sw = Math.round((x1 - x0) * W), sh = Math.round((y1 - y0) * H);
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const v = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2] > thr ? 0 : 255;
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return { canvas: c, sy, scale };
}
// How much gold text is in a row's stats columns (the screenshot owner's row is gold).
function goldIn(img, y) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas'), w = Math.round(0.26 * W), h = Math.round(0.035 * H);
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, Math.round(0.49 * W), Math.round(y - h / 2), w, h, 0, 0, w, h);
  const p = ctx.getImageData(0, 0, w, h).data;
  let n = 0;
  for (let i = 0; i < p.length; i += 4) if (p[i] > 170 && p[i + 1] > 130 && p[i + 2] < 120 && p[i] - p[i + 2] > 80) n++;
  return n;
}
const normName = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
function lev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}
const nameSim = (a, b) => { a = normName(a); b = normName(b); return a && b ? 1 - lev(a, b) / Math.max(a.length, b.length) : 0; };

async function readShot(file) {
  const img = await loadImage(file);
  const worker = await getOcr();
  await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
  // Header: VICTORY / DEFEAT and the date
  const head = prep(img, 0.05, 0, 0.5, 0.13, 2, 120);
  const headText = (await worker.recognize(head.canvas)).data.text;
  const result = /vict/i.test(headText) ? 'win' : /defe|feat/i.test(headText) ? 'loss' : null;
  const dm = headText.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/);
  let date = null;
  if (dm) {
    let [, a, b, y] = dm.map(Number);
    if (a > 12) [a, b] = [b, a]; // day/month locales
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31) date = `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
  }
  // Names column
  const col = prep(img, 0.128, 0.27, 0.285, 0.93);
  const lines = (await worker.recognize(col.canvas)).data.lines || [];
  const rows = [];
  for (const ln of lines) {
    const raw = ln.text.trim();
    const y = col.sy + ((ln.bbox.y0 + ln.bbox.y1) / 2) / col.scale;
    if (/\d+\s*[\/|]\s*\d+/.test(raw) && !/[a-z]{3}/i.test(raw)) { rows.push({ sep: true, y }); continue; }
    const name = raw.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9]+$/, '').replace(/\s{2,}/g, ' ').trim();
    if (normName(name).length >= 2) rows.push({ name, y });
  }
  const names = rows.filter(r => !r.sep);
  let split = rows.findIndex((r, i) => r.sep && rows.slice(0, i).some(x => !x.sep));
  let t1, t2;
  if (split >= 0) { t1 = rows.slice(0, split).filter(r => !r.sep); t2 = rows.slice(split + 1).filter(r => !r.sep); }
  else if (names.length === 10) { t1 = names.slice(0, 5); t2 = names.slice(5); }
  else { // split at the biggest vertical gap
    let gi = 1, gmax = -1;
    for (let i = 1; i < names.length; i++) { const g = names[i].y - names[i - 1].y; if (g > gmax) { gmax = g; gi = i; } }
    t1 = names.slice(0, gi); t2 = names.slice(gi);
  }
  t1 = t1.slice(0, 5); t2 = t2.slice(0, 5);
  // Whose screenshot is it? The row with the most gold.
  const scored = [...t1.map(r => ({ side: 'blue', g: goldIn(img, r.y) })), ...t2.map(r => ({ side: 'red', g: goldIn(img, r.y) }))].sort((a, b) => b.g - a.g);
  const owner = scored.length > 1 && scored[0].g > 40 && scored[0].g > 2 * scored[1].g ? scored[0].side : null;
  const winner = owner && result ? (result === 'win' ? owner : other(owner)) : null;
  return { blue: t1.map(r => r.name), red: t2.map(r => r.name), winner, date };
}

// Match OCR'd names to known players (Riot game name, ignoring case/spaces/symbols).
function matchPlayer(name, taken) {
  let best = null, bs = 0;
  for (const p of Object.values(S.stats.P)) {
    if (taken.has(keyOf(p.id))) continue;
    const s = nameSim(name, p.id.split('#')[0]);
    if (s > bs) { bs = s; best = p; }
  }
  return bs >= 0.67 ? best.id : null;
}
function applyShots(shots) {
  const f = S.form, warn = [];
  const first = shots.find(s => s.blue.length && s.red.length);
  if (!first) { toast('Couldn’t find player names — use the post-game Scoreboard tab.', true); return; }
  const taken = new Set(), team = { blue: [], red: [] };
  f.pending = [];
  for (const side of ['blue', 'red']) for (const n of first[side]) {
    const id = matchPlayer(n, taken);
    if (id) { taken.add(keyOf(id)); team[side].push(id); } else f.pending.push({ side, name: n });
  }
  Object.assign(f, { blue: team.blue, red: team.red, results: [], active: 'blue' });
  if (first.date) f.date = first.date;
  const overlap = (a, b) => a.filter(x => b.some(y => nameSim(x, y) >= 0.67)).length;
  shots.forEach((s, i) => {
    const same = overlap(s.blue, first.blue) + overlap(s.red, first.red);
    const swapped = overlap(s.blue, first.red) + overlap(s.red, first.blue);
    if (Math.max(same, swapped) < 6) { warn.push(`screenshot ${i + 1} has different teams — record it separately`); return; }
    if (!s.winner) { warn.push(`couldn’t tell who won screenshot ${i + 1} — tap the winner`); return; }
    f.results.push(swapped > same ? other(s.winner) : s.winner);
  });
  saveFormState(); render();
  const found = f.blue.length + f.red.length;
  const msg = [`Read ${shots.length} screenshot${shots.length > 1 ? 's' : ''}: ${found} players matched, ${f.results.length} result${f.results.length === 1 ? '' : 's'}.`];
  if (f.pending.length) msg.push(`${f.pending.length} new — add their #TAG.`);
  msg.push(...warn);
  toast(msg.join(' '), !!warn.length);
}
async function importShots(fileList) {
  const files = [...fileList].filter(x => x.type.startsWith('image/')).slice(0, 7);
  if (!files.length || !S.form) return;
  const shots = [];
  try {
    for (let i = 0; i < files.length; i++) {
      S.importing = i === 0 && !ocrWorker ? 'Loading the screenshot reader (first time takes a few seconds)…' : `Reading screenshot ${i + 1} of ${files.length}…`;
      render();
      shots.push(await readShot(files[i]));
    }
    S.importing = null;
    applyShots(shots);
  } catch (e) {
    S.importing = null; render();
    toast(`Couldn’t read the screenshot — ${e.message}`, true);
  }
}
function addPending(i) {
  const f = S.form, p = f.pending[i], el = document.querySelector(`input[data-pending="${i}"]`);
  const id = parseRiotId(el.value);
  if (!id) { el.classList.add('bad'); return toast('Add their tag: Name#TAG', true); }
  if (f[p.side].length >= 5) return toast(`${TEAM[p.side]} is full.`, true);
  f.pending.splice(i, 1);
  f.active = p.side;
  pick(S.stats.P[keyOf(id)]?.id || id);
}

function viewKeyBox() {
  const repo = esc(ghCfg().repo);
  if (S.askKey === 'perm') return `<div class="card" id="keybox"><h2>Your key can't save yet</h2>
    <p class="hint" style="margin-top:0">GitHub accepted the key, but it isn't allowed to change files. Fix the same key — no need to make a new one:</p>
    <ol class="hint">
      <li>Open <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener" style="color:var(--gold)">GitHub → your fine-grained tokens</a> and click your key.</li>
      <li>Click <b>Edit</b>. Repository access: <b>Only select repositories</b> → <b>${repo}</b>.</li>
      <li>Under <b>Permissions</b>, click <b>+ Add permissions</b> → <b>Contents</b>, then change its dropdown to <b>Read and write</b>. Click <b>Update</b>.</li>
      <li>Come back and press <b>Try again</b>.</li></ol>
    <div class="row end"><button class="btn" data-act="new-key">Use a different key</button><button class="btn gold" data-act="retry-publish">Try again</button></div>
  </div>`;
  return `<div class="card" id="keybox"><h2>One-time setup to publish</h2>
    <p class="hint" style="margin-top:0">To save games for everyone, this device needs a GitHub key. You only do this once.</p>
    <ol class="hint">
      <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener" style="color:var(--gold)">GitHub → new fine-grained token</a>.</li>
      <li>Repository access: <b>Only select repositories</b> → <b>${esc(ghCfg().repo)}</b>.</li>
      <li>Under <b>Permissions</b>, click <b>+ Add permissions</b> → <b>Contents</b>, then change its dropdown to <b>Read and write</b>.</li>
      <li>Click <b>Generate token</b>, copy it and paste it here.</li></ol>
    <input id="ghToken" type="password" placeholder="Paste key: github_pat_…" autocomplete="off">
    <div class="row end"><button class="btn" data-act="cancel-key">Cancel</button><button class="btn gold" data-act="save-key">Save &amp; publish</button></div>
  </div>`;
}

// ---------- events ----------
document.addEventListener('click', async e => {
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const { act, id } = a.dataset;
  switch (act) {
    case 'open-form':
      if (!S.form) S.form = emptyForm();
      render(); window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    case 'cancel': S.form = null; store.del(LS.form); render(); break;
    case 'set-active': S.form.active = a.dataset.side; saveFormState(); render(); break;
    case 'pick': pick(id); break;
    case 'unpick': {
      const side = a.dataset.side;
      S.form[side] = S.form[side].filter(x => x !== id); S.form.active = side; saveFormState(); render(); break;
    }
    case 'add-new': addNew(); break;
    case 'shots': $('#shotFile').click(); break;
    case 'add-pending': addPending(Number(a.dataset.i)); break;
    case 'last-teams': {
      const g = S.stats.ordered[S.stats.ordered.length - 1];
      Object.assign(S.form, { blue: [...g.blue], red: [...g.red] }); saveFormState(); render(); break;
    }
    case 'swap': { const f = S.form; [f.blue, f.red] = [f.red, f.blue]; f.results = f.results.map(other); saveFormState(); render(); break; }
    case 'clear-teams': Object.assign(S.form, { blue: [], red: [], active: 'blue' }); saveFormState(); render(); break;
    case 'result':
      if (S.form.results.length >= 7) return toast('Max 7 games at once.', true);
      S.form.results.push(a.dataset.side); saveFormState(); render(); break;
    case 'unresult': S.form.results.splice(Number(a.dataset.i), 1); saveFormState(); render(); break;
    case 'save': saveForm(); break;
    case 'rematch': case 'edit': {
      const games = gamesByIds(a.dataset.ids.split(','));
      if (!games.length) break;
      S.form = emptyForm(games[0]);
      if (act === 'edit') Object.assign(S.form, { editIds: games.map(g => g.id), date: games[0].date, results: games.map(g => g.winner) });
      saveFormState(); render(); window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    }
    case 'delete': {
      const ids = a.dataset.ids.split(',');
      if (confirm(ids.length > 1 ? `Delete all ${ids.length} games in this series? Ratings will be recalculated.` : 'Delete this game? Ratings will be recalculated.'))
        commit(d => { d.games = d.games.filter(g => !ids.includes(g.id)); }, 'Deleted.');
      break;
    }
    case 'toggle-all': S.showAll = !S.showAll; render(); break;
    case 'publish': publish(); break;
    case 'discard':
      if (confirm('Throw away your unpublished changes?')) { store.del(LS.draft); load(); }
      break;
    case 'cancel-key': S.askKey = false; render(); break;
    case 'retry-publish': S.askKey = false; publish(); break;
    case 'new-key': S.askKey = true; render(); setTimeout(() => $('#ghToken')?.focus(), 50); break;
    case 'save-key': {
      const token = $('#ghToken').value.trim();
      if (!token) return toast('Paste your GitHub key first.', true);
      const c = { ...ghCfg(), token };
      try { await ghFetchFile(c); }
      catch (err) { return toast(err.status === 401 ? 'That key didn’t work — check you copied all of it.' : `Couldn't connect — ${err.message}`, true); }
      store.set(LS.gh, c); S.askKey = false;
      publish();
      break;
    }
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'newPlayer') el.classList.remove('bad');
  if (S.form && el.dataset.f === 'date') { S.form.date = el.value; saveFormState(); }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'newPlayer') { e.preventDefault(); addNew(); }
  if (e.target.dataset?.pending != null) { e.preventDefault(); addPending(Number(e.target.dataset.pending)); }
  if (e.target.id === 'ghToken') { e.preventDefault(); $('[data-act=save-key]').click(); }
});

$('#shotFile').addEventListener('change', e => { const files = [...e.target.files]; e.target.value = ''; importShots(files); });
document.addEventListener('paste', e => {
  if (!S.form) return;
  const files = [...(e.clipboardData?.files || [])].filter(x => x.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); importShots(files); }
});

load();
