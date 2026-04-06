// api/_lib/tariff-rates.js — 합금철 중국 수출 관세율 (수동 관리)
// 변경 시 MOFCOM 공식 고시 확인 후 수정

export const FERRO_EXPORT_TARIFFS = {
  fesi: {
    pct:      25,
    misc_usd: 15,
    hs:       'HS 72022100, 72022900',
  },
  femn: {
    pct:      20,
    misc_usd: 15,
    hs:       'HS 72021100, 72021900',
  },
  simn: {
    pct:      20,
    misc_usd: 15,
    hs:       'HS 72023000',
  },
};
