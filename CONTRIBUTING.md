# 개발 규칙

## 프로젝트 추가

1. `projects/<소문자-kebab-case>`에 독립된 프로젝트를 만듭니다.
2. README에 목적, 지원 환경, 설정, 실행, 검증 방법을 기록합니다.
3. JavaScript는 `src/`, Node.js 테스트는 `test/*.test.js`에 둡니다. npm workspace의 패키지 이름은 `@stream-utils/<이름>`으로 정합니다.
4. 다른 언어도 같은 프로젝트 경계를 따르되, 해당 언어의 자연스러운 빌드 구성을 사용합니다.

공통 코드는 여러 프로젝트에서 필요해질 때 분리합니다. 빈 프로젝트나 사용되지 않는 공통 라이브러리를 미리 만들지 않습니다.

## 설정과 산출물

개인 경로, 계정 정보, 비밀번호, 로그, heartbeat, 컴파일 결과는 Git에 넣지 않습니다. 공유 가능한 `config.example.json`, `.env.example`과 재현 가능한 빌드 스크립트를 제공합니다. 사용자 설정은 `config.local.json`과 `.env`에 저장합니다.

## 변경 검증

`node scripts/check.js`와 `node scripts/test.js`를 실행합니다. 감시기 테스트는 OBS 서버나 실제 장치에 연결하지 않습니다. 네이티브 코드 변경 시 Windows에서 `projects/obs-watchdog/native-probe/build.ps1 -Test`를 실행하고, 실제 OBS에서 확인해야 하는 동작을 README에 남깁니다.

실제 방송 장치나 OBS 설정을 변경하는 통합 검증은 별도로 수행합니다. 커밋 메시지는 변경의 목적을 설명합니다.
