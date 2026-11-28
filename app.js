'use strict';
/* Gragas Superserver — a minimal Elo ladder for 5v5 League of Legends customs.
 * Players are identified by Riot ID (Name#TAG). Games are entered by hand (Riot's API
 * doesn't expose custom games), stored in data/league.json and published via the GitHub API.
 * Ratings are recomputed from the full game list on every load. */

const LS = { gh: 'cl.github', draft: 'cl.draft', form: 'cl.form2', admin: 'cl.admin', picker: 'cl.picker', me: 'cl.me', mode: 'cl.balMode' };
// Only the owner edits. Visiting the site once with #admin unlocks editing on that device;
// everyone else sees a read-only ladder.
if (location.hash === '#admin') { try { localStorage.setItem(LS.admin, '1'); } catch { /* ignore */ } history.replaceState(null, '', location.pathname + location.search); }

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
const clone = x => JSON.parse(JSON.stringify(x));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
// Personal links: opening …/#me=<code> logs this device in as that player (docs/supabase.md). The code is the only
// secret, so it moves into localStorage and out of the address bar (and the history) straight away.
let ME_FRESH = false; // show the one-time "You're logged in as…" banner
function takeMeHash() {
  const m = location.hash.match(/^#me=([A-Za-z0-9]{16,64})$/);
  if (!m) return false;
  store.set(LS.me, { code: m[1] }); ME_FRESH = true;
  history.replaceState(null, '', location.pathname + location.search);
  return true;
}
takeMeHash();

// Riot IDs: "Game Name#TAG". Case-insensitive identity, original casing for display.
function parseRiotId(s) {
  const m = String(s || '').trim().replace(/\s*#\s*/, '#').match(/^([^#]{1,16})#([^#\s]{2,5})$/);
  return m ? `${m[1].trim()}#${m[2]}` : null;
}
const opgg = (id, region) => {
  const [name, tag] = id.split('#');
  return `https://op.gg/lol/summoners/${region}/${encodeURIComponent(name)}-${encodeURIComponent(tag)}`;
};

// ---------- state ----------
const S = { showLinks: false, importing: null, data: null, base: null, baseData: null, loadedAt: 0, dirty: false, remoteChanged: false, stats: null, form: (f => (f && Array.isArray(f.results) ? f : null))(store.get(LS.form)), askKey: false, showAll: false, busy: false, page: null,
  // me: who this device is logged in as ({ code, player, admin }; player is unknown until whoami answers).
  me: (m => (m && m.code ? m : null))(store.get(LS.me)), meMenu: false,
  // Team balancing: 'adjusted' (ladder rating nudged by Solo/Duo rank) or 'normal' (ladder rating only).
  mode: store.get(LS.mode) === 'normal' ? 'normal' : 'adjusted',
  roleRows: [], roles: {}, roleDraft: null, meLinks: null, showMeLinks: false, linkShown: null };
store.del(LS.picker); // the old separate Balance screen's saved state


const resolveId = id => resolveWith(S.stats?.links || {}, id);

// ---------- GitHub sync ----------
function ghDefaults() {
  const h = location.hostname; let owner = 'conradcsoares', repo = 'gragas-superserver'; // fallback when not on github.io
  if (h.endsWith('.github.io')) {
    owner = h.split('.')[0];
    const seg = location.pathname.split('/').filter(Boolean)[0];
    repo = seg && !seg.includes('.') ? seg : `${owner}.github.io`;
  }
  return { owner, repo, branch: 'main', path: 'data/league.json', token: '' };
}
// Repo comes from the site's own address; only the key is saved on the device (so a repo rename can't break publishing).
const ghCfg = () => ({ ...ghDefaults(), token: (store.get(LS.gh) || {}).token || '' });
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
    // Never upload a stale copy: fetch the live ladder and re-apply only this device's edits on top.
    // If someone publishes in the split second between our read and write, GitHub refuses (409) and we redo it.
    let merged = false, text;
    for (let attempt = 0; ; attempt++) {
      const remote = await ghFetchFile(c);
      if (remote.text && hash(canon(remote.text)) !== S.base) { rebase(JSON.parse(remote.text)); merged = true; }
      text = serialize(S.data);
      try {
        await ghRequest('PUT', c, { message: `Update ladder (${S.data.games.length} games)`, content: b64enc(text), branch: c.branch, ...(remote.sha ? { sha: remote.sha } : {}) });
        break;
      } catch (e) { if ((e.status === 409 || e.status === 422) && attempt < 2) continue; throw e; }
    }
    S.base = hash(canon(text)); S.baseData = normalize(JSON.parse(text)); S.dirty = false; S.remoteChanged = false; store.del(LS.draft);
    ringDoorbell();
    const when = doorbell ? 'Everyone sees it now.' : 'Everyone sees it within about a minute.';
    toast(merged ? `Published, merged with newer changes from someone else. ${when}` : `Published! ${when}`);
  } catch (e) {
    if (e.status === 401) { store.set(LS.gh, { token: '' }); S.askKey = true; toast('Your GitHub key expired or was revoked — paste a new one.', true); }
    else if (e.status === 403 || e.status === 404) { S.askKey = 'perm'; window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else toast(`Publish failed — ${e.message}`, true);
  }
  finally { S.busy = false; render(); }
}

// ---------- load / save ----------
// The live ladder straight from the repo through GitHub's API, so a publish shows up as soon as it's committed
// (GitHub Pages takes about a minute to rebuild). Without a key GitHub allows 60 of these an hour per network,
// so it's only used on page load and when there's reason to think the ladder changed — never on a timer.
// Returns the file's text, or null if it doesn't exist.
async function fetchLive() {
  const c = ghCfg();
  if (ghReady(c)) return (await ghFetchFile(c)).text;
  const path = c.path.split('/').map(encodeURIComponent).join('/');
  const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path}?ref=${encodeURIComponent(c.branch)}`,
    { cache: 'no-cache', headers: { Accept: 'application/vnd.github.raw+json' } });
  if (r.status === 404) return null;
  if (!r.ok) { const e = new Error(`GitHub said ${r.status}`); e.status = r.status; throw e; }
  return r.text();
}
// prefetched: text already fetched by the live check (skips fetching again).
async function load(prefetched) {
  let text = prefetched ?? null, err = null;
  if (prefetched === undefined) {
    try { text = await fetchLive(); } catch (e) { err = e; }
    if (text == null) {
      // GitHub's API unreachable or rate-limited: fall back to the copy GitHub Pages serves.
      try {
        const r = await fetch(`data/league.json?t=${Date.now()}`, { cache: 'no-store' });
        if (r.ok) { text = await r.text(); if (!ghReady()) err = null; } else if (r.status !== 404) err = err || new Error(`HTTP ${r.status}`);
      } catch (e) { err = err || e; }
    }
  }
  let remote = {};
  if (text) { try { remote = JSON.parse(text); } catch { err = new Error('data/league.json is not valid JSON'); } }
  if (err && text == null && S.data) { toast(`Couldn't refresh the ladder (${err.message}).`, true); return; } // keep what's on screen
  S.base = text ? hash(canon(text)) : null;
  S.baseData = normalize(clone(remote)); // separate copy: edits to S.data must never touch it
  S.remoteChanged = false;
  S.loadedAt = Date.now();
  const draft = store.get(LS.draft);
  S.data = normalize(remote); S.dirty = false;
  if (draft && draft.data) {
    if (draft.base === S.base) { S.data = normalize(draft.data); S.dirty = true; }
    else if (draft.baseData) {
      // The live ladder moved on since these edits were made: keep the live games, re-apply only the edits.
      S.data = applyEdits(S.baseData, normalize(draft.baseData), normalize(draft.data));
      S.dirty = serialize(S.data) !== serialize(S.baseData);
      if (S.dirty) { saveDraft(); toast('Loaded the latest ladder. Your unpublished changes are still here.'); }
      else store.del(LS.draft);
    } else {
      // Saved by an older version of the site (a full copy with no record of what was edited): too risky to publish.
      store.del(LS.draft);
      toast('Loaded the latest ladder. Old unpublished changes on this device were out of date and were dropped.', true);
    }
  }
  if (err) toast(`Couldn't load the ladder (${err.message}).`, true);
  update();
}

// Three-way merge: start from `live`, then apply what changed between `base` (what this device started
// from) and `mine` (this device's version): added, edited and deleted games, alt links and nicknames.
function applyEdits(live, base, mine) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const mergeList = (L, B, M, key) => {
    const out = new Map(L.map(x => [key(x), x]));
    const Bm = new Map(B.map(x => [key(x), x])), Mm = new Map(M.map(x => [key(x), x]));
    for (const [k, x] of Mm) if (!Bm.has(k) || !same(Bm.get(k), x)) out.set(k, x); // added or edited here
    for (const k of Bm.keys()) if (!Mm.has(k)) out.delete(k);                      // deleted here
    return [...out.values()];
  };
  return normalize(clone({
    settings: same(base.settings, mine.settings) ? live.settings : mine.settings,
    games: mergeList(live.games, base.games, mine.games, g => g.id),
    links: mergeList(live.links, base.links, mine.links, l => keyOf(l.alt)),
    nicks: mergeList(live.nicks, base.nicks, mine.nicks, n => keyOf(n.id)),
  }));
}
function rebase(remoteJson) {
  const live = normalize(clone(remoteJson));
  S.data = applyEdits(live, S.baseData || live, S.data);
  S.baseData = live; S.base = hash(canon(JSON.stringify(remoteJson)));
}
const saveDraft = () => store.set(LS.draft, { data: S.data, base: S.base, baseData: S.baseData });
function update() {
  S.stats = compute(S.data);
  S.blend = blendRatings(S.stats, S.ranks); // ladder ratings blended with Solo/Duo ranks, for team balancing only
  // Role preferences by player key. Stored under the account the link belongs to; alts share their main's.
  S.roles = {};
  for (const r of S.roleRows) S.roles[keyOf(resolveId(r.player))] = r.roles;
  const crown = S.data.settings.crownImg || null;
  if (crown !== S.crownShown && crown !== S.crownTried) {
    S.crownTried = crown;
    if (!crown) { CROWN_IMG = null; S.crownShown = null; }
    else {
      // A live update can name a picture GitHub Pages hasn't deployed yet (about a minute), so retry for a while.
      const tryLoad = (left, fresh) => loadCrownImg(crown, fresh).then(ok => {
        if (S.crownTried !== crown) return; // a different picture was set meanwhile
        if (ok) { S.crownShown = crown; render(); } else if (left > 0) setTimeout(() => tryLoad(left - 1, true), 20000);
      });
      tryLoad(6);
    }
  }
  $('#playerList').innerHTML = [...S.stats.ladder.map(p => p.id), ...S.data.links.map(l => l.alt)].map(id => `<option value="${esc(id)}">`).join('');
  render();
}
function commit(fn, msg) {
  fn(S.data);
  S.dirty = true;
  saveDraft();
  update();
  if (msg) toast(msg);
}

