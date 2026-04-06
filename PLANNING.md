# commodity-news 고도화 계획 세션 요약
> 최초 작성: 2026-03-27 | 최종 업데이트: 2026-04-06 | 상태: 합금철 탭 리팩토링 완료

---

## 세션 2 — 합금철 탭 프롬프트 전면 리팩토링 (2026-04-06)

### 발단: 합금철 탭 품질 문제
FeMn·SiMn 섹션에 "정보 부재", "최신 동향 미확보", "구체적 데이터 미확보" 등 placeholder 텍스트 다수 노출.

**근본 원인**
1. 단일 `ferroalloy.js` 프롬프트에서 FeSi·FeMn·SiMn 3품목을 한 번에 요청 → FeSi가 토큰을 선점, FeMn·SiMn 품질 저하
2. 검색 쿼리가 FeSi 중심 → FeMn·SiMn 데이터 수집 미흡
3. placeholder 텍스트 금지 규칙 부재

---

### 구조 변경: 단일 파일 → 4파일 분리

| 기존 | 신규 | maxTokens |
|------|------|-----------|
| `api/_prompts/ferroalloy.js` (삭제) | `api/_prompts/fesi.js` | 2,500 |
| `api/_prompts/ferrosilicon.js` (삭제, 미사용 dead code) | `api/_prompts/femn.js` | 2,000 |
| — | `api/_prompts/simn.js` | 2,000 |
| — | `api/_prompts/ferroalloy-summary.js` | 1,000 |

**호출 방식 변경** (`api/get-news.js`)
- Step 1: fesi / femn / simn **병렬** `Promise.allSettled` (각 55s AbortSignal)
- Step 2: ferroalloy-summary **순차** (3품목 결과 주입 후 cross-product 요약 생성)
- 개별 실패 시 `_latest` fallback, 전체 실패 시 latestData 반환

---

### 각 프롬프트 파일 핵심 스펙

#### fesi.js (페로실리콘 75)
- 고유 필드: `hbis_bid_price`(null 금지, 닝샤 현물가 fallback), `hbis_bid_month`, `hbis_bid_change`, `ningxia_spot`, `china_production_status`
- 비중국 생산국: 노르웨이(Elkem), 러시아(ChEZ·RUSAL), 인도(IMFA·Shyam Ferro)
- 검색 쿼리: 河钢 硅铁 招标价 + SMM + 닝샤 현물 + 비중국 4쿼리

#### femn.js (페로망간 HC78)
- 고유 필드: `hbis_bid_price`(null 허용), `mn_ore_cif_korea`(USD/MT 예외 명시), `ore_to_femn_spread`
- 비중국 생산국: 카자흐스탄(TNC Kazchrome), 남아프리카(Samancor), 가봉(Eramet/Comilog)
- 검색 쿼리: 河钢 高碳锰铁 招标价 + 망간광석 CIF + MOIL

#### simn.js (실리망간 6517)
- 고유 필드: `hbis_bid_price`(null 허용), `china_overcapacity_note`, `dual_input_cost`
- 비중국 생산국: 말레이시아(OM Materials), 인도(Nava Bharat·FACOR), **남아프리카(Transalloys·Hernic)**
  - 카자흐스탄(TNC Kazchrome)은 FeMn과 중복이므로 남아프리카로 교체
- 검색 쿼리: SMM 硅锰 6517 价格 + 上海有色 硅锰 现货价 추가

#### ferroalloy-summary.js (cross-product 요약)
- 3품목 분석 결과를 주입받아 `intl_context`, `non_china_summary`, `outlook` 3개 필드만 생성
- 서버에서 `market_summary = { fesi: context, femn: context, simn: context, intl_context, non_china_summary, outlook }` 조립
- 슬라이스: context 200자, supply_cause 150자 (한국어 문장 단절 방지)

---

### 공통 규칙 강화 (3개 프롬프트 동일 적용)

