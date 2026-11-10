# stream-utils

방송 운영에 필요한 작은 프로젝트를 모아 관리하는 저장소입니다. OBS 영상 소스 복구용 `obs-watchdog`과 Launchpad 입력을 Warudo에 전달하는 `midi-api`가 있습니다.

```text
projects/
  midi-api/
    src/           TypeScript MIDI 상태 처리와 로컬 HTTP API
    native/        Windows WinMM MIDI 입력 보조 모듈
    warudo/        HTTP API를 조회하는 Warudo Playground 에셋
    test/          가짜 MIDI 이벤트와 로컬 HTTP 테스트
  obs-watchdog/
    src/           설정, OBS 통신, 감시 로직, CLI
    test/          OBS 없이 실행하는 Node.js 테스트
    tools/         기존 도구 진입점과 Windows 프로세스 관리
    native-probe/  프레임 카운터 OBS 플러그인 소스와 빌드
scripts/           저장소 전체 검사와 테스트
.github/workflows/ Linux/Windows, Node.js 22/24 CI
```

프로젝트마다 실행 방법·설정·테스트를 자기 디렉터리에 둡니다. Node.js 프로젝트는 npm workspace로 묶고, 다른 언어의 프로젝트도 `projects/<이름>`에 추가할 수 있습니다. 실제로 두 프로젝트에서 쓰는 코드가 생기면 `packages/`로 공통 모듈을 추출합니다.

## 개발

Node.js **22.15 이상**이 필요합니다. 런타임 외부 의존성은 없으며, TypeScript 검사·빌드에는 개발 의존성을 설치합니다.

```powershell
npm ci
node scripts/check.js
node scripts/test.js
# npm이 설치되어 있으면:
npm run verify
```

`scripts/check.js`는 JavaScript 문법과 TypeScript 타입을 검사합니다. `scripts/test.js`는 TypeScript 프로젝트를 빌드하고 각 프로젝트의 테스트를 자동으로 모읍니다. 별도 언어의 빌드·테스트는 해당 프로젝트 README에 명시합니다. OBS 네이티브 플러그인 검사에는 Windows와 Zig 0.14.0이 필요합니다.

실행과 설정은 [obs-watchdog 안내](projects/obs-watchdog/README.md), [MIDI API와 Warudo 연동 안내](projects/midi-api/README.md)를 참고하세요. 변경 기여 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md)에 있습니다.
