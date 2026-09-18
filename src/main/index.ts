import { app, shell, BrowserWindow, protocol, net } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerIpc } from './ipc.js'

/**
 * 로컬 결과 영상을 렌더러에서 재생하기 위한 전용 프로토콜.
 * file:// 을 직접 열어주면 렌더러가 임의 경로를 읽을 수 있게 되므로,
 * 재생 전용 통로를 따로 판다.
 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'heyu-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
])

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
}

app.whenReady().then(() => {
  protocol.handle('heyu-media', (request) => {
    // heyu-media://local/<URI 인코딩된 절대경로>
    const encoded = new URL(request.url).pathname.replace(/^\//, '')
    const filePath = decodeURIComponent(encoded)
    return net.fetch(pathToFileURL(filePath).toString())
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
