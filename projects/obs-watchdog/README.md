# obs-watchdog

OBS 영상 입력이 프레임을 내보내지 않는 상태를 감지해 `SetInputSettings`로 기존 입력 설정을 다시 적용합니다. 기본 감시는 네이티브 필터의 프레임 카운터를 사용합니다. 정지 화면이어도 새 프레임이 들어오면 정상으로 처리합니다.

## 지원 환경

- 감시기: Node.js **22.15 이상**, obs-websocket 5.x. 별도 npm 의존성이 없습니다.
- 네이티브 플러그인: Windows x64. 기존 코드에서 가져온 **OBS 32.2.2 ABI 선언**을 사용합니다. 다른 OBS 버전의 ABI 호환성은 확인되지 않았습니다. OBS 버전 변경 시 공식 헤더와 레이아웃을 다시 확인해야 합니다.
- 빌드: Zig 0.14.0, Windows PowerShell. 기존 DLL은 새 소스와 동작이 달라 재빌드해야 합니다.

## 설정

저장소 루트에서:

```powershell
Copy-Item projects/obs-watchdog/config.example.json projects/obs-watchdog/config.local.json
Copy-Item projects/obs-watchdog/.env.example projects/obs-watchdog/.env
```

이미 로컬 파일이 있으면 복사 대신 수정합니다. `.env`의 `OBS_WS_PASSWORD`에 OBS WebSocket 서버 비밀번호를 입력합니다. 인증이 꺼진 OBS는 비밀번호가 필요 없습니다. `config.local.json`의 `sources`에 실제 OBS 입력 이름을 넣습니다. 예제의 이름은 교체해도 됩니다. 설정 파일과 비밀번호 파일은 Git에서 제외됩니다.

| 설정 | 기본값 / 의미 |
| --- | --- |
| `host`, `port` | `127.0.0.1`, `4455` |
| `sources` | 설정하지 않으면 빈 목록; 자동 감시 시작 전 설정 필수 |
| `heartbeatDir` | 현재 사용자의 임시 디렉터리 아래 `obs-watchdog` |
| `logFile` | 프로젝트 디렉터리의 `watchdog.log` |
| `pollIntervalMs` | 500ms |
| `freezeThresholdChecks` | 3회 동일 카운터 관측, 기본 약 1초; 낮은 FPS 입력은 상향 |
| `staleWarnMs` | 5000ms; 오래된 heartbeat 경고, 카운터 비교 제외 |
| `staleRecoverMs` | 15000ms; stale 관측이 이 시간 동안 지속되면 조건부 복구. `staleWarnMs`보다 커야 함 |
| `dryRun` | 기본 `false`, 예제는 `true`; 자동 복구 대신 증거와 복구 예정 로그만 남김 |
| `recoveryCooldownMs` | 30000ms; 복구 실패에도 적용 |
| `reconnectDelayMs` | 5000ms |
| `connectTimeoutMs`, `requestTimeoutMs` | 각각 5000ms |

환경변수 `OBS_WS_HOST`, `OBS_WS_PORT`, `OBS_WS_PASSWORD`, `OBS_HEARTBEAT_DIR`가 파일보다 우선합니다. `OBS_WATCHDOG_CONFIG`로 다른 설정 파일을 지정할 수 있습니다. 상대 경로 설정은 설정 파일 위치 기준입니다. 비밀번호는 환경변수 또는 `.env`로만 받습니다. Node는 `.env`를 자동으로 읽지 않으므로 아래처럼 `--env-file-if-exists`를 붙입니다.

## 플러그인 빌드와 설치

```powershell
# 저장소 루트
powershell.exe -NoProfile -File projects/obs-watchdog/native-probe/build.ps1 -Test
```

결과는 `native-probe/build/frame-arrival-probe.dll`입니다. OBS를 종료하고 다음 경로에 복사한 뒤 OBS를 다시 시작합니다.

```text
C:\ProgramData\obs-studio\plugins\frame-arrival-probe\bin\64bit\frame-arrival-probe.dll
```