// ---------- render ----------
let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, err ? 5000 : 2600);
}
// Everywhere a player is named: full Riot ID, then their real name in parentheses if one is set,
// e.g. "ArsDerps#NA1 (Arjun)". Alt accounts show as their main.
const who = id => S.stats.P[keyOf(resolveId(id))] || { id };
function fullName(id) { const p = who(id); return p.nick ? `${p.id} (${p.nick})` : p.id; }
function nameHtml(id) {
  const [n, t] = id.split('#');
  return `${esc(n)}<span class="tag">#${esc(t)}</span>`;
}
function fullNameHtml(id) { const p = who(id); return nameHtml(p.id) + (p.nick ? ` <span class="nick">(${esc(p.nick)})</span>` : ''); }
function renderBanner() {
  const b = $('#banner');
  if (!S.dirty) { b.innerHTML = ''; return; }
  b.innerHTML = `<div class="wrap"><span class="msg">${S.remoteChanged
    ? '<b>Heads up:</b> the live ladder changed since you started editing here. Publishing will overwrite it.'
    : '<b>Not published yet.</b> Only you can see these changes.'}</span>
    <button class="btn sm" data-act="discard">Discard</button>
    <button class="btn sm gold" data-act="publish" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Publishing…' : 'Publish'}</button></div>`;
}
const canEdit = () => store.get(LS.admin) === 1 || !!ghCfg().token || !!(S.me && S.me.admin);
// Player pages live at #p/<Riot ID>, so they can be linked and the back button works.
// Tabs live at #rankings (default), #history and #games, so each can be linked and the back button works.
const TABS = [['rankings', 'Rankings'], ['history', 'Rating history'], ['games', 'Games']];
function route() {
  const m = location.hash.match(/^#p\/(.+)$/);
  let id = null; if (m) { try { id = decodeURIComponent(m[1]); } catch { id = m[1]; } }
  S.page = id; // resolved to a player (alts → main) at render time, once the data has loaded
  const t = location.hash.slice(1);
  if (!id) S.tab = TABS.some(([k]) => k === t) ? t : 'rankings';
}
route();
window.addEventListener('hashchange', () => {
  if (takeMeHash()) { S.me = store.get(LS.me); checkMe(); return; }
  route(); if (S.data) { render(); window.scrollTo(0, 0); }
});
function render() {
  const st = S.data.settings;
  $('#recordBtn').hidden = !canEdit();
  $('#balanceBtn').hidden = canEdit(); // admins balance inside the record screen
  $('#leagueName').textContent = LEAGUE_NAME;
  document.title = LEAGUE_NAME;
  renderBanner();
  renderMe();
  const tab = { rankings: () => viewLadder() + (S.showMeLinks && S.me?.admin ? viewMeLinks() : '') + (S.showLinks && canEdit() ? viewLinks() : ''), history: viewHistory, games: viewGames }[S.tab] || viewLadder;
  $('#view').innerHTML = (S.askKey ? viewKeyBox() : '') + viewMeFresh() + (S.page ? viewPlayer(keyOf(resolveId(S.page)))
    : (S.form ? viewForm() : '') + viewTabs() + tab());
  drawCharts();
}

function viewTabs() {
  return `<nav class="tabs" aria-label="Sections">${TABS.map(([k, label]) =>
    `<a class="tab ${S.tab === k ? 'on' : ''}" href="#${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
}

function viewLadder() {
  const { ladder } = S.stats, region = S.data.settings.region;
  if (!ladder.length) return `<div class="card empty">No games yet.</div>`;
  const rest = ladder.slice(3);
  return `<div class="card">${viewPodium(ladder, region)}${rest.length ? `<table class="ladder">
    <thead><tr><th class="rk">#</th><th class="em"></th><th>Player</th><th class="r">W–L</th><th class="r">Rating</th></tr></thead>
    <tbody>${rest.map((p, j) => { const i = j + 3; return `<tr>
      <td class="rk">${i + 1}</td>
      <td class="em">${emblemSvg(rankOf(p.rating, i))}</td>
      <td class="pl"><a href="${playerHref(p.id)}" title="${esc(p.id)}: stats and rating history">${fullNameHtml(p.id)}</a>
        <span class="rank" style="--c:${RANKS[rankOf(p.rating, i)].color}">${RANKS[rankOf(p.rating, i)].name}</span>${soloBadge(p)}
        ${p.alts.length ? `<div class="alts">alt: ${p.alts.map(a => esc(a)).join(', ')}</div>` : ''}</td>
      <td class="r num muted">${p.wins}–${p.losses}</td>
      <td class="r num"><span class="rating">${p.rating}</span>${lastHtml(p)}</td>
    </tr>`; }).join('')}</tbody></table>` : ''}
    <div class="legend">${RANKS.map((r, i) => `<span class="lg" style="color:${r.color}">${emblemSvg(i)}<span>${r.name}<small>${rankRange(i)}</small></span></span>`).reverse().join('')}</div>
    ${(canEdit() && !S.showLinks) || (S.me?.admin && !S.showMeLinks) ? `<div class="row end" style="margin-top:10px;gap:16px">
      ${S.me?.admin && !S.showMeLinks ? '<button class="link" data-act="show-me-links">Player links</button>' : ''}
      ${canEdit() && !S.showLinks ? '<button class="link" data-act="show-links">Nicknames &amp; alt accounts</button>' : ''}</div>` : ''}</div>`;
}

// Solo/Duo rank badge: short (G1, P3, E4, D1, M 20) or long (Gold I · 95 LP). p: a player ({ id, alts }).
const SOLO_SHORT = { IRON: 'I', BRONZE: 'B', SILVER: 'S', GOLD: 'G', PLATINUM: 'P', EMERALD: 'E', DIAMOND: 'D', MASTER: 'M', GRANDMASTER: 'GM', CHALLENGER: 'C' };
const tierName = t => t.charAt(0) + t.slice(1).toLowerCase();
const soloText = r => `${tierName(r.tier)}${SOLO_TIERS.includes(r.tier) ? ` ${r.division}` : ''} · ${r.lp} LP`;
function soloBadge(p, long = false) {
  const r = S.ranks && soloFor(p, S.ranks);
  if (!r) return long && S.ranks ? '<span class="solo none">Unranked</span>' : '';
  const short = SOLO_SHORT[r.tier] + (SOLO_TIERS.includes(r.tier) ? { IV: 4, III: 3, II: 2, I: 1 }[r.division] : ` ${r.lp}`);
  return `<span class="solo t-${r.tier.toLowerCase()}" title="Solo/Duo: ${esc(soloText(r))}${r.wins != null ? ` (${r.wins}–${r.losses})` : ''}">${long ? esc(soloText(r)) : short}</span>`;
}
const lastHtml = p => (p.last ? `<span class="d ${p.last > 0 ? 'pos' : 'neg'}" title="Rating change from their last game">${signed(p.last)}</span>` : '');
// Top 3 on steps: 2nd on the left, 1st in the middle (tallest), 3rd on the right.
function viewPodium(ladder, region) {
  const order = [1, 0, 2].filter(i => ladder[i]);
  return `<div class="podium">${order.map(i => {
    const p = ladder[i], ri = rankOf(p.rating, i), r = RANKS[ri];
    return `<a class="pod p${i + 1}" href="${playerHref(p.id)}" title="${esc(p.id)}: stats and rating history">
      <div class="pod-emb">${emblemSvg(ri)}</div>
      <div class="pod-name">${esc(displayName(p))}</div>
      ${p.nick ? `<div class="pod-id">${esc(p.id)}</div>` : `<div class="pod-id">#${esc(p.id.split('#')[1])}</div>`}
      <div class="pod-rank" style="color:${r.color}">${r.name}</div>
      <div class="pod-step"><div class="pod-place">${i + 1}</div><div class="pod-rating num">${p.rating}${lastHtml(p)}</div><div class="pod-wl num">${p.wins}–${p.losses}</div></div>
    </a>`;
  }).join('')}</div>`;
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

// One match card: details on the left; each team a tight column of five rows, tinted by result.
function matchCard(gr, me = null) {
  const { P, ordered } = S.stats, num = g => ordered.indexOf(g) + 1;
  const gs = gr.games, g0 = gs[0], n = gs.length, ids = new Set(gs.map(g => g.id));
  const wins = { blue: gs.filter(g => g.winner === 'blue').length }; wins.red = n - wins.blue;
  // One row: rank emblem (as of after this match), name, MVP/ACE, rating after, change over the match.
  const row = id => {
    const p = P[keyOf(resolveId(id))], es = p ? p.hist.filter(e => ids.has(e.game)) : [];
    const d = es.reduce((a, e) => a + e.delta, 0), after = es.length ? es[es.length - 1].rating : START;
    const mvp = es.filter(e => e.award === 'mvp').length, ace = es.filter(e => e.award === 'ace').length;
    const w = who(id);
    return { after, html: `<a class="pr ${me && keyOf(resolveId(id)) === me ? 'me' : ''}" href="${playerHref(id)}" title="${esc(fullName(id))}: ${signed(d)} → ${after}">
      <span class="pr-emb">${emblemSvg(rankIdx(after))}</span>
      <span class="pr-nm">${esc(w.id.split('#')[0])}</span>
      <span class="pr-aw">${mvp ? `<span class="mvp">★${mvp > 1 ? mvp : ''}</span>` : ''}${ace ? `<span class="ace">◆${ace > 1 ? ace : ''}</span>` : ''}</span>
      <span class="pr-rt num">${after}</span><b class="pr-d num ${d > 0 ? 'pos' : d < 0 ? 'neg' : 'muted'}">${signed(d)}</b></a>` };
  };
  const team = side => {
    const res = wins[side] > wins[other(side)] ? 'win' : wins[side] < wins[other(side)] ? 'loss' : 'tie';
    const rows = g0[side].map(row).sort((a, b) => b.after - a.after);
    return `<div class="mt ${res}"><div class="mt-h"><span>${TEAM[side]}</span><b>${res === 'win' ? 'Win' : res === 'loss' ? 'Loss' : 'Tie'}${n > 1 ? ` ${wins[side]}–${wins[other(side)]}` : ''}</b></div>${rows.map(r => r.html).join('')}</div>`;
  };
  const nums = gs.map(num), idList = gs.map(g => g.id).join(',');
  // On a player's page (me = their key), the card shows the match from their side: Win/Loss and a colored edge.
  const mySide = me && ['blue', 'red'].find(sd => g0[sd].some(id => keyOf(resolveId(id)) === me));
  const myRes = mySide && (wins[mySide] > wins[other(mySide)] ? 'win' : wins[mySide] < wins[other(mySide)] ? 'loss' : 'tie');
  return `<div class="mc ${myRes ? `mine ${myRes}` : ''}">
    <div class="mc-meta">
      ${myRes ? `<span class="mc-res">${myRes === 'win' ? 'Win' : myRes === 'loss' ? 'Loss' : 'Tie'}${n > 1 ? ` ${wins[mySide]}–${wins[other(mySide)]}` : ''}</span>` : ''}
      <b>${n > 1 ? `Games ${nums[0]}–${nums[n - 1]}` : `Game ${nums[0]}`}</b>
      <span>${esc(fmtDate(g0.date))}</span>
      ${n > 1 ? `<span class="mc-series">${gs.map((g, i) => `<i class="${g.winner === 'blue' ? 'b' : 'r'}" title="Game ${i + 1}: ${TEAM[g.winner]} won">${g.winner === 'blue' ? 1 : 2}</i>`).join('')}</span>` : ''}
      ${canEdit() ? `<span class="mc-act"><button class="x" data-act="rematch" data-ids="${esc(idList)}" title="Record more games with these teams">↺</button><button class="x" data-act="edit" data-ids="${esc(idList)}" title="Edit">✎</button><button class="x" data-act="delete" data-ids="${esc(idList)}" title="Delete">✕</button></span>` : ''}
    </div>
    ${team('blue')}${team('red')}
  </div>`;
}

// Match history in the style of op.gg / u.gg: one compact card per match (a game, or a series recorded together),
// newest first. Details on the left; each team is a tight column of five rows, tinted by result.
function viewGames() {
  const groups = groupGames();
  if (!groups.length) return '<div class="card empty">No games yet.</div>';
  const shown = S.showAll ? groups : groups.slice(0, 20);
  return `<div class="mlist">${shown.map(gr => matchCard(gr)).join('')}</div>
    ${groups.length > 20 ? `<div class="row end" style="margin:4px 0 16px"><button class="link" data-act="toggle-all">${S.showAll ? 'Show fewer' : `Show all ${groups.length}`}</button></div>` : ''}`;
}

// ----- record form: tap players into teams, tap the winner once per game -----
const TEAM = { blue: 'Team 1', red: 'Team 2' };
const other = s => (s === 'blue' ? 'red' : 'blue');
function emptyForm(teams) {
  return { editIds: [], date: today(), blue: teams ? [...teams.blue] : [], red: teams ? [...teams.red] : [], results: [], active: 'blue' };
}
function saveFormState() {
  const f = S.form;
  const inTeams = k => [...f.blue, ...f.red].some(x => keyOf(resolveId(x)) === k);
  if (f && f.locks) for (const k of Object.keys(f.locks)) if (!inTeams(k)) delete f.locks[k];
  if (f && f.roles) for (const k of Object.keys(f.roles)) if (!inTeams(k)) delete f.roles[k];
  store.set(LS.form, f);
}
const awardOf = (f, i) => ((f.awards || (f.awards = []))[i] || (f.awards[i] = { mvp: '', ace: '' }));
function fixActive(f) { if (f[f.active].length >= 5 && f[other(f.active)].length < 5) f.active = other(f.active); }
function pick(id) {
  const f = S.form;
  if ([...f.blue, ...f.red].some(x => keyOf(resolveId(x)) === keyOf(resolveId(id)))) return toast('Already on a team (same player or their alt).', true);
  fixActive(f);
  if (f[f.active].length >= 5) return toast('Both teams are full.', true);
  f[f.active].push(id);
  if (!S.stats.P[keyOf(resolveId(id))] && !(f.extra || (f.extra = [])).some(x => sameP(x, id))) f.extra.push(id);
  fixActive(f); saveFormState(); render();
}
// The player list works like Balance teams: everyone stays in place, tapping toggles them on/off a team.
function formToggle(id) {
  const f = S.form, side = ['blue', 'red'].find(sd => f[sd].some(x => sameP(x, id)));
  if (!side) return pick(id);
  f[side] = f[side].filter(x => !sameP(x, id)); f.active = side; saveFormState(); render();
}
function addNew() {
  const el = $('#newPlayer'), id = parseRiotId(el.value);
  if (!id) { el.classList.add('bad'); return toast('Use Riot ID format: Name#TAG', true); }
  pick(S.stats.P[keyOf(id)]?.id || id);
  setTimeout(() => $('#newPlayer')?.focus(), 0);
}
function gamesByIds(ids) { return S.stats.ordered.filter(g => ids.includes(g.id)); }

// ----- autobalance: part of the same team screen. Anyone can use it (visitors get the screen without the
// recording parts); nothing is saved to the ladder until an admin records a game. Algorithm in core.js.
const ratingOf = id => S.stats.P[keyOf(resolveId(id))]?.rating ?? START;
// What the team balancer uses. Normal: the ladder rating. Adjusted: the blended rating (see blendRatings in core.js);
// someone not on the ladder yet counts as what their Solo/Duo rank predicts, or 1000 if unranked.
function balRatingOf(id, mode = S.mode) {
  if (mode === 'normal') return ratingOf(id);
  const k = keyOf(resolveId(id)), b = S.blend?.players[k];
  if (b) return b.balance;
  const sc = soloScore(S.ranks?.[k]);
  return sc == null || !S.blend ? START : Math.round(S.blend.a + S.blend.b * sc);
}
const sameP = (a, b) => keyOf(resolveId(a)) === keyOf(resolveId(b));
const avgRating = ids => ids.reduce((s, id) => s + ratingOf(id), 0) / ids.length;
const byName = (a, b) => fullName(a).localeCompare(fullName(b), undefined, { sensitivity: 'base' });
// Team 1's win chance and each team's rating change, same formula as compute(): Team 1 moves by
// round(K × (result − p)), Team 2 the opposite. (The MVP gains ×1.5 and the ACE loses ÷1.5 on top.)
const winChance = (blue, red) => 1 / (1 + Math.pow(10, (avgRating(red) - avgRating(blue)) / 400));
function swingFor(p) {
  const blue = { win: Math.round(K * (1 - p)), lose: Math.round(K * (0 - p)) };
  return { blue, red: { win: -blue.lose, lose: -blue.win } };
}
const swingHtml = (sw, side) => `<div class="swing small num" title="Rating change for each player on ${TEAM[side]} if they win / lose (the MVP gains ×${AWARD}, the ACE loses ÷${AWARD})"><b class="pos">${signed(sw[side].win)}</b> / <b class="neg">${signed(sw[side].lose)}</b></div>`;

const groupKey = f => [...f.blue, ...f.red].map(x => keyOf(resolveId(x))).sort().join('|');
const teamKey = ids => ids.map(x => keyOf(resolveId(x))).sort().join('|');
const canBalance = f => !f.editIds.length && !f.results.length && f.blue.length + f.red.length === 10;
// The options stay up only while the same 10 players are picked.
const balOn = f => !!(f.bal && f.bal.key === groupKey(f) && canBalance(f));
const lockOf = (f, id) => (f.locks || {})[keyOf(resolveId(id))] || null;
// Without locks the algorithm always lists the same player first, so each option gets a random side flip,
// rolled when Balance is tapped. With locks, the locks decide which team is which.
function balOptions(f) {
  const ids = [...f.blue, ...f.red].sort(byName);
  const players = ids.map(id => ({ id, rating: balRatingOf(id), side: lockOf(f, id), prefs: prefsOf(id) }));
  const flip = !players.some(p => p.side);
  return balanceTeams(players).map((o, i) => (flip && f.bal.flips[i] ? { ...o, blue: o.red, red: o.blue, p: 1 - o.p, cost: o.cost && { blue: o.cost.red, red: o.cost.blue } } : o));
}
// Keep the teams on screen if they're still one of the options (after a lock or mode change), else take option 1.
function refreshBal() {
  const f = S.form;
  if (!balOn(f)) return false;
  const cur = balOptions(f).findIndex(o => teamKey(o.blue) === teamKey(f.blue));
  if (cur < 0) { useOption(0); return true; }
  f.bal.opt = cur;
  return false;
}
function setMode(mode) {
  S.mode = mode === 'normal' ? 'normal' : 'adjusted'; store.set(LS.mode, S.mode);
  if (S.form && refreshBal()) return;
  if (S.form) saveFormState();
  render();
}
function useOption(i) {
  const f = S.form, o = balOptions(f)[i];
  if (!o) return;
  Object.assign(f, { blue: [...o.blue], red: [...o.red], active: 'blue' });
  if (o.roles) f.roles = Object.fromEntries(Object.entries(o.roles).map(([id, r]) => [keyOf(resolveId(id)), r]));
  f.bal.opt = i; f.bal.key = groupKey(f);
  saveFormState(); render();
}
function balance() {
  const f = S.form;
  if (!canBalance(f)) return toast('Pick all 10 players first.', true);
  f.bal = { key: groupKey(f), opt: 0, flips: Array.from({ length: 5 }, () => Math.random() < 0.5) };
  useOption(0);
}
// Lock a player to a team, move a locked player across (side = the other team), or unlock (side = null).
// While options are showing they're recalculated; the teams on screen stay put if they still fit.
function setLock(id, side) {
  const f = S.form, locks = f.locks || (f.locks = {}), k = keyOf(resolveId(id));
  if (side && [...f.blue, ...f.red].filter(x => !sameP(x, id) && lockOf(f, x) === side).length >= 5) return toast(`${TEAM[side]} already has 5 locked players.`, true);
  if (side) locks[k] = side; else delete locks[k];
  if (refreshBal()) return;
  saveFormState(); render();
}

// ----- roles on the team screen: like a League lobby, everyone has a position, and people can switch them around.
// Two players on the same role or a role nobody plays is allowed (it's flagged, not blocked).
const prefsOf = id => S.roles[keyOf(resolveId(id))] || null;
const roleOf = (f, id) => (f.roles || {})[keyOf(resolveId(id))] || '';
const ROLE_SHORT = { TOP: 'Top', JUNGLE: 'Jg', MID: 'Mid', ADC: 'ADC', SUPPORT: 'Sup' };
const ordinal = i => ['1st', '2nd', '3rd', '4th', '5th'][i];
function setRole(id, role) {
  const f = S.form, r = f.roles || (f.roles = {});
  if (ROLES.includes(role)) r[keyOf(resolveId(id))] = role; else delete r[keyOf(resolveId(id))];
  saveFormState(); render();
}
// Fill both teams' roles from preferences (the cheapest assignment, as the balancer does).
function autoRoles() {
  const f = S.form, r = f.roles || (f.roles = {});
  for (const side of ['blue', 'red']) {
    if (f[side].length !== 5) continue;
    bestRoles(f[side].map(prefsOf)).roles.forEach((role, i) => { r[keyOf(resolveId(f[side][i]))] = role; });
  }
  saveFormState(); render();
}
// How happy a team is with its roles: how many play a top-2 pick, among those with preferences.
function roleSummary(ids, roles) {
  const withPrefs = ids.filter(id => prefsOf(id));
  const top2 = withPrefs.filter(id => { const i = prefsOf(id).indexOf(roles(id)); return i >= 0 && i < 2; }).length;
  return { n: withPrefs.length, top2 };
}

function viewForm() {
  const f = S.form, P = S.stats.P, admin = canEdit();
  const sideOf = id => ['blue', 'red'].find(sd => f[sd].some(x => sameP(x, id)));
  // Ladder players plus anyone typed in that isn't on the ladder yet, alphabetical and never moving.
  const all = [...Object.values(P).map(p => p.id)];
  for (const id of [...(f.extra || []), ...f.blue, ...f.red]) if (!all.some(x => sameP(x, id))) all.push(id);
  all.sort(byName);
  const full = f.blue.length + f.red.length >= 10;
  const sw = f.blue.length && f.red.length ? swingFor(winChance(f.blue, f.red)) : null;
  const last = S.stats.ordered[S.stats.ordered.length - 1];
  const showLocks = canBalance(f), bal = balOn(f), opts = bal ? balOptions(f) : [];
  const pct = x => Math.round(x * 100);
  const nLocked = [...f.blue, ...f.red].filter(x => lockOf(f, x)).length;
  const member = (side, id) => {
    const lk = showLocks && lockOf(f, id);
    const role = roleOf(f, id), prefs = prefsOf(id), pi = prefs && role ? prefs.indexOf(role) : -1;
    const dup = role && f[side].filter(x => roleOf(f, x) === role).length > 1;
    const roleTip = role ? `${ROLE_NAME[role]}${prefs ? (pi >= 0 ? ` · ${ordinal(pi)} choice` : ' · not one of their picks') : ''}${dup ? ' · two players on this role' : ''}` : 'No role yet';
    const adj = balRatingOf(id, 'adjusted'), lad = ratingOf(id);
    return `<div class="mem ${lk ? 'locked' : ''}" role="button" tabindex="0" data-act="unpick" data-side="${side}" data-id="${esc(id)}" title="Remove">
        <label class="role ${role ? '' : 'none'} ${dup ? 'dup' : ''} ${pi === 0 ? 'p1' : pi === 1 ? 'p2' : pi > 1 ? 'pn' : prefs && role ? 'off' : ''}" data-act="noop" title="${esc(roleTip)}">
          <select data-role="${esc(id)}" aria-label="${esc(fullName(id))}'s role">${['', ...ROLES].map(r => `<option value="${r}" ${r === role ? 'selected' : ''}>${r ? ROLE_SHORT[r] : '—'}</option>`).join('')}</select></label>
        <span class="nm">${esc(fullName(id))}</span>${pi >= 0 ? `<span class="pref" title="${esc(roleTip)}">${ordinal(pi)}</span>` : ''}${soloBadge(who(id))}<span class="rt num" title="Ladder ${Math.round(lad)} · Adjusted ${adj}${S.mode === 'adjusted' ? ' (blends in Solo/Duo rank; used for ⚖ Balance)' : ' · Normal mode balances on the ladder rating'}">${Math.round(balRatingOf(id))}</span>
        ${lk && bal ? `<button class="lk" data-act="lock" data-id="${esc(id)}" data-side="${other(side)}" title="Move to ${TEAM[other(side)]} (stays locked)" aria-label="Move to ${TEAM[other(side)]}">⇄</button>` : ''}
        ${showLocks ? `<button class="lk ${lk ? 'on' : ''}" data-act="lock" data-id="${esc(id)}" data-side="${lk ? '' : side}" title="${lk ? 'Unlock' : `Lock to ${TEAM[side]} for ⚖ Balance`}" aria-label="${lk ? 'Unlock' : `Lock to ${TEAM[side]}`}">${lk ? '🔒' : '🔓'}</button>` : ''}
        <span class="rm">✕</span></div>`;
  };
  // Rows read Top → Support like a lobby; players without a role go last. (Display order only.)
  const roleRank = id => { const r = roleOf(f, id); return r ? ROLES.indexOf(r) : ROLES.length; };
  const avgUse = ids => ids.reduce((t, id) => t + balRatingOf(id), 0) / ids.length;
  const team = side => {
    const ids = [...f[side]].sort((a, b) => roleRank(a) - roleRank(b));
    const anyRole = ids.some(id => roleOf(f, id));
    const missing = anyRole && ids.length === 5 ? ROLES.filter(r => !ids.some(id => roleOf(f, id) === r)) : [];
    return `<div class="tbox ${side} ${f.active === side ? 'active' : ''}" data-act="set-active" data-side="${side}">
      <div class="tbox-head"><h3>${TEAM[side]}</h3><span class="small muted num" ${f[side].length ? `title="Average ${S.mode === 'adjusted' ? 'adjusted' : 'ladder'} rating (ladder: ${Math.round(avgRating(f[side]))})"` : ''}>${f[side].length ? `avg ${Math.round(avgUse(f[side]))} · ` : ''}${f[side].length}/5</span></div>
      ${sw ? swingHtml(sw, side) : ''}
      ${missing.length ? `<div class="small role-warn">No ${missing.map(r => ROLE_NAME[r]).join(', ')}</div>` : ''}
      ${ids.map(id => member(side, id)).join('')}
      ${Array(Math.max(0, 5 - f[side].length)).fill('<div class="mem empty"></div>').join('')}</div>`;
  };
  const bw = f.results.filter(r => r === 'blue').length, rw = f.results.length - bw;
  const n = f.results.length;
  const hint = S.importing ? `⏳ ${S.importing}`
    : (admin ? 'Pick the post-game Scoreboard screenshots (a whole Bo3 at once works), or paste one with Ctrl/⌘+V. ' : '')
      + (canBalance(f) ? 'Tap ⚖ Balance for fair teams. 🔓 locks a player to their team first.' : 'Pick all 10 players to balance the teams.')
      + ' Roles can be changed on each player; doubles and gaps are fine.';
  return `<div class="card form" id="teamForm">
    <div class="row" style="justify-content:space-between;margin-bottom:12px"><h2 style="margin:0">${!admin ? 'Balance teams' : f.editIds.length ? 'Edit' : 'Record games'}</h2>
      ${admin ? `<input type="date" data-f="date" value="${esc(f.date)}" style="width:auto;margin:0">` : ''}</div>
    ${!f.editIds.length ? `<div class="row" style="margin-bottom:6px">
      ${admin ? `<button class="btn sm" data-act="shots" ${S.importing ? 'disabled' : ''}>📷 From screenshots</button>` : ''}
      ${last ? '<button class="btn sm" data-act="last-teams">↺ Same teams as last game</button>' : ''}
      ${f.blue.length || f.red.length ? '<button class="btn sm" data-act="swap">⇄ Swap</button><button class="btn sm" data-act="clear-teams">Clear</button>' : ''}
      ${canBalance(f) ? '<button class="btn sm gold" data-act="balance">⚖ Balance</button>' : ''}
      ${canBalance(f) && S.ranks ? `<span class="seg" role="group" aria-label="Ratings ⚖ Balance uses">${[['adjusted', 'Adjusted', 'Ladder ratings nudged by Solo/Duo rank (most for players with few games)'], ['normal', 'Normal', 'Ladder ratings only']].map(([m, label, tip]) =>
        `<button class="${S.mode === m ? 'on' : ''}" data-act="bal-mode" data-mode="${m}" aria-pressed="${S.mode === m}" title="${tip}">${label}</button>`).join('')}</span>` : ''}
      ${[...f.blue, ...f.red].some(prefsOf) && (f.blue.length === 5 || f.red.length === 5) ? '<button class="btn sm" data-act="auto-roles" title="Give everyone the role they like most, team by team">Auto roles</button>' : ''}</div>
      <p class="hint" style="margin:0 0 12px">${hint}</p>` : ''}
    ${bal && opts.length ? `<div class="bal">
      <div class="bal-opts">${opts.map((x, i) => `<button class="bal-opt ${i === f.bal.opt ? 'on' : ''}" data-act="bal-opt" data-i="${i}">
        <b>Option ${i + 1}</b><span class="num"><span class="blue-t">${pct(x.p)}</span>–<span class="red-t">${100 - pct(x.p)}</span></span>${(() => {
          if (!x.roles) return '';
          const rs = roleSummary([...x.blue, ...x.red], id => x.roles[id]);
          return rs.n ? `<small class="num" title="${rs.top2} of ${rs.n} players with role preferences get one of their top 2">${rs.top2}/${rs.n} top-2</small>` : '';
        })()}</button>`).join('')}</div>
      <div class="row" style="justify-content:space-between"><span class="small muted">Each option gives both teams an even mix of strong and weak players, then gets as close to 50/50 as it can${opts.some(o => o.roles) ? '. Among the fairest, the ones where more people get their favourite roles come first' : ''}.${nLocked && opts.length < 5 ? ` Only ${opts.length} distinct option${opts.length > 1 ? 's' : ''} with these locks.` : ''}</span>
        ${nLocked ? `<button class="link small" data-act="unlock-all">Unlock all (${nLocked})</button>` : ''}</div>
    </div>` : ''}
    <div class="tboxes">${team('blue')}${team('red')}</div>
    ${admin && (f.pending || []).length ? `<div class="pending"><div class="small" style="margin:10px 0 6px"><b>New players</b> <span class="muted">— screenshots don’t show tags, so add theirs once:</span></div>
      ${f.pending.map((p, i) => `<div class="row nowrap" style="margin-bottom:6px"><span class="small ${p.side}-t" style="width:52px;flex-shrink:0">${TEAM[p.side]}</span>
        <input data-pending="${i}" value="${esc(p.name)}#" autocomplete="off" spellcheck="false" style="margin:0">
        <button class="btn sm" data-act="add-pending" data-i="${i}">Add</button></div>`).join('')}</div>` : ''}

    <div class="pool">
      <div class="small muted" style="margin-bottom:6px">${!all.length ? 'Add players by Riot ID — next time they’ll be one tap away.' : full ? 'Both teams are full. Tap a player to take them off.' : `Tap a player to add them to <b class="${f.active}-t">${TEAM[f.active]}</b>, tap again to take them off.`}</div>
      <div class="chips">${all.map(id => {
        const sd = sideOf(id), lk = sd && showLocks && lockOf(f, id);
        return `<button class="chip ${sd ? `on on-${sd}` : ''}" data-act="form-toggle" data-id="${esc(id)}" ${!sd && full ? 'disabled' : ''} title="${sd ? `On ${TEAM[sd]}${lk ? ' (locked)' : ''} — tap to remove` : esc(id)}">${lk ? '🔒 ' : ''}${esc(fullName(id))}</button>`;
      }).join('')}</div>
      <div class="row nowrap" style="margin-top:8px"><input id="newPlayer" list="playerList" placeholder="New player — Name#TAG" autocomplete="off" spellcheck="false" style="margin:0">
        <button class="btn" data-act="add-new">Add</button></div>
    </div>
    ${admin ? `
    <h3 class="sub">Who won? <span class="muted">Tap once per game — Bo3? tap three times. Then pick the group's MVP and ACE (optional).</span></h3>
    <div class="winner"><button class="btn blue" data-act="result" data-side="blue">${TEAM.blue} won</button>
      <button class="btn red" data-act="result" data-side="red">${TEAM.red} won</button></div>
    ${n ? `<div class="results-list">${f.results.map((r, i) => {
      const a = awardOf(f, i);
      const opts = (list, sel) => '<option value="">—</option>' + list.map(id => `<option value="${esc(id)}" ${sel && keyOf(id) === keyOf(sel) ? 'selected' : ''}>${esc(fullName(id))}</option>`).join('');
      return `<div class="result-row"><button class="res ${r}" data-act="unresult" data-i="${i}" title="Remove game ${i + 1}">G${i + 1} · ${TEAM[r]} won <span class="rm">✕</span></button>
        <label class="aw mvp">★ MVP <select data-award="mvp" data-i="${i}" aria-label="Game ${i + 1} MVP">${opts(f[r], a.mvp)}</select></label>
        <label class="aw ace">◆ ACE <select data-award="ace" data-i="${i}" aria-label="Game ${i + 1} ACE">${opts(f[other(r)], a.ace)}</select></label></div>`;
    }).join('')}
      ${n > 1 ? `<div class="small muted" style="margin-top:6px">${TEAM.blue} ${bw}–${rw} ${TEAM.red}</div>` : ''}</div>` : ''}
    <div class="row end" style="margin-top:14px"><button class="btn" data-act="cancel">Cancel</button>
      <button class="btn gold" data-act="save">${n > 1 ? `Save ${n} games` : 'Save game'}</button></div>`
    : `<div class="row end" style="margin-top:14px"><button class="btn" data-act="cancel">Close</button></div>`}
  </div>`;
}

function saveForm() {
  const f = S.form;
  if (!f.blue.length || !f.red.length) return toast('Add players to both teams.', true);
  if (!f.results.length) return toast('Tap who won each game.', true);
  const mk = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const series = f.results.length > 1 ? mk('s') : null;
  const onSide = (side, id) => id && f[side].some(x => keyOf(x) === keyOf(id));
  const games = f.results.map((w, i) => {
    const a = awardOf(f, i);
    return { id: mk('g'), date: f.date || today(), blue: [...f.blue], red: [...f.red], winner: w, ...(series ? { series } : {}),
      ...(onSide(w, a.mvp) ? { mvp: a.mvp } : {}), ...(onSide(other(w), a.ace) ? { ace: a.ace } : {}) };
  });
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
  const known = [...Object.values(S.stats.P).map(p => p.id), ...S.data.links.map(l => l.alt)];
  for (const id of known) {
    if (taken.has(keyOf(resolveId(id)))) continue;
    const s = nameSim(name, id.split('#')[0]);
    if (s > bs) { bs = s; best = id; }
  }
  return bs >= 0.67 ? best : null; // keeps the account actually played (alt or main)
}
function applyShots(shots) {
  const f = S.form, warn = [];
  const first = shots.find(s => s.blue.length && s.red.length);
  if (!first) { toast('Couldn’t find player names — use the post-game Scoreboard tab.', true); return; }
  const taken = new Set(), team = { blue: [], red: [] };
  f.pending = [];
  for (const side of ['blue', 'red']) for (const n of first[side]) {
    const id = matchPlayer(n, taken);
    if (id) { taken.add(keyOf(resolveId(id))); team[side].push(id); } else f.pending.push({ side, name: n });
  }
  Object.assign(f, { blue: team.blue, red: team.red, results: [], awards: [], active: 'blue' });
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

// ----- alt accounts (admin only) -----
function viewLinks() {
  const links = S.data.links, nicks = S.data.nicks;
  return `<div class="card" id="links"><h2>#1 picture</h2>
    <div class="row nowrap" style="align-items:center;gap:12px">
      <div style="width:76px;height:76px;flex-shrink:0">${emblemSvg(CROWN)}</div>
      <p class="hint" style="margin:0">The picture inside the #1 (Ayanokoji) emblem. Pick any image, then drag and zoom it to fit the frame. It publishes when you press Save.</p>
    </div>
    <div class="row end" style="margin-top:8px">${S.data.settings.crownImg ? '<button class="btn" data-act="crown-reset">Use the drawn one</button><button class="btn" data-act="crown-adjust">Adjust position</button>' : ''}<button class="btn gold" data-act="crown-pick" ${S.busy ? 'disabled' : ''}>${S.data.settings.crownImg ? 'Change picture…' : 'Upload picture…'}</button></div>
    <h2 style="margin-top:22px">Nicknames</h2>
    <p class="hint" style="margin-top:0">Show a name someone prefers on the ladder. They stay linked to their League account (op.gg link and rating). Leave the nickname empty to remove it.</p>
    <div class="cols" style="gap:8px">
      <input id="nickId" list="playerList" placeholder="Player — Name#TAG" autocomplete="off" spellcheck="false" style="margin:0">
      <input id="nickName" maxlength="${NICK_MAX}" placeholder="Nickname" autocomplete="off" spellcheck="false" style="margin:0">
    </div>
    <div class="row end" style="margin-top:8px"><button class="btn gold" data-act="set-nick">Save nickname</button></div>
    ${nicks.length ? `<div style="margin-top:12px">${nicks.map((n, i) => `<div class="game" style="grid-template-columns:minmax(0,1fr) auto;align-items:center">
      <div class="side"><b>${esc(n.nick)}</b> <span class="muted">=</span> ${nameHtml(n.id)}</div>
      <button class="x" data-act="unnick" data-i="${i}" title="Remove nickname">Remove</button></div>`).join('')}</div>` : ''}
    <h2 style="margin-top:22px">Link alt accounts</h2>
    <p class="hint" style="margin-top:0">Games played on an alt count toward the main player's rating. Unlinking puts them back on the alt.</p>
    <div class="cols" style="gap:8px">
      <input id="linkAlt" list="playerList" placeholder="Alt account — Name#TAG" autocomplete="off" spellcheck="false" style="margin:0">
      <input id="linkMain" list="playerList" placeholder="Main player — Name#TAG" autocomplete="off" spellcheck="false" style="margin:0">
    </div>
    <div class="row end" style="margin-top:8px"><button class="btn" data-act="hide-links">Done</button><button class="btn gold" data-act="add-link">Link</button></div>
    ${links.length ? `<div style="margin-top:12px">${links.map((l, i) => `<div class="game" style="grid-template-columns:minmax(0,1fr) auto;align-items:center">
      <div class="side">${nameHtml(l.alt)} <span class="muted">→</span> <b>${nameHtml(resolveId(l.main))}</b></div>
      <button class="x" data-act="unlink" data-i="${i}" title="Unlink">Unlink</button></div>`).join('')}</div>` : ''}
  </div>`;
}
// ----- custom #1 picture (admin only) -----
// Crop to a square (centered, a little above middle on tall images, where faces usually are), resize, upload
// as its own file, then point settings.crownImg at it and publish. Each upload gets a new file name, so no caching issues.
async function uploadCrown(file) {
  if (!ghReady()) { S.askKey = true; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return toast('Add your GitHub key first, then upload again.', true); }
  try { openCropper(await loadImage(file)); } catch { toast('Couldn’t open that image.', true); }
}
// Re-position the picture that's already up (works on the saved square, so zooming out stops at the edges).
async function adjustCrown() {
  if (!CROWN_IMG) return toast('The picture is still loading, try again in a second.', true);
  if (!ghReady()) { S.askKey = true; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return toast('Add your GitHub key first.', true); }
  const img = new Image(); img.src = CROWN_IMG; await img.decode(); openCropper(img);
}

// Drag to move, slider / wheel to zoom; the dark mask shows what the hexagon frame hides.
function openCropper(img) {
  const OUT = 320, w = img.naturalWidth, h = img.naturalHeight, base = Math.min(w, h);
  const st = { zoom: 1, cx: w / 2, cy: h > w ? (h - base) * 0.2 + base / 2 : h / 2, fill: edgeColor(img) };
  const ZMIN = 0.4, ZMAX = 5;
  const side = () => base / st.zoom;
  // The picture may move past the frame's edges (empty space gets the fill color), but its centre stays on the picture.
  const clampPos = () => {
    st.cx = Math.min(w, Math.max(0, st.cx));
    st.cy = Math.min(h, Math.max(0, st.cy));
  };
  const hex = hexPts(25.5);
  const wrap = document.createElement('div');
  wrap.className = 'crop-wrap';
  wrap.innerHTML = `<div class="card crop-card" role="dialog" aria-modal="true" aria-label="Position the #1 picture">
    <h2>Position the #1 picture</h2>
    <p class="hint" style="margin-top:0">Drag the picture to move it, even past the edges. Use the slider (or scroll) to zoom in or out. Empty space gets the fill color below. The dark area is hidden by the frame.</p>
    <div class="crop-main">
      <div class="crop-stage"><canvas width="${OUT}" height="${OUT}"></canvas>
        <svg viewBox="6.5 6.5 51 51" aria-hidden="true"><path fill-rule="evenodd" fill="rgba(5,7,13,.7)" d="M6.5 6.5h51v51h-51zM${hex.replace(/ /g, 'L')}z"/><polygon points="${hex}" fill="none" stroke="#f0c75e" stroke-width=".5"/></svg></div>
      <div class="crop-side"><div class="small muted">Preview</div><div class="crop-prev"></div><div class="crop-prev sm"></div></div>
    </div>
    <div class="row nowrap crop-zoom"><span class="muted">−</span><input type="range" min="0.4" max="5" step="0.01" value="1" aria-label="Zoom"><span class="muted">+</span></div>
    <div class="row crop-fill"><span class="small muted">Empty space:</span>${['#ffffff', '#000000', '#121a2c', '#f0c75e'].map(c => `<button class="sw" data-fill="${c}" style="background:${c}" title="${c}" aria-label="Fill ${c}"></button>`).join('')}<label class="sw pick" title="Pick any color"><input type="color" aria-label="Pick a fill color"></label><button class="link small" data-fill="auto">Match picture</button></div>
    <div class="row end"><button class="btn" data-c="cancel">Cancel</button><button class="btn" data-c="reset">Reset</button><button class="btn gold" data-c="save">Save</button></div>
  </div>`;
  document.body.appendChild(wrap);
  const cv = wrap.querySelector('canvas'), ctx = cv.getContext('2d'), stage = wrap.querySelector('.crop-stage');
  const range = wrap.querySelector('input[type=range]'), prevs = wrap.querySelectorAll('.crop-prev');
  let prevTimer = 0;
  const draw = () => {
    clampPos();
    const sd = side();
    const k = OUT / sd;
    ctx.fillStyle = st.fill; ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(img, (sd / 2 - st.cx) * k, (sd / 2 - st.cy) * k, w * k, h * k);
    wrap.querySelectorAll('[data-fill]').forEach(b => b.classList.toggle('on', b.dataset.fill === st.fill));
    wrap.querySelector('input[type=color]').value = st.fill;
    clearTimeout(prevTimer);
    prevTimer = setTimeout(() => {
      const saved = CROWN_IMG; CROWN_IMG = cv.toDataURL('image/jpeg', 0.8);
      const html = emblemSvg(CROWN); CROWN_IMG = saved;
      prevs.forEach(p => { p.innerHTML = html; });
    }, 60);
  };
  const setZoom = (z, fx = 0.5, fy = 0.5) => { // keep the point under (fx, fy) of the stage in place
    const before = side(); st.zoom = Math.min(ZMAX, Math.max(ZMIN, z));
    const after = side();
    st.cx += (fx - 0.5) * (before - after); st.cy += (fy - 0.5) * (before - after);
    range.value = st.zoom; draw();
  };
  let drag = null;
  stage.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; stage.setPointerCapture(e.pointerId); stage.classList.add('grabbing'); });
  stage.addEventListener('pointermove', e => {
    if (!drag) return;
    const k = side() / stage.getBoundingClientRect().width;
    st.cx -= (e.clientX - drag.x) * k; st.cy -= (e.clientY - drag.y) * k;
    drag = { x: e.clientX, y: e.clientY }; draw();
  });
  const end = () => { drag = null; stage.classList.remove('grabbing'); };
  stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    setZoom(st.zoom * Math.exp(-e.deltaY / 400), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }, { passive: false });
  range.addEventListener('input', () => setZoom(Number(range.value)));
  wrap.querySelector('input[type=color]').addEventListener('input', e => { st.fill = e.target.value; draw(); });
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', e => {
    const c = e.target.closest('[data-c]')?.dataset.c;
    if (e.target === wrap || c === 'cancel') close();
    else if (c === 'reset') { st.zoom = 1; st.cx = w / 2; st.cy = h / 2; range.value = 1; draw(); }
    else if (e.target.closest('[data-fill]')) { const f = e.target.closest('[data-fill]').dataset.fill; st.fill = f === 'auto' ? edgeColor(img) : f; draw(); }
    else if (c === 'save') {
      let url = cv.toDataURL('image/webp', 0.88);
      if (!url.startsWith('data:image/webp')) url = cv.toDataURL('image/png');
      close(); saveCrown(url);
    }
  });
  draw();
}
function edgeColor(img) {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 24;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0, 24, 24);
    const d = x.getImageData(0, 0, 24, 24).data; let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < 24; i++) for (const [px, py] of [[i, 0], [i, 23], [0, i], [23, i]]) { const o = (py * 24 + px) * 4; r += d[o]; g += d[o + 1]; b += d[o + 2]; n++; }
    return '#' + [r, g, b].map(v => Math.round(v / n).toString(16).padStart(2, '0')).join('');
  } catch { return '#121a2c'; }
}
async function saveCrown(url) {
  const c = ghCfg();
  try {
    S.busy = true; render(); toast('Uploading the picture…');
    const ext = url.startsWith('data:image/webp') ? 'webp' : 'png';
    const path = `assets/crown-${Date.now().toString(36)}.${ext}`;
    await ghRequest('PUT', { ...c, path }, { message: 'Update #1 picture', content: url.split(',')[1], branch: c.branch });
    const old = S.data.settings.crownImg;
    CROWN_IMG = url; S.crownShown = S.crownTried = path; rememberCrown(path, url);
    commit(d => { d.settings.crownImg = path; });
    S.busy = false;
    await publish();
    if (old) removeGhFile(old);
  } catch (e) {
    S.busy = false; render();
    if (e.status === 401 || e.status === 403 || e.status === 404) { S.askKey = e.status === 401 ? true : 'perm'; render(); }
    toast(`Couldn't upload the picture — ${e.message}`, true);
  }
}
async function resetCrown() {
  const old = S.data.settings.crownImg;
  CROWN_IMG = null; S.crownShown = S.crownTried = null;
  commit(d => { delete d.settings.crownImg; });
  await publish();
  if (old) removeGhFile(old);
}
async function removeGhFile(path) { // best effort: tidy up the previous picture
  try { const c = { ...ghCfg(), path }; const j = await ghRequest('GET', c); await ghRequest('DELETE', c, { message: 'Remove old #1 picture', sha: j.sha, branch: c.branch }); } catch { /* leave it */ }
}

