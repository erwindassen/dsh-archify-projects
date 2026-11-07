/**
 * Agent 编排：一次运行 = 一个 DSH 会话 + 一段结构化提示词 + 产物回收。
 *
 * 走的是宿主已经有的东西，不新造轮子：
 *   - 会话由 `ctx.sessionController.create({ cwd, agentPreset })` 起（复用 DSH 的
 *     模型/日志/审批），preset 就是 `cordis.patch.yml` 里那个受限组合；
 *   - 提示词经 `ctx.sessionController.prompt(...)` 进 agent 收件箱；
 *   - 结束靠 `agent.whenIdle()`，产物靠「标记优先 + 目录兜底」回收。
 *
 * 运行是**异步**的：HTTP 路由立刻返回 runId + sessionId，页面可以马上显示「生成中」
 * 并给出会话链接，不必等一次模型调用跑完。
 */

import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { buildRunPrompt, parseArtifactMarkers } from '../shared/prompt.js'
import {
  DIAGRAM_KINDS,
  type DiagramKind,
  type DiagramState,
  type Project,
  type RunKind,
  type RunRecord,
} from '../shared/types.js'
import { projectDir, workspaceRoot, type ResolvedConfig } from './config.js'
import {
  serviceOf,
  type AgentLike,
  type HostContext,
  type SessionControllerLike,
} from './context.js'
import { allowedToolNames, tightenAgent } from './policy.js'
import type { ProjectStore } from './store.js'
import { ensureProjectWorkspace } from './workspace.js'

/** 运行发起后的回执。 */
export interface StartedRun {
  readonly runId: string
  readonly sessionId: string | null
  readonly kind: RunKind
}

/** runner 的依赖。 */
export interface RunnerDeps {
  readonly ctx: HostContext
  readonly store: ProjectStore
  readonly config: ResolvedConfig
  /** 懒解析 archify skill 目录（可能为 null，表示降级）。 */
  readonly skillDir: () => Promise<string | null>
}

/** 生成可读的运行 id（不追求全局唯一，台账里可区分即可）。 */
export function newRunId(now: Date = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)
  const rand = Math.random().toString(36).slice(2, 6)
  return `run_${stamp}_${rand}`
}

/** 生成请求 id（prompt 的幂等标识）。 */
function newRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 跑一次运行。 */
export class Runner {
  private readonly deps: RunnerDeps
  private readonly busy = new Map<string, Promise<void>>()

  constructor(deps: RunnerDeps) {
    this.deps = deps
  }

  /** 该项目是否已有任务在跑。 */
  isBusy(projectId: string): boolean {
    return this.busy.has(projectId)
  }

  /** 等某个项目当前的运行结束（没有在跑就返回 undefined）。 */
  whenSettled(projectId: string): Promise<void> | undefined {
    return this.busy.get(projectId)
  }

  /**
   * 起一次运行：登记状态 → 建会话 → 投递提示词 → 后台等待结束。
   *
   * 返回时 `sessionId` 已确定（会话创建是同步等到的），所以页面能立刻给出会话链接。
   */
  async start(project: Project, kind: RunKind, kinds: readonly DiagramKind[]): Promise<StartedRun> {
    if (this.isBusy(project.id)) {
      throw new RunnerBusy(project.id)
    }
    const { store, config } = this.deps
    const runId = newRunId()
    const startedAt = new Date().toISOString()

    const workspaceDir = await ensureProjectWorkspace(config, project.id)
    const skillDir = await this.deps.skillDir()
    const prompt = buildRunPrompt({
      projectName: project.name,
      repoPath: project.repoPath,
      workspaceDir,
      git: project.git,
      kinds,
      stamp: stampOf(new Date()),
      archifySkillPath: skillDir,
      previous: previousCommits(project),
    })

    const sessionId = await this.openSession(project, workspaceDir, prompt)

    const record: RunRecord = {
      id: runId,
      kind,
      status: 'running',
      sessionId,
      startedAt,
      finishedAt: null,
      error: null,
      note: null,
    }
    await store.patch(project.id, (current) => ({
      ...current,
      updatedAt: startedAt,
      lastRun: record,
      runs: pushRun(current.runs, record, config.keepRuns),
      diagrams: markStatus(current.diagrams, kinds, 'running'),
    }))

    const tracked = this.follow(project.id, runId, kinds).finally(() => {
      this.busy.delete(project.id)
    })
    this.busy.set(project.id, tracked)

    return { runId, sessionId, kind }
  }

