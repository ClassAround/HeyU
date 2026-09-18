import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { join, basename } from 'node:path'
import { mkdirSync, statSync } from 'node:fs'
import { store } from './store.js'
import { signInWithGoogle } from './auth/google.js'
import { HeyGenClient } from './services/heygen.js'
import { OpenAIClient } from './services/openai.js'
import type {
  DubOptions,
  JobProgress,
  JobStage,
  SelectedVideo,
  CredentialStatus,
  GoogleProfile
} from '../shared/types.js'

/** 한 번에 하나의 더빙 작업만 돌린다. 동시 실행은 크레딧만 축내고 UI를 헷갈리게 한다. */
interface ActiveJob {
  id: string
  controller: AbortController
  progress: JobProgress
}

let selected: SelectedVideo | null = null
let job: ActiveJob | null = null
let lastFinished: JobProgress | null = null

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

function heygen(): HeyGenClient {
  const key = store.get('heygenApiKey')
  if (!key) throw new Error('HeyGen API 키를 먼저 설정해 주세요.')
  return new HeyGenClient(key)
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

  try {
    setStage(win, 'uploading', '영상 업로드 중', 0)
    const assetId = await client.uploadVideo(
      source.path,
      (r) => setStage(win, 'uploading', '영상 업로드 중', r),
      signal
    )

    setStage(win, 'submitting', '번역 작업 요청 중')
    const translationId = await client.createTranslation(assetId, opts, signal)

    setStage(win, 'translating', '영어 더빙 생성 중')
    const done = await client.waitForTranslation(
      translationId,
      (_s, elapsed) => {
        const mins = Math.floor(elapsed / 60000)
        const secs = Math.floor((elapsed % 60000) / 1000)
        setStage(
          win,
          'translating',
          `영어 더빙 생성 중 · ${mins}분 ${String(secs).padStart(2, '0')}초 경과`
        )
      },
      signal
    )

    const safeName = source.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_')
    const outPath = join(outputDir(), `${safeName}_EN_${Date.now()}.mp4`)

    setStage(win, 'downloading', '결과 내려받는 중', 0)
    await client.download(
      done.video_url!,
      outPath,
      (r) => setStage(win, 'downloading', '결과 내려받는 중', r),
      signal
    )

    setStage(win, 'done', '완료', 1, { outputPath: outPath })
    lastFinished = job.progress
    return outPath
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const canceled = signal.aborted
    setStage(win, canceled ? 'canceled' : 'failed', canceled ? '취소됨' : '실패', null, { error: msg })
    lastFinished = job?.progress ?? null
    throw e
  } finally {
    job = null
  }
}

export function registerIpc(win: BrowserWindow): void {
  // ── 자격증명 ──────────────────────────────────────────────
  ipcMain.handle('creds:status', (): CredentialStatus => store.status())

  ipcMain.handle('creds:setHeygen', async (_e, key: string) => {
    const trimmed = key.trim()
    if (!trimmed) {
      store.clear('heygenApiKey')
      return { ok: true }
    }
    // 저장 전에 실제로 통하는 키인지 확인한다. 나중에 파이프라인 중간에서 터지는 것보다 낫다.
    try {
      await new HeyGenClient(trimmed).me()
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '키 검증에 실패했습니다.' }
    }
    store.set('heygenApiKey', trimmed)
    return { ok: true }
  })

  ipcMain.handle('creds:setOpenai', (_e, key: string) => {
    const trimmed = key.trim()
    if (trimmed) store.set('openaiApiKey', trimmed)
    else store.clear('openaiApiKey')
    return { ok: true }
  })

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
      const res = await signInWithGoogle(clientId, store.get('googleClientSecret'), allowedDomains())
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

  // ── 영상 선택 ─────────────────────────────────────────────
  ipcMain.handle('video:pick', async () => {
    requireSignIn()
    const res = await dialog.showOpenDialog(win, {
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
      const outputPath = await runDub(win, opts)
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

  ipcMain.handle('shell:reveal', (_e, path: string) => {
    shell.showItemInFolder(path)
    return { ok: true }
  })

  // ── 대화 ──────────────────────────────────────────────────
  ipcMain.handle(
    'chat:send',
    async (_e, history: Array<{ role: 'user' | 'assistant'; content: string }>, input: string) => {
      const key = store.get('openaiApiKey')
      if (!key) return { ok: false, error: 'OpenAI API 키를 먼저 설정해 주세요.' }

      try {
        requireSignIn()
        const ai = new OpenAIClient(key)
        const turn = await ai.chat(history, input, {
          hasVideo: () => Boolean(selected),
          videoSummary: () =>
            selected
              ? `영상 "${selected.name}" 선택됨(${(selected.sizeBytes / 1024 / 1024).toFixed(1)}MB). ` +
                (job ? `작업 진행 중: ${job.progress.message}.` : '진행 중인 작업 없음.')
              : '선택된 영상 없음.',
          startDub: async (opts) => {
            // 거절 사유는 먼저 동기적으로 확인한다. 그래야 "시작했습니다"가 거짓말이 되지 않는다.
            if (job) return '이미 진행 중인 작업이 있습니다. 끝난 뒤 다시 시도하세요.'
            if (!store.get('heygenApiKey')) return 'HeyGen API 키가 설정되지 않았습니다.'

            // 여기서부터는 오래 걸리므로 대화를 막지 않고 백그라운드로 넘긴다.
            void runDub(win, opts).catch(() => {})
            return `더빙 작업을 시작했습니다. 모드: ${opts.mode}.`
          },
          getJobStatus: async () => {
            if (job) return `진행 중: ${job.progress.stage} — ${job.progress.message}`
            if (lastFinished) {
              return lastFinished.stage === 'done'
                ? `마지막 작업 완료. 저장 위치: ${lastFinished.outputPath}`
                : `마지막 작업 ${lastFinished.stage}: ${lastFinished.error ?? ''}`
            }
            return '아직 실행된 작업이 없습니다.'
          }
        })
        return { ok: true, ...turn }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}

function setSelected(path: string): SelectedVideo {
  selected = { path, name: basename(path), sizeBytes: statSync(path).size }
  return selected
}
