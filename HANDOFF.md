# HeyU 작업 인수인계

> 이 문서는 **다른 세션이 맥락 없이 이어받기 위한** 것이다.
> "무엇을 했는지"는 코드에 남지만 **"왜 그렇게 했는지"** 는 남지 않으므로 그쪽에 무게를 둔다.
> 최종 갱신: 2026-09-18

---

## 0. 한 줄 요약

영상을 넣으면 영어 립싱크 더빙을 돌려주는 Electron 데스크톱 앱.
**동작하는 상태이고 DMG/EXE까지 나왔다.** 다만 **실제 더빙은 아직 한 번도 돌려보지 않았다.**

---

## 1. 원래 요구사항과 검증 결과

사용자가 요구한 5가지와, 착수 전 실제로 검증한 결과다.

| # | 요구 | 결과 | 비고 |
|---|---|---|---|
| 1 | Win/Mac 프로그램 | 구현됨 | Electron 33 |
| 2 | Google OAuth 로그인 | 구현됨 | RFC 8252, PKCE + 루프백 |
| 3 | ChatGPT 개인계정 연결 | **불가능** | 아래 §2 |
| 4 | HeyGen MCP를 ChatGPT에 연결 | **경로 변경** | 아래 §2 |
| 5 | 2분 미만 영상 → 영어 더빙(립싱크) | 구현됨 | HeyGen Video Translation |

추가로 사용자가 나중에 요청한 것:
- 로그인 게이트 (로그인 전 기능 잠금) → **구현됨**
- 조직 도메인 제한 (`@titanz.co.kr` 등) → **구현됨**
- DMG / EXE 배포 파일 → **생성됨**

---

## 2. 가장 중요한 결론 — ChatGPT를 경로에서 제거한 이유

**이걸 모르고 다시 ChatGPT 연동을 시도하면 시간을 버린다.**

### 개인 ChatGPT 구독은 외부 앱에서 쓸 수 없다

- **"Sign in with ChatGPT"는 신원 확인 전용이다.** 앱이 받는 값은 이름·이메일·프로필 사진뿐이고
  추론 호출 권한은 없다. Google OAuth와 같은 역할이다.
  → https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt
- **구독 할당량은 OpenAI 자사 제품 전용이다.** ChatGPT 앱과 Codex(CLI/IDE/데스크톱)가 전부.
  공식 문서가 서드파티는 API 키를 쓰라고 명시한다.
  → https://learn.chatgpt.com/docs/auth
- **웹 세션 리버스 엔지니어링은 약관 위반이다.** OpenAI는 실제로 해당 계정들을 정지시킨 전례가 있다.
  → https://openai.com/policies/row-terms-of-use/

### ChatGPT에 붙인 MCP 커넥터는 외부에서 호출할 수 없다

ChatGPT Developer Mode로 커스텀 MCP 커넥터를 등록하는 것 자체는 된다(Plus/Pro/Business).
하지만 그건 **chatgpt.com UI 안에서 사람이 쓸 때만** 동작한다.
`앱 → ChatGPT → HeyGen MCP` 체인은 첫 화살표에서 끊긴다.

### 그래서 어떻게 했나

**앱이 HeyGen을 직접 호출한다.** 기능 손실은 0이다 —
"영상 넣으면 영어 더빙이 나온다"는 HeyGen API 호출 한 번이고, 그 사이에 LLM이 할 일이 없다.

OpenAI는 **선택적 대화 레이어**로만 남겼다. 키가 없으면 채팅 패널만 꺼지고 더빙은 정상 동작한다.
사용자가 이 방향(OpenAI API 키로 LLM 추가)을 명시적으로 선택했다.

---

## 3. 아직 반영 안 된 중요한 발견 — HeyGen MCP는 서버 없이 붙일 수 있다

사용자가 "HeyGen MCP 연동"을 계속 요청했고, 마지막에 실제로 조사해서 **가능하다는 걸 확인했다.
아직 구현하지 않았다.** 다음 세션의 가장 유력한 다음 작업이다.

```
엔드포인트: https://mcp.heygen.com/mcp/v1/   (Streamable HTTP MCP)
인증 서버:  https://api2.heygen.com
  authorization_endpoint: /v1/oauth/authorize
  token_endpoint:         /v1/oauth/token
  registration_endpoint:  /v1/oauth/register   ← 동적 클라이언트 등록(DCR) 지원
  PKCE: S256
  grant types: authorization_code, client_credentials, refresh_token, device_code
```

**DCR을 지원하므로 서버가 필요 없다.** 데스크톱 앱이 스스로 클라이언트를 등록하고
PKCE로 브라우저 로그인(이미 만든 Google 루프백 방식 그대로)을 하면 된다.