  /**
   * 建会话并投递提示词。
   *
   * 优先 `sessionController`（宿主的标准会话命令面）；没有这个服务时退回
   * `agents.createSession` + `agent.followup`。两条路都用同一个 preset，
   * 限制不会因为走哪条路而消失。
   */
  private async openSession(
    project: Project,
    workspaceDir: string,
    prompt: string,
  ): Promise<string | null> {
    const { ctx, config, store } = this.deps
    const allow = allowedToolNames()
    const controller = serviceOf<SessionControllerLike>(ctx, 'sessionController')
    if (controller !== undefined) {
      const created = await controller.create({ cwd: workspaceDir, agentPreset: config.presetId })
      // 会话刚建好、还没开 turn：这时候收口工具面最干净
      this.tighten(created.sessionId, allow)
      if (typeof controller.prompt === 'function') {
        await controller.prompt(
          {
            requestId: newRequestId(),
            sessionId: created.sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: prompt }],
          },
          new AbortController().signal,
        )
      }
      return created.sessionId
    }

    const agents = serviceOf<{
      createSession(request: {
        cwd: string
        agentPreset?: string
        reusable: (sessionId: string) => boolean
      }): Promise<{ agent: AgentLike }>
    }>(ctx, 'agents')
    if (agents === undefined) {
      throw new RunnerUnavailable(
        '宿主没有 sessionController 也没有 agents 服务，无法起 agent 会话',
      )
    }
    const created = await agents.createSession({
      cwd: workspaceDir,
      agentPreset: config.presetId,
      reusable: () => false,
    })
    const agent = created.agent
    this.tighten(agent.id ?? null, allow)
    agent.followup({
      id: newRequestId(),
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'user' },
    } as never)
    const sessionId = (agent as unknown as { id?: string }).id ?? null
    // 会话 id 拿不到就无法跟踪产物；把这次运行标成失败，别留一个永远「运行中」的记录
    if (sessionId === null) throw new RunnerUnavailable('用 agents.createSession 起的会话没有 id')
    await store.patch(project.id, (current) => ({ ...current }))
    return sessionId
  }

  /** 对该会话的 agent 作用域装工具白名单与守卫。 */
  private tighten(sessionId: string | null, allow: readonly string[]): void {
    const { ctx } = this.deps
    const warn = (message: string): void => {
      try {
        ctx.logger.warn(`[dsh-archify-projects] ${message}`)
      } catch {
        // 日志器不可用不影响运行
      }
    }
    if (sessionId === null) {
      warn('会话没有 id：跳过工具收口')
      return
    }
    const agent = serviceOf<{ get(id: string): AgentLike | undefined }>(ctx, 'agents')?.get(
      sessionId,
    )
    if (agent?.ctx === undefined) {
      warn('拿不到 agent 作用域：工具白名单未生效（守卫同样未生效）')
      return
    }
    tightenAgent(agent.ctx, allow, warn)
  }

  /** 后台等待结束并回收产物。 */
  private follow(projectId: string, runId: string, kinds: readonly DiagramKind[]): Promise<void> {
    const run = async (): Promise<void> => {
      const { ctx, store, config } = this.deps
      const project = await store.get(projectId)
      if (project === undefined) return
      const sessionId = project.lastRun?.sessionId ?? null
      if (sessionId === null) {
        await this.fail(projectId, runId, '会话没有 id，无法跟踪运行')
        return
      }
      try {
        const agent = serviceOf<{ get(id: string): AgentLike | undefined }>(ctx, 'agents')?.get(
          sessionId,
        )
        if (agent === undefined) throw new RunnerUnavailable('会话已不在运行中，无法等待结果')
        await withTimeout(agent.whenIdle(), config.runTimeoutMs)
        const text = readFinalText(agent)
        const markers = parseArtifactMarkers(text)
        const found = await this.collectArtifacts(projectId, markers, kinds)
        await this.succeed(projectId, runId, found, kinds)
      } catch (err) {
        await this.fail(projectId, runId, err instanceof Error ? err.message : String(err))
      }
    }
    return run()
  }

  /** 回收产物：标记优先，找不到就扫 `.archify/` 最新目录。 */
  private async collectArtifacts(
    projectId: string,
    markers: Partial<Record<DiagramKind, string>>,
    kinds: readonly DiagramKind[],
  ): Promise<Map<DiagramKind, string>> {
    const found = new Map<DiagramKind, string>()
    for (const kind of kinds) {
      const marked = markers[kind]
      if (marked !== undefined && (await isFile(marked))) {
        found.set(kind, path.resolve(marked))
      }
    }
    if (found.size === kinds.length) return found

    const fallback = await discoverArtifacts(this.deps.config, projectId)
    for (const kind of kinds) {
      if (found.has(kind)) continue
      const candidate = fallback.get(kind)
      if (candidate !== undefined) found.set(kind, candidate)
    }
    return found
  }

  private async succeed(
    projectId: string,
    runId: string,
    found: Map<DiagramKind, string>,
    kinds: readonly DiagramKind[],
  ): Promise<void> {
    const { store, config } = this.deps
    const now = new Date().toISOString()
    const root = workspaceRoot(config)
    await store.patch(projectId, (current) => {
      const diagrams = { ...current.diagrams }
      for (const kind of kinds) {
        const html = found.get(kind)
        diagrams[kind] =
          html === undefined
            ? failedState('没有找到这次运行的产物文件')
            : readyState(html, root, current, now)
      }
      const lastRun = finishRun(
        current,
        runId,
        now,
        found.size === kinds.length
          ? { status: 'succeeded', error: null }
          : { status: 'failed', error: '部分图谱没有产出' },
      )
      return {
        ...current,
        updatedAt: now,
        diagrams,
        lastRun,
        runs: pushRun(current.runs, lastRun, config.keepRuns),
      }
    })
  }

  private async fail(projectId: string, runId: string, message: string): Promise<void> {
    const { store, config } = this.deps
    const now = new Date().toISOString()
    // 失败路径也要先看盘：agent 常常已经把自检通过的 HTML 落进 `.archify/`，
    // 报错只是「等不到最终回复」（会话被宿主机重启掐断、超时、连接断）。
    // 这种情况下把已有产物认下来，比留一张「失败」有用得多。
    const salvaged = await discoverArtifacts(config, projectId).catch(
      () => new Map<DiagramKind, string>(),
    )
    const root = workspaceRoot(config)
    await store.patch(projectId, (current) => {
      const diagrams = { ...current.diagrams }
      for (const kind of DIAGRAM_KINDS) {
        if (diagrams[kind].status !== 'running' && diagrams[kind].status !== 'queued') continue
        const html = salvaged.get(kind)
        diagrams[kind] =
          html === undefined
            ? { ...diagrams[kind], status: 'failed', error: message }
            : readyState(html, root, current, now)
      }
      const lastRun = finishRun(current, runId, now, { status: 'failed', error: message })
      return {
        ...current,
        updatedAt: now,
        diagrams,
        lastRun,
        runs: pushRun(current.runs, lastRun, config.keepRuns),
      }
    })
  }
}

