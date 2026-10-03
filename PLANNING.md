# commodity-news 현재 상태
> 최종 업데이트: 2026-10-03 (전면 개편 완료, 커밋 90d0f98)

(주)한국에이원 — 회사 내부와 국내 제강사 구매팀(무료 제공)이 매일 아침 10분 동안 보는 원자재 시황.
화면 단위는 기사가 아니라 **시장**이다. 시장마다 "지금 어떻게 돌아가나 → 왜 → 어디에 어떻게 영향 → 앞으로"를 숫자와 함께 보여준다.

배포: https://news.a1kor.com (Vercel Hobby, GitHub main 푸시 시 자동 배포)

---

## 핵심 원칙 (위반 금지)

1. **숫자는 결정적 소스만** — 거래소·관세청·공시·야드 매입가를 코드로 수집. 수집 실패는 null + `errors` 기록, 추정값·상수로 채우지 않는다. 근거 없는 "통상 범위"를 가격처럼 쓰지 않는다(가탄제 100~180 사고).
2. **방향·신호는 코드, 해석은 LLM** — 강세/약세·구매 유리/불리는 주간 변동률 규칙으로 코드가 정한다. LLM은 이유·영향·전망만 쓰고 판정을 바꾸지 못한다.
3. **LLM 출력은 검증 후 저장** — 입력에 없는 숫자, 통화 단위가 다른 숫자(元→원 등)가 든 문장은 삭제하고 1회 재작성. 핵심 칸이 비어도 재작성, 그래도 비면 그 시장은 오류로 남긴다.
4. **근거는 신뢰 매체 화이트리스트만** — 검색형 LLM으로 사실을 발굴하지 않는다. 근거 기사는 해석 생성에만 쓰고 화면에는 표시하지 않는다.
5. **방문자 요청으로 생성하지 않는다** — 생성은 새벽 수집 작업만. 화면 API는 읽기 전용 + CDN 캐시.
6. **셀프 fetch는 공개 도메인** — `VERCEL_URL`은 Vercel Authentication에 막힌다. `news.a1kor.com` 사용.

---

## 데이터 흐름

```
[매일 03:30 KST] Vercel cron → /api/collect-daily (300s)
   1) 스냅샷   snapshot.js  — 환율·LME·중국 선물 8종·해외 스크랩·국내 고시·관세청 무연탄
   2) 근거     evidence.js  — 시장별 신뢰 매체 기사 본문 (Google News 원문 해독 + 국내 RSS)
   3) 리포트   report.js    — 시장 5개 해석(interpret.js, 동시 2) + 브리핑(공통 요인에 거시 헤드라인)
[매시 05분]  GitHub Actions → /api/macro-sentinel — 새 거시 이벤트면 regenerate → 워크플로가 collect-daily 재호출 (하루 1회)
[하루 2회]   GitHub Actions kr-scrap-archive — 국내 스크랩 고시 이미지 OCR → /api/kr-scrap-archive
[조회]       / → src/v3/V3App.tsx → /api/get-report (s-maxage 600, stale-while-revalidate 3600)
```

### 시장 정의 (`api/_lib/market-metrics.js`)
| 시장 | 주 지표(방향 판정) | 보조 | 추가 숫자 |
|------|------------------|------|----------|
| 합금철 | ZCE FeSi | ZCE SiMn | — |
| 알루미늄 1차 | LME | SHFE 1차 | — |
| 알루미늄 2차 | SHFE 2차(주조합금) | SHFE 1차 | 국내 스크랩 고시, 미국·캐나다 야드가, 1·2차 가격차 |
| 가탄제 | DCE 원료탄 | DCE 코크스 | 관세청 무연탄 평균 수입단가(중국·러시아) |
| 철강 업황 | SHFE 철근 | SHFE 열연 | 수요 신호(합금철·가탄제·탈산제) |

방향: 주간 ±1.5% 이상이면 강세/약세, 월간이 반대로 크면 혼조. 원화 구매가 = 현지 가격 × 환율(CNY 품목은 교차환율).

