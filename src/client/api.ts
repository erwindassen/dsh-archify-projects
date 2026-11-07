/**
 * 客户端 HTTP 封装。
 *
 * 只用同源 fetch（`credentials: 'same-origin'`），不引入任何请求库 ——
 * 插件产物必须能在外置 11 个 baseline 模块之外零依赖运行。
 */

import type { ApiResult } from '../shared/protocol.js'

/** 带错误码的失败。 */
export class ApiError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

/** 发一次请求并解包 `{ok, value}`。 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    ...init,
  })
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ApiError('bad-response', `服务返回了非 JSON 内容（HTTP ${response.status}）`)
  }
  const result = payload as ApiResult<T>
  if (result.ok === true) return result.value
  const code = result.error?.code ?? 'unknown'
  const message = result.error?.message ?? '未知错误'
  throw new ApiError(code, message)
}

/** POST/PATCH 的便捷封装。 */
export function send<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T> {
  return api<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
