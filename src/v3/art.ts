// src/v3/art.ts — 브리핑 화면 그림. LLM·외부 이미지 없이 직접 그린 SVG 묶음에서 코드가 요일·품목·분야로 고른다(비용 0).
// 값은 고정 문자열이라 innerHTML로 넣어도 응답 데이터가 섞이지 않는다. 그림 안에 등락 화살표는 넣지 않는다(그날 방향과 어긋날 수 있다).
let uid = 0;
const id = () => `a${++uid}`;

function snow(n: number, w: number, h: number, seed: number) {
  let s = seed, out = '';
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < n; i++) out += `<circle cx="${(rnd() * w).toFixed(0)}" cy="${(rnd() * h * 0.8).toFixed(0)}" r="${(1 + rnd() * 2.2).toFixed(1)}" fill="#fff" opacity="${(0.35 + rnd() * 0.5).toFixed(2)}"/>`;
  return out;
}

// ─── 상단 그림: 월~금 5장(주말은 날짜로 돌림) ───────────────────────────────
const HERO_BG = [
  'linear-gradient(120deg,#2b63d6,#4a86ef)',
  'linear-gradient(120deg,#17707f,#2a9aa8)',
  'linear-gradient(120deg,#3b46b8,#6470e0)',
  'linear-gradient(120deg,#33507e,#5677ab)',
  'linear-gradient(120deg,#155e75,#3b82a6)',
];

const ingot = (x: number, y: number, t: string, f: string, s: string) =>
  `<path d="M${x} ${y} h48 l10 -9 h-48z" fill="url(#${t})"/><path d="M${x - 3} ${y + 15} h54 l-3 -15 h-48z" fill="url(#${f})"/><path d="M${x + 48} ${y} l10 -9 l2 14 l-11 10z" fill="url(#${s})"/>`;
const ingotDefs = (t: string, f: string, s: string) => `
  <linearGradient id="${t}" x1="0" x2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d7dde7"/></linearGradient>
  <linearGradient id="${f}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c5ccd8"/><stop offset="1" stop-color="#959eae"/></linearGradient>
  <linearGradient id="${s}"><stop offset="0" stop-color="#a7afbd"/><stop offset="1" stop-color="#7d8697"/></linearGradient>`;

