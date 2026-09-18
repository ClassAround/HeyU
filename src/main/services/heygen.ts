import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { downloadFile } from './download.js'
import { basename, extname } from 'node:path'
import type { DubOptions } from '../../shared/types.js'

const BASE = 'https://api.heygen.com'

/**
 * HeyGen REST 클라이언트.
 *
 * 업로드 경로를 direct-upload(presigned S3)로 고정한 이유:
 * 멀티파트 `POST /v3/assets` 는 32MB 상한이 있는데, 2분짜리 1080p 영상은
 * 비트레이트에 따라 이 값을 쉽게 넘긴다. 프록시 업로드를 쓰면 길이 제한은
 * 통과해도 용량에서 막히는 사례가 생긴다.
 */

export class HeyGenError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: unknown
  ) {
    super(message)
    this.name = 'HeyGenError'
  }
}

/** HeyGen 은 응답을 `{ data: ... }` 로 감쌀 때와 그대로 줄 때가 섞여 있다. */
function unwrap<T>(body: any): T {
  if (body && typeof body === 'object') {
    if (body.error) {
      const msg =
        typeof body.error === 'string' ? body.error : (body.error.message ?? JSON.stringify(body.error))
      throw new HeyGenError(msg, undefined, body.error)
    }
    if ('data' in body && body.data !== null && body.data !== undefined) return body.data as T
  }
  return body as T
}

export interface DirectUpload {
  asset_id: string
  upload_url: string
  upload_headers?: Record<string, string>
  max_bytes?: number
}

export interface TranslationStatus {
  id?: string
  status: 'pending' | 'running' | 'completed' | 'failed' | string
  video_url?: string
  audio_url?: string
  srt_caption_url?: string
  failure_message?: string
  output_language?: string
}

/** 확장자로 MIME 타입 추정. HeyGen 은 완료 시 실제 바이트와 대조 검증한다. */
function guessContentType(path: string): string {
  const map: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.m4v': 'video/x-m4v',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo'
  }
  return map[extname(path).toLowerCase()] ?? 'video/mp4'
}

export type HeyGenTransport = (path: string, init: RequestInit) => Promise<unknown>

export class HeyGenClient {
  constructor(private readonly apiKey: string | HeyGenTransport) {
    if (!apiKey) throw new HeyGenError('HeyGen API 키가 설정되지 않았습니다.')
  }

