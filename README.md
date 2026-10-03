# 오늘의 원자재

(주)한국에이원 원자재 시황 — 회사 내부와 국내 제강사 구매팀이 매일 아침 10분 동안 보는 시장 브리핑.
합금철·알루미늄(1차·2차·스크랩)·가탄제·철강 업황을 시장 단위로 "지금 → 왜 → 영향 → 전망"과 숫자로 보여준다.

- 운영: https://news.a1kor.com
- 스택: Vite + React 19 / Vercel Functions / Firestore / Perplexity Agent API(Claude Sonnet, 검색 없음)
- 구조·원칙·데이터 소스: [PLANNING.md](PLANNING.md)

## 로컬 실행

```bash
npm install
npx vercel env pull .env   # 환경변수 (Vercel CLI 인증 필요)
npm run dev                # tsx server.ts — 화면 + /api/get-report
```

## 검증

```bash
npm test        # ESLint + 결정적 계층 회귀 테스트 (파서·지표·숫자/단위 검증·근거 필터)
npm run build   # vite build — 배포 게이트
```

## 배포·갱신

main 브랜치 푸시 시 Vercel 자동 배포.
- 매일 03:30 KST: `/api/collect-daily` — 숫자 스냅샷 → 근거 기사 → 시장 5개 해석 + 브리핑
- 매시간: 매크로 센티널(GitHub Actions) — 새 거시 이벤트면 리포트 재생성(하루 1회)
- 하루 2회: 국내 알루미늄 스크랩 고시 보관(GitHub Actions OCR)
