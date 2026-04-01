// api/lib/uk-holidays.js — UK 공식 공휴일 API 기반 LME 휴장 감지
// 출처: https://www.gov.uk/bank-holidays.json (영국 정부 공식 API, 무료·키 불필요)
// 매년 자동 업데이트되므로 하드코딩 불필요

// 공휴일명 영→한 매핑
const HOLIDAY_NAME_KO = {
  "New Year's Day":          '신년',
  "New Year's Day (substitute)": '신년 대체공휴일',
  'Good Friday':             '성금요일',
  'Easter Monday':           '부활절 월요일',
  'Early May bank holiday':  '5월 조기 공휴일',
  'Spring bank holiday':     '봄 공휴일',
  'Summer bank holiday':     '하계 공휴일',
  'Christmas Day':           '크리스마스',
  'Christmas Day (substitute)': '크리스마스 대체공휴일',
  'Boxing Day':              '박싱데이',
  'Boxing Day (substitute)': '박싱데이 대체공휴일',
};

let _ukHolidayCache = null; // { date: title, ... }

async function fetchUkHolidays() {
  if (_ukHolidayCache) return _ukHolidayCache;
  try {
    const res = await fetch('https://www.gov.uk/bank-holidays.json', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`UK holiday API HTTP ${res.status}`);
    const data = await res.json();
    // england-and-wales 기준 (LME 소재지)
    const events = data['england-and-wales']?.events ?? [];
    _ukHolidayCache = {};
    for (const e of events) {
      _ukHolidayCache[e.date] = e.title; // { '2026-04-03': 'Good Friday', ... }
    }
    console.log(`[UKHoliday] ✅ ${Object.keys(_ukHolidayCache).length}개 공휴일 로드`);
    return _ukHolidayCache;
  } catch (e) {
    console.warn('[UKHoliday] API 실패, 빈 목록 사용:', e.message);
    return {};
  }
}

// parsedDate(마지막 LME 가격 날짜)와 오늘 사이 UK 공휴일 탐색
// 반환 형식: "영국 Easter Monday(부활절 월요일) 공휴일로 03/21 ~ 03/23 LME 휴장"
export async function getLmeHolidayNote(parsedDate) {
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (parsedDate === today) return null; // 오늘 날짜 데이터면 정상

  const holidays = await fetchUkHolidays();

  const holidayDates = [];
  const from = new Date(parsedDate + 'T00:00:00Z');
  const to   = new Date(today + 'T00:00:00Z');

  for (let d = new Date(from.getTime() + 86400000); d <= to; d = new Date(d.getTime() + 86400000)) {
    const key = d.toISOString().slice(0, 10);
    if (holidays[key]) holidayDates.push({ date: key, title: holidays[key] });
  }

  if (holidayDates.length === 0) return null;

  const fmt = (dateStr) => {
    const [, mm, dd] = dateStr.split('-');
    return `${mm}/${dd}`;
  };

  const startDate = holidayDates[0].date;
  const endDate   = holidayDates[holidayDates.length - 1].date;

  const uniqueTitles = [...new Set(holidayDates.map(h => h.title))];
  const titleStr = uniqueTitles.map(t => {
    const ko = HOLIDAY_NAME_KO[t];
    return ko ? `${t}(${ko})` : t;
  }).join(', ');

  const rangeStr = startDate === endDate ? fmt(startDate) : `${fmt(startDate)} ~ ${fmt(endDate)}`;

  return `영국 ${titleStr} 공휴일로 ${rangeStr} LME 휴장`;
}
