# HeyU

2분 내외의 영상을 넣으면 **영어 립싱크 더빙** 결과를 돌려주는 Windows / macOS 데스크톱 앱.

---

## 사용 방법

1. Google 계정으로 로그인한다.
2. HeyGen 계정을 브라우저 OAuth로 연결한다.
3. 영상을 선택하고 옵션을 정한 뒤 **영어로 더빙하기**를 누른다.
4. 완료된 영상을 앱에서 재생하거나 `~/Movies/HeyU/`에서 연다.

앱이 HeyGen MCP를 직접 호출한다. 별도 AI 로그인과 채팅은 필요하지 않다.

## 구조

- `auth/google.ts`: 조직 Google 로그인
- `auth/heygenMcp.ts`: HeyGen OAuth 연결
- `services/heygenMcp.ts`: MCP 세션과 도구 호출
- `services/heygenMcpTransport.ts`: 업로드·번역·조회 MCP 연결
- `services/heygen.ts`: 더빙 클라이언트 (기존 REST 작업 조회 호환 포함)
- `services/download.ts`: 임시 파일 다운로드·무결성 검사·완료 파일 저장
- `jobStore.ts`: 진행 중인 번역 ID와 최근 결과 저장
- `ipc.ts`: 더빙 실행과 진행 상태 전달

`create_asset_upload` → 스토리지 PUT → `complete_asset_upload` →
`create_video_translation` → `get_video_translation` → 결과 다운로드 순서다.
새 작업은 API 키 경로로 전환하지 않는다.

## 설치와 실행

설치 파일은 [GitHub Releases](https://github.com/ClassAround/HeyU/releases)에서 받습니다.
Mac은 v0.1.1 이상을 사용하세요. 테스트 빌드에는 ad-hoc 서명만 적용되어 있으며
Apple Developer ID 서명·공증은 없습니다. 최초 실행이 차단되면 파일 출처를 확인한 후
시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기를 사용합니다.

```bash
npm install
npm run dev        # 개발 모드
npm run build      # 타입체크 + 번들
npm run pack:mac   # DMG
npm run pack:win   # NSIS 인스톨러
```

Node 22 기준으로 개발했다.

> **`ELECTRON_RUN_AS_NODE` 관련 메모**
> VS Code 확장 호스트와 일부 IDE 통합 터미널은 이 변수를 1로 걸어둔다. 값이 살아 있으면
> Electron 바이너리가 순수 Node로 동작해 `require('electron')`이 API 객체 대신 실행파일
> 경로 문자열을 돌려주고, 앱이 즉시 죽는다.
>
> `electron.vite.config.ts` 맨 위에서 이 변수를 지우므로 `npm run dev`는 그냥 동작한다.
> 다만 **빌드된 바이너리를 직접 실행할 때는 적용되지 않는다** — 그 경우
> `env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .` 으로 띄운다.

---

## 설정

앱 우상단 **설정**에서 입력한다. 값은 macOS 키체인 / Windows DPAPI로 암호화되어 이 PC에만 남는다.

### HeyGen 계정 — 더빙에 필요

설정에서 브라우저 OAuth로 연결한다. API 키 입력은 제공하지 않는다.
MCP를 사용해도 웹 플랜의 잔액·기능 권한은 필요하며 부족하면 HeyGen이 요청을 거절할 수 있다.

### Google 로그인 — 필수

로그인하기 전에는 본 화면이 뜨지 않는다. 영상 선택·더빙 핸들러도 메인 프로세스에서
로그인 여부를 확인한다 (`requireSignIn`). 렌더러에서 화면만 가리면 IPC 채널이 그대로
열려 있어 우회되기 때문이다.

**클라이언트 ID를 넣는 두 가지 경로:**

1. **배포 빌드에 심기** — 권장. OAuth 클라이언트 ID는 비밀이 아니라 바이너리에 들어가도 된다.
   ```bash
   GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com \
   ALLOWED_DOMAINS=titanz.co.kr \
   npm run pack:mac
   ```
2. **로그인 화면에서 입력** — 심어두지 않으면 첫 화면에 입력칸이 뜬다. 한 번 넣으면 저장된다.

설정 화면은 로그인 뒤에 있으므로, 심어두지 않은 빌드에서 로그인 화면에 입력칸이 없으면
영원히 들어갈 수 없다. 그래서 두 경로를 모두 열어 두었다.

Google Cloud Console → 사용자 인증 정보 → OAuth 클라이언트 ID →
애플리케이션 유형을 반드시 **데스크톱 앱**으로 만든다. 웹 애플리케이션 유형은 동작하지 않는다.

리디렉션 URI는 등록할 필요가 없다. 루프백 주소는 Google이 데스크톱 앱 유형에 한해
포트를 가리지 않고 허용한다.

`client_secret`이 바이너리에 들어가도 된다 — 데스크톱 앱 클라이언트의 secret은
Google 문서상 기밀로 취급되지 않고, 실제 보호는 PKCE가 담당한다.

### 허용 도메인

쉼표로 구분해 입력한다 (예: `titanz.co.kr`). 비우면 제한이 없다.

검증은 Google이 서명한 **ID 토큰의 `hd` 클레임**으로 한다. 인증 URL의 `hd` 파라미터는
계정 선택 화면을 좁혀주는 힌트일 뿐 조작 가능하므로 그것만 믿지 않는다.
`hd`가 없는 계정은 `email_verified`가 참인 이메일의 도메인으로 판단한다.

> **이 검사는 보안 경계가 아니다.**
> 사용자 PC에서 실행되므로 앱을 수정하면 우회된다. 같은 이유로 저장된 자격증명도
> 사용자 손에 있다. 실제로 접근을 차단해야 한다면 키를 쥔 서버를 두고 거기서 검증해야 한다.
> 지금 구조에서 도메인 제한은 "잘못된 계정으로 들어오는 것을 막는 안내"다.

---

## 비용

연결된 HeyGen 웹 플랜의 MCP 크레딧 정책과 기능 권한이 적용된다.

옵션 중 `precision` 모드는 립싱크 품질이 높은 대신 생성이 느리다. `speed`가 기본값보다
빠르지만 정밀도가 낮다. 앱 기본값은 `precision`이다.

---

## 알려진 한계

- **길이 제한은 경고만 한다.** 2분을 넘겨도 진행할 수 있다. 분당 과금이라 길수록 비싸질 뿐
  기술적으로 막히지는 않기 때문이다. 정책상 강제해야 하면 `DubPanel.tsx`의 `tooLong`을
  버튼 비활성화로 연결한다.
- **동시 작업은 1건이다.** 크레딧 소모와 UI 혼선을 막기 위해 의도적으로 막았다.
- **작업 재개:** 번역 ID를 저장하며 앱을 다시 열면 진행 중인 작업 조회를 재개한다.
- **Google 리프레시 토큰을 저장만 하고 쓰지 않는다.** 현재 로그인은 신원 확인이 전부라
  갱신할 이유가 없다. Google API를 실제로 호출하게 되면 갱신 로직을 붙여야 한다.

### 검증

`npm test`는 MCP 업로드·번역·조회 연결, 실패 시 API 대체 호출 금지,
다운로드 취소·손상 파일 거부·완료 파일 보존을 검증한다. 실제 더빙 크레딧은 사용하지 않는다.
