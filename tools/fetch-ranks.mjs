// One-off: fetch every player's Solo/Duo rank from the Riot API into data/ranks.json.
// Run rarely, by hand (ranks are a rough guide for team balancing, not live data):
//
//   RIOT_API_KEY=RGAPI-... node tools/fetch-ranks.mjs
//
// The key comes from the environment only; it is never written anywhere. A development key from
// developer.riotgames.com works (it expires after 24 hours, which is fine for a one-off run).
// Looks up every account in data/league.json, alts included: Riot ID -> PUUID (account-v1, americas),
// then PUUID -> league entries (league-v4, na1). Unranked accounts are recorded as such.
import fs from 'node:fs';

const KEY = process.env.RIOT_API_KEY;
if (!KEY) { console.error('Set RIOT_API_KEY (e.g. RIOT_API_KEY=RGAPI-... node tools/fetch-ranks.mjs)'); process.exit(1); }
const ROUTE = 'americas', PLATFORM = 'na1';
const root = new URL('..', import.meta.url);
const league = JSON.parse(fs.readFileSync(new URL('data/league.json', root), 'utf8'));
const out = new URL('data/ranks.json', root);
const prev = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { players: {} };

const keyOf = id => id.toLowerCase().replace(/\s+/g, '');
const ids = new Map();
for (const g of league.games || []) for (const id of [...g.blue, ...g.red]) ids.set(keyOf(id), id);
for (const l of league.links || []) for (const id of [l.alt, l.main]) ids.set(keyOf(id), id);

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, { headers: { 'X-Riot-Token': KEY } });
    if (r.status === 429) { await sleep(1000 * Number(r.headers.get('retry-after') || 5)); continue; } // rate limited
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  }
  throw new Error('rate limited too many times');
}

const players = {};
let ranked = 0, unranked = 0, missing = 0;
for (const [k, id] of [...ids].sort()) {
  const [name, tag] = id.split('#');
  try {
    const acct = await get(`https://${ROUTE}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
    if (!acct) { players[k] = { id, status: 'not found' }; missing++; console.log(`?  ${id}: Riot ID not found`); continue; }
    const entries = (await get(`https://${PLATFORM}.api.riotgames.com/lol/league/v4/entries/by-puuid/${acct.puuid}`)) || [];
    const solo = entries.find(e => e.queueType === 'RANKED_SOLO_5x5');
    if (solo) {
      players[k] = { id, tier: solo.tier, division: solo.rank, lp: solo.leaguePoints, wins: solo.wins, losses: solo.losses };
      ranked++; console.log(`✓  ${id}: ${solo.tier} ${solo.rank} ${solo.leaguePoints} LP`);
    } else { players[k] = { id, status: 'unranked' }; unranked++; console.log(`-  ${id}: unranked in Solo/Duo`); }
  } catch (e) {
    // Keep the last known rank for this account if the lookup fails.
    if (prev.players?.[k]) players[k] = prev.players[k];
    console.log(`!  ${id}: ${e.message}`);
  }
  await sleep(150); // stay well under the development key's limits (20/s, 100 per 2 min)
}
fs.writeFileSync(out, JSON.stringify({ updated: new Date().toISOString().slice(0, 10), players }, null, 2) + '\n');
console.log(`\n${ranked} ranked, ${unranked} unranked, ${missing} not found -> data/ranks.json`);