/** 正在跑时又点了一次。 */
export class RunnerBusy extends Error {
  readonly projectId: string

  constructor(projectId: string) {
    super('这个项目已有任务在运行，等它结束再试')
    this.name = 'RunnerBusy'
    this.projectId = projectId
  }
}

/** 宿主缺少必要的 agent 服务。 */
export class RunnerUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RunnerUnavailable'
  }
}

/** 把一条运行写进历史（同 id 覆盖，否则追加），并裁剪到上限。 */
export function pushRun(
  runs: readonly RunRecord[],
  record: RunRecord,
  keep: number,
): readonly RunRecord[] {
  const withoutSame = runs.filter((run) => run.id !== record.id)
  const next = [...withoutSame, record]
  return next.length <= keep ? next : next.slice(next.length - keep)
}

/** 结束一条运行：补齐 status / finishedAt / error，其余字段沿用启动时的记录。 */
function finishRun(
  project: Project,
  runId: string,
  now: string,
  outcome: { status: 'succeeded' | 'failed'; error: string | null },
): RunRecord {
  const base = project.runs.find((run) => run.id === runId) ??
    project.lastRun ?? {
      id: runId,
      kind: 'create' as const,
      sessionId: null,
      startedAt: now,
      finishedAt: null,
      error: null,
      note: null,
    }
  return { ...base, status: outcome.status, finishedAt: now, error: outcome.error }
}

