'use strict';
/* Rating history charts and player pages. Uses the app's state and helpers (S, esc, who, fullName, …) at call
 * time, so it can load before app.js. Ratings come from compute() in core.js: each player's `hist` holds one
 * entry per game they played ({ n, game, date, won, delta, rating, award }), where n numbers games in date order. */

// Categorical hues (dark-mode steps), validated against the card surface #111827: lightness band, chroma floor,
// adjacent CVD separation and 3:1 contrast all pass. Past 8 players, identity is hue × line style × marker
// (composite encoding), so no hue is ever generated. Styles follow the player: assigned in order of first game.
const SERIES = ['#338ced', '#e76624', '#00a888', '#d28e05', '#e24d8b', '#0aac23', '#9887ef', '#eb6263'];
const DASHES = ['', '7 4', '1.5 3.5', '8 3 1.5 3'];
const MARKS = ['circle', 'square', 'triangle', 'diamond'];
const SURFACE = '#111827';
const LS_SEL = 'cl.chartSel2';

const playerHref = id => '#p/' + encodeURIComponent(who(id).id);
const playerLink = id => `<a class="plink" href="${playerHref(id)}">${esc(fullName(id))}</a>`;
const gameName = p => p.id.split('#')[0];

function styleOf(p) {
  const i = Math.max(0, Object.values(S.stats.P).indexOf(p)), g = Math.floor(i / SERIES.length) % DASHES.length;
  return { color: SERIES[i % SERIES.length], dash: DASHES[g], mark: MARKS[g] };
}
function markSvg(kind, x, y, r, color) {
  const a = `fill="${color}" stroke="${SURFACE}" stroke-width="1.5"`;
  if (kind === 'square') return `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" rx="1" ${a}/>`;
  if (kind === 'triangle') return `<path d="M${x},${y - r * 1.2}L${x + r * 1.1},${y + r * 0.8}L${x - r * 1.1},${y + r * 0.8}Z" ${a}/>`;
  if (kind === 'diamond') return `<path d="M${x},${y - r * 1.25}L${x + r * 1.1},${y}L${x},${y + r * 1.25}L${x - r * 1.1},${y}Z" ${a}/>`;
  return `<circle cx="${x}" cy="${y}" r="${r}" ${a}/>`;
}
// A legend key: a short stroke in the player's line style with their marker.
const keySvg = st => `<svg class="lkey" width="30" height="12" aria-hidden="true"><line x1="1" x2="29" y1="6" y2="6" stroke="${st.color}" stroke-width="2" stroke-dasharray="${st.dash}" stroke-linecap="round"/>${markSvg(st.mark, 15, 6, 3.5, st.color)}</svg>`;

// ---------- which players the everyone chart shows (per device): empty = everyone ----------
function chartSel() {
  const sel = store.get(LS_SEL);
  return Array.isArray(sel) ? sel.filter(k => S.stats.P[k]) : [];
}
function toggleSel(k) {
  const sel = chartSel(), i = sel.indexOf(k);
  if (i >= 0) sel.splice(i, 1); else sel.push(k);
  store.set(LS_SEL, sel); render();
}
function setSel(keys) { store.set(LS_SEL, keys); render(); }

