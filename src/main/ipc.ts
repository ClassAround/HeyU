import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { join, basename } from 'node:path'
import { mkdirSync, statSync, existsSync } from 'node:fs'
import { store } from './store.js'
import { signInWithGoogle } from './auth/google.js'
import { HeyGenClient, HeyGenError } from './services/heygen.js'
import { mcpHeygen } from './services/heygenMcpTransport.js'
import { heygenMcp } from './services/heygenMcp.js'
import { jobStore } from './jobStore.js'
import type {
  DubOptions,
  JobProgress,
  JobStage,
  SelectedVideo,
  CredentialStatus,
  GoogleProfile,
  McpStatus
} from '../shared/types.js'

/** 한 번에 하나의 더빙 작업만 돌린다. 동시 실행은 크레딧만 축내고 UI를 헷갈리게 한다. */
interface ActiveJob {
  id: string
  controller: AbortController
  progress: JobProgress
}

let selected: SelectedVideo | null = null
let job: ActiveJob | null = null
/** 앱을 다시 켰을 때도 마지막 결과 카드가 남아 있도록 디스크에서 읽어온다. */
let lastFinished: JobProgress | null = null

/**
 * 현재 살아 있는 창. macOS 는 창을 닫아도 앱이 남아 있고, 독 아이콘을 누르면
 * 창만 새로 만들어진다 — 그때 핸들러를 다시 등록하면 Electron 이
 * "second handler" 로 막아 창 생성이 통째로 실패한다.
 * 그래서 핸들러는 한 번만 등록하고, 대상 창만 갈아끼운다.
 */
let currentWin: BrowserWindow | null = null
let handlersRegistered = false

/** 핸들러 안에서 쓰는 창. 등록 시점이 아니라 호출 시점의 창이어야 한다. */
function win(): BrowserWindow {
  if (!currentWin || currentWin.isDestroyed()) throw new Error('창이 없습니다.')
  return currentWin
}

function outputDir(): string {
  const dir = join(app.getPath('videos'), 'HeyU')
  mkdirSync(dir, { recursive: true })
  return dir
}

function emit(win: BrowserWindow, p: JobProgress): void {
  if (!win.isDestroyed()) win.webContents.send('job:progress', p)
}

function setStage(
  win: BrowserWindow,
  stage: JobStage,
  message: string,
  ratio: number | null = null,
  extra: Partial<JobProgress> = {}
): void {
  if (!job) return
  job.progress = { ...job.progress, stage, message, ratio, ...extra }
  emit(win, job.progress)
}

/**
 * 저장된 설정을 우선하고, 없으면 빌드 타임에 심어둔 값으로 떨어진다.
 * 배포 빌드는 심어둔 값으로 바로 로그인되고, 개발 중에는 UI 입력이 이긴다.
 */
function googleClientId(): string {
  return store.get('googleClientId') || __GOOGLE_CLIENT_ID__ || ''
}

function googleClientSecret(): string | undefined {
  return store.get('googleClientSecret') || __GOOGLE_CLIENT_SECRET__ || undefined
}

function allowedDomains(): string[] {
  const saved = store.get('allowedDomains')
  if (saved?.length) return saved
  return __ALLOWED_DOMAINS__
    ? __ALLOWED_DOMAINS__.split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean)
    : []
}

/**
 * 로그인 확인.
 *
 * 렌더러에서 화면을 가리는 것만으로는 부족하다 — IPC 채널은 그대로 열려 있으므로
 * 실제 작업을 시작하는 핸들러에서 한 번 더 막는다.
 * (다만 이것도 사용자 PC 위의 검사다. 진짜 차단은 서버가 해야 한다 — README 참고.)
 */
function requireSignIn(): void {
  if (!store.get('googleProfile')) {
    throw new Error('먼저 Google 계정으로 로그인해 주세요.')
  }
}

/** New uploads and translations always use the connected HeyGen MCP account. */
function heygen(): HeyGenClient { return mcpHeygen() }

