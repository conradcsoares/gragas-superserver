'use strict';
/* Customs League — a minimal Elo ladder for 5v5 League of Legends customs.
 * Players are identified by Riot ID (Name#TAG). Games are entered by hand (Riot's API
 * doesn't expose custom games), stored in data/league.json and published via the GitHub API.
 * Ratings are recomputed from the full game list on every load. */

const START = 1000;
const K = 32;
const REGIONS = ['na', 'euw', 'eune', 'kr', 'br', 'lan', 'las', 'oce', 'tr', 'ru', 'jp', 'me', 'ph', 'sg', 'th', 'tw', 'vn'];
const LS = { gh: 'cl.github', draft: 'cl.draft', form: 'cl.form' };
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
const S = { data: null, base: null, dirty: false, remoteChanged: false, stats: null, form: store.get(LS.form), showSetup: false, showAll: false, busy: false };

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
  const get = id => P[keyOf(id)] || (P[keyOf(id)] = { id, rating: START, wins: 0, losses: 0, last: 0 });
  for (const g of ordered) {
    const blue = g.blue.map(get), red = g.red.map(get);
    const avg = t => t.reduce((a, p) => a + p.rating, 0) / t.length;
    const expBlue = 1 / (1 + Math.pow(10, (avg(red) - avg(blue)) / 400));
    const dBlue = Math.round(K * ((g.winner === 'blue' ? 1 : 0) - expBlue));
    deltas[g.id] = { blue: dBlue, red: -dBlue };
    for (const [team, d, won] of [[blue, dBlue, g.winner === 'blue'], [red, -dBlue, g.winner === 'red']]) {
      for (const p of team) { p.rating += d; p.last = d; won ? p.wins++ : p.losses++; }
    }
  }
  const ladder = Object.values(P).sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.id.localeCompare(b.id));
  return { P, deltas, ordered, ladder };
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
  if (!ghReady(c)) { S.showSetup = true; render(); $('#setup')?.scrollIntoView({ behavior: 'smooth' }); toast('Add a GitHub token in Setup to publish.'); return; }
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
  } catch (e) { toast(`Publish failed — ${e.message}`, true); }
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
function render() {
  const st = S.data.settings;
  $('#leagueName').textContent = st.leagueName;
  document.title = st.leagueName;
  renderBanner();
  $('#view').innerHTML = (S.form ? viewForm() : '') + viewLadder() + viewGames() + (S.showSetup ? viewSetup() : '');
}

function viewLadder() {
  const { ladder } = S.stats, region = S.data.settings.region;
  if (!ladder.length) return `<div class="card empty">No games yet. Hit <b>+ Record game</b> after your first custom.</div>`;
  return `<div class="card"><table class="ladder">
    <thead><tr><th class="rk">#</th><th>Player</th><th class="r">W–L</th><th class="r">Rating</th></tr></thead>
    <tbody>${ladder.map((p, i) => `<tr>
      <td class="rk">${i + 1}</td>
      <td class="pl"><a href="${opgg(p.id, region)}" target="_blank" rel="noopener" title="Open on op.gg">${nameHtml(p.id)}</a></td>
      <td class="r num muted">${p.wins}–${p.losses}</td>
      <td class="r num"><span class="rating">${p.rating}</span><span class="d ${p.last > 0 ? 'pos' : p.last < 0 ? 'neg' : 'dim'}">${signed(p.last)}</span></td>
    </tr>`).join('')}</tbody></table></div>`;
}

function viewGames() {
  const { ordered, deltas, P } = S.stats;
  if (!ordered.length) return '';
  const list = [...ordered].reverse();
  const shown = S.showAll ? list : list.slice(0, 5);
  const names = ids => ids.map(id => esc(P[keyOf(id)].id.split('#')[0])).join(', ');
  return `<div class="card"><h2>Recent games</h2>
    ${shown.map(g => {
      const w = g.winner, l = w === 'blue' ? 'red' : 'blue', d = deltas[g.id][w];
      return `<div class="game"><div class="teams">
          <div class="side"><b class="pos">Won</b> · ${names(g[w])}</div>
          <div class="side muted">Lost · ${names(g[l])}</div>
          <div class="meta">${fmtDate(g.date)} · ${signed(d)} / ${signed(-d)}</div></div>
        <div class="right"><button class="x" data-act="edit" data-id="${esc(g.id)}" title="Edit">Edit</button><button class="x" data-act="delete" data-id="${esc(g.id)}" title="Delete">✕</button></div></div>`;
    }).join('')}
    ${list.length > 5 ? `<div class="row end" style="margin-top:8px"><button class="link" data-act="toggle-all">${S.showAll ? 'Show less' : `Show all ${list.length} games`}</button></div>` : ''}
  </div>`;
}