// ---------- rating chart ----------
// x = game number (shared by everyone). A player's line starts at 1000 just before their first game and moves
// game by game, staying level through games they sat out; markers sit on the games they played.
function ratingAt(p, n) {
  const h = p.hist;
  if (!h.length || n < h[0].n - 1) return null; // hadn't played yet
  let r = START;
  for (const e of h) { if (e.n > n) break; r = e.rating; }
  return r;
}
function drawCharts() {
  for (const el of document.querySelectorAll('.rchart')) {
    if (el.dataset.mode === 'player') { const p = S.stats.P[el.dataset.k]; if (p) drawChart(el, [p], true); continue; }
    // Everyone chart: all players, or only the picked ones (the rest aren't drawn at all).
    const sel = chartSel();
    drawChart(el, S.stats.ladder.filter(p => p.hist.length && (!sel.length || sel.includes(keyOf(p.id)))), false);
  }
}
function drawChart(el, shown, single, picked = null) {
  const games = S.stats.ordered, N = games.length;
  if (!N || !shown.length) { el.innerHTML = shown.length ? '' : '<p class="small muted" style="padding:20px 0">Nobody selected.</p>'; return; }
  const W = Math.max(280, el.clientWidth), H = Number(el.dataset.h) || 320;
  const wide = W >= 480;
  const m = { l: 44, r: wide ? 92 : 12, t: 12, b: 40 };
  let lo = START, hi = START;
  // The everyone chart keeps one scale (all players) however many are shown; a player page fits its one player.
  for (const p of single ? shown : S.stats.ladder) for (const e of p.hist) { lo = Math.min(lo, e.rating); hi = Math.max(hi, e.rating); }
  // Gridlines sit on the rank thresholds (…, 950, 1050, …); the right edge names the rank each one starts.
  const floor0 = START - 50;
  lo = floor0 + Math.floor((lo - 15 - floor0) / 100) * 100; hi = floor0 + Math.ceil((hi + 15 - floor0) / 100) * 100;
  const tickStep = (hi - lo) / 100 > 9 ? 200 : 100;
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const x = n => m.l + (n / N) * pw, y = r => m.t + ((hi - r) / (hi - lo)) * ph;
  let grid = '';
  for (let r = lo; r <= hi; r += 100) {
    const ri = rankIdx(r);
    grid += `<line x1="${m.l}" x2="${m.l + pw}" y1="${y(r)}" y2="${y(r)}" class="grid"/>`;
    if ((r - lo) % tickStep === 0) grid += `<text x="${m.l - 8}" y="${y(r) + 4}" class="ytick">${r}</text>`;
    if (wide && r < hi && rankFloor(ri) === r) grid += `<text x="${m.l + pw + 8}" y="${y(r) + 4}" class="rtick">${esc(RANKS[ri].name)}</text>`;
  }
  const xStep = [1, 2, 5, 10, 20, 25, 50, 100].find(s => (pw / N) * s >= 34) || 100;
  for (let n = 0; n <= N; n += xStep) grid += `<text x="${x(n)}" y="${H - m.b + 16}" class="xtick">${n}</text>`;
  grid += `<text x="${m.l + pw / 2}" y="${H - 4}" class="xtitle">Game number</text>`;

  // A line runs from just before a player's first game to their last game (it doesn't carry on past it).
  const lastN = p => p.hist[p.hist.length - 1].n;
  const pts = p => { const out = [{ n: p.hist[0].n - 1, r: START, e: null }]; for (let n = p.hist[0].n; n <= lastN(p); n++) { const e = p.hist.find(h => h.n === n); out.push({ n, r: e ? e.rating : out[out.length - 1].r, e }); } return out; };
  const series = shown.map(p => ({ p, st: single ? { ...styleOf(p), dash: '' } : styleOf(p), pts: pts(p), ghost: !!picked && !picked.has(keyOf(p.id)) }))
    .sort((a, b) => a.ghost - b.ghost).reverse(); // grey lines first, picked ones drawn on top
  const mr = single ? 4 : 3;
  const lines = series.map(s => `<g class="pl ${s.ghost ? 'ghost' : ''}" data-k="${esc(keyOf(s.p.id))}">
      ${single ? `<path d="M${s.pts.map(q => `${x(q.n).toFixed(1)},${y(q.r).toFixed(1)}`).join('L')}" class="halo"/>` : ''}
      <path d="M${s.pts.map(q => `${x(q.n).toFixed(1)},${y(q.r).toFixed(1)}`).join('L')}" class="ser" stroke="${s.st.color}" stroke-dasharray="${s.st.dash}" style="--c:${s.st.color}"/>
      ${s.ghost ? '' : s.pts.filter(q => q.e).map(q => markSvg(s.st.mark, +x(q.n).toFixed(1), +y(q.r).toFixed(1), mr, s.st.color)).join('')}</g>`).join('');
  // Name tags at each line's end, highest rating first; a tag that would overlap one already placed is skipped
  // (the legend and tooltip still name every line).
  // A tag sits just past the line's end, or just before it when there's no room on the right.
  const tagX = (n, tw) => (x(n) + 8 + tw <= m.l + pw ? x(n) + 8 : x(n) - tw - 8);
  let tags = '';
  if (!single) {
    const placed = [];
    for (const s of series.filter(s => !s.ghost).sort((a, b) => b.p.rating - a.p.rating)) {
      const ty = y(s.p.rating), label = gameName(s.p), tw = label.length * 6.6 + 12;
      const tx = tagX(lastN(s.p), tw);
      if (placed.some(b => Math.abs(b.y - ty) < 19 && tx < b.x + b.w + 4 && b.x < tx + tw + 4)) continue;
      placed.push({ x: tx, y: ty, w: tw });
      tags += `<g class="tag"><rect x="${tx}" y="${ty - 9}" width="${tw}" height="18" rx="4" stroke="${s.st.color}"/><text x="${tx + tw / 2}" y="${ty + 4}">${esc(label)}</text></g>`;
    }
  }
  const label = single ? `Rating after each game for ${shown[0].id}` : `Rating after each game for ${shown.length === S.stats.ladder.length ? 'every player' : shown.map(p => p.id).join(', ')}`;
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" tabindex="0" role="img" aria-label="${esc(label)}">
      ${grid}<line x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}" class="axis"/>
      <line class="cross" y1="${m.t}" y2="${m.t + ph}" hidden/>
      <g class="lines">${lines}</g><g class="tags">${tags}</g><g class="tag hottag"></g></svg>
    <div class="ctip" hidden></div>`;
  const svg = el.querySelector('svg'), tip = el.querySelector('.ctip'), cross = el.querySelector('.cross');
  let cur = null, hover = null;
  const show = (n, py) => {
    n = Math.max(0, Math.min(N, n)); cur = n;
    // The line nearest the pointer (within 14px) is brought forward; the rest fade.
    hover = null;
    if (py != null && !single) {
      let best = 14;
      for (const s of series) { const r = n > lastN(s.p) ? null : ratingAt(s.p, n); if (r == null) continue; const d = Math.abs(y(r) - py); if (d < best) { best = d; hover = s; } }
    }
    svg.classList.toggle('focusing', !!hover);
    for (const g of svg.querySelectorAll('.pl')) g.classList.toggle('on', !!hover && g.dataset.k === keyOf(hover.p.id));
    if (hover) svg.querySelector('.lines').append(svg.querySelector(`.pl.on`)); // draw it on top
    if (!single) {
      // Everyone chart: no readout, just the highlighted line, its name tag and its legend entry.
      const hk = hover && keyOf(hover.p.id);
      for (const b of document.querySelectorAll('.hl-item')) b.classList.toggle('hot', b.dataset.k === hk);
      const hot = svg.querySelector('.hottag');
      if (!hover) { hot.innerHTML = ''; return; }
      const label = `${gameName(hover.p)} · ${hover.p.rating}`, tw = label.length * 6.6 + 14, ty = y(hover.p.rating), tx = tagX(lastN(hover.p), tw);
      hot.innerHTML = `<rect x="${tx}" y="${ty - 10}" width="${tw}" height="20" rx="4" stroke="${hover.st.color}"/><text x="${tx + tw / 2}" y="${ty + 4}">${esc(label)}</text>`;
      return;
    }
    const cx = x(n);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.hidden = false;
    // Readout: who played this game (or the one player / the hovered line), highest rating first.
    const rows = series.filter(s => single || s === hover || s.p.hist.some(e => e.n === n))
      .map(s => ({ s, r: ratingAt(s.p, n), e: s.p.hist.find(e => e.n === n) })).filter(o => o.r != null)
      .sort((a, b) => b.r - a.r);
    tip.replaceChildren(); // built with textContent: names are data
    const head = document.createElement('div'); head.className = 'ctip-h';
    head.textContent = n === 0 ? 'Start' : `Game ${n} · ${fmtDate(games[n - 1].date)}`;
    tip.append(head);
    for (const { s, r, e } of rows) {
      const row = document.createElement('div'); row.className = 'ctip-r' + (s === hover ? ' on' : '');
      const key = document.createElement('i'); key.style.background = s.st.color;
      const v = document.createElement('b'); v.textContent = r;
      const d = document.createElement('span'); d.className = e ? (e.delta > 0 ? 'pos' : 'neg') : 'dim';
      d.textContent = e ? `${signed(e.delta)}${e.award === 'mvp' ? ' ★' : e.award === 'ace' ? ' ◆' : ''}` : 'sat out';
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = fullName(s.p.id);
      row.append(key, v, d, nm); tip.append(row);
    }
    if (!rows.length) { const e = document.createElement('div'); e.className = 'dim'; e.textContent = 'None of these players played this game.'; tip.append(e); }
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${cx + 14 + tw > W ? Math.max(0, cx - 14 - tw) : cx + 14}px`;
    tip.style.top = `${m.t}px`;
  };
  const hide = () => {
    cross.hidden = true; tip.hidden = true; svg.classList.remove('focusing'); cur = null; hover = null;
    svg.querySelector('.hottag').innerHTML = '';
    for (const b of document.querySelectorAll('.hl-item.hot')) b.classList.remove('hot');
  };
  const toN = e => { const b = svg.getBoundingClientRect(); return { n: Math.round(((e.clientX - b.left - m.l) / pw) * N), py: e.clientY - b.top }; };
  svg.addEventListener('pointermove', e => { const { n, py } = toN(e); show(n, py); });
  svg.addEventListener('pointerleave', hide);
  if (single) { svg.addEventListener('focus', () => show(N)); svg.addEventListener('blur', hide); }
  svg.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); show((cur ?? N) + (e.key === 'ArrowLeft' ? -1 : 1)); }
    if (e.key === 'Escape') hide();
  });
  // Tapping a line shows only that player (tapping it again while picked removes it).
  if (!single) svg.addEventListener('click', e => { const { n, py } = toN(e); show(n, py); if (hover) toggleSel(keyOf(hover.p.id)); });
}
let chartResize;
window.addEventListener('resize', () => { clearTimeout(chartResize); chartResize = setTimeout(drawCharts, 150); });