OBS 로그의 Loaded Modules에서 로드를 확인합니다. 기본 heartbeat 위치는 Windows `%TEMP%\obs-watchdog`입니다. OBS와 감시기를 같은 Windows 사용자로 실행합니다. 사용자 지정 위치를 쓰면 디렉터리를 미리 만들고 **OBS 프로세스와 감시기 모두**에 같은 `OBS_HEARTBEAT_DIR` 환경변수를 설정한 뒤 OBS를 재시작합니다. Node의 `.env` 설정만으로 OBS 프로세스의 환경은 변경되지 않습니다.

필터는 비동기 영상 입력용입니다. OBS의 각 감시 소스에 추가합니다.

```powershell
Set-Location projects/obs-watchdog
node --env-file-if-exists=.env src/cli.js filter add "카메라(3)"
node --env-file-if-exists=.env src/cli.js filter check "카메라(3)"
node --env-file-if-exists=.env src/cli.js watch
```

`Ctrl+C`로 종료합니다. Windows 백그라운드 실행은 `just start-native`, 중지는 `just stop-native`, 상태·로그는 `just status-native`, `just logs-native`를 사용합니다. `just`가 없어도 `powershell.exe -File tools/manage-watchdog.ps1 start native`처럼 호출할 수 있습니다. 각 프로세스는 현재 프로젝트의 절대 경로로 구분합니다. 시작 직후 실패는 `native.stderr.log`에서 확인합니다.

## 수동 복구와 필터 관리

```powershell
node --env-file-if-exists=.env src/cli.js recover "화면4"
node --env-file-if-exists=.env src/cli.js filter reattach "카메라(3)"
node --env-file-if-exists=.env src/cli.js filter remove "카메라(3)" "화면4"
```

복구는 원래 입력 설정을 `overlay: true`로 다시 적용하는 요청입니다. 장치가 실제로 회복됐는지는 다음 프레임 관측과 OBS 화면으로 확인합니다. 필터 도구의 기본 종류는 모두 `frame_arrival_probe_native`이며, 다른 필터는 제거하지 않습니다. `filter add`의 마지막 인자로 다른 filterKind를 지정할 수 있습니다.

기존 `obs-camera-watchdog-native.js`, `obs-camera-watchdog.js`, `tools/obs_*.js`는 공통 CLI를 호출하는 호환 진입점으로 남아 있습니다. 스크린샷 해시 방식은 `watch-pixels` 또는 `just start`로 실행하며, 정상적인 정지 화면도 멈춤으로 판정하므로 센서 노이즈가 있는 웹캠에만 사용합니다.

## 동작과 검증

필터는 프레임 도착 때 카운터를 증가시키고, OBS render tick에서 500ms마다 heartbeat를 기록합니다. 프레임이 끊겨도 갱신 시각은 계속 바뀌므로 고정된 카운터를 감지할 수 있습니다. 임시 파일을 쓴 뒤 교체해 부분 기록을 줄이며, UTF-8 소스 이름은 파일 내용으로 매칭합니다. 숨겨진 소스, 유실·오래된 파일, 조회 실패는 카운터 비교 상태를 초기화합니다. 요청 타임아웃이나 연결 종료는 대기 요청을 모두 해제하고 재접속으로 이어집니다.

캡처보드 장애로 heartbeat 기록 자체가 멎는 경우도 감시합니다. `videoShowing=true`인 소스에서 같은 파일·카운터·기록 시각의 stale 관측이 `staleRecoverMs` 동안 지속되고, 파일 기록도 그 시간 이상 오래됐을 때 복구 후보가 됩니다. 기본 설정에서는 마지막 기록 후 약 5초에 경고를 시작하고, 그 뒤 15초 이상 계속 보이는 상태로 갱신이 없으면 복구 후보가 됩니다. 갱신·파일 교체·숨김·파일 유실·상태 조회 실패는 지속 시간을 초기화합니다. 미래 시각의 파일은 복구 근거로 쓰지 않습니다.

stale 복구에는 같은 감시 주기에 **다른 감시 소스가 보이고 heartbeat가 최신인 증거**가 필요합니다. `sources`에 캡처보드와 함께 정상적으로 보이는 카메라 등도 넣습니다. 단일 소스만 감시하거나, 다른 소스가 모두 숨김·유실·stale·조회 실패 상태이면 복구를 보류하고 경고합니다. 이는 OBS/프로브 전체 갱신 중단과 소스별 장애를 구분하기 위한 조건이며, 최신 heartbeat만으로 다른 소스의 영상 정상 여부까지 보장하지는 않습니다. 최신 파일에서 카운터만 고정되는 기존 복구에는 이 추가 조건이 적용되지 않습니다.