const HERO_ART: ((sn: boolean) => string)[] = [
  // 월: 고로와 코크스
  (sn) => { const a = id(), b = id(); return `<svg viewBox="0 0 360 220" preserveAspectRatio="xMaxYMax meet"><defs>
    <linearGradient id="${a}" x1="0" x2="1"><stop offset="0" stop-color="#f5f8fe"/><stop offset="1" stop-color="#b3c1e2"/></linearGradient>
    <radialGradient id="${b}"><stop offset="0" stop-color="#fff4b8"/><stop offset=".45" stop-color="#ffb04a"/><stop offset="1" stop-color="#ff6a2b" stop-opacity="0"/></radialGradient></defs>
    ${sn ? snow(26, 360, 220, 7) : ''}
    <ellipse cx="262" cy="208" rx="100" ry="9" fill="#000" opacity=".16"/>
    <path d="M232 42 C262 26 300 36 304 72" stroke="#e3e9f6" stroke-width="9" fill="none" stroke-linecap="round"/>
    <rect x="290" y="70" width="30" height="138" rx="15" fill="url(#${a})"/><rect x="323" y="86" width="26" height="122" rx="13" fill="url(#${a})" opacity=".85"/>
    <rect x="294" y="110" width="22" height="4" rx="2" fill="#9fb0d6"/><rect x="327" y="124" width="18" height="4" rx="2" fill="#9fb0d6"/>
    <rect x="214" y="22" width="20" height="38" rx="4" fill="#e9eef9"/><rect x="210" y="18" width="28" height="7" rx="3" fill="#c8d3ec"/>
    <path d="M196 58 H252 L270 198 H178 Z" fill="url(#${a})"/>
    <path d="M192 92 H256 L257 99 H191 Z" fill="#9fb0d6"/><path d="M186 138 H262 L263 145 H185 Z" fill="#9fb0d6"/>
    <circle cx="224" cy="182" r="28" fill="url(#${b})"/><circle cx="224" cy="182" r="6" fill="#fff6c9"/>
    <path d="M219 186 Q200 190 186 196" stroke="#ff8a3d" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M150 178 h46 l-6 28 h-34 z" fill="#4f5565"/><ellipse cx="173" cy="178" rx="23" ry="5" fill="#ff9a3d"/>
    <g fill="#2a2d35"><path d="M282 206 l8 -12 l12 2 l4 10z"/><path d="M300 206 l6 -16 l14 3 l3 13z"/><path d="M318 207 l9 -11 l12 4 l1 7z"/><path d="M292 196 l7 -9 l9 3 l-2 8z" fill="#3a3e48"/><path d="M309 192 l8 -8 l9 4 l-3 8z" fill="#3a3e48"/></g>
  </svg>`; },
  // 화: 알루미늄 잉곳 더미와 용탕
  (sn) => { const t = id(), f = id(), s = id(), g = id(); return `<svg viewBox="0 0 360 220" preserveAspectRatio="xMaxYMax meet"><defs>${ingotDefs(t, f, s)}
    <radialGradient id="${g}"><stop offset="0" stop-color="#fff8d6"/><stop offset=".5" stop-color="#ffc66b"/><stop offset="1" stop-color="#ff8a3d" stop-opacity="0"/></radialGradient></defs>
    ${sn ? snow(22, 360, 220, 11) : ''}
    <ellipse cx="262" cy="208" rx="104" ry="9" fill="#000" opacity=".16"/>
    <path d="M168 62 l40 -10 l8 16 l-40 12z" fill="#5d6270"/><path d="M212 66 Q226 96 222 130" stroke="#ffd27a" stroke-width="6" fill="none" stroke-linecap="round"/>
    <circle cx="222" cy="136" r="22" fill="url(#${g})"/>
    ${ingot(186, 196, t, f, s)}${ingot(244, 196, t, f, s)}${ingot(302, 196, t, f, s)}
    ${ingot(215, 172, t, f, s)}${ingot(273, 172, t, f, s)}${ingot(244, 148, t, f, s)}${ingot(302, 148, t, f, s)}
    <path d="M260 156 l10 -4 M318 156 l10 -4" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".8"/>
  </svg>`; },
  // 수: 크레인과 철근 다발
  (sn) => { const a = id(); return `<svg viewBox="0 0 360 220" preserveAspectRatio="xMaxYMax meet"><defs>
    <linearGradient id="${a}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e08a55"/><stop offset="1" stop-color="#9c4d27"/></linearGradient></defs>
    ${sn ? snow(30, 360, 220, 13) : ''}
    <g stroke="#fff" stroke-opacity=".35" stroke-width="2" fill="none"><rect x="252" y="96" width="96" height="112"/><path d="M252 134 H348 M252 172 H348 M284 96 V208 M316 96 V208"/></g>
    <rect x="300" y="28" width="13" height="180" fill="#ffc94a"/>
    <path d="M300 40 L313 56 L300 72 L313 88 L300 104 L313 120 L300 136 L313 152 L300 168 L313 184 L300 200" stroke="#d99a1c" stroke-width="2" fill="none"/>
    <rect x="176" y="30" width="176" height="9" fill="#ffc94a"/><rect x="330" y="39" width="20" height="16" fill="#5d6270"/>
    <path d="M306 16 L306 30 M306 16 L190 30 M306 16 L345 30" stroke="#ffc94a" stroke-width="2"/>
    <rect x="208" y="39" width="16" height="8" rx="2" fill="#5d6270"/>
    <line x1="216" y1="47" x2="216" y2="96" stroke="#2a2d35" stroke-width="1.6"/>
    <path d="M216 96 L190 110 M216 96 L246 110" stroke="#2a2d35" stroke-width="1.6"/>
    <g>${[0, 1, 2, 3, 4, 5].map(i => `<rect x="${160 + (i % 2) * 4}" y="${110 + i * 4.2}" width="116" height="4.6" rx="2.3" fill="url(#${a})"/>`).join('')}
    <rect x="186" y="108" width="6" height="30" rx="1" fill="#2f3340"/><rect x="242" y="108" width="6" height="30" rx="1" fill="#2f3340"/></g>
    <ellipse cx="270" cy="210" rx="96" ry="8" fill="#000" opacity=".14"/>
    <path d="M160 214 Q220 196 360 206 V220 H160 Z" fill="#fff" opacity="${sn ? '.85' : '.25'}"/>
  </svg>`; },
  // 목: 열연 코일
  (sn) => { const a = id(), b = id(); return `<svg viewBox="0 0 360 220" preserveAspectRatio="xMaxYMax meet"><defs>
    <radialGradient id="${a}" cx=".4" cy=".35"><stop offset="0" stop-color="#eef1f6"/><stop offset=".7" stop-color="#a8b1c0"/><stop offset="1" stop-color="#7c8596"/></radialGradient>
    <linearGradient id="${b}" x1="0" x2="1"><stop offset="0" stop-color="#8d96a6"/><stop offset="1" stop-color="#c9cfd9"/></linearGradient></defs>
    ${sn ? snow(24, 360, 220, 21) : ''}
    <ellipse cx="260" cy="206" rx="104" ry="10" fill="#000" opacity=".18"/>
    <rect x="168" y="128" width="40" height="76" fill="url(#${b})"/><circle cx="208" cy="166" r="38" fill="url(#${a})"/>
    ${[30, 22, 14].map(r => `<circle cx="208" cy="166" r="${r}" fill="none" stroke="#8b94a5" stroke-width="1"/>`).join('')}<circle cx="208" cy="166" r="10" fill="#3a3f4b"/>
    <rect x="246" y="82" width="54" height="124" fill="url(#${b})"/><circle cx="300" cy="144" r="62" fill="url(#${a})"/>
    ${[52, 43, 34, 25].map(r => `<circle cx="300" cy="144" r="${r}" fill="none" stroke="#8b94a5" stroke-width="1.1"/>`).join('')}<circle cx="300" cy="144" r="16" fill="#3a3f4b"/>
  </svg>`; },
  // 금: 원료를 실은 벌크선
  (sn) => `<svg viewBox="0 0 360 220" preserveAspectRatio="xMaxYMax meet">
    ${sn ? snow(20, 360, 220, 31) : ''}
    <path d="M150 196 Q190 188 230 196 T310 196 T390 196 V220 H150Z" fill="#fff" opacity=".18"/>
    <path d="M160 160 H352 L334 196 H178 Z" fill="#e9eef6"/><path d="M160 160 H352 L349 168 H163 Z" fill="#d6453d" opacity=".85"/>
    <rect x="312" y="112" width="34" height="48" rx="3" fill="#f5f7fb"/><rect x="318" y="120" width="22" height="6" rx="2" fill="#7d91aa"/><rect x="326" y="96" width="8" height="18" fill="#3a3f4b"/>
    <path d="M176 160 q18 -26 36 0z M216 160 q18 -30 36 0z M256 160 q18 -26 36 0z" fill="#3a3e48"/>
    <path d="M186 150 l6 -4 M228 146 l7 -4 M268 150 l6 -4" stroke="#8a8f98" stroke-width="2" stroke-linecap="round"/>
    <line x1="214" y1="100" x2="214" y2="160" stroke="#f5f7fb" stroke-width="3"/><line x1="214" y1="104" x2="250" y2="134" stroke="#f5f7fb" stroke-width="2"/>
    <line x1="290" y1="104" x2="290" y2="160" stroke="#f5f7fb" stroke-width="3"/><line x1="290" y1="108" x2="258" y2="134" stroke="#f5f7fb" stroke-width="2"/>
    <ellipse cx="256" cy="200" rx="104" ry="5" fill="#000" opacity=".12"/>
  </svg>`,
];

