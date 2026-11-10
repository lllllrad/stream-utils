# midi-api

Launchpad MIDI 입력을 로컬 API로 제공하고, Warudo가 API를 조회해 **누르는 동안만** Leap Motion 포즈 트래킹을 적용합니다.

```text
빨간 Launchpad MK2 → WinMM 입력 보조 프로세스 → TypeScript HTTP 서버
                                               ↑ HTTP 조회
                                      Warudo Leap Motion Gate
                                               ↓
                                Leap Motion 보간 조건 / 가중치 제어
```

MIDI 장치를 여는 곳은 API 서버의 보조 프로세스뿐입니다. Warudo에는 MIDI 수신기를 추가하지 않습니다. API 서버에 Warudo 인증 토큰도 필요하지 않습니다. 기존 Leap Motion 트래킹 블루프린트를 사용하며, 센서 서비스 자체를 종료하지는 않습니다.

## 환경과 실행

- Windows, Windows PowerShell 5.1, Node.js 22.15 이상
- TypeScript 소스를 빌드하면 CommonJS JavaScript가 생성됩니다. 런타임 npm 의존성은 없습니다.
- Warudo 0.15.1용 Playground 연동 코드. 이미 Leap Motion 트래킹 설정이 있는 씬이 필요합니다.

저장소 루트에서 실행합니다.

```powershell
npm install
npm run build --workspace @stream-utils/midi-api
npm run devices --workspace @stream-utils/midi-api
Copy-Item projects/midi-api/config.example.json projects/midi-api/config.local.json
npm start --workspace @stream-utils/midi-api
```

기본 선택은 이름이 정확히 `Launchpad MK2`인 입력입니다. 이 세션에서 빨간색으로 켠 장치이며, 파란 장치 `2 - Launchpad MK2`는 열지 않습니다. 여러 장치가 같은 이름으로 검색되면 임의 선택하지 않습니다. `--list`에서 장치 인터페이스가 제공되면 `deviceInterface`에 그 값을 지정해 이름 대신 고정할 수 있습니다. 일부 Windows MIDI 드라이버는 이 값을 빈 문자열로 반환하므로, 이때에는 정확한 이름을 사용합니다. USB 연결을 바꿔 Windows 장치 이름이 변경되면 다시 확인하세요.

`config.local.json`은 Git에서 제외됩니다. 별도 파일은 `node projects/midi-api/dist/src/cli.js --config FILE`로 지정합니다. 포트 기본값은 `19100`이며 `127.0.0.1`에만 바인딩합니다. 보조 프로세스는 해당 프로세스에만 `-ExecutionPolicy Bypass`를 전달해 저장소의 PowerShell 진입점을 실행합니다. 시스템 실행 정책은 변경하지 않습니다.

## 동작과 API

아무 패드나 버튼을 하나 이상 누르면 `trackingEnabled: true`, 전부 떼면 `false`입니다. Note On, Note Off, velocity 0 해제, MK2 상단 CC 104–111을 처리하고, 압력·클록·다른 CC 메시지는 활성화 조건으로 사용하지 않습니다. 토글 방식이 아닙니다.

| GET 경로 | 반환 값 |
| --- | --- |
| `/health` | 서버 상태와 MIDI 연결 상태 |
| `/v1/devices` | 보조 프로세스가 확인한 입력 장치 목록 |
| `/v1/state` | 현재 연결·누름·트래킹 허용 상태 |

```json
{"schemaVersion":1,"connected":true,"trackingEnabled":true,"pressedCount":1,"pressed":["note:0:11"],"device":{"id":0,"name":"Launchpad MK2","deviceInterface":""},"lastError":null,"lastWarudoRequestAt":null}
```

응답은 캐시하지 않습니다. 장치 분리·보조 프로세스 오류·입력 오버플로가 감지되면 누름 상태를 비우고 2초 뒤 재연결합니다. 보조 프로세스의 250ms 하트비트가 기본 1500ms 동안 없으면 꺼집니다. 장치 목록 변경 확인은 1초 간격입니다. 재연결 후 이전의 누름 상태는 복구하지 않고 새 누름을 기다립니다. `/health`의 `ok`는 HTTP 서버 자체의 생존 여부이며, 장치 연결은 `midiConnected`를 확인합니다.

