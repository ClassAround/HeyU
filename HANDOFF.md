# HeyU 작업 인수인계

> **현재 상태 — v0.1.0 설치 테스트 (2026-09-18)**
> 현재 구현과 설치 방법은 `README.md`와 `docs/releases/v0.1.0.md`를 기준으로 한다.
> Google 로그인 후 앱이 HeyGen MCP를 직접 호출한다. ChatGPT 로그인, 채팅,
> OpenAI API 키 및 Codex 의존성은 제거했다. 실제 더빙 결과의 다운로드와
> 영상·음성 디코딩을 확인했고, 다운로드 파일 검증과 원자적 저장을 추가했다.
> 자동 테스트 9개, 타입 검사, 프로덕션 빌드가 통과했다.
> Windows x64와 macOS arm64/x64 설치 파일을 만들었으며 다른 PC에서의
> 설치 검증은 남아 있다. 아래 내용은 이전 설계와 조사 기록으로,
> 현재 기능·지원 범위에 관한 설명으로 사용하지 않는다.

> 이 문서는 **다른 세션이 맥락 없이 이어받기 위한** 것이다.
> "무엇을 했는지"는 코드에 남지만 **"왜 그렇게 했는지"** 는 남지 않으므로 그쪽에 무게를 둔다.
> 최종 갱신: 2026-09-18 (HeyGen MCP OAuth 연동 구현)

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
| 2 | Google OAuth 로그인 | 구현됨 | RFC 8252, PKCE + 루프백 · `@titan.kr` 기본 잠금 |
| 3 | ChatGPT 개인계정 연결 | **코드 완성 · 승인 대기** | 아래 §2 |
| 4 | HeyGen MCP를 ChatGPT에 연결 | **경로 변경 후 구현됨** | 아래 §2, §3 |
| 5 | 2분 미만 영상 → 영어 더빙(립싱크) | 구현됨 | HeyGen Video Translation |

추가로 사용자가 나중에 요청한 것:
- 로그인 게이트 (로그인 전 기능 잠금) → **구현됨**
- 조직 도메인 제한 → **구현됨.** 빌드에서 지정하지 않으면 **`titan.kr` 로 잠긴다**
  (예전 문서에는 `titanz.co.kr` 로 적혀 있었으나 사용자가 `titan.kr` 로 확정했다)
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

### 다만 두 가지는 갱신됐다 (2026-09-18 재조사)

**(1) MCP 는 우회로가 있다.** `앱 → ChatGPT UI → MCP` 는 막히지만
**`앱 → OpenAI Responses API → HeyGen MCP` 는 뚫린다.** Responses API 의 `type: "mcp"` 도구로
원격 MCP 서버를 모델에 직접 붙일 수 있고, `authorization` 필드에 우리가 받아둔 HeyGen OAuth
토큰을 실어 보낸다. **구현 완료** — §3 참고. 사용자가 원했던 "ChatGPT에 MCP 붙여 쓰기"에
기능적으로 가장 가까운 형태다.

**(2) ChatGPT 계정 연결은 "불가능"이 아니라 "승인 대기"다.**
OAuth 자체는 표준대로 존재한다(`https://auth.openai.com/.well-known/openid-configuration`).
문제는 **registration_endpoint 가 없다 = DCR 미지원**이라 client_id 를 우리가 만들 수 없다는 것이다.
OpenAI 개발자 신청으로 발급받아야 하고, 2026년 4월 기준 실제 동작하는 곳은 Codex 계열뿐이다.

**그래도 이 연결이 추론 권한을 주지는 않는다는 결론은 그대로다.** 신원 확인뿐이다.
구독 할당량은 여전히 OpenAI 자사 제품 전용이고 서드파티는 API 키로 종량 과금된다.

