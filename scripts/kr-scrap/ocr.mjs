// scripts/kr-scrap/ocr.mjs — 국내 알루미늄 스크랩 고시 이미지 판독 → 보관 API 전송
// 사용: node ocr.mjs [이미지경로]   (판독 결과만 출력, 경로 생략 시 게시글에서 받음)
//       node ocr.mjs --post          (ARCHIVE_URL·CRON_SECRET 환경변수로 전송)
// 표의 행은 노란 '주간 단가' 칸을 세로로 훑어 찾고(양식·해상도가 바뀌어도 따라감),
// 표 밖 숫자(기준 LME·환율·적용기간)는 원본 917px 기준 좌표를 이미지 폭에 맞춰 늘려 읽는다.
// 품목 수·값 범위 판정은 서버(api/_lib/kr-scrap.js)가 한다.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createWorker, PSM } from 'tesseract.js';
import { PNG } from 'pngjs';

const BOARD_URL = 'https://wsmetal.co.kr/bbs/board.php?bo_table=gallery&wr_id=2';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

// 원본(917x1690, 2026-10-08~ 양식) 기준 좌표. base_* 는 '기준가' 빨간 칸 윗변 기준 상대 y.
const DESIGN_W = 917;
const RECT = {
  period_end: { left: 690, top: 88, width: 135, height: 44 },
  base_lme: { left: 170, dy: 4, width: 265, height: 52 },
  base_fx: { left: 590, dy: 4, width: 265, height: 52 },
  base_lme_date: { left: 26, dy: 29, width: 130, height: 30 },
  base_fx_date: { left: 447, dy: 29, width: 132, height: 30 },
};

// 게시판은 본문에 썸네일(thumb-…_WxH)을 걸어 둔다. 썸네일은 1MB가 넘어 Firestore 문서 한도를 넘기므로 원본을 우선 받는다.
async function fetchImage() {
  const html = await (await fetch(BOARD_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })).text();
  const m = html.match(/https:\/\/wsmetal\.co\.kr\/data\/editor\/[^"']+\.(?:png|jpe?g)/i);
  if (!m) throw new Error('게시글에서 고시 이미지를 찾지 못함');
  const original = m[0].replace(/\/thumb-([^/]+?)_\d+x\d+(\.\w+)$/, '/$1$2');
  for (const url of new Set([original, m[0]])) {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: BOARD_URL }, signal: AbortSignal.timeout(20000) });
    if (r.ok) return { url, buf: Buffer.from(await r.arrayBuffer()) };
  }
  throw new Error(`이미지 다운로드 실패 ${m[0]}`);
}

const pixel = (png, x, y) => { const i = (png.width * y + x) << 2; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
const isYellow = ([r, g, b]) => r > 248 && g > 236 && g < 252 && b > 190 && b < 220;
const isBlue = ([r, , b]) => b > 150 && r < 120;
const isRed = ([r, g, b]) => r > 150 && g < 100 && b < 100;

// '주간 단가' 노란 칸: 가로 위치와 행별 세로 구간
function findPriceColumn(png) {
  const y0 = Math.round(png.height * 0.19);
  let left = -1, right = -1;
  for (let x = 0; x < png.width / 2; x++) if (isYellow(pixel(png, x, y0))) { if (left < 0) left = x; right = x; }
  if (left < 0) return null;
  const cx = left + 3, rows = [];
  let start = null;
  for (let y = 0; y < png.height; y++) {
    const on = isYellow(pixel(png, cx, y));
    if (on && start === null) start = y;
    if (!on && start !== null) { if (y - start > png.height / 200) rows.push({ top: start, height: y - start }); start = null; }
  }
  return { left, right, rows };
}

// '전주 대비' 칸: 노란 칸 오른쪽 경계선까지. 첫 색 글자 덩어리가 화살표(파랑=하락, 빨강=상승), 그 뒤가 숫자.
function readChangeCell(png, col, row) {
  // 경계선 = 행 위·가운데·아래가 모두 무채색 어두운 세로줄 (글자 가장자리의 서브픽셀 색 번짐과 구분)
  const isLine = (x) => [row.top + 3, row.top + (row.height >> 1), row.top + row.height - 4].every(y => {
    const [r, g, b] = pixel(png, x, y);
    return r < 180 && Math.abs(r - g) < 12 && Math.abs(g - b) < 12;
  });
  let cellRight = col.right + 2;
  while (cellRight < png.width - 1 && !isLine(cellRight)) cellRight++;
  const colored = [];
  for (let x = col.right + 2; x < cellRight; x++) {
    let blue = 0, red = 0;
    for (let y = row.top + 2; y < row.top + row.height - 2; y++) { const p = pixel(png, x, y); if (isBlue(p)) blue++; else if (isRed(p)) red++; }
    colored.push({ x, blue, red });
  }
  const segs = [];
  for (const c of colored) {
    if (!c.blue && !c.red) continue;
    const last = segs.at(-1);
    if (last && c.x - last.end <= 2) { last.end = c.x; last.blue += c.blue; last.red += c.red; } else segs.push({ start: c.x, end: c.x, blue: c.blue, red: c.red });
  }
  if (segs.length < 2) return { rect: null, sign: 0 };
  const arrow = segs[0];
  const sign = arrow.blue > 10 && arrow.red === 0 ? -1 : arrow.red > 10 && arrow.blue === 0 ? 1 : 0;
  const left = segs[1].start - 3;
  return { rect: { left, top: row.top, width: cellRight - left - 1, height: row.height }, sign };
}

// '기준가' 빨간 칸 윗변: 표 아래에서 칸 폭 전체가 빨간 첫 줄 (LME 그래프 선과 구분)
function findBaseBoxTop(png, below, scale) {
  const xs = [30, 60, 90, 120, 150].map(x => Math.round(x * scale));
  for (let y = below; y < png.height; y++) if (xs.every(x => isRed(pixel(png, x, y)))) return y;
  return null;
}

// 칸을 잘라 글자만 검게(배경과 밝기 차이가 큰 픽셀) 3배 확대 — 색 글자·어두운 칸의 흰 글자도 같은 조건으로 읽힌다
const ZOOM = 3, PAD = 12;
function inkCrop(png, rect) {
  const lum = (x, y) => { const [r, g, b] = pixel(png, x, y); return 0.299 * r + 0.587 * g + 0.114 * b; };
  const vals = [];
  for (let y = rect.top; y < rect.top + rect.height; y++) for (let x = rect.left; x < rect.left + rect.width; x++) vals.push(lum(x, y));
  const bg = [...vals].sort((a, b) => a - b)[vals.length >> 1];
  const ink = (x, y) => Math.abs(vals[y * rect.width + x] - bg) > 70;
  // 칸 테두리(세로 막대)는 지운다 — 이미지 폭이 917→920px로 바뀌자 기준가·날짜 칸 왼쪽에 테두리가 들어와
  // "1,324.60"이 "1.32460", "(10/23금)"이 "00/233"으로 읽혔다(2026-10-16·23 고시). 글자 획은 칸 높이의 80%를 채우지 않는다
  const border = new Set();
  for (let x = 0; x < rect.width; x++) {
    let n = 0;
    for (let y = 0; y < rect.height; y++) if (ink(x, y)) n++;
    if (n >= rect.height * 0.8) border.add(x);
  }
  const out = new PNG({ width: rect.width * ZOOM + PAD * 2, height: rect.height * ZOOM + PAD * 2 });
  out.data.fill(255);
  for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) {
    if (!ink(x, y) || border.has(x)) continue;
    for (let dy = 0; dy < ZOOM; dy++) for (let dx = 0; dx < ZOOM; dx++) {
      const i = (out.width * (PAD + y * ZOOM + dy) + PAD + x * ZOOM + dx) << 2;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = 0;
    }
  }
  return PNG.sync.write(out);
}