// 월~금은 요일 순서로, 주말은 날짜로 돌린다
export function heroArt(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const wd = d.getUTCDay();
  const i = wd >= 1 && wd <= 5 ? wd - 1 : Math.floor(d.getTime() / 86400000) % 5;
  const m = d.getUTCMonth();
  return { bg: HERO_BG[i], svg: HERO_ART[i](m === 11 || m <= 1) };
}

// 세계 동향 탭 배너 — 원료를 실은 벌크선
export const worldArt = () => ({ bg: HERO_BG[4], svg: HERO_ART[4](false) });

// ─── 품목 띠 그림 ────────────────────────────────────────────────────────────
export const BAND_COLOR: Record<string, string> = { ferro: '#6e5d52', al1: '#6f84a0', al2: '#3f8a9c', recarb: '#45474f', steel: '#3d5d85' };

const BAND_ART: Record<string, () => string> = {
  ferro: () => { const a = id(); const lump = (pts: string) => `<path d="${pts}" fill="url(#${a})" stroke="#5c6270" stroke-width=".8"/>`; return `<svg viewBox="0 0 220 150" preserveAspectRatio="xMaxYMid meet"><defs>
    <linearGradient id="${a}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f1f3f7"/><stop offset=".55" stop-color="#b4bac6"/><stop offset="1" stop-color="#7e8594"/></linearGradient></defs>
    <ellipse cx="130" cy="132" rx="80" ry="8" fill="#000" opacity=".18"/>
    ${lump('M70 128 l10 -26 l24 -6 l14 18 l-6 16z')}${lump('M108 130 l6 -30 l22 -10 l20 14 l-2 26z')}${lump('M150 130 l4 -22 l24 -8 l14 16 l-4 14z')}
    ${lump('M92 104 l12 -22 l22 2 l6 18 l-18 10z')}${lump('M134 98 l10 -20 l20 0 l8 16 l-14 12z')}${lump('M114 80 l12 -16 l18 4 l2 14 l-16 6z')}
    <path d="M118 88 l8 -6 M142 84 l6 -4 M84 112 l10 -6" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".8"/>
  </svg>`; },
  al1: () => { const t = id(), f = id(), s = id(); return `<svg viewBox="0 0 220 150" preserveAspectRatio="xMaxYMid meet"><defs>${ingotDefs(t, f, s)}</defs>
    <ellipse cx="130" cy="134" rx="86" ry="8" fill="#000" opacity=".18"/>
    ${ingot(56, 112, t, f, s)}${ingot(110, 112, t, f, s)}${ingot(164, 112, t, f, s)}${ingot(83, 88, t, f, s)}${ingot(137, 88, t, f, s)}${ingot(110, 64, t, f, s)}
  </svg>`; },
  al2: () => { const a = id(), b = id(); return `<svg viewBox="0 0 220 150" preserveAspectRatio="xMaxYMid meet"><defs>
    <radialGradient id="${a}" cx=".4" cy=".35"><stop offset="0" stop-color="#f4f6f9"/><stop offset="1" stop-color="#9aa3b2"/></radialGradient>
    <linearGradient id="${b}" x1="0" x2="1"><stop offset="0" stop-color="#e2e6ec"/><stop offset="1" stop-color="#9ca5b4"/></linearGradient></defs>
    <ellipse cx="140" cy="136" rx="78" ry="7" fill="#000" opacity=".18"/>
    <circle cx="150" cy="78" r="54" fill="url(#${a})" stroke="#7d8697" stroke-width="2"/><circle cx="150" cy="78" r="42" fill="#5f6878"/>
    ${[0, 72, 144, 216, 288].map(r => `<path d="M146 76 L142 40 Q150 34 158 40 L154 76z" fill="url(#${b})" transform="rotate(${r} 150 78)"/>`).join('')}
    <circle cx="150" cy="78" r="12" fill="url(#${b})" stroke="#7d8697"/><circle cx="150" cy="78" r="4" fill="#5f6878"/>
    <g transform="rotate(-18 78 118)"><path d="M62 104 h28 l-2 10 l4 6 l-3 14 h-26 l2 -12 l-4 -6z" fill="url(#${b})" stroke="#7d8697"/></g>
  </svg>`; },
  recarb: () => { const a = id(); let g = '', s = 5;
    const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 90; i++) { const x = 70 + rnd() * 110, top = 132 - 30 * Math.sin(((x - 70) / 110) * Math.PI); const y = top + rnd() * (134 - top); g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.6 + rnd() * 2).toFixed(1)}" fill="${rnd() > 0.7 ? '#5b5f6b' : '#1c1e24'}"/>`; }
    return `<svg viewBox="0 0 220 150" preserveAspectRatio="xMaxYMid meet"><defs>
    <linearGradient id="${a}" x1="0" x2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d8dbe2"/></linearGradient></defs>
    <ellipse cx="140" cy="136" rx="80" ry="7" fill="#000" opacity=".2"/>
    <path d="M128 30 h64 l6 98 h-76z" fill="url(#${a})"/><path d="M132 30 q6 -16 12 0 M176 30 q6 -16 12 0" stroke="#e8eaef" stroke-width="4" fill="none"/>
    <rect x="126" y="62" width="70" height="20" fill="#2f3441" opacity=".85"/><rect x="134" y="69" width="40" height="5" rx="2" fill="#fff" opacity=".8"/>
    ${g}
  </svg>`; },
  steel: () => { const a = id(); let rods = '';
    [[0, 0], [1, 0], [2, 0], [3, 0], [0.5, 1], [1.5, 1], [2.5, 1], [1, 2], [2, 2]].forEach(([c, r]) => { const x = 104 + c * 26, y = 116 - r * 23; rods += `<circle cx="${x}" cy="${y}" r="12" fill="url(#${a})" stroke="#6b3418" stroke-width="1.2"/><circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#6b3418" stroke-width=".8" opacity=".6"/>`; });
    return `<svg viewBox="0 0 220 150" preserveAspectRatio="xMaxYMid meet"><defs>
    <radialGradient id="${a}" cx=".35" cy=".35"><stop offset="0" stop-color="#f0a46e"/><stop offset="1" stop-color="#a24f25"/></radialGradient></defs>
    <ellipse cx="146" cy="134" rx="72" ry="7" fill="#000" opacity=".2"/>
    ${rods}<path d="M90 120 Q140 136 196 120" stroke="#2a2d35" stroke-width="4" fill="none"/>
  </svg>`; },
};
export const bandArt = (market: string) => (BAND_ART[market] ?? BAND_ART.steel)();