function stampOf(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

function previousCommits(project: Project): Partial<Record<DiagramKind, string | null>> {
  return {
    structure: project.diagrams.structure.commit,
    domain: project.diagrams.domain.commit,
  }
}

function markStatus(
  diagrams: Readonly<Record<DiagramKind, DiagramState>>,
  kinds: readonly DiagramKind[],
  status: DiagramState['status'],
): Record<DiagramKind, DiagramState> {
  const next: Record<DiagramKind, DiagramState> = { ...diagrams }
  for (const kind of kinds) {
    const current = next[kind]
    next[kind] = { ...current, status, error: null }
  }
  return next
}

export function readyState(
  htmlPath: string,
  root: string,
  project: Project,
  now: string,
): DiagramState {
  const specPath = path.join(path.dirname(htmlPath), 'candidate.json')
  return {
    status: 'ready',
    htmlPath: relativeTo(root, htmlPath),
    specPath: relativeTo(root, specPath),
    generatedAt: now,
    branch: project.git.branch,
    commit: project.git.commit,
    error: null,
  }
}

function failedState(message: string): DiagramState {
  return {
    status: 'failed',
    htmlPath: null,
    specPath: null,
    generatedAt: null,
    branch: null,
    commit: null,
    error: message,
  }
}

/** 相对路径统一用 posix 分隔符，URL 拼接才稳。 */
function relativeTo(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/')
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile()
  } catch {
    return false
  }
}

/** 从 agent 会话里取最后一条 assistant 文本。 */
function readFinalText(agent: AgentLike): string {
  const session = agent.session as { deriveMessages?: () => unknown[] } | undefined
  if (session === undefined || typeof session.deriveMessages !== 'function') return ''
  let messages: unknown[]
  try {
    messages = session.deriveMessages()
  } catch {
    return ''
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: unknown; content?: unknown } | undefined
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue
    const text = message.content
      .map((block) => {
        const b = block as { type?: unknown; text?: unknown }
        return b.type === 'text' && typeof b.text === 'string' ? b.text : ''
      })
      .join('\n')
      .trim()
    if (text.length > 0) return text
  }
  return ''
}

/**
 * 开库对账。宿主每次启动跑一次，做两件事：
 *
 * 1. **认领磁盘上的产物**：记录说不 ready、`.archify/` 下却已经有自检通过的 html
 *    （agent 跑到一半宿主被重启 / 页面被关的典型现场），把它认回来当 ready。
 * 2. **收尸悬挂的运行**：上一次运行的 `running` 会原样留在台账里（进程被 kill 时
 *    没有机会写 finishedAt）。不收拾就会永远「生成中」，按钮全禁用，用户只能手改 JSON。
 *    这里把它标成 failed，并说明代价只是重跑一次；能认领的产物照旧认领。
 */