async function readImage(buf) {
  const png = PNG.sync.read(buf);
  const raw = { width: png.width, height: png.height, prices: [], changes: [] };
  const col = findPriceColumn(png);
  if (!col?.rows.length) return raw;   // 판독 없이 서버에 넘겨 실패로 기록되게 한다
  const scale = png.width / DESIGN_W;
  const sc = (r, top) => ({ left: Math.round(r.left * scale), top, width: Math.round(r.width * scale), height: Math.round(r.height * scale) });
  const tableBottom = col.rows.at(-1).top + col.rows.at(-1).height;
  const baseTop = findBaseBoxTop(png, tableBottom, scale);

  const worker = await createWorker('eng');
  const read = async (rect, whitelist) => {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: whitelist });
    return (await worker.recognize(inkCrop(png, rect))).data.text.trim();
  };
  try {
    for (const row of col.rows) {
      raw.prices.push(await read({ left: col.left + 2, top: row.top, width: col.right - col.left - 3, height: row.height }, '0123456789,'));
      const ch = readChangeCell(png, col, row);
      raw.changes.push(ch.rect ? { digits: await read(ch.rect, '0123456789,'), sign: ch.sign } : { digits: '', sign: 0 });
    }
    raw.period_end = await read(sc(RECT.period_end, Math.round(RECT.period_end.top * scale)), '0123456789/~');
    if (baseTop !== null) {
      for (const [k, wl] of [['base_lme', '0123456789,.'], ['base_fx', '0123456789,.'], ['base_lme_date', '0123456789/()'], ['base_fx_date', '0123456789/()']]) {
        raw[k] = await read(sc(RECT[k], baseTop + Math.round(RECT[k].dy * scale)), wl);
      }
    }
  } finally {
    await worker.terminate();
  }
  return raw;
}

const localPath = process.argv.slice(2).find(a => !a.startsWith('--'));
const { url, buf } = localPath ? { url: localPath, buf: readFileSync(localPath) } : await fetchImage();
const sha = createHash('sha256').update(buf).digest('hex');
const raw = await readImage(buf);
console.log(JSON.stringify({ source_url: url, image_sha256: sha, image_bytes: buf.length, raw }, null, 2));

if (process.argv.includes('--post')) {
  const { ARCHIVE_URL, CRON_SECRET } = process.env;
  if (!ARCHIVE_URL || !CRON_SECRET) throw new Error('ARCHIVE_URL·CRON_SECRET 필요');
  const r = await fetch(ARCHIVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRON_SECRET}` },
    body: JSON.stringify({ raw, image_b64: buf.toString('base64'), image_sha256: sha, source_url: url }),
    signal: AbortSignal.timeout(60000),
  });
  const body = await r.text();
  console.log(`보관 API ${r.status}: ${body}`);
  if (!r.ok) process.exit(1);
}