function setNick() {
  const idIn = parseRiotId($('#nickId').value), nick = $('#nickName').value.trim().slice(0, NICK_MAX);
  if (!idIn) return toast('Pick the player as Name#TAG.', true);
  const p = S.stats.P[keyOf(resolveId(idIn))];
  if (!p) return toast('No one on the ladder has that Riot ID yet.', true);
  commit(d => {
    d.nicks = (d.nicks || []).filter(n => keyOf(resolveId(n.id)) !== keyOf(p.id));
    if (nick) d.nicks.push({ id: p.id, nick });
  }, nick ? `${p.id.split('#')[0]} now shows as ${nick}. Publish to share.` : `Removed ${p.id.split('#')[0]}'s nickname.`);
}
function addLink() {
  const altIn = parseRiotId($('#linkAlt').value), mainIn = parseRiotId($('#linkMain').value);
  if (!altIn || !mainIn) return toast('Use Name#TAG for both accounts.', true);
  const known = id => S.stats.P[keyOf(id)]?.id || S.data.links.find(l => keyOf(l.alt) === keyOf(id))?.alt || id;
  const alt = known(altIn), main = resolveId(known(mainIn));
  if (keyOf(alt) === keyOf(main)) return toast('That’s the same account.', true);
  commit(d => {
    d.links = d.links.filter(l => keyOf(l.alt) !== keyOf(alt));
    for (const l of d.links) if (keyOf(l.main) === keyOf(alt)) l.main = main; // alt had its own alts: move them over
    d.links.push({ alt, main });
  }, `${alt.split('#')[0]} now counts for ${main.split('#')[0]}. Publish to share.`);
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

// ---------- personal links, roles (Supabase; see docs/supabase.md) ----------
// Every call goes through a function that checks the caller's code; the tables can't be touched directly.
let sbClient = null;
function sb() {
  if (!LIVE.url || !LIVE.key) return Promise.reject(new Error('Supabase is not set up'));
  return sbClient || (sbClient = new Promise((ok, fail) => {
    if (window.supabase) return ok();
    const sc = document.createElement('script');
    sc.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
    sc.onload = ok; sc.onerror = () => fail(new Error('could not reach Supabase')); document.head.appendChild(sc);
  }).then(() => window.supabase.createClient(LIVE.url, LIVE.key)).catch(e => { sbClient = null; throw e; }));
}
async function rpc(fn, args) {
  const { data, error } = await (await sb()).rpc(fn, args);
  if (error) { const e = new Error(error.message); e.code = error.code; throw e; }
  return data;
}
const meLink = code => `${location.origin}${location.pathname}#me=${code}`;
// Who this device's link belongs to. Checked once per visit; a revoked link logs out.
async function checkMe() {
  const m = store.get(LS.me);
  if (!m || !m.code) return;
  try {
    const r = (await rpc('whoami', { p_code: m.code }))?.[0];
    if (!r) throw Object.assign(new Error('no such link'), { code: 'P0001' });
    S.me = { code: m.code, player: r.player, admin: !!r.is_admin }; store.set(LS.me, S.me);
  } catch (e) {
    // P0001 = the database said no (unknown or revoked code). Anything else (offline…): keep the saved login.
    if (e.code === 'P0001') { logout(true); toast('This link no longer works — ask an admin for a new one.', true); }
  }
  if (S.data) render();
}
function logout(quiet) {
  store.del(LS.me);
  Object.assign(S, { me: null, meMenu: false, showMeLinks: false, meLinks: null, roleDraft: null });
  ME_FRESH = false;
  if (!quiet) toast('Logged out on this device.');
  if (S.data) render();
}
// Header chip: always shows who this device is logged in as.
function renderMe() {
  const el = $('#me'), m = S.me;
  if (!el) return;
  if (!m || !m.player) { el.innerHTML = ''; return; }
  const k = keyOf(resolveId(m.player)), p = S.stats.P[k], place = p ? S.stats.ladder.indexOf(p) : -1;
  el.innerHTML = `<button class="me-chip" data-act="me-menu" aria-haspopup="menu" aria-expanded="${S.meMenu}" title="Logged in as ${esc(fullName(m.player))}">
      ${p ? `<span class="me-emb">${emblemSvg(rankOf(p.rating, place))}</span>` : ''}<span class="me-nm">${fullNameHtml(m.player)}</span>${m.admin ? '<span class="adm">ADMIN</span>' : ''}</button>
    ${S.meMenu ? `<div class="me-menu" role="menu">
      <div class="small muted">Logged in as ${esc(fullName(m.player))}</div>
      <a role="menuitem" href="${playerHref(m.player)}" data-act="me-page">My page</a>
      <a role="menuitem" href="${playerHref(m.player)}" data-act="me-roles">My roles</a>
      <button role="menuitem" data-act="logout">Log out</button></div>` : ''}`;
}
function viewMeFresh() {
  if (!ME_FRESH || !S.me || !S.me.player) return '';
  return `<div class="card me-fresh"><span>You're logged in as <b>${fullNameHtml(S.me.player)}</b>${S.me.admin ? ' <span class="adm">ADMIN</span>' : ''}. Not you?</span>
    <span class="row"><button class="btn sm" data-act="logout">Log out</button><button class="btn sm gold" data-act="me-ok">Got it</button></span></div>`;
}

// ----- Links panel (admins): one row per ladder player -----
async function loadMeLinks() {
  try {
    const rows = await rpc('list_links', { p_code: S.me.code });
    S.meLinks = {}; for (const r of rows || []) S.meLinks[keyOf(resolveId(r.player))] = { player: r.player, admin: r.is_admin };
  } catch (e) { S.meLinks = { error: e.message }; }
  render();
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
// Copy (creates the link on first use) or reissue (old link dies) a player's link, then copy it.
async function linkAction(kind, id) {
  const name = fullName(id);
  if (kind === 'reissue' && !confirm(`Make a new link for ${name}?\n\nTheir current link stops working straight away.`)) return;
  try {
    const code = await rpc(kind === 'reissue' ? 'reissue_link' : 'get_link', { p_code: S.me.code, p_player: id });
    const url = meLink(code), copied = await copyText(url);
    S.linkShown = { k: keyOf(id), url };
    toast(copied ? `Copied ${name}'s link. Send it only to them.` : `Here's ${name}'s link — copy it from the box.`, !copied);
    await loadMeLinks();
  } catch (e) { toast(`Couldn't get the link — ${e.message}`, true); }
}
async function adminToggle(id, on) {
  try { await rpc('set_admin', { p_code: S.me.code, p_player: id, p_admin: on }); toast(on ? `${fullName(id)} is now an admin.` : `${fullName(id)} is no longer an admin.`); await loadMeLinks(); }
  catch (e) { toast(`Couldn't change that — ${e.message}`, true); }
}
function viewMeLinks() {
  const L = S.meLinks, myKey = keyOf(resolveId(S.me.player));
  const players = [...S.stats.ladder].sort((a, b) => byName(a.id, b.id));
  const body = !L ? '<p class="muted small">Loading…</p>' : L.error ? `<p class="small neg">Couldn't load links — ${esc(L.error)}</p>`
    : `<div class="links-list">${players.map(p => {
      const k = keyOf(p.id), l = L[k], me = k === myKey, shown = S.linkShown && S.linkShown.k === k;
      return `<div class="lrow"><div class="lname">${fullNameHtml(p.id)}${me ? ' <span class="muted small">(you)</span>' : ''}
          <div class="small ${l ? 'pos' : 'dim'}">${l ? 'Has a link' : 'No link yet'}</div></div>
        <div class="row nowrap lact">
          <button class="btn sm" data-act="link-copy" data-id="${esc(p.id)}">Copy link</button>
          ${l && !me ? `<button class="btn sm" data-act="link-reissue" data-id="${esc(p.id)}" title="New link; the old one stops working">Reissue</button>` : ''}
          <label class="adm-t ${me ? 'off' : ''}" title="${me ? "You can't remove your own admin" : 'Admins can record games and hand out links'}"><input type="checkbox" data-admin="${esc(p.id)}" ${l && l.admin ? 'checked' : ''} ${me ? 'disabled' : ''}> Admin</label>
        </div>
        ${shown ? `<input class="lurl" readonly value="${esc(S.linkShown.url)}" aria-label="${esc(fullName(p.id))}'s link">` : ''}</div>`;
    }).join('')}</div>`;
  return `<div class="card" id="meLinks"><h2>Player links</h2>
    <p class="hint" style="margin-top:0">Each player's personal link logs them in on their device, with no account or password, so they can set their roles. Admin links can also record games. Send each link only to its player; if one leaks, <b>Reissue</b> it.</p>
    ${body}
    <div class="row end" style="margin-top:10px"><button class="btn" data-act="hide-me-links">Done</button></div></div>`;
}

// ----- role preferences: public, edited by the player on their own page -----
async function loadRoles() {
  try {
    const { data, error } = await (await sb()).from('roles').select('player, roles');
    if (error) throw error;
    S.roleRows = (data || []).filter(r => r && r.player && Array.isArray(r.roles));
    if (S.data) update();
  } catch { /* no roles: balancing ignores them */ }
}
function rolesCard(k) {
  const prefs = S.roles[k] || null, mine = S.me && S.me.player && keyOf(resolveId(S.me.player)) === k;
  const line = list => list.map(r => ROLE_NAME[r]).join(' › ');
  if (!mine) return `<div class="card" id="roles"><h3 class="ctitle">Roles</h3>
    <div>${prefs ? `<b>${esc(line(prefs))}</b>` : '<span class="muted">No role preferences yet.</span>'}</div></div>`;
  const d = S.roleDraft || (S.roleDraft = prefs ? [...prefs] : []);
  const changed = JSON.stringify(d) !== JSON.stringify(prefs || []);
  return `<div class="card" id="roles"><h3 class="ctitle">Your roles</h3>
    <p class="hint" style="margin-top:0">Tap roles in the order you like them, favourite first. Leave out any you'd rather not play; they count as your last pick. Everyone can see this, and ⚖ Balance uses it to hand out roles.</p>
    <div class="role-pick">${ROLES.map(r => { const i = d.indexOf(r); return `<button class="rp ${i >= 0 ? 'on' : ''}" data-act="role-tap" data-role="${r}" aria-pressed="${i >= 0}">${i >= 0 ? `<b>${i + 1}</b>` : ''}${ROLE_NAME[r]}</button>`; }).join('')}</div>
    <div class="small" style="margin:8px 0">${d.length ? esc(line(d)) : '<span class="muted">Nothing picked: any role is fine.</span>'}</div>
    <div class="row end">${d.length ? '<button class="btn sm" data-act="role-clear">Clear</button>' : ''}<button class="btn sm gold" data-act="role-save" ${changed ? '' : 'disabled'}>Save</button></div></div>`;
}
async function saveRoles() {
  try {
    await rpc('set_roles', { p_code: S.me.code, p_roles: S.roleDraft || [] });
    S.roleDraft = null; await loadRoles(); toast('Roles saved.');
  } catch (e) { toast(`Couldn't save your roles — ${e.message}`, true); }
}

// ---------- events ----------
document.addEventListener('click', async e => {
  const a = e.target.closest('[data-act]');
  if (S.meMenu && !e.target.closest('#me')) { S.meMenu = false; renderMe(); } // tap outside closes the menu
  if (!a) return;
  const { act, id } = a.dataset;
  switch (act) {
    case 'open-form': case 'open-balance':
      if (!S.form) S.form = emptyForm();
      if (S.page) { location.hash = S.tab || 'rankings'; break; } // hashchange renders the tabs with the form
      render(); window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    case 'cancel': S.form = null; store.del(LS.form); render(); break;
    case 'set-active': S.form.active = a.dataset.side; saveFormState(); render(); break;
    case 'pick': pick(id); break;
    case 'form-toggle': formToggle(id); break;
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
    case 'swap': {
      const f = S.form; [f.blue, f.red] = [f.red, f.blue]; f.results = f.results.map(other);
      for (const k of Object.keys(f.locks || {})) f.locks[k] = other(f.locks[k]); // locks follow their players
      f.bal = null; saveFormState(); render(); break;
    }
    case 'clear-teams': Object.assign(S.form, { blue: [], red: [], active: 'blue', locks: {}, bal: null }); saveFormState(); render(); break;
    case 'balance': balance(); break;
    case 'bal-mode': setMode(a.dataset.mode); break;
    case 'auto-roles': autoRoles(); break;
    case 'noop': break;
    case 'bal-opt': useOption(Number(a.dataset.i)); break;
    case 'lock': setLock(id, a.dataset.side || null); break;
    case 'unlock-all': S.form.locks = {}; if (refreshBal()) break; saveFormState(); render(); break;
    case 'result':
      if (S.form.results.length >= 7) return toast('Max 7 games at once.', true);
      S.form.results.push(a.dataset.side); saveFormState(); render(); break;
    case 'unresult': S.form.results.splice(Number(a.dataset.i), 1); (S.form.awards || []).splice(Number(a.dataset.i), 1); saveFormState(); render(); break;
    case 'save': saveForm(); break;
    case 'rematch': case 'edit': {
      const games = gamesByIds(a.dataset.ids.split(','));
      if (!games.length) break;
      S.form = emptyForm(games[0]);
      if (act === 'edit') Object.assign(S.form, { editIds: games.map(g => g.id), date: games[0].date, results: games.map(g => g.winner), awards: games.map(g => ({ mvp: g.mvp || '', ace: g.ace || '' })) });
      saveFormState(); render(); window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    }
    case 'delete': {
      // Spell out which match this is, so a mis-tap on the small ✕ is easy to catch.
      const ids = a.dataset.ids.split(','), gs = gamesByIds(ids);
      const nums = gs.map(g => S.stats.ordered.indexOf(g) + 1);
      const what = gs.length > 1 ? `all ${gs.length} games of this series (games ${nums[0]}–${nums[nums.length - 1]}, ${fmtDate(gs[0].date)})` : `game ${nums[0]} (${gs[0] ? fmtDate(gs[0].date) : ''})`;
      const teams = gs[0] ? `\n\n${TEAM.blue}: ${gs[0].blue.map(id => who(id).id.split('#')[0]).join(', ')}\n${TEAM.red}: ${gs[0].red.map(id => who(id).id.split('#')[0]).join(', ')}` : '';
      if (confirm(`Delete ${what}?${teams}\n\nEveryone's ratings will be recalculated without it.`))
        commit(d => { d.games = d.games.filter(g => !ids.includes(g.id)); }, 'Deleted.');
      break;
    }
    case 'toggle-all': S.showAll = !S.showAll; render(); break;
    case 'sel-toggle': toggleSel(a.dataset.k); break;
    case 'sel-clear': setSel([]); break;
    case 'crown-pick': $('#crownFile').click(); break;
    case 'crown-adjust': adjustCrown(); break;
    case 'crown-reset': if (confirm('Go back to the drawn #1 emblem?')) resetCrown(); break;
    case 'show-links': S.showLinks = true; render(); $('#links')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); break;
    case 'hide-links': S.showLinks = false; render(); break;
    case 'add-link': addLink(); break;
    case 'set-nick': setNick(); break;
    case 'unnick': { const n = S.data.nicks[Number(a.dataset.i)]; commit(d => { d.nicks.splice(Number(a.dataset.i), 1); }, `Removed the nickname ${n.nick}.`); break; }
    case 'unlink': { const l = S.data.links[Number(a.dataset.i)]; commit(d => { d.links.splice(Number(a.dataset.i), 1); }, `Unlinked ${l.alt.split('#')[0]}.`); break; }
    case 'publish': publish(); break;
    case 'me-menu': S.meMenu = !S.meMenu; renderMe(); break;
    case 'me-page': S.meMenu = false; renderMe(); break;
    case 'me-roles': S.meMenu = false; setTimeout(() => $('#roles')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120); break;
    case 'me-ok': ME_FRESH = false; render(); break;
    case 'logout': logout(); break;
    case 'show-me-links': S.showMeLinks = true; S.meLinks = null; render(); loadMeLinks(); setTimeout(() => $('#meLinks')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); break;
    case 'hide-me-links': S.showMeLinks = false; S.linkShown = null; render(); break;
    case 'link-copy': linkAction('copy', id); break;
    case 'link-reissue': linkAction('reissue', id); break;
    case 'role-tap': { const d = S.roleDraft || (S.roleDraft = []), r = a.dataset.role, i = d.indexOf(r); i >= 0 ? d.splice(i, 1) : d.push(r); render(); break; }
    case 'role-clear': S.roleDraft = []; render(); break;
    case 'role-save': saveRoles(); break;
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
      store.set(LS.gh, { token }); S.askKey = false;
      publish();
      break;
    }
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'newPlayer') el.classList.remove('bad');
  if (S.form && el.dataset.f === 'date') { S.form.date = el.value; saveFormState(); }
  if (S.form && el.dataset.award) { awardOf(S.form, Number(el.dataset.i))[el.dataset.award] = el.value; saveFormState(); }
  if (S.form && el.dataset.role != null) { setRole(el.dataset.role, el.value); el.blur(); }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset && el.dataset.admin != null) adminToggle(el.dataset.admin, el.checked);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'newPlayer') { e.preventDefault(); addNew(); }
  if (e.target.dataset?.pending != null) { e.preventDefault(); addPending(Number(e.target.dataset.pending)); }
  if (e.target.id === 'ghToken') { e.preventDefault(); $('[data-act=save-key]').click(); }
});

