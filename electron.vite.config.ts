import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
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

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // 배포 빌드에 클라이언트 ID 를 심는다: GOOGLE_CLIENT_ID=... npm run build
    // OAuth 클라이언트 ID 는 비밀이 아니므로 바이너리에 들어가도 된다.
    define: {
      __GOOGLE_CLIENT_ID__: JSON.stringify(process.env.GOOGLE_CLIENT_ID ?? ''),
      __ALLOWED_DOMAINS__: JSON.stringify(process.env.ALLOWED_DOMAINS ?? '')
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