/** 결과 파일 이름으로 쓸 수 있게 확장자와 금지 문자를 털어낸다. */
function safeNameOf(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_')
}

/**
 * 번역 요청 이후 구간 — 폴링과 다운로드.
 * 새 작업과 "이전 작업 재개"가 이 함수를 공유한다. 두 경로가 갈라지면
 * 한쪽만 고치는 버그가 반드시 생긴다.
 */
async function awaitAndDownload(
  win: BrowserWindow,
  client: HeyGenClient,
  translationId: string,
  safeName: string,
  signal: AbortSignal,
  elapsedOffsetMs = 0
): Promise<string> {
  const done = await client.waitForTranslation(
    translationId,
    (_s, elapsed) => {
      const total = elapsed + elapsedOffsetMs
      const mins = Math.floor(total / 60000)
      const secs = Math.floor((total % 60000) / 1000)
      setStage(
        win,
        'translating',
        `영어 더빙 생성 중 · ${mins}분 ${String(secs).padStart(2, '0')}초 경과`
      )
    },
    signal
  )

  const outPath = join(outputDir(), `${safeName}_EN_${Date.now()}.mp4`)

  setStage(win, 'downloading', '결과 내려받는 중', 0)
  await client.download(
    done.video_url!,
    outPath,
    (r) => setStage(win, 'downloading', '결과 내려받는 중', r),
    signal
  )
  return outPath
}

/**
 * 작업 종료를 한곳에서 처리한다 — 화면 갱신과 디스크 기록이 어긋나지 않게.
 *
 * 실패한 경우에도 기록을 지울지가 관건이다. HeyGen 이 "failed" 라고 말했으면 끝난 것이지만,
 * 네트워크가 끊겨서 실패한 것이라면 **번역은 서버에서 계속 돌고 있다.** 후자는 기록을 남겨
 * 다음 실행 때 다시 붙는다 — 이미 크레딧이 빠져나갔기 때문이다.
 */
function finishJob(win: BrowserWindow, error?: unknown, outputPath?: string): void {
  if (!job) return

  if (!error) {
    setStage(win, 'done', '완료', 1, { outputPath })
    lastFinished = job.progress
    jobStore.setLast(job.progress)
    return
  }

  const canceled = job.controller.signal.aborted
  const msg = error instanceof Error ? error.message : String(error)
  const terminal =
    canceled || (error instanceof HeyGenError && (error.detail as any)?.status === 'failed')

  setStage(win, canceled ? 'canceled' : 'failed', canceled ? '취소됨' : '실패', null, { error: msg })
  lastFinished = job.progress

  if (terminal) jobStore.setLast(job.progress)
  // 그 외에는 active 기록을 그대로 둔다. 다음 실행이 이어받는다.
}

/**
 * 더빙 파이프라인 전체.
 * 업로드 → 번역 요청 → 폴링 → 다운로드. 각 단계가 진행률을 렌더러로 흘린다.
 */
async function runDub(win: BrowserWindow, opts: DubOptions): Promise<string> {
  if (!selected) throw new Error('영상이 선택되지 않았습니다.')
  if (job) throw new Error('이미 진행 중인 작업이 있습니다.')

  const client = heygen()
  const id = randomUUID()
  job = {
    id,
    controller: new AbortController(),
    progress: { jobId: id, stage: 'preparing', ratio: null, message: '준비 중' }
  }
  const signal = job.controller.signal
  const source = selected
  const safeName = safeNameOf(source.name)

  try {
    setStage(win, 'uploading', '영상 업로드 중', 0)
    const assetId = await client.uploadVideo(
      source.path,
      (r) => setStage(win, 'uploading', '영상 업로드 중', r),
      signal
    )

    setStage(win, 'submitting', 'HeyGen MCP로 번역 요청 중')
    const translationId = await client.createTranslation(assetId, opts, signal)

    // 크레딧이 빠져나가는 시점이다. 여기서부터는 앱이 죽어도 되찾을 수 있어야 한다.
    jobStore.setActive({ jobId: id, translationId, safeName, opts, startedAt: Date.now(), transport: 'mcp' })

    setStage(win, 'translating', '영어 더빙 생성 중')
    const outPath = await awaitAndDownload(win, client, translationId, safeName, signal)

    finishJob(win, undefined, outPath)
    return outPath
  } catch (e) {
    finishJob(win, e)
    throw e
  } finally {
    job = null
  }
}

