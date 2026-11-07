// @vitest-environment node
/**
 * 假的 HTTP 请求/响应，用来测路由分发。
 *
 * 宿主给的是原生 node 的 req/res，所以这里也用最小的原生形状，
 * 不引入 supertest 之类的额外依赖。
 */

import { Readable, Writable } from 'node:stream'
import type { WebRequest, WebResponse } from '../../src/host/context.js'

export interface FakeResponse extends WebResponse {
  readonly finished: boolean
  readonly status: number
  readonly headers: Record<string, string>
  readonly body: string
  readonly json: () => unknown
}

/** 造一个只读的请求流。 */
export function fakeRequest(options: {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}): WebRequest {
  const stream = Readable.from(
    options.body === undefined ? [] : [Buffer.from(options.body, 'utf8')],
  ) as unknown as WebRequest
  Object.defineProperty(stream, 'url', { value: options.url, enumerable: true })
  Object.defineProperty(stream, 'method', { value: options.method ?? 'GET', enumerable: true })
  Object.defineProperty(stream, 'headers', { value: options.headers ?? {}, enumerable: true })
  return stream
}

/** 造一个能收集输出的响应。真的 Writable，所以 `readStream.pipe(res)` 也能用。 */
export function fakeResponse(): FakeResponse {
  const chunks: Buffer[] = []
  const headers: Record<string, string> = {}
  let status = 0
  let finished = false

  const stream = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      done()
    },
    final(done) {
      finished = true
      done()
    },
  })

  Object.defineProperties(stream, {
    statusCode: {
      get: () => status,
      set: (value: number) => {
        status = value
      },
      configurable: true,
    },
    status: { get: () => status },
    finished: { get: () => finished },
    headers: { get: () => headers },
    body: { get: () => Buffer.concat(chunks).toString('utf8') },
    json: {
      get: () => (): unknown => {
        const text = Buffer.concat(chunks).toString('utf8')
        return text.length === 0 ? null : JSON.parse(text)
      },
    },
    setHeader: {
      get:
        () =>
        (name: string, value: string): unknown => {
          headers[name.toLowerCase()] = value
          return stream
        },
    },
    writeHead: {
      get:
        () =>
        (code: number, extra?: Record<string, string>): unknown => {
          status = code
          for (const [key, value] of Object.entries(extra ?? {})) headers[key.toLowerCase()] = value
          return stream
        },
    },
  })

  return stream as unknown as FakeResponse
}