1. `price_cny`: 숫자만, null 절대 금지 / 참고 범위 + 중간값 fallback 명시
2. placeholder 텍스트 금지: "정보 부재", "최신 동향 미확보", "구체적 데이터 미확보", "데이터 없음", "확인 불가" 등
3. `key_issues`: **정확히 1개, 빈 배열 금지**
4. `non_china_producers`: 반드시 3개국, 완전한 문장 (단어·구 나열 금지), 수치 포함
5. 종결어미 금지: ~이다/~했다/~있다/~된다
6. 텍스트 필드 가격: CNY x,xxx/MT 형식만 (USD 직접 표기 금지)
   - 예외: `mn_ore_cif_korea`는 USD/MT (업계 관행)

---

### UI 수정 (FerroalloyTab.tsx)

| 추가 | 제거 |
|------|------|
| `FesiExtra` 컴포넌트: HBIS 입찰가 + 닝샤 현물 + 중국 생산 동향 | `SUMMARY_ROWS`에서 fesi/femn/simn 행 제거 (개별 카드 중복) |
| `FemnExtra` 컴포넌트: 망간광석 CIF + 마진 | — |
| `SimnExtra` 컴포넌트: 공급구조 + 원가 | — |

합금철 시장 종합 섹션은 이제 `국제 정세 / 비중국 생산 / 단기 전망` 3행만 표시.

---

### 수정된 파일 목록

| 파일 | 변경 |
|------|------|
| `api/_prompts/fesi.js` | 신규 생성 |
| `api/_prompts/femn.js` | 신규 생성 |
| `api/_prompts/simn.js` | 신규 생성 |
| `api/_prompts/ferroalloy-summary.js` | 신규 생성 |
| `api/_prompts/ferroalloy.js` | 삭제 |
| `api/_prompts/ferrosilicon.js` | 삭제 (dead code) |
| `api/get-news.js` | ferroalloy 멀티콜 브랜치 추가, maxTokens 조건 정리 |
| `src/tabs/FerroalloyTab.tsx` | FesiExtra/FemnExtra/SimnExtra 추가, SUMMARY_ROWS 정리 |
| `src/types.ts` | FerroItem에 제품별 optional 필드 7개 추가 |

---

### 보류 중인 작업 (다음 세션)

| 항목 | 이유 |
|------|------|
| summary.js `key_signals` 확장 | 효과 대비 작업량 검토 필요 |
| steelmaker.js `key_issues` 추가 | 현재 미요청 |
| aluminum.js rule 5 fallback 강화 | 전일 데이터 없을 때 hallucination 위험 |
| recarburizer.js CIF 범위 재검토 ($10~15 → $15~25) | 시장가 대비 낮은 기본값 |
| 전체 프롬프트 placeholder 금지 규칙 통일 | ferroalloy 외 탭 미적용 상태 |

---

## 목표
코리아에이원이 운영하는 원자재 뉴스 서비스를 멀티 업체 제공 플랫폼으로 고도화.
- path 기반 업체별 개인화 (`/:clientId`)
- 코리아에이원 브랜딩 유지, 내용만 업체별 차별화
- 신규 원자재: 철강, 유연탄(원료탄), 열탄, 고철/스크랩

## 확정된 설계 원칙

### 아키텍처
- 클라이언트 설정: `clients.config.ts` (코드 기반, 관리 UI 없음)
- 라우팅: `/:clientId` → `clients.config.ts` 기반 동적 렌더링
- Firestore 네임스페이스: `/clients/{clientId}/data/{tab}`
- 인증: 없음 (URL = 접근)
- 브랜딩: 모든 페이지 한국에이원 CI 고정, 내용만 변경

### 마이그레이션 원칙
- Phase 1: 신규 경로만 추가, 기존 코드 무수정
- Phase 2: 코리아에이원도 clients.config.ts로 통합
- Phase 3: 기존 코드 정리 (기존 프롬프트 추정값 제거 포함)

### 신뢰성 원칙 (핵심 가치)
- 확인된 데이터만 표시
- null = 해당 항목 UI 미노출 (단, 빈 화면 제공은 불가 — 미해결 과제)
- 추정값·범위 추정 절대 금지
- 텍스트 분석에 미확인 가격 수치 포함 금지

