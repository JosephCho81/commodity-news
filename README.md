# 오늘의 원자재 뉴스

(주)한국에이원 구매팀용 원자재 시황 대시보드.
LME 알루미늄·합금철(FeSi/FeMn/SiMn)·가탄제·철강 업황을 매일 자동 수집·검증해 브리핑한다.

- 운영: https://news.a1kor.com
- 스택: Vite + React 19 / Vercel Functions / Firestore 캐시 / Perplexity API
- 아키텍처·운영 원칙: [PLANNING.md](PLANNING.md) 참조

## 로컬 실행

```bash
npm install
npx vercel env pull .env   # 환경변수 (Vercel CLI 인증 필요)
npm run dev                # tsx server.ts
```

## 검증

```bash
npm test        # 결정적 계층 회귀 테스트 (가격 검증·매크로 감지·파서)
npm run build   # vite build — 배포 게이트
```

## 배포

main 브랜치 푸시 시 Vercel 자동 배포.
데이터 갱신: 매일 04:00 KST cron + 매크로 이벤트 감지 시 시간 단위(GitHub Actions 센티널).
