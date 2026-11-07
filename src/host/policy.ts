/**
 * 会话策略：这个 agent 能碰什么。
 *
 * 三件事集中在这里，因为它们必须一致：
 *   1. **工具白名单**（`tools.restrict` 的 allow，模型看得见什么）；
 *   2. **执行层守卫**（`tools.guard`，拦不在名单里的工具、拦非 archify 的 skill）；
 *   3. **skill 收口口径**（唯一允许的名字）。
 *
 * 为什么必须在 `agent.ctx` 上装：`tools.restrict` 的实现第一行是
 * `scopeOf(this.ctx)` —— 根 ctx 直接抛「requires a scoped context (agent.ctx)」。
 * 在 runner 里、会话刚建好、第一条 prompt 之前装，顺带拿到「只影响本插件起的会话」
 * 这个性质：别的 preset 起的 agent 一个都不动。
 */

import type { ScopedAgentCtx, ToolExecutionLike } from './context.js'

/** 唯一的 skill 名。 */
export const ARCHIFY_SKILL_NAME = 'archify'

/** 基础工具白名单（不含 shell，shell 按平台补）。 */
const BASE_ALLOW = ['read', 'write', 'edit', 'glob', 'grep', 'skill'] as const

/**
 * 问答会话的白名单：只读代码 + 加载 archify（不需要出图，但保留 skill 方便看口径）。
 * 没有 shell、没有写工具 —— 用户要求「会话只剩 archify 和读代码的能力」。
 */
const READONLY_ALLOW = ['read', 'glob', 'grep', 'skill'] as const

/**
 * 这个受限 agent 允许使用的工具全集。
 *
 * shell 按平台二选一：宿主在 Windows 上只注册 `pwsh`，写 `bash` 会让
 * `restrict` 因为「未知工具名」直接抛。
 */
export function allowedToolNames(platform: string = process.platform): readonly string[] {
  return [...BASE_ALLOW, platform === 'win32' ? 'pwsh' : 'bash']
}

/** 只读会话（提问）允许的工具：读文件、找文件、加载 archify，别的都没有。 */
export function readonlyToolNames(): readonly string[] {
  return [...READONLY_ALLOW]
}

/**
 * 执行层守卫：单调、同步、返回字符串即拒绝。
 *
 * 两道检查合在一个函数里，因为 guard 只能注册一次，且必须同步给结论：
 *   - `skill` 只认 archify；
 *   - 其余工具必须在白名单里。
 *
 * 白名单已经收过一遍了，这里仍再查一次 —— restrict 可能因为「未知工具名」降级，
 * 而 guard 不看注册表，是最后一道能真正拦住执行的闸。
 */
export function makeGuard(
  allow: readonly string[],
): (exec: ToolExecutionLike) => string | undefined {
  const allowed = new Set(allow)
  return (exec: ToolExecutionLike): string | undefined => {
    if (exec.name === 'skill') {
      const requested = readSkillName(exec.arguments)
      if (requested !== ARCHIFY_SKILL_NAME) {
        return `这个会话只允许加载 archify skill（请求的是 ${requested ?? '(未指定)'}）`
      }
      return undefined
    }
    if (!allowed.has(exec.name)) {
      return `工具 "${exec.name}" 在这个会话里被禁用：本会话只允许 ${allow.join(' / ')}`
    }
    return undefined
  }
}

function readSkillName(args: unknown): string | null {
  if (typeof args !== 'object' || args === null) return null
  const name = (args as { name?: unknown }).name
  return typeof name === 'string' ? name : null
}

/** 收口结果，给调用方记日志用。 */
export interface TightenResult {
  readonly restricted: boolean
  readonly guarded: boolean
  readonly message: string | null
}

/**
 * 装白名单 + 守卫。
 *
 * 两步各自容错：`restrict` 对未注册的名字会抛，抛了也继续装 guard ——
 * 少了哪一层都要在日志里说清楚，不静默降级。
 */
export function tightenAgent(
  scope: ScopedAgentCtx | undefined,
  allow: readonly string[],
  warn: (message: string) => void,
): TightenResult {
  if (scope === undefined || scope.tools === undefined) {
    const message = 'agent 作用域没有 tools 服务：白名单未生效'
    warn(message)
    return { restricted: false, guarded: false, message }
  }
  const tools = scope.tools
  let restricted = false
  let guarded = false
  let message: string | null = null

  try {
    run(
      scope,
      () => tools.restrict?.({ allow }) ?? undefined,
      'dsh-archify-projects: tool allowlist',
    )
    restricted = true
  } catch (err) {
    message = `工具白名单未生效：${describe(err)}`
    warn(message)
  }

  try {
    run(
      scope,
      () => tools.guard?.(makeGuard(allow)) ?? undefined,
      'dsh-archify-projects: tool guard',
    )
    guarded = true
  } catch (err) {
    const text = `工具守卫未生效：${describe(err)}`
    warn(text)
    message = message === null ? text : `${message}；${text}`
  }

  return { restricted, guarded, message }
}

/** 装只读白名单 + 守卫（问答会话用）。 */
export function tightenReadOnlyAgent(
  scope: ScopedAgentCtx | undefined,
  warn: (message: string) => void,
): TightenResult {
  return tightenAgent(scope, READONLY_ALLOW, warn)
}

/** 有 `effect` 就交给它管生命周期，没有就直接装。 */
function run(scope: ScopedAgentCtx, install: () => (() => void) | undefined, label: string): void {
  if (typeof scope.effect === 'function') {
    scope.effect(() => install() ?? undefined, label)
    return
  }
  install()
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