function emptyForm() { return { id: null, date: today(), winner: '', blue: Array(5).fill(''), red: Array(5).fill('') }; }
function viewForm() {
  const f = S.form;
  const col = side => `<div class="team-col ${side}"><h3>${side === 'blue' ? 'Blue team' : 'Red team'}</h3>
    ${f[side].map((v, i) => `<input data-side="${side}" data-i="${i}" value="${esc(v)}" list="playerList" placeholder="Name#TAG" autocomplete="off" spellcheck="false" aria-label="${side} player ${i + 1}">`).join('')}</div>`;
  return `<div class="card">
    <div class="row" style="justify-content:space-between;margin-bottom:12px"><h2 style="margin:0">${f.id ? 'Edit game' : 'Record a game'}</h2>
      <input type="date" data-f="date" value="${esc(f.date)}" style="width:auto;margin:0"></div>
    <div class="cols">${col('blue')}${col('red')}</div>
    <div class="winner"><button class="btn blue ${f.winner === 'blue' ? 'on' : ''}" data-act="winner" data-side="blue">Blue won</button>
      <button class="btn red ${f.winner === 'red' ? 'on' : ''}" data-act="winner" data-side="red">Red won</button></div>
    <div class="row end"><button class="btn" data-act="cancel">Cancel</button><button class="btn gold" data-act="save">Save game</button></div>
    <p class="hint" style="margin-bottom:0">Type each player's Riot ID, e.g. <code>Faker#KR1</code>. New players join the ladder automatically at 1000.</p>
  </div>`;
}
function saveForm() {
  const f = S.form;
  const blue = [], red = [], bad = [];
  for (const side of ['blue', 'red']) f[side].forEach((v, i) => {
    if (!v.trim()) return;
    const id = parseRiotId(v);
    if (!id) bad.push(`${side}-${i}`);
    else (side === 'blue' ? blue : red).push(S.stats.P[keyOf(id)]?.id || id); // reuse existing casing
  });
  document.querySelectorAll('input[data-side]').forEach(el => el.classList.toggle('bad', bad.includes(`${el.dataset.side}-${el.dataset.i}`)));
  if (bad.length) return toast('Use Riot ID format: Name#TAG', true);
  if (!blue.length || !red.length) return toast('Add players to both teams.', true);
  const keys = [...blue, ...red].map(keyOf);
  if (new Set(keys).size !== keys.length) return toast('Someone is listed twice.', true);
  if (!f.winner) return toast('Pick who won.', true);
  const game = { id: f.id || 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), date: f.date || today(), blue, red, winner: f.winner };
  S.form = null; store.del(LS.form);
  commit(d => {
    const i = d.games.findIndex(g => g.id === game.id);
    if (i >= 0) d.games[i] = game; else d.games.push(game);
  }, f.id ? 'Game updated.' : 'Game saved — hit Publish to share it.');
}

