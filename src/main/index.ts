import { app, shell, BrowserWindow, protocol } from 'electron'
import { join, extname } from 'node:path'
import { createReadStream, statSync, existsSync, renameSync, copyFileSync, mkdirSync } from 'node:fs'
import { Readable } from 'node:stream'
import { resolveRange } from './services/mediaRange.js'
import { registerIpc, resumeActiveJob } from './ipc.js'

/**
 * 로컬 결과 영상을 렌더러에서 재생하기 위한 전용 프로토콜.
 * file:// 을 직접 열어주면 렌더러가 임의 경로를 읽을 수 있게 되므로,
 * 재생 전용 통로를 따로 판다.
 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'heyu-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
])

/**
 * 예전 이름("heyu")으로 저장된 자격증명을 새 이름 폴더로 옮긴다.
 *
 * userData 경로는 앱 이름에서 나온다. 이름을 바꾸면 Electron 이 **빈 폴더**를 새로 만들고,
 * 사용자는 Google 로그인·HeyGen 연결·API 키를 전부 다시 등록해야 한다.
 * 이름 변경은 우리 사정이지 사용자 사정이 아니므로, 조용히 이사시킨다.
 *
 * 옮기는 게 아니라 **복사**한다 — 예전 이름의 빌드를 다시 실행하더라도 그쪽이 망가지지 않는다.
 * app.whenReady() 전에, 저장소를 처음 읽기 전에 불러야 한다.
 */
function migrateLegacyUserData(): void {
  const current = app.getPath('userData')
  const legacy = join(app.getPath('appData'), 'heyu')
  if (!existsSync(legacy) || legacy === current) return

  // 폴더 존재 여부로 판단하면 안 된다 — Electron 이 우리 코드가 돌기 전에
  // 빈 userData 폴더를 이미 만들어 둔다. 실제로 옮길 파일이 있는지를 본다.
  for (const name of ['credentials.bin', 'jobs.json']) {
    const from = join(legacy, name)
    const to = join(current, name)
    if (!existsSync(from) || existsSync(to)) continue
    try {
      mkdirSync(current, { recursive: true })
      copyFileSync(from, to)
      console.log(`[RAWCUT] 이전 설정을 옮겼습니다: ${name}`)
    } catch (e) {
      // 실패해도 앱은 떠야 한다. 사용자는 다시 로그인하면 된다.
      console.warn(`[RAWCUT] ${name} 이전 실패:`, e)
    }
  }
}

/**
 * 예전 이름으로 만들어 둔 결과 폴더(~/Movies/HeyU)를 새 이름으로 옮긴다.
 * 이미 만들어 둔 더빙 결과물이 앱에서 안 보이는 곳에 남는 일을 막는다.
 */
function migrateLegacyOutputs(): void {
  const current = join(app.getPath('videos'), 'RAWCUT GLOBAL')
  if (existsSync(current)) return

  const legacy = join(app.getPath('videos'), 'HeyU')
  if (!existsSync(legacy)) return

  try {
    renameSync(legacy, current)
  } catch {
    // 못 옮겨도 앱 동작에는 지장이 없다. 예전 폴더에 그대로 남을 뿐이다.
  }
}

const MEDIA_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo'
}

/**
 * 로컬 영상을 렌더러에 흘려보낸다.
 *
 * **Range 요청을 반드시 처리해야 한다.** 예전에는 `net.fetch(file://…)` 로 파일 전체를
 * 그대로 돌려줬는데, 그러면 `<video>` 가 몇 초만 재생하고 멈춘다 — 브라우저는 미디어를
 * 구간 단위로 요청하면서 재생하는데, 서버가 206 을 못 주면 이어받을 방법이 없기 때문이다.
 * 탐색(seek) 도 당연히 안 된다. 파일이 클수록 증상이 심해진다.
 */
function serveMedia(filePath: string, rangeHeader: string | null): Response {
  let size: number
  try {
    const st = statSync(filePath)
    if (!st.isFile()) return new Response('not a file', { status: 404 })
    size = st.size
  } catch {
    return new Response('not found', { status: 404 })
  }

  const type = MEDIA_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const stream = (start?: number, end?: number): ReadableStream =>
    Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream

  const range = resolveRange(size, rangeHeader)

  if (range.kind === 'unsatisfiable') {
    return new Response('range not satisfiable', {
      status: 416,
      headers: { 'content-range': `bytes */${size}` }
    })
  }

  // 범위 요청이 아니면 전체를 주되, 범위를 받을 수 있다고 알려둔다.
  if (range.kind === 'full') {
    return new Response(stream(), {
      status: 200,
      headers: {
        'content-type': type,
        'content-length': String(size),
        'accept-ranges': 'bytes'
      }
    })
  }

  return new Response(stream(range.start, range.end), {
    status: 206,
    headers: {
      'content-type': type,
      'content-length': String(range.end - range.start + 1),
      'content-range': `bytes ${range.start}-${range.end}/${size}`,
      'accept-ranges': 'bytes'
    }
  })
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 940,
    minHeight: 640,
    show: false,
    backgroundColor: '#14161A',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // 외부 링크는 앱 안에서 열지 않고 기본 브라우저로 보낸다.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))

  registerIpc(mainWindow)

  // 지난 실행에서 끝내지 못한 번역이 있으면 다시 붙는다.
  // 렌더러가 뜬 뒤에 시작해야 진행 상황 이벤트를 받을 화면이 존재한다.
  mainWindow.webContents.once('did-finish-load', () => {
    if (mainWindow) void resumeActiveJob(mainWindow)
  })
}

migrateLegacyUserData()
migrateLegacyOutputs()

app.whenReady().then(() => {
  protocol.handle('heyu-media', (request) => {
    // heyu-media://local/<URI 인코딩된 절대경로>
    const encoded = new URL(request.url).pathname.replace(/^\//, '')
    const filePath = decodeURIComponent(encoded)
    return serveMedia(filePath, request.headers.get('range'))
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