/**
 * 지난 실행에서 끝내지 못한 작업에 다시 붙는다.
 *
 * 앱을 껐다 켜는 것이 작업 취소와 같아서는 안 된다 — 번역은 HeyGen 쪽에서 돌고 있고
 * 크레딧은 이미 소모됐다. 조용히 실패하는 편이 나은 경우(키가 아직 없음)는 기록을 남겨둔다.
 */
export async function resumeActiveJob(win: BrowserWindow): Promise<void> {
  const saved = jobStore.active()
  if (!saved || job) return

  let client: HeyGenClient
  try {
    // Only resume old REST jobs through their original account; never resubmit them.
    const key = store.get('heygenApiKey')
    if (saved.transport !== 'mcp' && !key) return
    client = saved.transport === 'mcp' ? heygen() : new HeyGenClient(key!)
  } catch {
    // API 키가 아직 설정되지 않았다. 기록은 남겨두고 다음 기회에 다시 시도한다.
    return
  }

  job = {
    id: saved.jobId,
    controller: new AbortController(),
    progress: {
      jobId: saved.jobId,
      stage: 'translating',
      ratio: null,
      message: '이전 작업에 다시 연결하는 중'
    }
  }
  emit(win, job.progress)

  try {
    const outPath = await awaitAndDownload(
      win,
      client,
      saved.translationId,
      saved.safeName,
      job.controller.signal,
      Date.now() - saved.startedAt
    )
    finishJob(win, undefined, outPath)
  } catch (e) {
    finishJob(win, e)
  } finally {
    job = null
  }
}