export async function reconcileArtifacts(
  store: ProjectStore,
  config: ResolvedConfig,
): Promise<string[]> {
  const adopted: string[] = []
  const root = workspaceRoot(config)
  let projects: readonly Project[] = []
  try {
    projects = await store.list()
  } catch {
    return adopted
  }
  for (const project of projects) {
    const strayRuns = project.runs.filter((run) => run.status === 'running')
    const missing = DIAGRAM_KINDS.filter((kind) => project.diagrams[kind].status !== 'ready')
    if (missing.length === 0 && strayRuns.length === 0) continue

    const found = await discoverArtifacts(config, project.id).catch(
      () => new Map<DiagramKind, string>(),
    )
    const strayDiagrams = DIAGRAM_KINDS.filter((kind) => {
      const status = project.diagrams[kind].status
      return status === 'queued' || status === 'running'
    })
    if (found.size === 0 && strayRuns.length === 0 && strayDiagrams.length === 0) continue

    const now = new Date().toISOString()
    await store.patch(project.id, (current) => {
      const diagrams = { ...current.diagrams }
      for (const [kind, html] of found) diagrams[kind] = readyState(html, root, current, now)

      // 认领完还停在 queued / running 的：产物没有，就是那次运行被中断了。
      for (const kind of DIAGRAM_KINDS) {
        const status = diagrams[kind].status
        if (status !== 'queued' && status !== 'running') continue
        diagrams[kind] = failedState('上一次运行随宿主退出而中断，点「重新生成」重跑')
      }

      const runs = current.runs.map((run) =>
        run.status === 'running'
          ? { ...run, status: 'failed' as const, finishedAt: now, error: '宿主重启，本次运行中断' }
          : run,
      )
      const lastRun =
        current.lastRun !== null && current.lastRun.status === 'running'
          ? {
              ...current.lastRun,
              status: 'failed' as const,
              finishedAt: now,
              error: '宿主重启，本次运行中断',
            }
          : current.lastRun

      return { ...current, updatedAt: now, diagrams, runs, lastRun }
    })

    if (found.size > 0) adopted.push(`${project.name}: ${[...found.keys()].join('+')}`)
    if (strayRuns.length > 0) adopted.push(`${project.name}: 收尸 ${strayRuns.length} 条悬挂运行`)
  }
  return adopted
}

/**
 * 目录兜底：扫 `<项目目录>/.archify/` 下的子目录，按目录名里的 kind 关键词归类。
 *
 * 只在标记缺失时用。名字里没关键词时按「新目录优先」补位，宁可给错一张也不留空白。
 */
export async function discoverArtifacts(
  config: ResolvedConfig,
  projectId: string,
): Promise<Map<DiagramKind, string>> {
  const result = new Map<DiagramKind, string>()
  const archifyRoot = path.join(projectDir(config, projectId), '.archify')
  let dirs: string[]
  try {
    dirs = await readdir(archifyRoot, { withFileTypes: true }).then((entries) =>
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .reverse(),
    )
  } catch {
    return result
  }

  for (const dir of dirs) {
    const full = path.join(archifyRoot, dir)
    const kind = kindOfDirName(dir)
    if (kind === null || result.has(kind)) continue
    const html = await firstHtmlIn(full)
    if (html !== null) result.set(kind, html)
  }
  return result
}

function kindOfDirName(dir: string): DiagramKind | null {
  const lower = dir.toLowerCase()
  if (lower.startsWith('domain')) return 'domain'
  if (lower.startsWith('structure') || lower.startsWith('architecture')) return 'structure'
  return null
}

async function firstHtmlIn(dir: string): Promise<string | null> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const html = entries.find((e) => e.isFile() && e.name.endsWith('.html'))
    return html === undefined ? null : path.join(dir, html.name)
  } catch {
    return null
  }
}

/** 超时包装。 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`等待 agent 结束超时（${ms} ms）`))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      },
    )
  })
}
