'use strict';
/* Rank emblems, drawn as SVG (one per entry in RANKS, same order). The frame gets fancier as
 * the rank goes up: cracked disc → ring → hexagon → spiked hexagon → winged, crowned hexagon. */

const EMBLEM_INK = '#0b0f1a';

// Picture in the middle of each emblem, drawn in a 64×64 box. `c` is the rank color.
const EMBLEM_GLYPHS = [
  // Make-A-Wish Kid: a sad little balloon
  c => `<path d="M32 39c-6 0-10-6-10-12.5S26.5 15 32 15s10 5 10 11.5S38 39 32 39z" fill="${c}"/>
    <path d="M30 39.5h4l-2 2.5z" fill="${c}"/>
    <path d="M32 42c-3 2.5 3 4.5 0 7s2 3 0 4" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>
    <ellipse cx="28" cy="22" rx="2.2" ry="3.6" fill="#fff" opacity=".45" transform="rotate(25 28 22)"/>`,
  // Wood: end of a log
  c => `<circle cx="32" cy="32" r="13.5" fill="${c}"/>
    <circle cx="32" cy="32" r="9.5" fill="none" stroke="${EMBLEM_INK}" stroke-width="1.4" opacity=".55"/>
    <circle cx="32" cy="32" r="5.5" fill="none" stroke="${EMBLEM_INK}" stroke-width="1.4" opacity=".55"/>
    <circle cx="32" cy="32" r="1.8" fill="${EMBLEM_INK}" opacity=".6"/>
    <path d="M32 18.5l2 6-2.5 3.5" fill="none" stroke="${EMBLEM_INK}" stroke-width="1.6" stroke-linecap="round"/>`,
  // Moron: dunce cap
  c => `<path d="M32 13L21 45h22z" fill="${c}"/>
    <path d="M27.5 26.5h9M25 34h14" stroke="${EMBLEM_INK}" stroke-width="2.2" opacity=".5"/>
    <ellipse cx="32" cy="45.5" rx="14" ry="3.2" fill="${c}"/>
    <circle cx="32" cy="12.5" r="3" fill="#fff" opacity=".85"/>
    <text x="32" y="42" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="7" fill="${EMBLEM_INK}" opacity=".75">D</text>`,
  // Tool: a wrench
  c => `<g transform="rotate(-45 32 32)">
      <rect x="29" y="28" width="6" height="22" rx="3" fill="${c}"/>
      <path d="M24 22a8 8 0 0 1 5-7.4V22h6v-7.4a8 8 0 0 1-1 15.1V31h-4v-1.3A8 8 0 0 1 24 22z" fill="${c}"/>
    </g>`,
  // Pawn: chess pawn
  c => `<circle cx="32" cy="19" r="6" fill="${c}"/>
    <rect x="25.5" y="25.5" width="13" height="3.2" rx="1.6" fill="${c}"/>
    <path d="M28.5 28.7h7c0 5 3 9 4.5 14h-16c1.5-5 4.5-9 4.5-14z" fill="${c}"/>
    <rect x="21.5" y="42.5" width="21" height="5" rx="2" fill="${c}"/>`,
  // Peasant: pitchfork
  c => `<path d="M32 26v24M23.5 13.5v7.5c0 4.5 4 6 8.5 6s8.5-1.5 8.5-6v-7.5M32 13.5V27" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M23.5 13.5l-1-2.5M32 13.5l0-2.5M40.5 13.5l1-2.5" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`,
  // NPC: blank, featureless face
  c => `<circle cx="32" cy="27" r="11" fill="${c}"/>
    <path d="M17 50c1-8 7.5-12 15-12s14 4 15 12z" fill="${c}"/>
    <circle cx="28" cy="26" r="1.6" fill="${EMBLEM_INK}"/><circle cx="36" cy="26" r="1.6" fill="${EMBLEM_INK}"/>
    <path d="M28.5 31.5h7" stroke="${EMBLEM_INK}" stroke-width="1.8" stroke-linecap="round"/>`,
  // The Observer: an unblinking eye
  c => `<path d="M12 32Q32 13 52 32Q32 51 12 32z" fill="${c}"/>
    <circle cx="32" cy="32" r="8.5" fill="${EMBLEM_INK}"/>
    <circle cx="32" cy="32" r="3.6" fill="${c}"/>
    <circle cx="34.5" cy="29.5" r="1.6" fill="#fff" opacity=".9"/>`,
  // Manipulator: smiling mask
  c => `<path d="M19 18c8-4 18-4 26 0v9c0 12-6 19-13 21-7-2-13-9-13-21z" fill="${c}"/>
    <path d="M23.5 26.5c2-2.5 5-2.5 7 0-2 1.6-5 1.6-7 0zM33.5 26.5c2-2.5 5-2.5 7 0-2 1.6-5 1.6-7 0z" fill="${EMBLEM_INK}"/>
    <path d="M24.5 35c4 5 11 5 15 0" fill="none" stroke="${EMBLEM_INK}" stroke-width="2" stroke-linecap="round"/>
    <path d="M24.5 35l-1.5-1.5M39.5 35l1.5-1.5" stroke="${EMBLEM_INK}" stroke-width="1.6" stroke-linecap="round"/>`,
  // Lone Wolf: wolf head under a crescent moon
  c => `<path d="M47 9.5a6 6 0 1 0 4.5 9.5 5 5 0 1 1-4.5-9.5z" fill="#fff" opacity=".75"/>
    <path d="M19 15l8 10 5-2 5 2 8-10 1 15-5 10-9 9-9-9-5-10z" fill="${c}"/>
    <path d="M24.5 31l5 1.5-4 1.5zM39.5 31l-5 1.5 4 1.5z" fill="${EMBLEM_INK}"/>
    <path d="M28.5 41l3.5 4 3.5-4z" fill="${EMBLEM_INK}"/>
    <path d="M22 18l3.5 6M42 18l-3.5 6" stroke="${EMBLEM_INK}" stroke-width="1.5" opacity=".45"/>`,
  // Puppet Master: control bar with strings
  c => `<rect x="18" y="15" width="28" height="4" rx="2" fill="${c}"/>
    <rect x="30" y="10" width="4" height="15" rx="2" fill="${c}"/>
    <path d="M20 19v24M44 19v24M32 25v15M25 17v17M39 17v17" stroke="${c}" stroke-width="1" opacity=".85"/>
    <circle cx="20" cy="45" r="2.6" fill="${c}"/><circle cx="44" cy="45" r="2.6" fill="${c}"/>
    <circle cx="32" cy="43" r="3.6" fill="${c}"/>
    <circle cx="25" cy="36" r="2" fill="${c}"/><circle cx="39" cy="36" r="2" fill="${c}"/>`,
  // Mastermind: chess king
  c => `<rect x="30.5" y="8" width="3" height="10" rx="1" fill="${c}"/>
    <rect x="27" y="10.8" width="10" height="3" rx="1" fill="${c}"/>
    <path d="M24.5 19.5h15l-2.5 7h-10z" fill="${c}"/>
    <rect x="25.5" y="27" width="13" height="3" rx="1.5" fill="${c}"/>
    <path d="M28 30h8c0 5.5 3 9.5 4.5 13h-17c1.5-3.5 4.5-7.5 4.5-13z" fill="${c}"/>
    <rect x="21" y="43" width="22" height="5" rx="2" fill="${c}"/>`,
  // Dark Triad: three-cornered sigil
  c => `<path d="M32 12.5L51 45.5H13z" fill="none" stroke="${c}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M32 46l-7-12h14z" fill="${c}"/>
    <circle cx="32" cy="12.5" r="4" fill="${c}"/><circle cx="51" cy="45.5" r="4" fill="${c}"/><circle cx="13" cy="45.5" r="4" fill="${c}"/>
    <circle cx="32" cy="12.5" r="1.4" fill="${EMBLEM_INK}"/><circle cx="51" cy="45.5" r="1.4" fill="${EMBLEM_INK}"/><circle cx="13" cy="45.5" r="1.4" fill="${EMBLEM_INK}"/>`,
  // Ayanokoji (#1 only): an original crowned big guy — deadpan stare, double chin, too comfortable at the top
  c => `<g clip-path="url(#emb13c)">
      <path d="M13 60c1-10 8-16.5 19-16.5S50 50 51 60z" fill="#1c2131"/>
      <path d="M26.5 43.5L32 51l5.5-7.5z" fill="#f4f1ea"/>
      <path d="M30.6 46.5h2.8l1 3.2-2.4 9.3-2.4-9.3z" fill="${c}"/>
      <path d="M26.5 43.5L22 47M37.5 43.5L42 47" stroke="#0d111c" stroke-width="1.2" opacity=".6"/>
    </g>
    <ellipse cx="32" cy="41.2" rx="11" ry="4.6" fill="#e9b893"/>
    <path d="M23.5 40.2q8.5 6.5 17 0" fill="none" stroke="#c98f6c" stroke-width="1.1" opacity=".8"/>
    <ellipse cx="32" cy="31" rx="12" ry="11.2" fill="#f3caa6"/>
    <path d="M23 38.5q9 5.5 18 0" fill="none" stroke="#d9a07c" stroke-width="1.1"/>
    <path d="M20 31c-.5-8 4.5-12 12-12s12.5 4 12 12c-1.5-3.5-3-4.8-5-5.4l-1.5 2.4-1.2-3.2c-2 .9-4 1.2-6 .6l-1 2.6-1.4-3c-2.6.2-4.8 1.6-6.4 4.3-.6-1.3-1-1.4-1.5 1.7z" fill="#262033"/>
    <ellipse cx="24.8" cy="34.2" rx="2.4" ry="1.3" fill="#ec8f9a" opacity=".55"/><ellipse cx="39.2" cy="34.2" rx="2.4" ry="1.3" fill="#ec8f9a" opacity=".55"/>
    <path d="M25.6 30.4h5M33.4 30.4h5" stroke="#3a2b22" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M26.6 30.6a1.9 1.6 0 0 0 3.6 0zM34.4 30.6a1.9 1.6 0 0 0 3.6 0z" fill="#2a1f1a"/>
    <path d="M30.4 36.6h3.2" stroke="#9c5f4c" stroke-width="1.2" stroke-linecap="round"/>
    <path d="M24.5 21l1-6.5 3.6 3.2L32 12.4l2.9 5.3 3.6-3.2 1 6.5z" fill="${c}"/>
    <path d="M24.5 21h15" stroke="${EMBLEM_INK}" stroke-width=".9" opacity=".45"/>
    <circle cx="25.5" cy="14.3" r="1.1" fill="#fff"/><circle cx="32" cy="12.2" r="1.2" fill="#fff"/><circle cx="38.5" cy="14.3" r="1.1" fill="#fff"/>
    <path d="M32 16.6l1.5 1.9-1.5 1.9-1.5-1.9z" fill="#d9344a"/>`,
];