이게 주는 이점:
- 사용자가 **API 키를 복사·붙여넣기 할 필요가 없다.** "HeyGen 연결" 누르고 로그인하면 끝.
- HeyGen 도구 전체(아바타, 번역, 립싱크, 음성 복제 등 100개 이상)를 채팅으로 쓸 수 있다.
- 회사 Business 워크스페이스에 팀원을 초대하면 **크레딧 풀을 공유**하면서도
  회사 API 키를 아무에게도 배포하지 않는다.

구현 시 참고: `src/main/auth/google.ts` 의 루프백 + PKCE 패턴을 거의 그대로 재사용할 수 있다.
MCP 클라이언트는 `@modelcontextprotocol/sdk` 를 쓰면 된다.

---

## 4. 서버가 필요한가 — 현재 판단

**기능적으로는 전부 서버 없이 된다.** 실제로 서버 없이 다 만들었다.
다만 아래 네 가지는 서버 없이는 **원리적으로 불가능**하다.

| 필요한 것 | 서버 없이 가능? | 이유 |
|---|---|---|
| Google 로그인 | 가능 | PKCE 루프백 |
| 더빙 파이프라인 | 가능 | REST 직접 호출 |
| HeyGen MCP 연동 | 가능 | DCR + PKCE (§3) |
| 개인별 AI 계정 | 가능 | 각자 자기 키 |
| **도메인 제한 강제** | **불가능** | 클라이언트 검사는 앱을 고치면 우회됨 |
| **사용량·비용 추적** | **불가능** | 누가 크레딧 얼마나 썼는지 집계 불가 |
| **앱 종료 후 결과 수신** | **불가능** | webhook `callback_url` 받을 공개 엔드포인트 필요 |
| **회사 키 은닉** | **불가능** | 배포된 키는 추출 가능 (단 MCP OAuth로 우회 가능 — §3) |

**미결정 사항이다. 사용자에게 확인해야 한다.**

---

## 5. 구조

```
Electron 메인 프로세스 ─ 자격증명·네트워크·파일 전담
  ├─ index.ts            창 생성, heyu-media 프로토콜 등록
  ├─ auth/google.ts      Google OAuth (PKCE + 127.0.0.1 루프백) + 도메인 검증
  ├─ services/heygen.ts  업로드 → 번역 → 폴링 → 다운로드
  ├─ services/openai.ts  도구 호출 오케스트레이터 (선택)
  ├─ store.ts            safeStorage 암호화 저장소
  └─ ipc.ts              파이프라인 + IPC 핸들러 + requireSignIn 게이트
        ↕ contextBridge (API 키 값은 렌더러로 건너가지 않는다)
렌더러 (React)
  ├─ App.tsx             로그인 게이트 분기
  ├─ components/Login.tsx
  ├─ components/DubPanel.tsx
  ├─ components/Chat.tsx
  └─ components/Settings.tsx
```

### 설계 결정과 이유

- **API 키는 메인 프로세스 밖으로 안 나간다.** 렌더러는 "설정됨/미설정"만 본다.
- **`heyu-media://` 전용 프로토콜을 팠다.** `file://`을 렌더러에 열어주면 임의 경로를 읽을 수 있다.
- **동시 작업 1건으로 제한했다.** 크레딧 낭비와 UI 혼선 방지. 의도적이다.
- **`requireSignIn()`을 메인 프로세스에도 걸었다.** 렌더러에서 화면만 가리면
  IPC 채널이 그대로 열려 있어 우회된다.

---

## 6. 함정 — 여기서 실제로 막혔던 것들

### (1) `ELECTRON_RUN_AS_NODE=1`

VS Code 확장 호스트가 이 변수를 걸어둔다. 값이 살아 있으면 Electron 바이너리가 **순수 Node로 동작**해서
`require('electron')`이 API 객체 대신 실행파일 경로 문자열을 돌려주고, 앱이 즉시 죽는다.

증상이 오해를 부른다 — 처음에 ESM 로더 문제로 잘못 진단했다.
`electron.vite.config.ts` 맨 위에서 `delete process.env.ELECTRON_RUN_AS_NODE` 로 처리했으므로
`npm run dev`는 그냥 된다. **빌드된 바이너리를 직접 실행할 때는 적용 안 된다:**
```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .
```

### (2) HeyGen 업로드 32MB 상한

멀티파트 `POST /v3/assets`는 **32MB 제한**이 있다. 2분짜리 1080p 영상은 이걸 쉽게 넘는다.
그래서 presigned direct-upload 경로로 고정했다:
```
POST /v3/assets/direct-uploads → PUT <presigned url> → POST /v3/assets/{id}/complete
```
`upload_headers`는 서명에 포함되므로 **한 글자도 바꾸지 말고 그대로** 보내야 한다.

### (3) 로그인 게이트의 닭과 달걀