// ─── 세계 동향 썸네일: 분야별 여러 장, 같은 분야가 이어지면 다음 그림 ─────────────
const ground = (c: string) => `<rect x="0" y="78" width="160" height="12" fill="${c}" opacity=".3"/>`;
const THUMB: Record<string, ((c: string) => string)[]> = {
  demand: [
    c => `<rect x="104" y="14" width="6" height="64" fill="#e3a72c"/><rect x="58" y="16" width="80" height="5" fill="#e3a72c"/><line x1="72" y1="21" x2="72" y2="48" stroke="#333" stroke-width="1.2"/><rect x="58" y="48" width="30" height="4" rx="2" fill="#a24f25"/><rect x="58" y="53" width="30" height="4" rx="2" fill="#b65e30"/><g stroke="${c}" stroke-opacity=".5" fill="none"><rect x="118" y="40" width="30" height="38"/><path d="M118 53 H148 M118 66 H148 M133 40 V78"/></g>${ground(c)}`,
    c => `<path d="M34 64 h70 l8 -14 h-20 l-8 -10 h-34 l-10 12 h-6z" fill="${c}" opacity=".8"/><circle cx="52" cy="66" r="7" fill="#2a2d35"/><circle cx="92" cy="66" r="7" fill="#2a2d35"/><circle cx="52" cy="66" r="3" fill="#ccc"/><circle cx="92" cy="66" r="3" fill="#ccc"/><rect x="58" y="44" width="14" height="8" fill="#fff" opacity=".7"/><rect x="118" y="30" width="26" height="48" fill="${c}" opacity=".35"/><rect x="124" y="36" width="5" height="5" fill="#fff"/><rect x="133" y="36" width="5" height="5" fill="#fff"/><rect x="124" y="46" width="5" height="5" fill="#fff"/><rect x="133" y="46" width="5" height="5" fill="#fff"/>${ground(c)}`,
  ],
  supply: [
    c => `<path d="M40 78 V48 l18 -12 v12 l18 -12 v12 l18 -12 v42z" fill="${c}" opacity=".75"/><rect x="100" y="22" width="10" height="56" fill="${c}" opacity=".85"/><circle cx="105" cy="16" r="5" fill="${c}" opacity=".25"/><circle cx="112" cy="9" r="4" fill="${c}" opacity=".18"/>${ground(c)}`,
    c => `<path d="M60 26 h40 l8 52 h-56z" fill="${c}" opacity=".7"/><rect x="56" y="22" width="48" height="6" fill="${c}"/><circle cx="80" cy="64" r="9" fill="#ffb04a"/><circle cx="80" cy="64" r="4" fill="#fff4b8"/><path d="M108 58 h22 l-4 18 h-14z" fill="#4f5565"/><ellipse cx="119" cy="58" rx="11" ry="3" fill="#ff9a3d"/>${ground(c)}`,
    c => `<path d="M24 78 L60 40 L84 58 L104 34 L140 78z" fill="${c}" opacity=".45"/><path d="M92 78 v-14 h18 l8 8 v6z" fill="#e3a72c"/><path d="M108 64 l12 -16 l10 4" stroke="#e3a72c" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M126 48 l10 2 l-2 8 l-10 -2z" fill="#e3a72c"/><circle cx="98" cy="78" r="4" fill="#2a2d35"/><circle cx="112" cy="78" r="4" fill="#2a2d35"/>${ground(c)}`,
  ],
  policy: [
    c => `<rect x="52" y="14" width="46" height="60" rx="3" fill="#fff" stroke="${c}" stroke-opacity=".5"/><path d="M60 26 h30 M60 34 h30 M60 42 h22 M60 50 h28" stroke="${c}" stroke-opacity=".6" stroke-width="2.4" stroke-linecap="round"/><circle cx="102" cy="62" r="13" fill="none" stroke="#d6453d" stroke-width="3"/><path d="M96 62 h12" stroke="#d6453d" stroke-width="3"/>${ground(c)}`,
  ],
  logistics: [
    c => `<path d="M30 60 H130 L120 76 H40 Z" fill="${c}" opacity=".8"/><rect x="46" y="44" width="18" height="16" fill="#d6453d" opacity=".8"/><rect x="66" y="44" width="18" height="16" fill="#e3a72c"/><rect x="86" y="44" width="18" height="16" fill="${c}" opacity=".5"/><rect x="56" y="30" width="18" height="14" fill="${c}" opacity=".6"/><rect x="108" y="38" width="12" height="22" fill="#fff" opacity=".8"/>${ground(c)}`,
  ],
  other: [
    c => `<circle cx="80" cy="44" r="28" fill="${c}" opacity=".25"/><circle cx="80" cy="44" r="28" fill="none" stroke="${c}" stroke-width="2"/><path d="M52 44 h56 M80 16 c-14 16 -14 40 0 56 M80 16 c14 16 14 40 0 56" stroke="${c}" stroke-width="1.6" fill="none"/>${ground(c)}`,
  ],
};
export function thumbArt(category: string, color: string, nth: number) {
  const set = THUMB[category] ?? THUMB.other;
  return `<svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice"><rect width="160" height="90" fill="${color}" opacity=".14"/>${set[nth % set.length](color)}</svg>`;
}

