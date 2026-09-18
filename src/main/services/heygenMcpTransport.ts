import { HeyGenClient, HeyGenError, type HeyGenTransport } from './heygen.js'
import { heygenMcp } from './heygenMcp.js'

/** Decode MCP tool results; tool errors must never be mistaken for successful jobs. */
export function decodeMcpResult(result: any): unknown {
  const text = (result.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
  if (result.isError) throw new HeyGenError(text || 'HeyGen MCP 도구 실행에 실패했습니다.')
  if (result.structuredContent) return result.structuredContent
  try { return JSON.parse(text) } catch {
    throw new HeyGenError('HeyGen MCP 응답을 해석할 수 없습니다.')
  }
}

/** Uses OAuth MCP tools for every control operation. No REST/API-key fallback. */
export function mcpTransport(call = heygenMcp.callTool): HeyGenTransport {
  return async (path, init) => {
    init.signal?.throwIfAborted()
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
    let name: string
    let args: Record<string, unknown>
    if (path === '/v3/assets/direct-uploads' && init.method === 'POST') {
      name = 'create_asset_upload'
      args = { filename: body.filename, contentType: body.content_type, sizeBytes: body.size_bytes }
    } else if (/^\/v3\/assets\/[^/]+\/complete$/.test(path) && init.method === 'POST') {
      name = 'complete_asset_upload'
      args = { assetId: path.split('/')[3] }
    } else if (path === '/v3/video-translations' && init.method === 'POST') {
      name = 'create_video_translation'
      args = {
        video: body.video, outputLanguages: body.output_languages,
        mode: body.mode, disableMusicTrack: body.disable_music_track,
        enableDynamicDuration: body.enable_dynamic_duration, title: body.title,
        ...(body.stock_voice_config ? { stockVoiceConfig: body.stock_voice_config } : {})
      }
    } else if (/^\/v3\/video-translations\/[^/]+$/.test(path) && init.method === 'GET') {
      name = 'get_video_translation'
      args = { videoTranslationId: path.split('/')[3] }
    } else {
      throw new HeyGenError('이 작업은 HeyGen MCP 더빙 경로에서 지원하지 않습니다.')
    }
    return decodeMcpResult(await call(name, args, init.signal ?? undefined))
  }
}

export function mcpHeygen(): HeyGenClient {
  if (!heygenMcp.status().connected) throw new HeyGenError('설정에서 HeyGen 계정을 먼저 연결해 주세요.')
  return new HeyGenClient(mcpTransport())
}
