# Vercel CLI 개발 환경

관련 요구사항: `TR-06`, `TR-07`

## 연결 정보

- Vercel scope: `thsus1214-7527s-projects`
- Vercel project: `taxi-ta-share`
- GitHub Repository: `https://github.com/LEE-JAKE-123/taxi-ta-share` (연결됨)
- Framework: Next.js
- 로컬 연결 파일: `.vercel/project.json` 및 `.env.local`  
  두 파일은 비밀값 또는 개인 연결 정보를 포함할 수 있어 Git에 커밋하지 않는다.

## 개발 환경 연동 실행

```powershell
vercel login
vercel link --yes
vercel env pull .env.local --environment=development --yes
pnpm db:migrate
pnpm db:verify
```

`vercel env pull`은 `.env.local`을 덮어쓴다. 수동 로컬 전용 값이 필요하면
`.env.development.local`에 분리한다.

## 확인 명령

```powershell
vercel whoami
vercel project inspect taxi-ta-share
vercel env ls development
vercel integration installations
```

환경 변수의 값은 터미널, 이슈, PR, 로그에 출력하지 않는다. 필요한 키 이름은
`.env.example`을 기준으로 확인한다.

## 현재 제한

- GitHub 저장소 자동 연결은 Vercel 계정의 GitHub 저장소 권한이 없어 완료되지 않았다.
- Development Neon 연결과 migration은 완료됐다.
- Preview·Production 환경의 앱 전용 변수, DB fingerprint와 최소 권한 역할 검증은
  배포 준비 단계에서 별도로 구성한다.
- 백업/PITR 보유 기간, RPO/RTO, 복구 훈련과 경보 정책은 `TR-07` 열린 결정이다.
