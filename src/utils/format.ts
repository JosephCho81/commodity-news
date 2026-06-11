export function formatNum(val: string | null | undefined) {
  if (!val) return null;
  const n = parseFloat(String(val).replace(/,/g, ''));
  if (isNaN(n)) return String(val);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 정수 천단위 콤마 — 숫자 변환 불가 시 원본 문자열, 빈 값은 '—' (구 FerroalloyTab fmtCny 통합)
export function formatInt(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '') return '—';
  const n = Number(String(val).replace(/,/g, ''));
  if (isNaN(n)) return String(val);
  return n.toLocaleString('en-US');
}

export function directionColor(d: string | null | undefined) {
  if (d === 'UP') return 'var(--up)';
  if (d === 'DOWN') return 'var(--down)';
  return 'var(--neutral)';
}

export function urgencyBadge(u: string | null | undefined) {
  if (!u) return '참고';
  const map: Record<string, string> = { HIGH: '고위험', MEDIUM: '주의', LOW: '참고' };
  return map[u.toUpperCase()] ?? u;
}

// LME 알루미늄 현실 범위: $1,500 ~ $4,500/톤
export function isValidLmePrice(val: string | null | undefined): boolean {
  if (!val) return false;
  const n = parseFloat(String(val).replace(/,/g, ''));
  if (isNaN(n)) return false;
  return n >= 1500 && n <= 4500;
}

export function hasText(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 4;
}

// 기준일(as_of)이 N일보다 오래됐는지 — 이월 가격의 범위 표시 강등 판단용
export function isOlderThanDays(dateStr: string | null | undefined, days: number): boolean {
  if (!dateStr) return false;
  const t = Date.parse(String(dateStr));
  if (isNaN(t)) return false;
  return Date.now() - t > days * 86400000;
}
