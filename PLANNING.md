# commodity-news 현재 상태
> 최종 업데이트: 2026-04-06

세션 상세 기록 → `docs/` 폴더 참조

---

## 현재 서비스 구조

**배포**: Vercel Hobby (maxDuration 60s)
**캐시**: Firestore `commodity_cache/{tab}_{YYYY-MM-DD}` + `{tab}_latest`
**탭 5개**: steelmaker | aluminum | ferroalloy | recarburizer | summary

### 합금철 탭 (멀티콜)
- Step 1: fesi / femn / simn 병렬 호출 (Promise.allSettled)
- Step 2: ferroalloy-summary 순차 호출 (cross-product 요약)
- 총 토큰: ~7,500 (2,500 + 2,000 + 2,000 + 1,000)

### 나머지 탭 (단일 호출)
- steelmaker: 6,000 tokens
- aluminum: 3,000 tokens + 직접 스크래핑 (LME, 스크랩)
- recarburizer: 3,000 tokens
- summary: 3,000 tokens + 각 탭 캐시 주입

---

## 프롬프트 파일 현황

| 파일 | 품목 | 비중국 생산국 |
|------|------|-------------|
| `api/_prompts/fesi.js` | FeSi 75 | 노르웨이·러시아·인도 |
| `api/_prompts/femn.js` | FeMn HC78 | 카자흐스탄·남아프리카·가봉 |
| `api/_prompts/simn.js` | SiMn 6517 | 말레이시아·인도·남아프리카 |
| `api/_prompts/ferroalloy-summary.js` | cross-product 요약 | — |
| `api/_prompts/aluminum.js` | LME + 스크랩 | — |
| `api/_prompts/recarburizer.js` | 중국·러시아 가탄제 | — |
| `api/_prompts/steelmaker.js` | 국내외 제강사 | — |
| `api/_prompts/summary.js` | 시황 종합 | — |

---

## 보류 중인 작업

| 우선순위 | 항목 | 비고 |
|---------|------|------|
| 높음 | 전체 프롬프트 placeholder 금지 규칙 통일 | ferroalloy 외 탭 미적용 |
| 높음 | recarburizer.js CIF 범위 재검토 | $10~15 → $15~25 추정 |
| 중간 | aluminum.js 전일 데이터 없을 때 fallback 강화 | hallucination 위험 |
| 낮음 | summary.js key_signals 확장 | 효과 대비 작업량 검토 필요 |
| 낮음 | steelmaker.js key_issues 추가 | 미요청 상태 |

---

## 중장기 로드맵 (미착수)

멀티 클라이언트 플랫폼 고도화 → `docs/session-2026-03-27.md` 참조
- `src/clients.config.ts` — 업체별 설정
- `api/get-news-v2.js` — clientId 지원
- 신규 원자재: 철강 HRC, 원료탄, 열탄, 고철
