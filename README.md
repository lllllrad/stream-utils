# stream-utils

방송 운영에 필요한 작은 프로젝트를 모아 관리하는 저장소입니다. 첫 프로젝트는 OBS 영상 소스 멈춤을 감지하고 복구하는 `obs-watchdog`입니다.

```text
projects/
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

Node.js **22.15 이상**이 필요합니다. 현재 외부 JavaScript 의존성은 없어 설치 없이 검사할 수 있습니다.

```powershell
node scripts/check.js
node scripts/test.js
# npm이 설치되어 있으면:
npm run verify
```

`scripts/test.js`는 `projects/*/test/*.test.js`를 자동으로 모읍니다. 별도 언어의 빌드·테스트는 해당 프로젝트 README에 명시합니다. 네이티브 플러그인 검사에는 Windows와 Zig 0.14.0이 필요합니다.

OBS 설정과 실행은 [obs-watchdog 안내](projects/obs-watchdog/README.md)를 참고하세요. 변경 기여 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md)에 있습니다.