  private async request<T>(
    path: string,
    init: RequestInit & { signal?: AbortSignal } = {}
  ): Promise<T> {
    if (typeof this.apiKey === 'function') return unwrap<T>(await this.apiKey(path, init))
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'x-api-key': this.apiKey,
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers as Record<string, string> | undefined)
      }
    })

    const text = await res.text()
    let parsed: unknown
    try {
      parsed = text ? JSON.parse(text) : {}
    } catch {
      throw new HeyGenError(`HeyGen 응답을 해석하지 못했습니다 (HTTP ${res.status}).`, res.status, text)
    }

    if (!res.ok) {
      const body = parsed as any
      const msg =
        body?.error?.message ?? body?.message ?? body?.error ?? `HeyGen 요청 실패 (HTTP ${res.status})`
      throw new HeyGenError(typeof msg === 'string' ? msg : JSON.stringify(msg), res.status, parsed)
    }

    return unwrap<T>(parsed)
  }

  /** 계정/크레딧 확인. 키가 유효한지 검증하는 용도로도 쓴다. */
  async me(): Promise<any> {
    return this.request<any>('/v2/user/remaining_quota', { method: 'GET' })
  }

  /**
   * 로컬 영상 파일을 HeyGen 에 올리고 asset_id 를 돌려준다.
   * onProgress 는 0~1 비율을 받는다.
   */
  async uploadVideo(
    filePath: string,
    onProgress: (ratio: number) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const size = statSync(filePath).size
    const contentType = guessContentType(filePath)

    const init = await this.request<DirectUpload>('/v3/assets/direct-uploads', {
      method: 'POST',
      signal,
      body: JSON.stringify({
        filename: basename(filePath),
        content_type: contentType,
        size_bytes: size
      })
    })

    if (init.max_bytes && size > init.max_bytes) {
      throw new HeyGenError(
        `파일이 업로드 상한(${(init.max_bytes / 1024 / 1024).toFixed(0)}MB)을 초과합니다.`
      )
    }

    // 파일 바이트는 S3 로 직접 간다. 진행률은 읽은 바이트 수로 계산한다.
    let sent = 0
    const fileStream = createReadStream(filePath)
    fileStream.on('data', (chunk: string | Buffer) => {
      sent += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
      onProgress(Math.min(sent / size, 1))
    })

    const uploadUrl = new URL(init.upload_url)
    if (uploadUrl.protocol !== 'https:' || !uploadUrl.hostname.endsWith('.amazonaws.com')) {
      throw new HeyGenError('허용되지 않은 업로드 주소입니다.')
    }
    const putRes = await fetch(uploadUrl, {
      redirect: 'error',
      method: 'PUT',
      signal,
      // upload_headers 는 presigned 서명에 포함되므로 한 글자도 바꾸지 않고 그대로 보낸다.
      headers: {
        'content-type': contentType,
        'content-length': String(size),
        ...(init.upload_headers ?? {})
      },
      body: Readable.toWeb(fileStream) as ReadableStream,
      // Node 의 fetch 는 스트림 본문에 duplex 지정을 요구한다.
      duplex: 'half'
    } as RequestInit & { duplex: 'half' })

    if (!putRes.ok) {
      throw new HeyGenError(
        `스토리지 업로드 실패 (HTTP ${putRes.status}).`,
        putRes.status,
        await putRes.text().catch(() => undefined)
      )
    }

    await this.request(`/v3/assets/${init.asset_id}/complete`, { method: 'POST', signal, body: '{}' })
    onProgress(1)
    return init.asset_id
  }

  /** 번역 작업을 만들고 translation id 를 돌려준다. */
  async createTranslation(
    assetId: string,
    opts: DubOptions,
    signal?: AbortSignal
  ): Promise<string> {
    const payload: Record<string, unknown> = {
      video: { type: 'asset_id', asset_id: assetId },
      output_languages: ['English'],
      mode: opts.mode,
      disable_music_track: opts.removeMusic,
      enable_dynamic_duration: true,
      title: `RAWCUT GLOBAL · English dub · ${new Date().toISOString()}`
    }
    if (opts.useStockVoice) {
      payload.stock_voice_config = { use_stock_voice: true }
    }

    const data = await this.request<{ video_translation_ids?: string[]; id?: string }>(
      '/v3/video-translations',
      { method: 'POST', signal, body: JSON.stringify(payload) }
    )

    const id = data.video_translation_ids?.[0] ?? data.id
    if (!id) throw new HeyGenError('번역 작업 ID를 받지 못했습니다.', undefined, data)
    return id
  }

  async getTranslation(id: string, signal?: AbortSignal): Promise<TranslationStatus> {
    return this.request<TranslationStatus>(`/v3/video-translations/${id}`, { method: 'GET', signal })
  }

  /**
   * 완료될 때까지 폴링한다.
   * 간격은 3초에서 시작해 15초까지 늘린다 — 초반 응답성과 장시간 작업의
   * 요청 낭비를 동시에 잡기 위한 절충이다.
   */
  async waitForTranslation(
    id: string,
    onTick: (status: TranslationStatus, elapsedMs: number) => void,
    signal?: AbortSignal,
    timeoutMs = 45 * 60 * 1000
  ): Promise<TranslationStatus> {
    const started = Date.now()
    let delay = 3000

    for (;;) {
      if (signal?.aborted) throw new HeyGenError('사용자가 작업을 취소했습니다.')

      const status = await this.getTranslation(id, signal)
      const elapsed = Date.now() - started
      onTick(status, elapsed)

      if (status.status === 'completed') {
        if (!status.video_url) {
          throw new HeyGenError('완료 상태이지만 다운로드 URL이 없습니다.', undefined, status)
        }
        return status
      }
      if (status.status === 'failed') {
        throw new HeyGenError(status.failure_message ?? 'HeyGen 번역에 실패했습니다.', undefined, status)
      }
      if (elapsed > timeoutMs) {
        throw new HeyGenError(`제한 시간(${Math.round(timeoutMs / 60000)}분)을 초과했습니다.`)
      }

      await new Promise((r) => setTimeout(r, delay))
      delay = Math.min(delay * 1.4, 15000)
    }
  }

  /** presigned 결과 URL을 로컬 파일로 내려받는다. */
  async download(
    url: string,
    destPath: string,
    onProgress: (ratio: number | null) => void,
    signal?: AbortSignal
  ): Promise<void> {
    await downloadFile(url, destPath, onProgress, signal)
  }
}