그래서 `src/main/auth/chatgpt.ts` 에 **코드는 완성해 두고 client_id 가 없으면 비활성**으로 뒀다.
설정 화면에 연결 버튼과 client ID 입력칸이 있고, 발급받아 넣으면 **재빌드 없이 바로 켜진다.**
```bash
OPENAI_CLIENT_ID=... npm run build   # 배포 빌드에 심는 경우
```

---

## 3. HeyGen MCP 연동 — 구현됨 (서버 없이)

사용자가 계속 요청했던 "HeyGen MCP 연동"이다. **서버 없이 가능하고, 실제로 그렇게 구현했다.**

```
엔드포인트: https://mcp.heygen.com/mcp/v1/   (Streamable HTTP MCP · 끝 슬래시 필수)
resource 식별자: https://mcp.heygen.com/mcp/v1   (슬래시 없음 — 메타데이터가 주는 값 그대로)
인증 서버:  https://api2.heygen.com
  authorization_endpoint: /v1/oauth/authorize
  token_endpoint:         /v1/oauth/token
  registration_endpoint:  /v1/oauth/register   ← 동적 클라이언트 등록(DCR)
  revocation_endpoint:    /v1/oauth/revoke
  userinfo_endpoint:      /v1/oauth/userinfo
  PKCE: S256 · 공개 클라이언트(token_endpoint_auth_method: none)
```

위 값은 전부 **실제로 호출해서 확인했다.** DCR 은 client_secret 없는 공개 클라이언트를 즉시 발급한다.

### 구현 위치

- `src/main/auth/heygenMcp.ts` — 디스커버리 → DCR → PKCE 루프백 로그인 → 토큰 교환/갱신/폐기
- `src/main/services/heygenMcp.ts` — MCP 세션(게으른 연결), 도구 목록/호출
- `src/main/ipc.ts` — `mcp:status` / `mcp:connect` / `mcp:disconnect` / `mcp:tools`
- `src/renderer/src/components/Settings.tsx` — "HeyGen 계정 연결" 버튼
- `src/main/services/openai.ts` — Responses API. 연결되어 있으면 `type: "mcp"` 도구로
  **모델이 HeyGen MCP 에 직접 붙는다** (앱이 중계하지 않는다)
- `src/main/ipc.ts` — 채팅용 로컬 도구 `pick_video` / `upload_video` / `download_result`

### 알아둘 결정들

- **매 로그인마다 DCR 을 새로 한다.** redirect_uri 가 등록 내용에 포함되는데 루프백 포트는
  OS 가 매번 다르게 고르기 때문이다. 받은 client_id 는 저장해 두고 **갱신에는 그대로 쓴다**
  (refresh 는 redirect_uri 가 필요 없다).
- **`resource` 파라미터를 붙인다.** 이 토큰이 MCP 서버 전용임을 못박는다(혼동된 대리인 방지).
  값은 보호 자원 메타데이터가 주는 것과 **한 글자도 다르면 안 된다** — 끝 슬래시 주의.
- **엔드포인트를 상수로 박지 않는다.** 메타데이터에서 읽는다. HeyGen 이 경로를 옮겨도 살아남는다.
- **연결은 게으르게 맺는다.** 앱 기동 때 세션을 열면 쓰지도 않을 토큰을 갱신하고 첫 화면이 느려진다.
- **채팅은 Chat Completions 가 아니라 Responses API 를 쓴다.** 원격 MCP 를 모델에 직접 붙이는
  기능이 여기에만 있다. 되돌리면 도구를 앱이 하나씩 중계해야 하고 개수 상한도 다시 필요해진다.
- **`authorization` 토큰은 매 요청 다시 보내야 한다.** OpenAI 가 저장하지 않기 때문이다
  (응답 객체에도 실리지 않는다). 그래서 턴마다 `heygenMcp.accessToken()` 으로 새로 받는다.
- **토큰이 이 PC 밖으로 나가는 유일한 지점이다.** 중계 방식으로 되돌릴 수 있게
  호출부를 `services/openai.ts` 한곳에 모아두었다.