Google 로그인에는 클라이언트 ID가 필요한데 그 입력칸이 설정 화면(로그인 뒤)에 있으면
영원히 못 들어간다. 두 경로를 다 열어서 해결:
- 배포 빌드에 심기: `GOOGLE_CLIENT_ID=... ALLOWED_DOMAINS=... npm run pack:mac`
- 심어두지 않으면 로그인 화면 안에 입력칸이 뜬다

### (4) 도메인 제한은 보안 경계가 아니다

인증 URL의 `hd` 파라미터는 **화면 힌트일 뿐** 조작 가능하다.
실제 검증은 Google이 서명한 **ID 토큰의 `hd` 클레임**으로 한다 (`assertAllowedDomain`).
그래도 **사용자 PC에서 도는 검사라 앱을 고치면 우회된다.** 진짜 차단은 서버가 해야 한다.

### (5) macOS 코드 서명 없음 — 배포 시 문제됨

인증서가 없어 `identity: null`로 서명을 건너뛴다. 결과:
```
spctl 판정: code has no resources but signature indicates they must be present
```
**사용자가 그냥 열면 Gatekeeper가 막는다.** 임시 우회:
```bash
xattr -dr com.apple.quarantine /Applications/HeyU.app
```
사내 배포라도 이건 불편하다. **Apple Developer 계정($99/년)으로 서명 + 공증(notarization)이
필요하다.** 미결정 사항이다.

Windows EXE도 서명 안 됨 → SmartScreen 경고가 뜬다.

---

## 7. 현재 상태

### 검증된 것
- `npm run build` 통과 (타입체크 포함)
- 앱 기동 성공, 콘솔 오류 0건
- 로그인 게이트 두 시나리오 확인 (클라이언트 ID 있음/없음), 본 화면 유출 없음
- DMG 마운트·번들 구조·Info.plist 확인
- HeyGen 계정 확인: `business_plus`, add-on 크레딧 491개

### 배포 파일 (`release/`)
```
HeyU-0.1.0-arm64.dmg   94MB   (Apple Silicon)
HeyU-0.1.0-x64.dmg     98MB   (Intel Mac)
HeyU-0.1.0-x64.exe     78MB   (Windows, NSIS 설치 프로그램)
```
Windows EXE는 macOS에서 빌드했다. electron-builder가 **자체 Wine을 내려받아** 처리하므로
시스템에 Wine을 깔 필요가 없다.

### 검증 안 된 것 — 가장 중요
**실제 더빙을 한 번도 돌리지 않았다.** 크레딧이 실제로 소모되어(2분 ≈ 10크레딧)
사용자 동의 없이 쓰지 않았다. 파이프라인 전체가 실물로 검증되지 않은 상태다.

**다음 세션이 가장 먼저 해야 할 일이다.** HeyGen API 키를 설정에 넣고 짧은 영상으로 1건 돌려서
업로드→번역→폴링→다운로드가 끝까지 도는지 확인해야 한다.

---

## 8. 남은 일 (우선순위 순)

1. **실제 더빙 1건 실행 검증** — 위 참조. 사용자 동의 필요(크레딧 소모).
2. **HeyGen MCP 연동** (§3) — 서버 불필요 확인됨. API 키 수동 입력을 없앨 수 있다.
3. **서버 필요 여부 결정** (§4) — 사용자 확인 대기 중.
4. **코드 서명 / 공증** (§6-5) — 배포하려면 사실상 필수.
5. 작업 상태 영속화 — 앱 닫으면 폴링이 끊긴다. `callbackUrl`(웹훅)은 클라이언트가 이미 지원.
6. Google 리프레시 토큰을 저장만 하고 안 쓴다. 신원 확인이 전부라 지금은 갱신할 이유가 없다.

---

## 9. 실행 방법

```bash
npm install
npm run dev        # 개발 모드 (창이 뜬다)
npm run build      # 타입체크 + 번들
npm run pack:mac   # DMG (arm64 + x64)
npm run pack:win   # EXE (NSIS)
```

앱을 켠 뒤 순서:
1. Google 로그인 (클라이언트 ID 없으면 로그인 화면에서 입력)
2. 설정 → HeyGen API 키 입력 (저장 시 실제 호출로 검증함)
3. 영상 선택 → "영어로 더빙하기"
4. 결과는 `~/Movies/HeyU/` 에 저장

OpenAI 키와 채팅은 선택이다. 없어도 더빙은 된다.

---

## 10. 사용자 관련 메모

- **앱을 띄울 때는 미리 말할 것.** 검증하느라 창을 반복해서 띄웠다 껐더니 사용자가 불편해했다.
  오프스크린 캡처(`show: false` + `webContents.capturePage()`)를 쓰면 화면을 가리지 않는다.
- 사용자가 선택한 것: **Electron**(Tauri 아님), **OpenAI API 키로 LLM 추가**(제거 아님).
- 앱 이름은 **HeyU**. (Shottr는 무관한 macOS 스크린샷 앱이며 한 번 혼동이 있었다.)