자동 복구 직전에 사유(`frozen`/`stale`), 카운터, 기록 시각, 경과 시간, `videoActive`/`videoShowing`, 정상 heartbeat가 있는 소스 이름을 로그로 남깁니다. 복구 성공·실패와 dry-run 모두 쿨다운을 적용합니다. `dryRun: true`로 먼저 시험 운영해 로그의 `dry-run: would request recovery`가 실제 장애와 일치하는지 확인한 다음 `false`로 바꿔 감시기를 다시 시작합니다. dry-run은 `watch`와 `watch-pixels`의 자동 복구에 적용되며 수동 `recover`와 필터 관리 명령은 그대로 실행됩니다.

2026-10-10 캡처보드 장애 기록의 구형 DLL은 소스 이름을 포함한 파일을 작업 폴더에 기록했습니다. 현재 저장소 DLL은 `%TEMP%\obs-watchdog`에 PID·포인터 기반 파일을 기록하고 파일 내용에서 소스 이름을 읽습니다. 구형 설치에서 전환할 때는 위 빌드·설치 절차로 DLL을 교체하고 OBS를 다시 시작한 뒤 실제 heartbeat 디렉터리와 필터를 확인합니다. 설정 변경만으로 구형 DLL의 출력 위치가 바뀌지는 않습니다.

```powershell
# 저장소 루트: OBS와 실제 장치를 사용하지 않는 테스트
node scripts/check.js
node scripts/test.js
# Windows 네이티브 heartbeat 생성, 멈춘 카운터 기록, 소스 이름 변경, 파일 정리
powershell.exe -NoProfile -File projects/obs-watchdog/native-probe/build.ps1 -Test
```

CI는 Linux/Windows와 Node.js 22/24에서 JavaScript 검사·테스트를 실행합니다. 네이티브 테스트는 OBS 콜백을 모사하는 실행 파일로 검증하며, 실제 OBS 로드·장치 복구를 보장하지 않습니다. 설치 후 실제 OBS에서 필터 로드, heartbeat 생성, 숨김 상태, 프레임 중단 후 복구를 확인합니다.

실제 설치된 OBS 코어를 사용하는 추가 검증은 명시적으로 실행할 수 있습니다. OBS GUI 실행이나 DLL 설치 없이 별도 프로세스에서 `obs.dll`과 D3D11 렌더러를 사용하고, 합성 비동기 영상에 빌드한 필터를 연결합니다. 실제 장치, 저장된 장면·프로필, 방송·녹화는 사용하지 않습니다. 이 검증은 일반 `build.ps1 -Test`나 CI에 포함되지 않습니다.

```powershell
# OBS 32.2.2 설치와 Zig 0.14.0 필요; 저장소 루트에서 실행
powershell.exe -NoProfile -File projects/obs-watchdog/native-probe/test-installed-obs.ps1 -ObsBinDir 'C:\Program Files\obs-studio\bin\64bit'
```

PowerShell 실행 정책 때문에 스크립트가 차단되면 해당 실행에만 `-ExecutionPolicy Bypass`를 추가할 수 있습니다. 이 선택적 하네스의 설치·작업 폴더 경로는 ASCII여야 합니다. OBS 버전이 32.2.2가 아니면 테스트를 거부합니다. 필터 생성·해제 100회, 동일 픽셀 프레임의 카운터 증가, 입력 중단 시 고정 카운터와 계속 갱신되는 기록 시각, UTF-8 소스 이름 변경, 숨김 상태, 필터 제거 후 파일 삭제를 검사합니다. 종료 시 OBS 코어와 GPU 자원을 해제하며 전체 로그는 Git에서 제외된 `native-probe/build/installed-obs-smoke.log`에 남깁니다. GUI 플러그인 검색·로드, 실제 캡처보드/USB 드라이버, 감시기의 실제 장치 복구, 장시간 안정성은 이 테스트 범위 밖입니다.

프로토콜 기준: [공식 obs-websocket 5.x 문서](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md). 네이티브 ABI 참고: [OBS 32.2.2 소스 헤더](https://github.com/obsproject/obs-studio/blob/32.2.2/libobs/obs-source.h).