## Warudo 연결

1. Warudo의 **Menu → Open Data Folder**에서 `StreamingAssets` 경로를 확인합니다.
2. 다음 명령으로 소스 파일 하나를 Playground에 설치합니다. 다른 파일은 변경하지 않습니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File projects/midi-api/tools/install-warudo.ps1 -WarudoDataDirectory 'C:\path\to\Warudo\Warudo_Data\StreamingAssets'
```

3. Warudo **Assets → Add Asset → External Integration → MIDI API Leap Motion Gate**를 추가합니다. Playground가 소스를 자동 컴파일하며, Warudo를 다시 시작할 필요가 없습니다.
4. `Api Url`은 `http://127.0.0.1:19100/v1/state?consumer=warudo`, `Tracking Blueprint Name`은 기존 `Pose Tracking - Leap Motion` 이름과 일치시킵니다. 서버 포트를 바꿨다면 URL도 맞춥니다.
5. 씬을 저장합니다. 에셋이 기존 Leap Motion 데이터와 보간 노드 사이에 `MIDI API Tracking Condition` 노드 3개를 연결합니다. 이미 연결된 씬에서는 중복 생성하지 않습니다. 얼굴 트래킹 블루프린트는 제어하지 않습니다.

`Fade In Seconds` 기본값은 **0.25초**, `Fade Out Seconds`는 **0.4초**입니다. Warudo 에셋에서 두 값을 따로 조절할 수 있습니다(0–5초). 기존 블루프린트의 InOutSine 보간을 사용해 뼈 회전 가중치와 손 IK 가중치를 함께 전환합니다. 손 트래킹이 실제로 감지되고 패드도 눌려 있어야 진입합니다. 모든 패드를 떼면 트래킹 적용량이 0으로 돌아갑니다. 빠르게 다시 눌러도 기존 보간 노드가 현재 상태에서 목표를 전환합니다.

해제 중에도 포즈 블루프린트를 계속 실행해 복귀 보간이 완료되도록 합니다. 따라서 블루프린트의 눈 아이콘은 켜져 있어도 패드를 누르지 않으면 트래킹 적용량은 0입니다. 기존 `On Disable Graph`를 매번 호출해 자세가 즉시 바뀌는 동작은 사용하지 않습니다.

Warudo는 요청 완료 후 30ms 간격으로 API를 조회합니다. 요청 실패·응답 오류·500ms 초과 무응답이면 트래킹 허용 조건을 닫고 같은 복귀 보간을 적용합니다. API 서버가 실행 중이어야 하며, 자동 시작 등록은 포함하지 않습니다.

확인은 빨간 장치의 패드를 눌러 손을 움직인 뒤 떼는 방식으로 합니다. 다중 패드 입력도 확인하세요. `GET /v1/state`의 `lastWarudoRequestAt`과 Warudo 에셋의 `Status`에서 실제 통신을 확인할 수 있습니다.

## 검사

```powershell
node scripts/check.js
node scripts/test.js
# 설치된 Warudo DLL 컴파일 검사와 가짜 Warudo 로컬 하네스 (라이브 씬 변경 없음)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File projects/midi-api/tools/check-warudo.ps1 -WarudoDataDirectory 'C:\path\to\Warudo\Warudo_Data\StreamingAssets' -Test
```

자동 테스트는 가짜 MIDI 이벤트, 로컬 HTTP 서버, 가짜 Warudo 그래프를 사용합니다. C# 하네스는 보간 연결, 해제 시 그래프 유지, 시간 조절, 씬 재연결의 중복 방지, API 오류 처리를 검사합니다. 실제 Unity 보간의 시각적 품질은 라이브 씬에서 확인합니다. 실제 장치를 누르거나 Warudo에 설치하는 자동 테스트는 하지 않습니다.

Warudo의 [Playground](https://docs.warudo.app/docs/scripting/creating-your-first-script), [씬 API](https://docs.warudo.app/docs/scripting/api/scene), [에셋 생명주기](https://docs.warudo.app/docs/scripting/api/assets)를 사용합니다.
