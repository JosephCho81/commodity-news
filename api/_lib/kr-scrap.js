// api/_lib/kr-scrap.js — 국내 알루미늄 스크랩 주간 고시 검증 (순수 함수, 의존성 없음)
// OCR은 GitHub Actions(scripts/kr-scrap)에서 하고, 저장 전 판정은 여기 한 곳에서만 한다.

export const KR_SCRAP_ITEMS = [
  ['기계철', '신재'], ['기계철', 'A'], ['기계철', 'B'], ['기계철', 'C'],
  ['SAS', 'A'], ['SAS', 'B'],
  ['CHIP', '12S'], ['CHIP', '60'],
  ['노베압축', '-'], ['작업 휠', '-'], ['프로파일', '-'], ['드로스', '-'],
];

// 고시 이미지 고정 레이아웃 — 크기가 바뀌면 칸 좌표를 믿을 수 없다
export const KR_SCRAP_LAYOUT = { width: 731, height: 1332 };

const STEP = 50;

// "10/02" → "2026-10-02". 연말 고시를 연초에 읽는 경우 전년도로 본다.
export function resolveMonthDay(mmdd, now = new Date()) {
  const m = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(String(mmdd ?? ''));
  if (!m) return null;
  const month = Number(m[1]), day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const nowKst = new Date(now.getTime() + 9 * 3600000);
  let year = nowKst.getUTCFullYear();
  if (month > nowKst.getUTCMonth() + 2) year -= 1;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1) return null;
  return d.toISOString().slice(0, 10);
}

// OCR 숫자 문자열 → 정수/실수. "3,750" → 3750, "1,359.60" → 1359.6
export function toNum(s) {
  const t = String(s ?? '').replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

// raw: OCR 원본 { width, height, prices[], changes[{digits, sign}], base_lme, base_lme_date, base_fx, base_fx_date, period_end }
// prev: 직전 저장 레코드(record 형식) 또는 null
// 반환: { record, issues[], fatal }
export function buildRecord(raw, prev = null, now = new Date()) {
  const issues = [];
  let fatal = false;
  const flag = (msg, isFatal = false) => { issues.push(msg); if (isFatal) fatal = true; };

  if (raw?.width !== KR_SCRAP_LAYOUT.width || raw?.height !== KR_SCRAP_LAYOUT.height) {
    flag(`이미지 크기 변경 ${raw?.width}x${raw?.height}`, true);
  }

  const prices = (raw?.prices ?? []).map(toNum);
  if (prices.length !== KR_SCRAP_ITEMS.length) flag(`단가 개수 ${prices.length}`, true);

  const baseLme = toNum(raw?.base_lme);
  const baseFx = toNum(raw?.base_fx);
  if (!(baseLme >= 1500 && baseLme <= 4500)) flag(`기준 LME 범위 밖 ${raw?.base_lme}`, true);
  if (!(baseFx >= 1000 && baseFx <= 1900)) flag(`기준환율 범위 밖 ${raw?.base_fx}`, true);

  const baseDate = resolveMonthDay(raw?.base_fx_date, now);
  const lmeDate = resolveMonthDay(raw?.base_lme_date, now);
  const periodEnd = resolveMonthDay(raw?.period_end, now);
  if (!baseDate) flag(`기준일 판독 실패 ${raw?.base_fx_date}`, true);
  if (!lmeDate) flag(`LME 기준일 판독 실패 ${raw?.base_lme_date}`);
  if (!periodEnd) flag(`적용기간 판독 실패 ${raw?.period_end}`);

  const krwLme = baseLme && baseFx ? baseLme * baseFx / 1000 : null;
  const items = KR_SCRAP_ITEMS.map(([item, grade], i) => {
    const price = prices[i] ?? null;
    if (price === null || !Number.isInteger(price) || price % STEP !== 0 || price < 500 || price > 10000) {
      flag(`${item} ${grade} 단가 이상 ${raw?.prices?.[i]}`, true);
    } else if (krwLme && (price / krwLme < 0.2 || price / krwLme > 1.3)) {
      flag(`${item} ${grade} LME 대비 비율 이상 ${(price / krwLme).toFixed(2)}`, true);
    }
    const ch = raw?.changes?.[i] ?? {};
    const digits = toNum(ch.digits);
    let change = 0;
    if (digits !== null && digits > 0) {
      if (digits % STEP !== 0) flag(`${item} ${grade} 전주 대비 ${ch.digits} 50원 단위 아님`, true);
      if (ch.sign !== 1 && ch.sign !== -1) flag(`${item} ${grade} 전주 대비 방향 판독 실패`, true);
      change = digits * (ch.sign === 1 ? 1 : -1);
    }
    return { item, grade, price, change };
  });

  // 직전 주 기록과 대조: 이번 주 단가 - 전주 대비 = 지난주 단가 (같은 주 재게시는 대조 생략)
  if (prev?.items && prev.base_date && baseDate && prev.base_date < baseDate) {
    items.forEach((it, i) => {
      const p = prev.items[i]?.price;
      if (Number.isFinite(p) && it.price !== null && it.price - it.change !== p) {
        flag(`${it.item} ${it.grade} 지난주 대조 불일치 (지난주 ${p}, 이번 주 ${it.price}, 대비 ${it.change})`);
      }
    });
  }

  const record = {
    base_date: baseDate,
    period_end: periodEnd,
    base_lme: baseLme,
    base_lme_date: lmeDate,
    base_fx: baseFx,
    base_fx_date: baseDate,
    items,
  };
  return { record, issues, fatal };
}