// Optional custom #1 picture (uploaded by the admin, path in settings.crownImg), held as a data URL so the
// emblem also works as a standalone image (the trailer draws emblems onto a canvas).
let CROWN_IMG = null;
async function loadCrownImg(path, fresh = false) {
  try {
    // fresh: skip the browser cache, so a retry doesn't get a cached 'not found' from before Pages deployed the file
    const r = await fetch(path, { cache: fresh ? 'reload' : 'force-cache' });
    if (!r.ok) return false;
    const blob = await r.blob();
    CROWN_IMG = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
    return true;
  } catch { return false; }
}
const crownPicture = (c, id) => `<image href="${CROWN_IMG}" x="6.5" y="6.5" width="51" height="51" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id}c)"/>
    <polygon points="${hexPts(25.5)}" fill="none" stroke="${c}" stroke-width="1.4"/>`;

const hexPts = (r, cx = 32, cy = 32) =>
  [0, 1, 2, 3, 4, 5].map(k => { const a = Math.PI / 3 * k - Math.PI / 2; return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`; }).join(' ');

function emblemFrame(i, c, id) {
  const bg = `url(#${id}b)`;
  if (i <= 2) return `<circle cx="32" cy="32" r="27" fill="${bg}" stroke="${c}" stroke-width="2" stroke-dasharray="30 4 12 5 40 3" opacity=".95"/>`;
  if (i <= 6) return `<circle cx="32" cy="32" r="27" fill="${bg}" stroke="${c}" stroke-width="2.5"/>
    <circle cx="32" cy="32" r="23" fill="none" stroke="${c}" stroke-width="1" opacity=".35"/>`;
  const hex = `<polygon points="${hexPts(28)}" fill="${bg}" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"/>
    <polygon points="${hexPts(23.5)}" fill="none" stroke="${c}" stroke-width="1" opacity=".4"/>`;
  if (i <= 9) return hex;
  const spikes = `<path d="M7.8 24L0 32l7.8 8zM56.2 24L64 32l-7.8 8zM28 4.2L32-4l4 8.2z" fill="${c}"/>`;
  if (i <= 12) return spikes + hex;
  const wings = `<path d="M8 20C-2 22-4 34-3 44c3-5 6-7 11-7zM8 28c-6 2-8 8-8 13M56 20c10 2 12 14 11 24-3-5-6-7-11-7z" fill="${c}" opacity=".9"/>
    <path d="M8 26C1 28-1 36 0 41M56 26c7 2 9 10 8 15" fill="none" stroke="${EMBLEM_INK}" stroke-width="1" opacity=".35"/>`;
  return `<circle cx="32" cy="32" r="35" fill="url(#${id}g)"/>` + wings + spikes + hex;
}

// Full emblem as an SVG string. Works inline in HTML and as an <img>/canvas source.
function emblemSvg(i, cls = 'emb') {
  const c = RANKS[i].color, id = `emb${i}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" viewBox="-6 -6 76 76" role="img" aria-label="${RANKS[i].name}"><title>${RANKS[i].name}</title>
    <defs>
      <clipPath id="${id}c"><polygon points="${hexPts(25.5)}"/></clipPath>
      <radialGradient id="${id}b" cx="50%" cy="38%" r="65%"><stop offset="0" stop-color="${c}" stop-opacity=".38"/><stop offset=".7" stop-color="#121a2c"/><stop offset="1" stop-color="#090d16"/></radialGradient>
      <radialGradient id="${id}g"><stop offset=".55" stop-color="${c}" stop-opacity=".45"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>
    </defs>
    ${emblemFrame(i, c, id)}
    ${i === CROWN && CROWN_IMG ? crownPicture(c, id) : EMBLEM_GLYPHS[i](c)}
  </svg>`;
}