### 데이터 소스
| 소스 | 모듈 | 비고 |
|------|------|------|
| westmetall (LME Cash) | lme-data.js | 이력은 올해 1월부터 |
| 신랑재경 hq.sinajs.cn / 일봉 | zce-futures.js, history-backfill.js | czce 공식 파일 fallback |
| frankfurter (ECB) | exchange-rate.js | 주말은 시계열에 넣지 않음 |
| recycleinme | recycleinme.js | "Canada" 페이지가 UK 라벨 → lb 행=캐나다, 톤 행=영국 |
| 관세청 nitemtrade (HS 270111) | customs.js | 월 1회(15일경 전월분), 1,000톤 미만 월 제외, 전 용도 평균 |
| 국내 스크랩 주간 고시 | scripts/kr-scrap, kr-scrap.js | 같은 게시글을 매주 덮어씀 → 2026-10-02분부터 보관. 화면에 회사명 표기 금지 |
| 근거 매체 | evidence.js `DOMAINS` | 신랑재경·마이스틸·AL Circle·Aluminium Today·스틸데일리·페로타임즈, 철강금속신문(유료 → 제목만) |
| 거시 헤드라인 | macro-news.js | Google News 와이어, 국면 fingerprint |

### LLM
- Perplexity **Agent API**(`/v1/agent`), 모델 `anthropic/claude-sonnet-5-5`(env `AGENT_MODEL`로 교체), **검색 도구 없음**.
- Sonar 채팅 API는 2026-09-27 지원 종료 → 사용하지 않는다.
- 함정: Anthropic 모델은 `max_output_tokens` 필수, JSON 스키마 `minItems/maxItems` 미지원(400), 동시 5개면 429(재시도·동시 2로 처리).
- 비용: 하루 약 $0.15~0.22(시장 5 + 브리핑, 재작성 포함). 일일 호출 상한 `PPLX_DAILY_CALL_CAP`(기본 40, budget.js).
- 모델 비교(2026-10-03): Sonnet 최적. Opus는 2배 비용·차이 미미·빈 응답 1건, Gemini Flash는 일반론 많음, Haiku는 단위 오기로 탈락.

---

## Firestore 문서

| 컬렉션/문서 | 내용 |
|------------|------|
| `commodity_cache/market_snapshot_{날짜}`·`_latest` | 숫자 스냅샷 |
| `commodity_cache/price_history_market` | 시계열 400일(값마다 실제 거래일 날짜). 200행 미만이면 자동 백필 |
| `commodity_cache/evidence_{날짜}`·`_latest`, `evidence_seen` | 근거 묶음, 최근 5일 사용 URL(빼지 않고 후순위) |
| `commodity_cache/market_report_{날짜}`·`_latest` | 하루치 리포트 |
| `commodity_cache/collect_log_{날짜}`, `macro_state`, `pplx_budget_{날짜}` | 실행 기록, 센티널 상태, 호출 수 |
| `kr_scrap_weekly/{기준일}`·`_latest` | 국내 고시 판독값 + 원본 이미지(저장소가 공개라 git 대신 Firestore) |

2026-10 이전 탭 구조의 캐시 문서(`{tab}_{날짜}` 등)는 남아 있으나 쓰지 않는다.

---

## 검증·운영

- **게이트**: `npm test`(ESLint + 파서·매크로·국내 고시·스냅샷·근거·해석 회귀) + `npm run build`. `tsc`는 @types/react 부재로 신뢰 불가.
- 환경변수(Vercel): `PERPLEXITY_API_KEY`, `FIREBASE_*` 3종, `CRON_SECRET`, `CUSTOMS_API_KEY`, (선택) `AGENT_MODEL`, `PPLX_DAILY_CALL_CAP`, `PUBLIC_BASE_URL`. 운영 환경변수는 Vercel MCP 권한 부족 → `vercel env add`로 등록.
- GitHub 시크릿: `CRON_SECRET`(2026-10-03 등록 — 그전엔 0개라 센티널이 계속 실패하다 자동 정지됐었다).
- 공개 저장소 예약 워크플로 60일 비활성 정지 → kr-scrap 워크플로의 `keepalive` 잡이 enable API로 재활성화.
- 수동 실행: `curl -H "Authorization: Bearer $CRON_SECRET" https://news.a1kor.com/api/collect-daily` (약 2분, $0.2)

## 남은 작업

| 우선순위 | 항목 | 비고 |
|---------|------|------|
| 높음 | 2026-10-04 03:30 첫 자동 실행 확인 | `collect_log_2026-10-04`, 화면 날짜·어제 대비 신호 |
| 중간 | 국내 스크랩 예상가 계산식 보정 | 고시 몇 주 쌓인 뒤 품목별 반응도 반영, 적중률 표시 |
| 중간 | 가탄제 무연탄 직접 근거 | 무료 기사 소스 없음(sxcoal 유료). 지금은 원료탄·코크스·관세청으로 설명 |
| 낮음 | 관세청 키 재발급 시 교체 | 대화에 노출됨 |
