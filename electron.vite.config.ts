import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'

/*
 * VS Code 확장 호스트(및 일부 IDE 통합 터미널)는 ELECTRON_RUN_AS_NODE=1 을 걸어둔다.
 * 이 값이 살아 있으면 Electron 바이너리가 순수 Node 로 동작해서
 * require('electron') 이 API 객체 대신 실행파일 경로 문자열을 돌려주고,
 * 앱은 `Cannot read properties of undefined (reading 'app')` 류로 즉시 죽는다.
 *
 * 여기서 지우면 electron-vite 가 띄우는 자식 프로세스가 깨끗한 환경을 물려받는다.
 * env -u 와 달리 Windows 에서도 동작한다.
 */
delete process.env.ELECTRON_RUN_AS_NODE

/*
 * .env 를 읽어 빌드 타임 상수로 심는다.
 *
 * 이게 없으면 사용자가 로그인 화면에서 클라이언트 ID 를 직접 입력해야 한다 —
 * OAuth 클라이언트 ID 는 비밀이 아니고 팀 전체가 같은 값을 쓰므로,
 * 사람마다 붙여넣게 할 이유가 없다. .env 에 한 번 적어두면 끝이다.
 *
 *   GOOGLE_CLIENT_ID=....apps.googleusercontent.com
 *   GOOGLE_CLIENT_SECRET=GOCSPX-...
 *   ALLOWED_DOMAINS=titan.kr
 *
 * .env 는 .gitignore 에 있다. 명령줄 환경변수가 .env 보다 우선한다.
 */
const env = { ...loadEnv('production', process.cwd(), ''), ...process.env }

export default defineConfig({
  main: {
    // MCP SDK 는 번들에 넣는다. electron-builder 의 files 가 out/** 만 담기 때문에
    // 외부 의존성으로 남겨두면 패키징된 앱에서 모듈을 찾지 못한다.
    plugins: [externalizeDepsPlugin({ exclude: ['@modelcontextprotocol/sdk'] })],
    // 배포 빌드에 클라이언트 ID 를 심는다: GOOGLE_CLIENT_ID=... npm run build
    // OAuth 클라이언트 ID 는 비밀이 아니므로 바이너리에 들어가도 된다.
    define: {
      __GOOGLE_CLIENT_ID__: JSON.stringify(env.GOOGLE_CLIENT_ID ?? ''),
      // Google 은 "데스크톱 앱" 클라이언트에도 secret 을 발급하고 토큰 교환 때 요구할 때가 있다.
      // 문서상 기밀로 취급되지 않는 값이며, 실제 보호는 PKCE 가 한다.
      __GOOGLE_CLIENT_SECRET__: JSON.stringify(env.GOOGLE_CLIENT_SECRET ?? ''),
      // 조직 계정 전용 앱이다. 빌드할 때 지정하지 않으면 titan.kr 로 잠긴다 —
      // "아무나 들어올 수 있는 상태"가 기본값이어서는 안 된다.
      __ALLOWED_DOMAINS__: JSON.stringify(env.ALLOWED_DOMAINS ?? 'titan.kr')
    },
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts') } } }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } },
    plugins: [react()]
  }
})