function viewSetup() {
  const c = ghCfg(), st = S.data.settings;
  return `<div class="card" id="setup"><h2>Setup</h2>
    <div class="grid2">
      <div><label>League name</label><input id="sName" value="${esc(st.leagueName)}" maxlength="40"></div>
      <div><label>op.gg region (for player links)</label><select id="sRegion">${REGIONS.map(r => `<option value="${r}" ${st.region === r ? 'selected' : ''}>${r.toUpperCase()}</option>`).join('')}</select></div>
    </div>
    <div class="row end" style="margin:10px 0 18px"><button class="btn sm" data-act="save-settings">Save</button></div>

    <h2><span class="dot ${ghReady(c) ? 'on' : ''}"></span>Publishing</h2>
    <p class="hint" style="margin-top:0">Whoever records games needs a GitHub token (once per device) so the site can save the ladder to the repo. It's stored only in this browser.</p>
    <div class="grid2">
      <div><label>Repo owner</label><input id="ghOwner" value="${esc(c.owner)}" placeholder="github-username" autocomplete="off"></div>
      <div><label>Repo name</label><input id="ghRepo" value="${esc(c.repo)}" placeholder="customs-league" autocomplete="off"></div>
    </div>
    <label>Token</label><input id="ghToken" type="password" value="${esc(c.token)}" placeholder="github_pat_…" autocomplete="off">
    <div class="row end" style="margin-top:4px">${c.token ? '<button class="btn sm" data-act="gh-forget">Forget token</button>' : ''}<button class="btn sm gold" data-act="gh-save">Save &amp; test</button></div>
    <div class="hint"><ol>
      <li>Go to <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener" style="color:var(--gold)">GitHub → new fine-grained token</a>.</li>
      <li>Repository access: <b>Only select repositories</b> → this repo.</li>
      <li>Permissions → <b>Contents: Read and write</b>. Generate and paste it above.</li></ol></div>

    <h2 style="margin-top:18px">Fix a player</h2>
    <p class="hint" style="margin-top:0">Someone changed their Riot ID? Rename them everywhere.</p>
    <div class="grid2"><input id="renFrom" list="playerList" placeholder="Old Name#TAG" autocomplete="off"><input id="renTo" placeholder="New Name#TAG" autocomplete="off"></div>
    <div class="row end"><button class="btn sm" data-act="rename">Rename</button></div>

    <h2 style="margin-top:18px">Backup</h2>
    <div class="row"><button class="btn sm" data-act="export">Export JSON</button><button class="btn sm" data-act="import">Import JSON</button></div>
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
      setTimeout(() => document.querySelector('input[data-side]')?.focus(), 50);
      break;
    case 'cancel': S.form = null; store.del(LS.form); render(); break;
    case 'winner': S.form.winner = a.dataset.side; store.set(LS.form, S.form); render(); break;
    case 'save': saveForm(); break;
    case 'edit': {
      const g = S.data.games.find(x => x.id === id);
      const pad = arr => [...arr, '', '', '', '', ''].slice(0, 5);
      S.form = { id, date: g.date, winner: g.winner, blue: pad(g.blue), red: pad(g.red) };
      render(); window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    }
    case 'delete':
      if (confirm('Delete this game? Ratings will be recalculated.')) commit(d => { d.games = d.games.filter(g => g.id !== id); }, 'Game deleted.');
      break;
    case 'toggle-all': S.showAll = !S.showAll; render(); break;
    case 'toggle-setup':
      S.showSetup = !S.showSetup; render();
      if (S.showSetup) $('#setup').scrollIntoView({ behavior: 'smooth' });
      break;
    case 'publish': publish(); break;
    case 'discard':
      if (confirm('Throw away your unpublished changes?')) { store.del(LS.draft); load(); }
      break;
    case 'save-settings':
      commit(d => { d.settings.leagueName = $('#sName').value.trim() || DEFAULTS.leagueName; d.settings.region = $('#sRegion').value; }, 'Saved.');
      break;
    case 'gh-save': {
      const c = { ...ghCfg(), owner: $('#ghOwner').value.trim(), repo: $('#ghRepo').value.trim(), token: $('#ghToken').value.trim() };
      store.set(LS.gh, c);
      if (!ghReady(c)) { toast('Fill in owner, repo and token.', true); render(); return; }
      toast('Testing…');
      try {
        const r = await ghFetchFile(c);
        if (!S.dirty && r.text) { S.data = normalize(JSON.parse(r.text)); S.base = hash(canon(r.text)); update(); }
        toast(r.text ? 'Connected! You can publish from this device.' : 'Connected — the data file will be created when you publish.');
      } catch (err) { toast(`Couldn't connect — ${err.message}`, true); }
      render();
      break;
    }
    case 'gh-forget': { const c = ghCfg(); c.token = ''; store.set(LS.gh, c); toast('Token removed.'); render(); break; }
    case 'rename': {
      const from = parseRiotId($('#renFrom').value), to = parseRiotId($('#renTo').value);
      if (!from || !to) return toast('Use Name#TAG for both.', true);
      if (!S.stats.P[keyOf(from)]) return toast(`${from} hasn't played yet.`, true);
      if (S.stats.P[keyOf(to)] && keyOf(to) !== keyOf(from) && !confirm(`${to} already exists. Merge ${from} into them?`)) return;
      const swap = arr => arr.map(x => (keyOf(x) === keyOf(from) ? to : x));
      commit(d => { d.games.forEach(g => { g.blue = swap(g.blue); g.red = swap(g.red); }); }, `Renamed to ${to}.`);
      break;
    }
    case 'export': {
      const url = URL.createObjectURL(new Blob([serialize(S.data)], { type: 'application/json' }));
      const link = Object.assign(document.createElement('a'), { href: url, download: `ladder-${today()}.json` });
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      break;
    }
    case 'import': $('#importFile').click(); break;
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (!S.form) return;
  if (el.dataset.side) { S.form[el.dataset.side][Number(el.dataset.i)] = el.value; el.classList.remove('bad'); }
  else if (el.dataset.f === 'date') S.form.date = el.value;
  else return;
  store.set(LS.form, S.form);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset?.side) { e.preventDefault(); saveForm(); }
});
$('#importFile').addEventListener('change', e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  file.text().then(t => {
    const d = normalize(JSON.parse(t));
    if (confirm(`Import ${d.games.length} games? This replaces the ladder on this device (publish afterwards to share).`)) commit(x => { x.settings = d.settings; x.games = d.games; }, 'Imported.');
  }).catch(() => toast('That file isn’t valid ladder JSON.', true));
});

load();