- **`require_approval: 'never'` 다.** 승인 절차를 끼우면 채팅이 매번 멈춘다. 대신 시스템
  프롬프트에서 크레딧을 쓰는 생성 작업은 사용자에게 먼저 확인하도록 못박았다.
- **MCP SDK 는 번들에 넣는다** (`externalizeDepsPlugin({ exclude: [...] })`). electron-builder 의
  `files` 가 `out/**` 만 담기 때문에 외부 의존성으로 남기면 패키징된 앱에서 모듈을 못 찾는다.
- **더빙 파이프라인은 여전히 REST API 키를 쓴다.** 둘은 공존한다. 더빙은 단계별 진행률을
  보여줘야 하고 그건 우리가 직접 치는 편이 예측 가능하다. MCP 는 그 외 100여 개 도구용이다.

### 채팅이 HeyGen 을 실제로 부리려면 로컬 도구가 필요하다

MCP 도구만으로는 **핵심 작업이 끝까지 가지 않는다.** MCP 는 HeyGen 계정 안의 리소스만 다루고
**이 PC 의 파일을 보지 못한다.** 사용자의 영상은 여기 있는데 말이다.

그래서 MCP 가 못 하는 세 가지를 로컬 도구로 메웠다:

| 도구 | 하는 일 | 왜 MCP 가 못 하나 |
|---|---|---|
| `pick_video` | 파일 선택 창 | 원격 서버는 이 PC 의 파일 시스템을 모른다 |
| `upload_video` | 로컬 영상 → HeyGen, `asset_id` 반환 | 바이트를 올릴 주체가 로컬에 있어야 한다 |
| `download_result` | 결과 URL → `~/Movies/HeyU/` | 받은 파일을 놓을 곳이 이 PC 다 |

전형적인 흐름: `pick_video` → `upload_video` → (모델이 `asset_id` 로 `heygen_*` 호출)
→ `download_result`. 시스템 프롬프트에 이 순서를 명시했다.

**`download_result` 는 호스트를 검사한다.** 모델이 준 문자열을 그대로 내려받으면
임의 URL 다운로드 도구가 된다 — heygen.com 과 S3 만 허용한다.

**업로드는 REST API 키가 필요하다.** presigned 업로드 경로를 쓰기 때문에 MCP OAuth 연결만으로는
되지 않는다. (HeyGen REST 가 Bearer OAuth 토큰을 받아주는지는 확인하지 못했다 — 확인되면
API 키 요구를 없앨 수 있다.)

### 아직 안 한 것

**실제 브라우저 로그인을 한 번도 돌리지 않았다.** 디스커버리·DCR·401 응답까지는 실물로 확인했고
타입체크와 빌드는 통과하지만, 인가 코드를 받아 토큰으로 바꾸는 구간은 사람이 로그인해야 검증된다.

## 4. 서버가 필요한가 — 현재 판단

**기능적으로는 전부 서버 없이 된다.** 실제로 서버 없이 다 만들었다.
다만 아래 네 가지는 서버 없이는 **원리적으로 불가능**하다.

| 필요한 것 | 서버 없이 가능? | 이유 |
|---|---|---|
| Google 로그인 | 가능 | PKCE 루프백 |
| 더빙 파이프라인 | 가능 | REST 직접 호출 |
| HeyGen MCP 연동 | 가능 | DCR + PKCE — 구현 완료 (§3) |
| 개인별 AI 계정 | 가능 | 각자 자기 키 |
| **도메인 제한 강제** | **불가능** | 클라이언트 검사는 앱을 고치면 우회됨 |
| **사용량·비용 추적** | **불가능** | 누가 크레딧 얼마나 썼는지 집계 불가 |
| **앱 종료 후 결과 수신** | **불가능** | webhook `callback_url` 받을 공개 엔드포인트 필요 |
| **회사 키 은닉** | **해결됨** | MCP OAuth 로 대체 — 배포할 키가 없다 (§3) |

**미결정 사항이다. 사용자에게 확인해야 한다.**

