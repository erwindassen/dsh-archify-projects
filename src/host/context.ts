/**
 * 宿主 ctx 的窄化类型。
 *
 * cordis 的 `ctx` 在运行期是一个动态服务容器，没有可用的静态类型。与其到处 `any`，
 * 不如在这里把「本插件实际用到的那几个面」逐项写出来：改宿主 API 时，
 * 编译错误会集中出现在这一个文件，而不是散落几十处。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** DSH webServer 透传的 node 请求。 */
export interface WebRequest extends IncomingMessage {
  url: string
}

/** 透传的 node 响应。 */
export type WebResponse = ServerResponse

/** 路由注册项。`kind: 'exact'` 表示精确匹配路径。 */
export interface RouteSpec {
  kind?: string
  path: string
  methods?: readonly string[]
  handler: (req: WebRequest, res: WebResponse) => unknown
}

/** `ctx.webServer`。 */
export interface WebServerLike {
  register(route: RouteSpec): () => void
}

/** 日志器（DSH 的 logger 服务；本地退化实现同形）。 */
export interface LoggerLike {
  info(message: string, ...rest: unknown[]): void
  warn(message: string, ...rest: unknown[]): void
}

/** `ctx.workspaceRegistry` 里本插件用到的部分。 */
export interface WorkspaceLike {
  readonly id: string
  readonly path: string
  readonly title?: string
  readonly sessionIds?: readonly string[]
  attachSession?(sessionId: string): Promise<void>
}

export interface WorkspaceRegistryLike {
  list(): readonly WorkspaceLike[]
  create(path: string, title?: string): Promise<WorkspaceLike>
  get(id: string): WorkspaceLike | undefined
}

/** Skill 调用策略（注册表强校验这两个布尔）。 */
export interface SkillInvocationLike {
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
}

/** 资源根：bundle 目录式 skill 用它，加载正文时按这个根解析相对路径。 */
export interface SkillResourceBaseLike {
  readonly kind: 'directory'
  readonly path: string
}

/** 提供方 list() 返回的候选。字段与 `@deepseek-ai/dsh-skill` 的校验逐项对应。 */
export interface SkillCandidateLike {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: SkillInvocationLike
  readonly source: string
  readonly provider: string
  readonly rank: number
  readonly path?: string
  readonly resourceBase?: SkillResourceBaseLike
  readonly locator?: unknown
}

/** list() 的两种合法返回。 */
export type SkillListingLike =
  | readonly SkillCandidateLike[]
  | { readonly candidates: readonly SkillCandidateLike[]; readonly complete: boolean }

/** get() 返回的完整 skill。 */
export interface SkillDefinitionLike extends SkillCandidateLike {
  readonly content: string
}

/** 提供方对象契约。 */
export interface SkillProviderLike {
  readonly name: string
  list(options: { cwd: string; signal?: AbortSignal }): Promise<SkillListingLike>
  get(
    candidate: SkillCandidateLike,
    options: { signal?: AbortSignal },
  ): Promise<SkillDefinitionLike | undefined>
  dispose?(): Promise<void>
}

export interface SkillsLike {
  registerProvider(
    create: (control: { invalidate: () => void; signal: AbortSignal }) => SkillProviderLike,
  ): () => void
  register?(skill: unknown): () => void
}

/** `ctx.tools` 里本插件用到的部分。 */
export interface ToolExecutionLike {
  readonly name: string
  readonly arguments: unknown
}

export interface ToolsLike {
  restrict(filter: { allow?: readonly string[]; deny?: readonly string[] }): () => void
  guard(guard: (exec: ToolExecutionLike) => string | undefined): () => void
}

/** `ctx.sessionController`（`@deepseek-ai/dsh-api-session-controller`）。 */
export interface SessionControllerLike {
  create(request: {
    workspaceId?: string
    cwd?: string
    agentPreset?: string
    sessionId?: string
  }): Promise<{ sessionId: string; agentPreset?: string }>
  prompt?(
    request: {
      requestId: string
      sessionId: string
      mode: 'queue' | 'steer'
      content: readonly { type: string; text?: string }[]
      clientTimeZone?: string
    },
    signal?: AbortSignal,
  ): Promise<unknown>
}

/**
 * agent 作用域。
 *
 * `tools.restrict` 要求「scoped ctx」，宿主给的就是 `agent.ctx`；
 * 这里只声明本插件用到的两个成员，单测才好造假。
 */
export interface ScopedAgentCtx {
  readonly tools?: ToolsLike
  effect?: (fn: () => (() => void) | void, label?: string) => unknown
}

/** `ctx.agents`（`@deepseek-ai/dsh-agent`）。 */
/**
 * `ctx.sessionProjections` 的只读面。
 *
 * 宿主用它把「log 派生的会话状态」（todos / tokenUsage）端给客户端；这里只用
 * `snapshot()` 同步读一份，缺失或形状不对都按「没有」处理。
 */
export interface SessionProjectionsLike {
  snapshot(
    session: unknown,
    keys?: readonly string[],
  ): { readonly values?: Readonly<Record<string, unknown>> }
}

export interface AgentLike {
  readonly id?: string
  readonly ctx?: ScopedAgentCtx
  followup(message: {
    content: readonly { type: string; text?: string }[]
    source: { kind: string }
  }): unknown
  whenIdle(): Promise<void>
  readonly session?: unknown
}

export interface AgentHandleLike {
  readonly agent: AgentLike
  dispose(): Promise<void>
}

export interface AgentsLike {
  create(options: {
    sessionId?: string
    agentOptions?: { provider?: string; model?: string }
    setup?: (agentCtx: unknown, agent: AgentLike) => void | Promise<void>
  }): Promise<AgentHandleLike>
  get(id: string): AgentLike | undefined
}

/** 本插件拿到的宿主 ctx。全部可选 —— 缺服务时走降级并在日志里说清楚。 */
export interface HostContext {
  effect(fn: () => () => void, label?: string): void
  get(name: string): unknown
  /**
   * cordis 的服务注入：只有在 `inject([...])` 的回调里，`ctx.<service>` 才可访问。
   * 直接读未 inject 的服务，proxy 会抛 `cannot get property "x" without inject`——
   * 这正是路由一直 404 的根因：webServer 拿不到，注册被 try/catch 吞掉了。
   */
  inject(deps: readonly string[], fn: (scoped: HostContext) => void): void
  logger: LoggerLike
  webServer: WebServerLike
  workspaceRegistry?: WorkspaceRegistryLike
  sessionProjections?: SessionProjectionsLike
  sessionController?: SessionControllerLike
  agents?: AgentsLike
  skills?: SkillsLike
  tools?: ToolsLike
  sessions?: unknown
}

/** 取一个服务，取不到时返回 undefined（而不是抛）。 */
export function serviceOf<T>(ctx: HostContext, name: string): T | undefined {
  try {
    const viaGet = ctx.get(name)
    if (viaGet !== undefined && viaGet !== null) return viaGet as T
  } catch {
    // ctx.get 在服务不存在时会抛，这里当作「没有」
  }
  // cordis 的 ctx 是 proxy：访问未 inject 的服务，取属性这一步本身就会抛
  // 「cannot get property "x" without inject」，所以 `direct` 也必须在 try 里。
  try {
    const direct = (ctx as unknown as Record<string, unknown>)[name]
    return (direct as T | undefined) ?? undefined
  } catch {
    return undefined
  }
}