export function registerIpc(target: BrowserWindow): void {
  currentWin = target
  if (handlersRegistered) return
  handlersRegistered = true

  // 결과 파일이 이미 지워졌다면 완료 카드를 띄워봐야 재생되지 않는다. 경로만 떼어낸다.
  const saved = jobStore.last()
  if (saved) {
    lastFinished =
      saved.outputPath && !existsSync(saved.outputPath)
        ? { ...saved, outputPath: undefined, message: '완료 (결과 파일을 찾을 수 없습니다)' }
        : saved
  }

  // ── 자격증명 ──────────────────────────────────────────────
  ipcMain.handle('creds:status', (): CredentialStatus => store.status())

  ipcMain.handle('creds:setGoogleClient', (_e, id: string, secret: string) => {
    store.set('googleClientId', id.trim())
    if (secret.trim()) store.set('googleClientSecret', secret.trim())
    else store.clear('googleClientSecret')
    return { ok: true }
  })

  // ── Google 로그인 ─────────────────────────────────────────
  ipcMain.handle('auth:google', async () => {
    const clientId = googleClientId()
    if (!clientId) {
      return { ok: false, error: 'Google 클라이언트 ID가 설정되지 않았습니다.' }
    }
    try {
      const res = await signInWithGoogle(clientId, googleClientSecret(), allowedDomains())
      store.set('googleProfile', res.profile)
      if (res.refreshToken) store.set('googleRefreshToken', res.refreshToken)
      return { ok: true, profile: res.profile }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('auth:allowedDomains', (): string[] => allowedDomains())

  /** 로그인 화면이 "설정 입력칸을 보여줘야 하는지" 판단하는 데 쓴다. */
  ipcMain.handle('auth:config', () => ({
    clientIdConfigured: Boolean(googleClientId()),
    /** 빌드에 심겨 있으면 사용자가 바꿀 수 없다. */
    clientIdFromBuild: Boolean(__GOOGLE_CLIENT_ID__),
    allowedDomains: allowedDomains()
  }))

  ipcMain.handle('auth:setAllowedDomains', (_e, domains: string[]) => {
    const cleaned = domains
      .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
      .filter((d) => d.length > 0)
    if (cleaned.length) store.set('allowedDomains', cleaned)
    else store.clear('allowedDomains')
    return { ok: true }
  })

  ipcMain.handle('auth:signOut', () => {
    store.clear('googleRefreshToken')
    store.clear('googleProfile')
    return { ok: true }
  })

  ipcMain.handle('auth:profile', (): GoogleProfile | null => store.get('googleProfile') ?? null)

  // ── 최초 연결 안내 ────────────────────────────────────────
  // 연결을 설정 화면 깊숙이 두면 아무도 하지 않는다. 로그인 직후 한 번만 안내한다.
  ipcMain.handle('onboarding:needed', (): boolean => !store.get('onboardedAt'))

  ipcMain.handle('onboarding:complete', () => {
    store.set('onboardedAt', Date.now())
    return { ok: true }
  })

  /** 설정에서 다시 볼 수 있게 한다. 연결을 바꾸고 싶을 때가 있다. */
  ipcMain.handle('onboarding:reset', () => {
    store.clear('onboardedAt')
    return { ok: true }
  })

  ipcMain.handle('mcp:status', (): McpStatus => heygenMcp.status())

  ipcMain.handle('mcp:connect', async () => {
    try {
      requireSignIn()
      return { ok: true, status: await heygenMcp.connect() }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('mcp:disconnect', async () => {
    await heygenMcp.disconnect()
    return { ok: true, status: heygenMcp.status() }
  })

  /** 연결이 실제로 살아 있는지 확인용. 도구 개수만 돌려준다. */
  ipcMain.handle('mcp:tools', async () => {
    try {
      requireSignIn()
      const tools = await heygenMcp.tools()
      return { ok: true, count: tools.length, names: tools.map((t) => t.name) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ── 영상 선택 ─────────────────────────────────────────────
  ipcMain.handle('video:pick', async () => {
    requireSignIn()
    const res = await dialog.showOpenDialog(win(), {
      title: '더빙할 영상 선택',
      properties: ['openFile'],
      filters: [{ name: '영상', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    return setSelected(res.filePaths[0])
  })

  ipcMain.handle('video:setPath', (_e, path: string) => setSelected(path))
  ipcMain.handle('video:clear', () => {
    selected = null
    return null
  })

  // ── 더빙 작업 ─────────────────────────────────────────────
  ipcMain.handle('job:start', async (_e, opts: DubOptions) => {
    try {
      requireSignIn()
      const outputPath = await runDub(win(), opts)
      return { ok: true, outputPath }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('job:cancel', () => {
    job?.controller.abort()
    return { ok: true }
  })

  ipcMain.handle('job:current', (): JobProgress | null => job?.progress ?? lastFinished)

  /**
   * 안내에 쓰는 외부 링크만 연다.
   *
   * 렌더러가 임의 URL 을 열 수 있으면 그 자체가 공격 표면이다(피싱 페이지 유도 등).
   * 여는 곳은 우리가 UI 에 적어둔 발급 페이지들뿐이므로 목록으로 못박는다.
   */
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    const allowed = ['https://app.heygen.com/settings']
    if (!allowed.includes(url)) return { ok: false }
    void shell.openExternal(url)
    return { ok: true }
  })

  ipcMain.handle('shell:reveal', (_e, path: string) => {
    shell.showItemInFolder(path)
    return { ok: true }
  })

}

function setSelected(path: string): SelectedVideo {
  selected = { path, name: basename(path), sizeBytes: statSync(path).size }
  return selected
}