---

## 5. 구조

```
Electron 메인 프로세스 ─ 자격증명·네트워크·파일 전담
  ├─ index.ts            창 생성, heyu-media 프로토콜 등록
  ├─ auth/google.ts      Google OAuth (PKCE + 127.0.0.1 루프백) + 도메인 검증
  ├─ auth/heygenMcp.ts   HeyGen OAuth (DCR + PKCE 루프백) + 토큰 갱신/폐기
  ├─ auth/chatgpt.ts     ChatGPT OAuth (PKCE 루프백) — client ID 발급 전까지 비활성
  ├─ services/heygen.ts  업로드 → 번역 → 폴링 → 다운로드 (REST, API 키)
  ├─ services/heygenMcp.ts  MCP 세션 — 도구 목록/호출 (OAuth 토큰)
  ├─ services/openai.ts  도구 호출 오케스트레이터 (선택)
  ├─ store.ts            safeStorage 암호화 저장소 (자격증명)
  ├─ jobStore.ts         진행 중/마지막 작업 기록 (평문 JSON — 비밀이 아니다)
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
- **더빙에는 LLM 이 필요 없다. 채팅은 더빙용이 아니다.**
  `POST /v3/video-translations` **한 번**이면 HeyGen 이 전사·번역·음성복제·립싱크를 다 한다.
  넣을 게 영상 하나고 나올 게 더빙 하나라 그 사이에 모델이 판단할 일이 없다.
  업로드·폴링·다운로드가 더 붙는 건 API 가 여러 개여서가 아니라 **로컬 파일이기 때문이다**
  (HeyGen 은 공개 URL 이나 asset_id 만 받고, 생성은 비동기이며, 결과는 presigned URL 로 온다).
  → 영상이 이미 공개 URL 이면 `video: {type:"url"}` 로 **진짜 호출 한 번**으로 끝난다.
  채팅이 값을 하는 곳은 더빙 *바깥*이다 — 아바타, 음성 복제, 자막, 크레딧 조회 등 100여 개 도구.
  **이 구분이 흐려지면 "채팅으로 더빙시키기" 같은 불필요한 배선을 다시 만들게 된다.**
  사용자가 이 질문을 한 번 했고(2026-09-18), 둘 다 유지하기로 결정했다.
- **동시 작업 1건으로 제한했다.** 크레딧 낭비와 UI 혼선 방지. 의도적이다.
- **`requireSignIn()`을 메인 프로세스에도 걸었다.** 렌더러에서 화면만 가리면
  IPC 채널이 그대로 열려 있어 우회된다.
- **번역 요청 직후 translation id 를 디스크에 적는다.** 그 시점에 크레딧이 빠져나간다.
  앱을 껐다 켜는 것이 작업 취소와 같아서는 안 된다 — 다음 실행이 기록을 보고 다시 붙는다.
- **실패해도 기록을 항상 지우지는 않는다.** HeyGen 이 `failed` 라고 답했으면 끝난 것이지만,
  네트워크가 끊겨서 실패한 것이라면 번역은 서버에서 계속 돈다. 후자는 기록을 남겨 재개한다.
- **IPC 핸들러는 한 번만 등록한다.** macOS 는 창을 닫아도 앱이 살아 있고 독 아이콘으로
  창만 새로 만든다. 그때 다시 등록하면 Electron 이 "second handler" 로 막아 창 생성이 실패한다.
  핸들러는 고정하고 대상 창(`currentWin`)만 갈아끼운다.

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

### (5) node_modules 가 격리(quarantine)되면 빌드가 죽는다

프로젝트 폴더가 AirDrop 등으로 옮겨오면 `com.apple.quarantine` 이 붙고, rollup·esbuild 의
네이티브 바이너리가 Gatekeeper 에 막혀 빌드가 이상한 메시지로 죽는다:
```
ERR_DLOPEN_FAILED ... library load disallowed by system policy
Error: The service was stopped            ← esbuild 쪽 증상
```
rollup 이 "npm 의 optional dependency 버그"라고 안내하지만 **그 원인이 아니다.** 재설치해도 낫지 않는다.
```bash
xattr -dr com.apple.quarantine node_modules
```

### (6) macOS 코드 서명 없음 — 배포 시 문제됨

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

### (7) MCP 엔드포인트의 끝 슬래시

`https://mcp.heygen.com/mcp/v1` 로 POST 하면 **307 로 끝 슬래시 버전으로 넘긴다.** 동작은 하지만
매 요청이 두 번 나간다. 반대로 `resource` 파라미터는 **슬래시 없는** 값이어야 한다 —
두 값이 다르다는 점이 헷갈리기 쉽다. `MCP_ENDPOINT` / `MCP_RESOURCE` 로 분리해 두었다.

