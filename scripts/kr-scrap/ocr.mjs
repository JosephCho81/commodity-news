// scripts/kr-scrap/ocr.mjs — 국내 알루미늄 스크랩 고시 이미지 판독 → 보관 API 전송
// 사용: node ocr.mjs            (판독 결과만 출력)
//       node ocr.mjs --post     (ARCHIVE_URL·CRON_SECRET 환경변수로 전송)
// 고시 이미지는 고정 레이아웃이라 칸 좌표로 잘라 숫자만 읽는다. 판정은 서버(api/_lib/kr-scrap.js)가 한다.

import { createHash } from 'node:crypto';
import { createWorker, PSM } from 'tesseract.js';
import { PNG } from 'pngjs';

const BOARD_URL = 'https://wsmetal.co.kr/bbs/board.php?bo_table=gallery&wr_id=2';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

const ROWS = 12, ROW_TOP = 288, ROW_H = 27.1;
const PRICE_X = 252, PRICE_W = 110;
const CHANGE_X = 410, CHANGE_W = 60, ARROW_X = [395, 420];
const RECT = {
  base_lme: { left: 140, top: 1022, width: 215, height: 55 },
  base_fx: { left: 485, top: 1022, width: 225, height: 55 },
  base_lme_date: { left: 20, top: 1048, width: 112, height: 30 },
  base_fx_date: { left: 368, top: 1048, width: 112, height: 30 },
  period_end: { left: 560, top: 100, width: 150, height: 36 },
};

async function fetchImage() {
  const html = await (await fetch(BOARD_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })).text();
  const m = html.match(/https:\/\/wsmetal\.co\.kr\/data\/editor\/[^"']+\.(?:png|jpe?g)/i);
  if (!m) throw new Error('게시글에서 고시 이미지를 찾지 못함');
  const r = await fetch(m[0], { headers: { 'User-Agent': UA, Referer: BOARD_URL }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`이미지 다운로드 실패 HTTP ${r.status}`);
  return { url: m[0], buf: Buffer.from(await r.arrayBuffer()) };
}

// 전주 대비 화살표 색: 파랑=하락, 빨강=상승
function arrowSign(png, top) {
  let red = 0, blue = 0;
  for (let y = top + 4; y < top + 21; y++) {
    for (let x = ARROW_X[0]; x < ARROW_X[1]; x++) {
      const i = (png.width * y + x) << 2;
      const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]];
      if (b > 150 && r < 120) blue++;
      if (r > 150 && g < 100 && b < 100) red++;
    }
  }
  if (blue > 10 && red === 0) return -1;
  if (red > 10 && blue === 0) return 1;
  return 0;
}

async function readImage(buf) {
  const png = PNG.sync.read(buf);
  const raw = { width: png.width, height: png.height, prices: [], changes: [] };
  // 레이아웃이 다르면 좌표가 무의미 — 판독 없이 서버에 넘겨 실패로 기록되게 한다
  if (png.width !== 731 || png.height !== 1332) return raw;

  const worker = await createWorker('eng');
  const read = async (rect, whitelist) => {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: whitelist });
    return (await worker.recognize(buf, { rectangle: rect })).data.text.trim();
  };
  try {
    for (let i = 0; i < ROWS; i++) {
      const top = Math.round(ROW_TOP + i * ROW_H);
      raw.prices.push(await read({ left: PRICE_X, top, width: PRICE_W, height: 25 }, '0123456789,'));
      const digits = await read({ left: CHANGE_X, top, width: CHANGE_W, height: 25 }, '0123456789,');
      raw.changes.push({ digits, sign: digits ? arrowSign(png, top) : 0 });
    }
    raw.base_lme = await read(RECT.base_lme, '0123456789,.');
    raw.base_fx = await read(RECT.base_fx, '0123456789,.');
    raw.base_lme_date = await read(RECT.base_lme_date, '0123456789/');
    raw.base_fx_date = await read(RECT.base_fx_date, '0123456789/');
    raw.period_end = await read(RECT.period_end, '0123456789/~');
  } finally {
    await worker.terminate();
  }
  return raw;
}

const { url, buf } = await fetchImage();
const sha = createHash('sha256').update(buf).digest('hex');
const raw = await readImage(buf);
console.log(JSON.stringify({ source_url: url, image_sha256: sha, raw }, null, 2));

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