## Perplexity 프롬프트 검증 결과 (2026-03-27)

### 테스트 조건
- 모델: sonar, temperature: 0.1, max_tokens: 3000
- 시스템 프롬프트: "찾으면 보고, 못 찾으면 null, 추정 금지"

### 결과 요약

| 원자재 | 추출 성공 가격 | 추출 실패 (null) 이유 |
|--------|-------------|-------------------|
| 철강 HRC | 중국 FOB 472, 미국 835, EU 665 | 터키 내수 → 구독형 |
| 원료탄 | PLV HCC 223.5 (SGX 선물) | CFR 중국/한국/일본 → 구독형 |
| 열탄 | Newcastle 언급(텍스트에만) | 모든 벤치마크 필드 null |
| 고철 | HMS 터키 380, 일본 49,000 JPY | US Shredded → 구독형 |

### 핵심 발견
1. **공개 데이터는 추출 가능**: 철강 FOB, PLV HCC (SGX), HMS 터키
2. **구독형 지수는 접근 불가**: Platts, Argus, Globalcoal 구독 데이터
3. **열탄 문제**: Newcastle 가격을 텍스트에서는 언급하나 필드에 미기재
4. **텍스트 위반**: 추정치·예측치가 텍스트에 포함되는 것을 완전히 막기 어려움
5. **핵심 미해결 과제**: "빈 값은 고객에게 제공 불가" vs "확인된 데이터만 표시" 충돌

### 기존 프롬프트의 같은 문제
- 알루미늄 `price_range`: "추정: Zorba $X~$Y/톤 절대 null 금지"
- 페로실리콘: "못 찾으면 최근에 알려진 값 기재"
- 재탄화제 `price_range_text`: 가격 못 찾으면 범위 추정 강제
→ Phase 2에서 동일 원칙으로 수정 예정

## 미해결 과제 (다음 세션에서 결정 필요)

### [핵심] 빈 값 처리 전략
현재 충돌:
- "신뢰성" → 확인 안된 데이터 표시 금지
- "서비스 품질" → 빈 화면 제공 불가

후보 방향:
1. **직접 스크래핑 확장**: 현재 알루미늄처럼 신뢰 가능한 무료 소스를 원자재별로 직접 스크래핑. Perplexity는 텍스트 분석만.
2. **선별적 원자재 제공**: 확실히 추출 가능한 가격만 있는 원자재만 서비스. 나머지 스킵.
3. **이력 기반 fallback**: 오늘 데이터 없으면 최근 확인된 날짜 + "X일 전 기준" 표시.
4. **하이브리드**: 가격은 스크래핑, 분석 텍스트는 Perplexity.

### [기타] 다음 세션 전 확인 필요
- 각 신규 원자재별 무료 스크래핑 가능한 소스 목록
- 업체 B의 실제 요구 사항 (어떤 가격 정보가 핵심인지)
- Cron 스케줄: 업체별 개별 스케줄 vs 통합 스케줄

## 다음 구현 단계 (검증 완료 후)
1. `src/clients.config.ts` 생성
2. `src/commodity-prompts.ts` — 원자재별 프롬프트 템플릿
3. `src/types.ts` 확장 — 신규 원자재 타입
4. `api/get-news-v2.js` — clientId 지원, 기존 무수정
5. `api/cron-refresh-v2.js` — 멀티 클라이언트
6. `src/App.tsx` — 동적 렌더링
7. `src/main.tsx` — React Router

## 파일 구조 변경 계획
```
현재:
  api/get-news.js          ← 유지 (기존 서비스)
  api/cron-refresh.js      ← 유지
  src/App.tsx              ← 유지

추가:
  src/clients.config.ts    ← 신규
  src/commodity-prompts.ts ← 신규
  api/get-news-v2.js       ← 신규 (clientId 지원)
  api/cron-refresh-v2.js   ← 신규
```