---

## 7. 현재 상태

### 검증된 것
- `npm run build` 통과 (타입체크 포함)
- 앱 기동 성공, 콘솔 오류 0건
- 로그인 게이트 두 시나리오 확인 (클라이언트 ID 있음/없음), 본 화면 유출 없음
- HeyGen MCP: 메타데이터 디스커버리·DCR·401 응답을 실제 호출로 확인 (§3)
- 작업 영속화: 실제 Electron 에서 저장·복원·손상 파일 회복·재시작 복원 4개 시나리오 통과
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
2. **HeyGen MCP 브라우저 로그인 1회 검증** (§3) — 구현은 끝났고 사람이 한 번 로그인해 보면 된다.
   크레딧은 소모되지 않는다. 이어서 채팅으로 HeyGen 도구를 하나 호출해 보면
   Responses API 경로까지 한 번에 확인된다(조회용 도구를 쓰면 크레딧이 들지 않는다).
3. **ChatGPT OAuth client ID 신청** (§2) — OpenAI 개발자 신청. 받으면 설정에 넣기만 하면 된다.
4. **서버 필요 여부 결정** (§4) — 사용자 확인 대기 중. MCP OAuth 로 "회사 키 은닉"은 해결됐으므로
   남은 이유는 도메인 제한 강제·사용량 추적·웹훅 수신 셋이다.
5. **코드 서명 / 공증** (§6-6) — 배포하려면 사실상 필수.
6. Google 리프레시 토큰을 저장만 하고 안 쓴다. 신원 확인이 전부라 지금은 갱신할 이유가 없다.

작업 상태 영속화는 **완료됐다** (`jobStore.ts` + `resumeActiveJob()`). 앱을 닫아도
다음 실행이 진행 중이던 번역에 다시 붙어 결과를 내려받는다.
웹훅(`callbackUrl`)은 공개 엔드포인트가 필요하므로 여전히 서버 이야기다(§4).

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
2. 설정 → HeyGen API 키 입력 (저장 시 실제 호출로 검증함) — 더빙에 필요
3. (선택) 설정 → "HeyGen 계정 연결" — 브라우저 로그인 한 번이면 끝. 키 입력이 필요 없고,
   채팅에서 HeyGen 도구 전체를 쓸 수 있다. 더빙 버튼과는 별개 경로다.
4. 영상 선택 → "영어로 더빙하기"
5. 결과는 `~/Movies/HeyU/` 에 저장

OpenAI 키와 채팅은 선택이다. 없어도 더빙은 된다.

---

## 10. 사용자 관련 메모

- **앱을 띄울 때는 미리 말할 것.** 검증하느라 창을 반복해서 띄웠다 껐더니 사용자가 불편해했다.
  오프스크린 캡처(`show: false` + `webContents.capturePage()`)를 쓰면 화면을 가리지 않는다.
- 사용자가 선택한 것: **Electron**(Tauri 아님), **OpenAI API 키로 LLM 추가**(제거 아님).
- 앱 이름은 **HeyU**. (Shottr는 무관한 macOS 스크린샷 앱이며 한 번 혼동이 있었다.)
