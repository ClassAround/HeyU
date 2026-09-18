# HeyU

2분 내외의 영상을 넣으면 **영어 립싱크 더빙** 결과를 돌려주는 Windows / macOS 데스크톱 앱.

---

## 무엇이 되고 무엇이 안 되는가

착수 전 검증한 내용이다. 특히 마지막 항목은 구조를 바꾼 결론이라 먼저 읽어야 한다.

| 기능 | 상태 | 비고 |
|---|---|---|
| Windows / macOS 데스크톱 | 가능 | Electron 33 |
| Google OAuth 로그인 | 가능 | RFC 8252, PKCE + 루프백. 로그인 전 기능 잠김 |
| 조직 도메인 제한 | 가능 | ID 토큰 `hd` 클레임 검증 |
| 영어 더빙 + 립싱크 | 가능 | HeyGen Video Translation |
| **개인 ChatGPT 구독 연결** | **불가능** | 아래 참조 |

### 개인 ChatGPT 구독을 앱에서 쓸 수 없는 이유

처음 요구사항은 "개인 ChatGPT 계정 연결"과 "HeyGen MCP를 ChatGPT에 붙여 사용"이었다.
둘 다 합법적인 구현 경로가 없어 설계를 바꿨다.

- **"Sign in with ChatGPT"는 신원 확인 전용이다.** 앱이 받는 값은 이름·이메일·프로필 사진뿐이고
  추론 호출 권한은 포함되지 않는다.
- **구독 할당량은 OpenAI 자사 제품에서만 쓸 수 있다.** ChatGPT 앱과 Codex(CLI/IDE/데스크톱)가
  전부다. 서드파티 앱은 Platform API 키를 써야 한다.
- **웹 세션 리버스 엔지니어링은 약관 위반이다.** OpenAI는 실제로 해당 계정들을 정지시킨 적이 있다.
  제품에 넣을 수 없다.
- **ChatGPT에 붙인 MCP 커넥터는 외부에서 호출할 수 없다.** ChatGPT UI 안에서 사람이 쓸 때만
  동작한다. `앱 → ChatGPT → HeyGen` 체인은 첫 화살표에서 끊긴다.

그래서 **앱이 HeyGen을 직접 호출한다.** ChatGPT를 제거해도 기능 손실은 없다 —
"영상 넣으면 영어 더빙이 나온다"는 HeyGen API 호출 한 번이고, 그 사이에 LLM이 할 일이 없다.

OpenAI는 **선택적 대화 레이어**로만 남겼다. 키가 없으면 채팅 패널만 비활성화되고 더빙은 정상 동작한다.

---

## 구조

```
Electron 메인 프로세스 ─ 자격증명·네트워크·파일을 전담
  ├─ auth/google.ts     Google OAuth (PKCE + 127.0.0.1 루프백)
  ├─ services/heygen.ts 업로드 → 번역 → 폴링 → 다운로드
  ├─ services/openai.ts 도구 호출 오케스트레이터 (선택)
  ├─ store.ts           safeStorage 암호화 저장소
  └─ ipc.ts             파이프라인 + IPC 핸들러
        ↕ contextBridge (API 키 값은 건너오지 않는다)
렌더러 (React) ─ 화면만 담당
```

API 키는 **메인 프로세스 밖으로 나가지 않는다.** 렌더러는 "설정됨 / 미설정" 여부만 본다.

### 더빙 파이프라인

```
로컬 파일
  → POST /v3/assets/direct-uploads   (presigned S3 URL 발급)
  → PUT  <presigned url>             (바이트는 API를 거치지 않는다)
  → POST /v3/assets/{id}/complete
  → POST /v3/video-translations      (output_languages: ["English"])
  → GET  /v3/video-translations/{id} (3초 → 15초로 늘려가며 폴링)
  → 결과 다운로드 → ~/Movies/HeyU/
```

**업로드 경로를 direct-upload로 고정한 이유:** 멀티파트 `POST /v3/assets`는 32MB 상한이 있다.
2분짜리 1080p 영상은 비트레이트에 따라 이 값을 쉽게 넘긴다. 프록시 업로드를 쓰면
길이 제한은 통과해도 용량에서 막히는 사례가 생긴다.

---

## 설치와 실행

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

### HeyGen API 키 — 필수

대시보드 → Settings → API. 저장 시 실제로 호출해 유효성을 확인한다.

### OpenAI API 키 — 선택

대화 패널에만 쓰인다. **ChatGPT Plus 구독과는 별개로 종량 과금된다.**
기본 모델은 `gpt-4.1-mini`이며 `services/openai.ts` 생성자에서 바꾼다.

### Google 로그인 — 필수

로그인하기 전에는 본 화면이 뜨지 않는다. 영상 선택·더빙·채팅 핸들러도 메인 프로세스에서
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
> 사용자 PC에서 실행되므로 앱을 수정하면 우회된다. 같은 이유로 HeyGen·OpenAI 키도
> 사용자 손에 있다. 실제로 접근을 차단해야 한다면 키를 쥔 서버를 두고 거기서 검증해야 한다.
> 지금 구조에서 도메인 제한은 "잘못된 계정으로 들어오는 것을 막는 안내"다.

---

## 비용

Video Translation은 **립싱크 포함 분당 5크레딧**이다. 2분 영상 1건 = 약 10크레딧.
오디오 더빙만(립싱크 없음)은 분당 2크레딧.

옵션 중 `precision` 모드는 립싱크 품질이 높은 대신 생성이 느리다. `speed`가 기본값보다
빠르지만 정밀도가 낮다. 앱 기본값은 `precision`이다.

---

## 알려진 한계

- **길이 제한은 경고만 한다.** 2분을 넘겨도 진행할 수 있다. 분당 과금이라 길수록 비싸질 뿐
  기술적으로 막히지는 않기 때문이다. 정책상 강제해야 하면 `DubPanel.tsx`의 `tooLong`을
  버튼 비활성화로 연결한다.
- **동시 작업은 1건이다.** 크레딧 소모와 UI 혼선을 막기 위해 의도적으로 막았다.
- **작업 상태가 메모리에만 있다.** 앱을 닫으면 진행 중인 폴링이 끊긴다. HeyGen 쪽 작업은
  계속 돌지만 결과를 자동으로 받지 못한다. 필요해지면 `callback_url`(웹훅)이나
  translation id 영속화로 해결한다 — 클라이언트는 이미 `callbackUrl`을 지원한다.
- **Google 리프레시 토큰을 저장만 하고 쓰지 않는다.** 현재 로그인은 신원 확인이 전부라
  갱신할 이유가 없다. Google API를 실제로 호출하게 되면 갱신 로직을 붙여야 한다.
