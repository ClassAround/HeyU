import { createWriteStream } from 'node:fs'
import { open, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Structural integrity check, not a codec/decode guarantee. */
export async function validateMp4(path: string): Promise<void> {
  const file = await open(path, 'r')
  try {
    const { size } = await file.stat()
    let offset = 0
    const types = new Set<string>()
    while (offset < size) {
      const header = Buffer.alloc(16)
      const { bytesRead } = await file.read(header, 0, Math.min(16, size - offset), offset)
      if (bytesRead < 8) throw new Error('MP4 헤더가 잘렸습니다.')
      let length = header.readUInt32BE(0)
      const type = header.toString('ascii', 4, 8)
      let headerSize = 8
      if (length === 1) {
        if (bytesRead < 16) throw new Error('MP4 확장 헤더가 잘렸습니다.')
        const wide = header.readBigUInt64BE(8)
        if (wide > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('MP4 크기가 올바르지 않습니다.')
        length = Number(wide)
        headerSize = 16
      } else if (length === 0) length = size - offset
      if (length < headerSize || offset + length > size) throw new Error('MP4 데이터가 손상되었거나 다운로드가 덜 끝났습니다.')
      types.add(type)
      offset += length
    }
    if (!types.has('ftyp') || !types.has('moov') || !types.has('mdat')) {
      throw new Error('재생에 필요한 MP4 데이터가 없습니다.')
    }
  } finally { await file.close() }
}

/** Publish only a complete, validated download. Failed attempts cannot overwrite a valid result. */
export async function downloadFile(
  url: string, destPath: string, onProgress: (ratio: number | null) => void, signal?: AbortSignal
): Promise<void> {
  const partial = `${destPath}.${randomUUID()}.part`
  try {
    const res = await fetch(url, { signal, headers: { 'accept-encoding': 'identity' } })
    if (res.status !== 200 || !res.body) throw new Error(`결과 다운로드 실패 (HTTP ${res.status}).`)
    const mime = res.headers.get('content-type') ?? ''
    if (/text\/html|application\/(?:json|xml)/i.test(mime)) throw new Error('영상 대신 오류 응답을 받았습니다.')
    const total = res.headers.get('content-encoding') ? 0 : Number(res.headers.get('content-length') ?? 0)
    let got = 0
    const count = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        got += chunk.length
        onProgress(total > 0 ? Math.min(got / total, 0.99) : null)
        // Own the bytes until the asynchronous file write completes.
        callback(null, Buffer.from(chunk))
      }
    })
    await pipeline(Readable.fromWeb(res.body as any), count, createWriteStream(partial, { flags: 'wx' }), { signal })
    if (!got || (total > 0 && total !== got)) throw new Error('다운로드한 파일 크기가 서버 응답과 다릅니다.')
    if (extname(destPath).toLowerCase() === '.mp4') await validateMp4(partial)
    signal?.throwIfAborted()
    await rename(partial, destPath)
    onProgress(1)
  } catch (error) {
    await rm(partial, { force: true }).catch(() => {})
    throw error
  }
}
