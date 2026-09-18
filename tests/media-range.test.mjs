import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'rawcut-range-'))
buildSync({ entryPoints:['src/main/services/mediaRange.ts'], outfile:join(dir,'mediaRange.mjs'), bundle:true, platform:'node', format:'esm' })
const { resolveRange } = await import(pathToFileURL(join(dir,'mediaRange.mjs')))

const SIZE = 1000

test('range parsing drives <video> playback and seeking', async (t) => {
 try {
  await t.test('no range header serves the whole file', () => {
   assert.deepEqual(resolveRange(SIZE, null), { kind: 'full' })
   assert.deepEqual(resolveRange(SIZE, 'bytes=-'), { kind: 'full' })
   // 우리가 다루지 않는 형식은 거절이 아니라 전체 응답으로 떨어져야 한다.
   assert.deepEqual(resolveRange(SIZE, 'bytes=0-99,200-299'), { kind: 'full' })
   assert.deepEqual(resolveRange(SIZE, 'items=0-10'), { kind: 'full' })
  })

  await t.test('open-ended range streams to the end — this is what playback uses', () => {
   assert.deepEqual(resolveRange(SIZE, 'bytes=0-'), { kind: 'partial', start: 0, end: 999 })
   assert.deepEqual(resolveRange(SIZE, 'bytes=500-'), { kind: 'partial', start: 500, end: 999 })
  })

  await t.test('closed range is clamped to the file, not rejected', () => {
   assert.deepEqual(resolveRange(SIZE, 'bytes=0-99'), { kind: 'partial', start: 0, end: 99 })
   // 끝이 파일을 넘어가면 잘라준다 — 여기서 416 을 주면 탐색이 깨진다.
   assert.deepEqual(resolveRange(SIZE, 'bytes=900-5000'), { kind: 'partial', start: 900, end: 999 })
  })

  await t.test('suffix range reads from the tail — MP4 moov often lives there', () => {
   assert.deepEqual(resolveRange(SIZE, 'bytes=-200'), { kind: 'partial', start: 800, end: 999 })
   // 파일보다 큰 suffix 는 전체를 뜻한다. 음수 시작으로 넘어가면 안 된다.
   assert.deepEqual(resolveRange(SIZE, 'bytes=-5000'), { kind: 'partial', start: 0, end: 999 })
   assert.deepEqual(resolveRange(SIZE, 'bytes=-0'), { kind: 'unsatisfiable' })
  })

  await t.test('whitespace and impossible ranges', () => {
   assert.deepEqual(resolveRange(SIZE, '  bytes=10-20  '), { kind: 'partial', start: 10, end: 20 })
   assert.deepEqual(resolveRange(SIZE, 'bytes=1000-'), { kind: 'unsatisfiable' })
   assert.deepEqual(resolveRange(SIZE, 'bytes=600-500'), { kind: 'unsatisfiable' })
   assert.deepEqual(resolveRange(0, 'bytes=0-'), { kind: 'unsatisfiable' })
  })
 } finally {
  rmSync(dir, { recursive: true, force: true })
 }
})