$('#crownFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) uploadCrown(f); });
$('#shotFile').addEventListener('change', e => { const files = [...e.target.files]; e.target.value = ''; importShots(files); });
document.addEventListener('paste', e => {
  if (!S.form) return;
  const files = [...(e.clipboardData?.files || [])].filter(x => x.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); importShots(files); }
});

load();
// Solo/Duo ranks change rarely (refreshed by hand with tools/fetch-ranks.mjs), so load them once.
fetch(`data/ranks.json?t=${Date.now()}`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(j => {
  if (!j || !j.players) return;
  S.ranks = j.players; S.ranksDate = j.updated;
  if (S.data) update();
}).catch(() => { /* no ranks: balancing uses ladder ratings only */ });
// ---------- live updates ----------
// 1. Doorbell (instant): after a publish, the publisher's browser rings a Supabase Realtime broadcast channel.
//    Every open page hears it within a second or two and fetches the ladder from GitHub's API.
//    The channel only says "something changed"; the data always comes from GitHub, so a fake ring can't change anything.
// 2. Fallback (about a minute): every 15 s, check the copy GitHub Pages serves (no rate limit). Pages lags behind
//    the repo after a publish, so a different copy is confirmed through GitHub's API before it's shown, at most once
//    per Pages change. That way the page never rolls back to an older ladder.
// Unpublished edits on this device are kept either way (load() re-applies them on top).
// Supabase project URL + publishable key: both public by design (the doorbell only needs Realtime broadcast,
// no tables or secrets). Empty = doorbell off.
const LIVE = { url: 'https://dxwretijaangbpwxkvbk.supabase.co', key: 'sb_publishable_9-BKbz_bI0L2JWn3hG17zg_gX197gRW' };
const PAGES_EVERY = 15000;
let liveBusy = false, pagesSeen = null, doorbell = null;
async function applyLive(text) {
  if (text == null || hash(canon(text)) === S.base) return false;
  const el = document.activeElement; // don't redraw under someone typing; the next check picks it up
  if (S.busy || (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName))) { pagesSeen = null; return false; }
  await load(text);
  toast('The ladder just updated.');
  return true;
}
async function liveCheck(rang = false) {
  if (liveBusy || document.hidden || S.busy || !S.data) return;
  liveBusy = true;
  try {
    if (!rang) {
      const r = await fetch(`data/league.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) return;
      const h = hash(canon(await r.text()));
      if (h === S.base || h === pagesSeen) { pagesSeen = h; return; }
      pagesSeen = h; // different from what's on screen: newer or older? Ask GitHub (once per Pages change).
    }
    await applyLive(await fetchLive());
  } catch { /* offline or rate-limited: the next check tries again */ } finally { liveBusy = false; }
}
async function startDoorbell() {
  if (!LIVE.url || !LIVE.key) return;
  try {
    const ch = (await sb()).channel('ladder', { config: { broadcast: { self: false } } });
    let last = 0;
    ch.on('broadcast', { event: 'updated' }, () => {
      const now = Date.now(); if (now - last < 5000) return; last = now; // ignore bursts
      setTimeout(() => liveCheck(true), 1500); // give GitHub a moment to serve the new commit
    }).subscribe();
    doorbell = ch;
  } catch { /* doorbell unavailable: the Pages check still catches updates */ }
}
function ringDoorbell() { try { doorbell?.send({ type: 'broadcast', event: 'updated', payload: {} }); } catch { /* best effort */ } }
setInterval(() => liveCheck(), PAGES_EVERY);
document.addEventListener('visibilitychange', () => { if (!document.hidden) liveCheck(); });
startDoorbell();
checkMe();
loadRoles();