// ---------- main page: rating history card ----------
function viewHistory() {
  const { ladder, ordered } = S.stats;
  if (!ordered.length) return '';
  const sel = chartSel();
  const people = ladder.filter(p => p.hist.length);
  const shown = sel.length ? people.filter(p => sel.includes(keyOf(p.id))) : people;
  return `<div class="card" id="history">
    <div class="row" style="justify-content:space-between;align-items:baseline">
      <h3 class="ctitle">Rating history <span class="muted">· ${sel.length ? `${sel.length} selected` : 'everyone'}</span></h3>
      ${sel.length ? '<button class="link small" data-act="sel-clear">Show everyone</button>' : ''}</div>
    <div class="rchart" data-mode="all" data-h="680"></div>
    <div class="hlegend">${people.map((p, i) => {
      const k = keyOf(p.id), on = sel.includes(k);
      return `<button class="hl-item ${sel.length && !on ? 'off' : ''}" data-act="sel-toggle" data-k="${esc(k)}" aria-pressed="${on}" title="${esc(fullName(p.id))}">${keySvg(styleOf(p))}<span>${i + 1}. ${esc(gameName(p))} <span class="muted">· ${p.rating}</span></span></button>`;
    }).join('')}</div>
    <div class="small muted" style="margin-top:6px">Tap a line or a name to show just that player. Tap more names to add them, or tap a shown one again to remove it.</div>
  </div>`;
}

