## LLM Wiki

This project has an LLM-curated wiki at `wiki/`. Read `wiki/index.md` before answering research questions. Full conventions in `wiki/SCHEMA.md`. Ingest and query workflows live in the `llm-wiki` skill.

## 프로젝트 문서 (먼저 읽을 것)

- `PLANNING.md` — 현재 구조·데이터 흐름·Firestore 문서·운영. `docs/quality.md` — 품질 기준·검증 규칙(세계 동향 포함).
- 검증: `npm test`(ESLint + 회귀) + `npm run build`. `tsc`는 신뢰 불가. 화면 코드에 정규식 lookbehind 금지(구형 iOS Safari).
- 커밋·push는 소유자가 명시적으로 지시할 때만. 기존 리포트 생성(`collect-daily`)과 응답 필드 모양은 바꾸지 않고 추가만.

## 세계 동향 탐색 — `api/explore.js` (2026-11-17~, glove-news 방식 이식)

Vercel Cron `0 20 * * *` = **KST 05시대**(리포트 06시대보다 한 시간 앞 — Hobby는 지정한 시 안 아무 때나 돌아 한 시간 간격이면 순서 보장).
리포트와 따로 `commodity_cache/world_{날짜}`·`world_latest`에 저장하고 `get-report`가 함께 읽는다 — 탐색이 실패해도 리포트는 그대로, 화면은 직전 사안을 발표일과 함께 둔다.

1. **신호** `signals.js` — 무료 공식 통계를 코드로(LLM 없음, 실패는 null): 세계·중국·한국 조강 생산(세계철강협회), EU·미국 철강/알루미늄 생산지수(Eurostat·FRED), LME 알루미늄 재고(westmetall), 미국 주택 착공·자동차 판매(FRED), 컨테이너 운임(SCFI)·중국 연안 석탄 운임(CBCFI). 탐색 입력용 공지: 미국 연방관보(철강·알루미늄·합금철 제목)·무역대표부 RSS
2. **탐색** `exploreLenses.js` — 관점 5개(제강·철강 수요 / 알루미늄 수요 / 공급·원가 / 정책·무역·물류 / **자유 관점**) × Perplexity `web_search`(`max_steps` 5, 최근 1주, 홍보·SNS 제외). 고정 검색어·매체 목록 없음
3. **원문 대조** `exploreVerify.js` — 찾은 주소를 코드가 열어 인용문(한 글자도 다르지 않게)·발행일(최근 14일: 페이지 메타 → 본문에 적힌 LLM 날짜 → 검색 색인 날짜) 확인. 공식·통신사·근거 매체가 아니면 다른 사이트 1곳 더
4. **작성·검증**(검색 없음) — 사실 문장은 근거 문장 번호 + 숫자·단위 대조, 추론 문장(품목과의 관계·영향 범위·앞으로 예상)은 숫자 금지·추정 표현만. 규칙 상세는 `docs/quality.md`
5. 화면: "세계 동향" 탭(신호판 + 사안 카드), 브리핑 상위 3건, 품목 탭에 그 품목 사안. 해설 칸은 이어 읽는 문단(`Para`, 숫자 굵게). "AI 분석" 같은 표시는 붙이지 않는다

수동 실행: `curl -H "Authorization: Bearer $CRON_SECRET" https://news.a1kor.com/api/explore` (LLM 6회, glove-news 실측 약 $0.15·2분 — 이 프로젝트는 미실측). 점검: Vercel 로그 `[Explore]`, `/api/audit?date=` 응답의 `world`(사안·탈락 사유·비용).
