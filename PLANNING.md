# commodity-news 현재 상태
> 최종 업데이트: 2026-06-12

(주)한국에이원 — 제강사·주조사 구매팀용 원자재 시황 대시보드.
독자의 질문은 하나: **"오늘 이 입찰 단가가 적정한가?"** 모든 설계가 이 질문에 답하기 위해 존재.

배포: https://news.a1kor.com (Vercel Hobby, GitHub main 푸시 시 자동 배포)

---

## 핵심 원칙 (위반 금지)

1. **NULL 원칙** — 숫자(가격·재고·물량)는 출처 확인된 값만. 추정·중간값·기억값 금지, 불가 시 null → 전일값 carry-forward(`carried_over` 배지). 검증은 `api/_lib/validate.js`(품목별 hard bound + 전일 대비 ±10%).
2. **발굴(결정적) ↔ 해석(LLM) 분리** — 사실 수집은 코드(RSS·스크래핑·거래소 파싱)가, LLM은 해석·번역만. LLM 검색에 사실 발굴을 맡기지 않는다 (2026-06-12 미·이란 합의 미반영 사고의 교훈).
3. **셀프 fetch는 공개 도메인으로** — `VERCEL_URL`은 Vercel Authentication에 차단됨(로그인 HTML 반환). 반드시 `news.a1kor.com`(또는 `PUBLIC_BASE_URL`).
4. **전 소스 파일 200줄 미만**, 편집 > 신규 생성.

---

## 아키텍처

### 데이터 흐름
```
[정기]   Vercel cron 04:00 KST → /api/cron-refresh → 4탭 병렬 + summary 순차 강제 생성
[이벤트] GitHub Actions 매시 5분 → /api/macro-sentinel → 새 매크로 이벤트 감지 시 summary만 재생성
[조회]   /api/get-news?tab=X → Firestore 오늘 캐시 HIT 반환 / MISS 시 동기 생성
```
- 캐시: Firestore `commodity_cache/{tab}_{YYYY-MM-DD}` + `{tab}_latest`(fallback)
- `force=true&secret=ADMIN_SECRET`로 강제 재생성

### 탭 모듈 (get-news = 범용 오케스트레이터)
공통 인터페이스: `recency·maxTokens → prefetch → buildPrompt → postProcess → isValid → newsItems`

| 탭 | 모듈 | recency | maxTokens | 주 가격 소스 (결정적) |
|----|------|---------|-----------|----------------------|
| summary(브리핑·기본탭) | tab-summary.js | day | 3,500 | 각 탭 캐시 주입 |
| ferroalloy(멀티콜) | ferroalloy-tab.js | — | ~7,500 합계 | ZCE 선물 정산가(sina→czce fallback) |
| aluminum | tab-aluminum.js | week | 3,000 | LME westmetall, 스크랩 scrapmonster·dokindokin |
| recarburizer | tab-recarburizer.js | month | 3,000 | Perplexity(검증·이월) |
| steelmaker | tab-steelmaker.js | week | 4,000 | Perplexity(검증·이월) |

### 매크로 이벤트 파이프라인 (2026-06-12 신설)
- `api/_lib/macro-news.js` — Google News RSS 고정 쿼리 3개(무료·무인증) → 엔티티×국면 결정적 스코어링. fingerprint = 국면 조합(`iran:conflict+deal`) → 보도 물량에 새 국면(합의)이 묻히지 않음.
- `api/macro-sentinel.js` — 새 fingerprint + score≥9 + 소스≥2 → summary 재생성. 일 3회 상한, KST 06~23시. 평시 LLM 비용 0.
- summary 생성 시 글로벌 헤드라인 + 전일 risk_signals 주입 → `macro_event`(국면 전환 명시, 헤드라인 없으면 코드가 강제 null) → UI 최상단 "긴급 시황" 카드.

### 뉴스 품질 계층
- 국내 1차 보도: 페로타임즈·철강금속신문 RSS (`rss-news.js`) — 제목·URL·날짜 LLM 미경유 직표시 + 프롬프트 사실 근거 주입
- 반복 방지: `news_history_{tab}`(7일) 제외 목록 + bigram Jaccard(0.6) 코드 dedup. 단 **국면 전환(갈등→합의 등)은 신규 이슈로 취급**
- 문구 정화: `stripUncertaintyDeep` — "검색 결과 확인 불가" 류 내레이션 제거

---

## 검증·운영

- **게이트**: `npm test`(validate + macro-news 회귀) + `npm run build`(vite). tsc lint는 @types/react 부재로 신뢰 불가.
- 환경변수: `PERPLEXITY_API_KEY`, `FIREBASE_*` 3종, `CRON_SECRET`, `ADMIN_SECRET`, (선택) `PUBLIC_BASE_URL`
- 시크릿 확인: `npx vercel env pull`(CLI 인증돼 있음). GitHub Actions 시크릿 `CRON_SECRET` 등록 필요(미등록 시 센티널 미가동, 일일 cron은 무관)

## 남은 작업

| 우선순위 | 항목 | 비고 |
|---------|------|------|
| 높음 | GitHub repo 시크릿 `CRON_SECRET` 등록 | 센티널 가동 조건 |
| 중간 | 내일 04:00 cron 성공 확인 | VERCEL_URL→공개 도메인 수정 후 첫 실행 |
| 낮음 | `market-config.js` BID_MONTHS 입력 | 사용자가 채워야 입찰 기준점 배지 활성화 |
| 보류 | 멀티 클라이언트 플랫폼 (`/:clientId`, clients.config.ts) | 신규 품목: HRC·원료탄·열탄·고철 |