export const SIGNAL_ICON: Record<string, string> = {
  steel: '<svg width="34" height="34" viewBox="0 0 34 34"><path d="M4 30 V16 l7 -5 v5 l7 -5 v5 l7 -5 v19z" fill="#3d5d85"/><rect x="26" y="6" width="4" height="24" fill="#3d5d85"/></svg>',
  alu: '<svg width="34" height="34" viewBox="0 0 34 34"><path d="M5 14 L17 6 L29 14 V30 H5z" fill="#7d91aa"/><rect x="10" y="20" width="14" height="4" fill="#fff"/><rect x="10" y="25" width="14" height="4" fill="#fff"/></svg>',
  demand: '<svg width="34" height="34" viewBox="0 0 34 34"><path d="M4 16 L17 5 L30 16" stroke="#c46a3c" stroke-width="3" fill="none"/><rect x="8" y="15" width="18" height="15" fill="#e0a07a"/><rect x="15" y="21" width="5" height="9" fill="#fff"/></svg>',
  freight: '<svg width="34" height="34" viewBox="0 0 34 34"><path d="M3 20 H31 L27 28 H7 Z" fill="#3f8a9c"/><rect x="8" y="12" width="7" height="8" fill="#d6453d"/><rect x="16" y="12" width="7" height="8" fill="#e3a72c"/></svg>',
};