// ---------- player page ----------
function viewPlayer(k) {
  const { P, ladder, ordered } = S.stats, p = P[k];
  if (!p) return `<div class="card"><a class="link" href="#rankings">← Rankings</a><p class="muted">No player with that name has played a game yet.</p></div>`;
  const place = ladder.indexOf(p), shownRank = RANKS[rankOf(p.rating, place)];
  const h = p.hist, games = h.length, lastE = h[h.length - 1];
  const pct = (w, n) => (n ? Math.round((100 * w) / n) : 0);
  const peak = Math.max(START, ...h.map(e => e.rating));
  let streak = 0; for (let i = h.length - 1; i >= 0 && h[i].won === lastE.won; i--) streak++;
  const mvps = h.filter(e => e.award === 'mvp').length, aces = h.filter(e => e.award === 'ace').length;
  // Progress through the rating band toward the next rank.
  const band = rankIdx(p.rating), bandLo = rankFloor(band) ?? p.rating - 100, next = band + 1 < CROWN ? band + 1 : null;
  const bandHi = next != null ? rankFloor(next) : null;
  const fill = bandHi != null ? Math.max(2, Math.min(100, (100 * (p.rating - bandLo)) / (bandHi - bandLo))) : 100;
  const me = id => keyOf(resolveId(id)) === k;
  const sides = e => { const g = ordered[e.n - 1], mine = g.blue.some(me) ? 'blue' : 'red'; return { mates: g[mine].filter(id => !me(id)), opps: g[mine === 'blue' ? 'red' : 'blue'] }; };
  const rel = new Map();
  for (const e of h) {
    const { mates, opps } = sides(e);
    for (const [ids, kind] of [[mates, 'with'], [opps, 'vs']]) for (const id of ids) {
      const ok = keyOf(resolveId(id));
      const r = rel.get(ok) || rel.set(ok, { id: who(id).id, with: { n: 0, w: 0 }, vs: { n: 0, w: 0 } }).get(ok);
      r[kind].n++; if (e.won) r[kind].w++;
    }
  }
  const rels = [...rel.values()].sort((a, b) => (b.with.n + b.vs.n) - (a.with.n + a.vs.n) || fullName(a.id).localeCompare(fullName(b.id)));
  const rec = c => (c.n ? `${c.w}–${c.n - c.w} <span class="muted">${pct(c.w, c.n)}%</span>` : '<span class="dim">—</span>');
  const tile = (label, value, sub = '', cls = '') => `<div class="tile ${cls}"><div class="tl">${label}</div><div class="tv">${value}</div>${sub ? `<div class="ts">${sub}</div>` : ''}</div>`;
  const award = e => (e.award === 'mvp' ? '<span class="mvp">★ MVP</span>' : e.award === 'ace' ? '<span class="ace">◆ ACE</span>' : '');
  const [name, tag] = p.id.split('#');
  return `<div class="card phead">
    <a class="link small" href="#rankings">← Rankings</a>
    <div class="ph-top">
      <div style="min-width:0">
        <div class="lbl">Player</div>
        <h1 class="ph-name">${esc(name)}<span class="ph-tag">#${esc(tag)}</span>${p.nick ? `<span class="ph-nick">(${esc(p.nick)})</span>` : ''}</h1>
        <div class="small muted"><a href="${opgg(p.id, S.data.settings.region)}" target="_blank" rel="noopener noreferrer">op.gg ↗</a>${p.alts.length ? ` · alt: ${p.alts.map(a => esc(a)).join(', ')}` : ''}</div>
      </div>
      <div class="ph-rating"><div class="lbl">Rating</div><div class="ph-big num">${p.rating}</div></div>
    </div>
    <div class="ph-rank" style="--c:${RANKS[band].color}">
      <span class="ph-emb">${emblemSvg(rankOf(p.rating, place))}</span><b style="color:${shownRank.color}">${esc(shownRank.name)}</b>
      <div class="rbar"><span class="num muted">${bandLo}</span><div class="track"><div class="fill" style="width:${fill}%"></div></div>
        <span class="num muted">${bandHi != null ? `${bandHi} ${esc(RANKS[next].name)}` : 'top band'}</span></div>
      <span class="small">${bandHi != null ? `<b>${bandHi - p.rating}</b> to rank up` : ''}</span>
    </div>
    <div class="ph-grid">
      ${tile('Rank', `#${place + 1}`, `of ${ladder.length}`)}
      ${tile('Win rate', `${pct(p.wins, games)}%`)}
      ${tile('Record', `${p.wins}–${p.losses}`, `${games} game${games === 1 ? '' : 's'}`)}
      ${tile('Streak', `<span class="${lastE.won ? 'pos' : 'neg'}">${lastE.won ? 'W' : 'L'}${streak}</span>`)}
      ${tile('Peak', peak)}
      ${tile('★ MVP', mvps)}
      ${tile('◆ ACE', aces)}
      ${tile('Last game', `<span class="${p.last > 0 ? 'pos' : 'neg'}">${signed(p.last)}</span>`)}
      <div class="tile recent"><div class="tl">Recent games</div>
        ${[...h].reverse().slice(0, 8).map(e => `<div class="rg"><span class="${e.won ? 'pos' : 'neg'}">${e.won ? 'WIN' : 'LOSS'}</span><b class="num">${signed(e.delta)}</b><span>${award(e)}</span><span class="muted">${esc(fmtDate(e.date))}</span></div>`).join('')}
      </div>
    </div>
  </div>
  <div class="card"><h3 class="ctitle">Rating history</h3>
    <div class="rchart" data-mode="player" data-k="${esc(k)}" data-h="400"></div></div>
  <div class="card"><h3 class="ctitle">Games <span class="muted">· ${games}</span></h3>
    <div class="mlist">${groupGames().filter(gr => gr.games.some(g => h.some(e => e.game === g.id))).map(gr => matchCard(gr, k)).join('')}</div>
  </div>
  <div class="card"><h3 class="ctitle">With and against</h3>
    <div class="tscroll"><table class="rtable">
      <thead><tr><th>Player</th><th class="r">Together</th><th class="r">Against</th></tr></thead>
      <tbody>${rels.map(r => `<tr><td>${playerLink(r.id)}</td><td class="r num">${rec(r.with)}</td><td class="r num">${rec(r.vs)}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="small muted" style="margin-top:6px">${esc(displayName(p))}'s win–loss in games with each player as a teammate, and against them.</div>
  </div>`;
}
