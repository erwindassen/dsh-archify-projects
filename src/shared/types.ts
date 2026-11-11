/**
 * 台账数据模型（纯类型 + 纯构造函数，零 IO）。
 *
 * 这里是 host 与 client 唯一的「事实形状」来源：宿主写盘用它，页面渲染用它，
 * 序列化契约（protocol.ts 的请求/响应）也复用它。改这里的字段等于改协议版本。
 *
 * v2（图册）：版本口径从 commit 级降到分支级；图谱从「两张固定图」变成
 * 「默认两张 + 任意自定义图」；概念（Concept）成为项目级一等公民；
 * 图可以临时（只跑这一次）或永久（下次更新沿用同一 prompt）。
 */

/** 台账文件格式版本。字段形状不兼容时 +1，并在 store 里做迁移。 */
export const LEDGER_VERSION = 2

/** 两张默认图谱（自定义图统一用 `custom`）。 */
export const DIAGRAM_KINDS = ['structure', 'domain'] as const
export type DiagramKind = (typeof DIAGRAM_KINDS)[number]

/** 图种类：默认两张 + 自定义。 */
export type DiagramMode = DiagramKind | 'custom'

/** Archify 的真实渲染器（见 skills/archify 的 Type router）。 */
export const ARCHIFY_TYPES = [
  'architecture',
  'workflow',
  'sequence',
  'dataflow',
  'lifecycle',
] as const
export type ArchifyType = (typeof ARCHIFY_TYPES)[number]

/** 图的时效。永久图会在「更新图册」时用同一 prompt 重画；临时图只跑这一次。 */
export type Persistence = 'permanent' | 'temporary'

/** 一次运行因何而起。 */
export type RunKind = 'create' | 'update' | 'regenerate'

/** 运行状态。 */
export type RunStatus = 'running' | 'succeeded' | 'failed'

/** 单张图谱的产物状态机：idle → queued → running → ready | failed。 */
export type DiagramStatus = 'idle' | 'queued' | 'running' | 'ready' | 'failed'

/** 工作区状态（暂存 / 未暂存 / 未跟踪）。 */
export interface TreeState {
  readonly staged: number
  readonly unstaged: number
  readonly untracked: number
}

/**
 * 代码库的 Git 快照。
 *
 * 无 Git 目录时 `isRepo=false`，其余字段一律 `null` ——「不知道」和「空」必须能区分，
 * 否则页面会把 `null` 渲染成 0 或空串，用户会以为仓库干净。
 *
 * `commit` 仍保留（同步、排障用），但**不再是版本键**：图的「过期」看分支 + 工作区。
 */
export interface GitSnapshot {
  readonly isRepo: boolean
  readonly root: string | null
  readonly branch: string | null
  readonly detached: boolean
  readonly commit: string | null
  readonly commitFull: string | null
  readonly commitTime: string | null
  readonly commitSubject: string | null
  readonly upstream: string | null
  readonly ahead: number | null
  readonly behind: number | null
  readonly dirty: boolean | null
  /** 工作区明细；无 Git 或探测失败时为 null。 */
  readonly tree: TreeState | null
  readonly remoteUrl: string | null
  readonly checkedAt: string
}

/** 一张图谱的产物与元信息。`htmlPath` / `specPath` 都是相对插件工作区的路径。 */
export interface DiagramState {
  /** 稳定 id：默认两张是 `structure` / `domain`，自定义图是 `dgm_xxx`。 */
  readonly id: string
  readonly kind: DiagramMode
  readonly title: string
  /** 自定义图必填；默认图可为 null（用内置口径）。 */
  readonly prompt: string | null
  readonly persistence: Persistence
  /** 父子图：挂在哪张图下。 */
  readonly parentId: string | null
  /** 套图：同一 setId 的图在页面上归为一组（大图 + 细节小图）。 */
  readonly setId: string | null
  /** 这张图引用的概念 id。 */
  readonly conceptIds: readonly string[]
  /** 用户选的 archify 渲染器；null = 由 agent 按 prompt 判断。 */
  readonly renderer: ArchifyType | null
  /** 限定取证的目录（相对仓库根）；空数组 = 全仓库。 */
  readonly pathScope: readonly string[]
  readonly status: DiagramStatus
  readonly htmlPath: string | null
  readonly specPath: string | null
  readonly generatedAt: string | null
  /** 生成时的分支（版本键的一半）。 */
  readonly branch: string | null
  /** 生成时的工作区状态（版本键的另一半）。 */
  readonly tree: TreeState | null
  readonly error: string | null
}

/** 从代码里提取出来的架构概念；项目级，可被多张图引用。 */
export interface Concept {
  readonly id: string
  readonly name: string
  readonly summary: string
  /** 支撑这个概念的代码路径（相对仓库根），追问时用来定位。 */
  readonly evidence: readonly string[]
  readonly tags: readonly string[]
  readonly updatedAt: string
}

/** 一条 agent 进度（`todo_write` 的快照）。 */
export interface TodoItem {
  readonly content: string
  readonly status: 'pending' | 'in_progress' | 'completed'
}

/** 一次运行消耗的 token（来自宿主的 tokenUsage projection）。 */
export interface TokenUsage {
  readonly uncachedInput: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
}

/** 一次运行/一次提问的 token 合计。 */
export function usageTotalOf(usage: TokenUsage | null): number {
  if (usage === null) return 0
  return usage.uncachedInput + usage.output + usage.cacheRead + usage.cacheWrite
}

/** 对一张图的提问与回答。 */
export interface QaEntry {
  readonly id: string
  readonly diagramId: string
  readonly question: string
  readonly answer: string
  readonly at: string
  /** 回答是否已经并进图里。 */
  readonly applied: boolean
  /** 问答会话的运行状态；运行中页面据此显示进度。 */
  readonly status: 'running' | 'done' | 'failed'
  /** 问答会话的 todo 快照。 */
  readonly todos: readonly TodoItem[]
  readonly usage: TokenUsage | null
}

/** 一次 Agent 运行。会话 id 留着是为了能从页面跳回去看日志。 */
export interface RunRecord {
  readonly id: string
  readonly kind: RunKind
  readonly status: RunStatus
  readonly sessionId: string | null
  readonly startedAt: string
  readonly finishedAt: string | null
  readonly error: string | null
  readonly note: string | null
  /** 这次运行涉及哪些图（默认图用 kind，自定义图用 id）。 */
  readonly diagramIds: readonly string[]
  /** agent 的 todo 快照（最后写入的一份，用于运行结束后回看）。 */
  readonly todos: readonly TodoItem[]
  readonly usage: TokenUsage | null
}

/** 一个项目。 */
export interface Project {
  readonly id: string
  readonly name: string
  readonly repoPath: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly git: GitSnapshot
  /** 两张默认图（结构图 / 领域图）。 */
  readonly diagrams: Readonly<Record<DiagramKind, DiagramState>>
  /** 用户自定义的图（任意数量，可父子、可套图）。 */
  readonly custom: readonly DiagramState[]
  /** 项目级概念表。 */
  readonly concepts: readonly Concept[]
  /** 提问记录（按图归属）。 */
  readonly qa: readonly QaEntry[]
  /** 最近一次运行（`runs` 的末条，单独冗余一份方便渲染）。 */
  readonly lastRun: RunRecord | null
  /** 运行历史，旧→新，上限由 config.keepRuns 控制。 */
  readonly runs: readonly RunRecord[]
  /** 历史累计 token（不随 runs 裁剪丢失）。 */
  readonly usageTotal: number
}

/** 台账文件根。 */
export interface ProjectLedger {
  readonly version: number
  readonly updatedAt: string
  readonly projects: readonly Project[]
}

/** 空 Git 快照（无 Git 或尚未探测）。 */
export function emptyGitSnapshot(checkedAt: string): GitSnapshot {
  return {
    isRepo: false,
    root: null,
    branch: null,
    detached: false,
    commit: null,
    commitFull: null,
    commitTime: null,
    commitSubject: null,
    upstream: null,
    ahead: null,
    behind: null,
    dirty: null,
    tree: null,
    remoteUrl: null,
    checkedAt,
  }
}

/** 默认两张图的标题。 */
const DEFAULT_TITLES: Record<DiagramKind, string> = {
  structure: '项目结构图',
  domain: '领域图',
}

/** 空图谱状态。 */
export function emptyDiagramState(kind: DiagramKind = 'structure'): DiagramState {
  return {
    id: kind,
    kind,
    title: DEFAULT_TITLES[kind],
    prompt: null,
    persistence: 'permanent',
    parentId: null,
    setId: kind === 'structure' ? 'structure' : null,
    conceptIds: [],
    renderer: 'architecture',
    pathScope: [],
    status: 'idle',
    htmlPath: null,
    specPath: null,
    generatedAt: null,
    branch: null,
    tree: null,
    error: null,
  }
}

/** 空台账。 */
export function emptyLedger(now: string): ProjectLedger {
  return { version: LEDGER_VERSION, updatedAt: now, projects: [] }
}

/** 默认两张 + 自定义图，统一成一条列表（默认在前）。 */
export function allDiagrams(project: Project): readonly DiagramState[] {
  return [...DIAGRAM_KINDS.map((kind) => project.diagrams[kind]), ...project.custom]
}

/** 按 id 找图；`structure` / `domain` 也能命中默认图。 */
export function findDiagram(project: Project, id: string): DiagramState | undefined {
  if ((DIAGRAM_KINDS as readonly string[]).includes(id)) {
    return project.diagrams[id as DiagramKind]
  }
  return project.custom.find((diagram) => diagram.id === id)
}

/** 不可变地替换一张图（默认图走 record，自定义图走数组）。 */
export function withDiagram(project: Project, next: DiagramState): Project {
  if ((DIAGRAM_KINDS as readonly string[]).includes(next.kind)) {
    return {
      ...project,
      diagrams: { ...project.diagrams, [next.kind as DiagramKind]: next },
    }
  }
  return { ...project, custom: project.custom.map((d) => (d.id === next.id ? next : d)) }
}

/** 需要「更新图册」的图：默认两张 + 所有永久自定义图。 */
export function runnableDiagrams(project: Project): readonly DiagramState[] {
  return allDiagrams(project).filter(
    (diagram) =>
      diagram.persistence === 'permanent' || DIAGRAM_KINDS.includes(diagram.kind as DiagramKind),
  )
}

/** 工作区状态签名，用于判断图是否过期。 */
export function treeSignature(tree: TreeState | null): string {
  if (tree === null) return 'none'
  return `${tree.staged}:${tree.unstaged}:${tree.untracked}`
}

/** 由 Git 快照派生「图谱是否落后于代码」——按分支 + 工作区，不看 commit。 */
export function isStale(project: Project): boolean {
  if (!project.git.isRepo) return false
  const ready = allDiagrams(project).filter((d) => d.status === 'ready')
  if (ready.length === 0) return false
  const currentTree = treeSignature(project.git.tree)
  return ready.some((d) => d.branch !== project.git.branch || treeSignature(d.tree) !== currentTree)
}

/** 运行记录超过这个时长还没结束，就当它已经死了。
 *
 * 宿主被 kill / 断电 / 重启时，`running` 会被原样留在台账里。页面如果照字面
 * 相信它，就会永远显示「生成中」并把按钮全部禁用——用户只能去手改 JSON。 */
export const RUN_STALE_MS = 25 * 60 * 1000

/** 这条运行记录还算不算「活着」。 */
export function isRunAlive(run: RunRecord, now: number = Date.now()): boolean {
  if (run.status !== 'running') return false
  const started = Date.parse(run.startedAt)
  if (Number.isNaN(started)) return false
  return now - started < RUN_STALE_MS
}

/** 项目是否有正在进行的运行。 */
export function isRunning(project: Project, now: number = Date.now()): boolean {
  return (
    project.runs.some((run) => isRunAlive(run, now)) ||
    allDiagrams(project).some((d) => d.status === 'queued' || d.status === 'running')
  )
}

/** 有运行记录卡在 running、但其实早就过期了的项目。 */
export function hasStaleRun(project: Project, now: number = Date.now()): boolean {
  return project.runs.some((run) => run.status === 'running' && !isRunAlive(run, now))
}

/** 项目名兜底：名称空时用仓库目录名。 */
export function defaultProjectName(repoPath: string): string {
  const parts = repoPath.split(/[\\/]+/).filter((part) => part.length > 0)
  return parts.length > 0 ? (parts[parts.length - 1] as string) : repoPath
}

/** 构造项目时要给的输入（全部显式，便于测试确定性）。 */
export interface CreateProjectInput {
  readonly id: string
  readonly name: string
  readonly repoPath: string
  readonly now: string
  readonly git: GitSnapshot
}

/** 纯构造：不读盘、不探测，把已知事实拼成一条台账记录。 */
export function createProject(input: CreateProjectInput): Project {
  return {
    id: input.id,
    name: input.name,
    repoPath: input.repoPath,
    createdAt: input.now,
    updatedAt: input.now,
    git: input.git,
    diagrams: { structure: emptyDiagramState('structure'), domain: emptyDiagramState('domain') },
    custom: [],
    concepts: [],
    qa: [],
    lastRun: null,
    runs: [],
    usageTotal: 0,
  }
}

/** 当前正在进行的 todo（没有就是 null）。 */
export function activeTodo(run: RunRecord | null): TodoItem | null {
  if (run === null) return null
  return run.todos.find((todo) => todo.status === 'in_progress') ?? null
}

/**
 * 把 todo 收敛到「已经没人在跑」的状态。
 *
 * agent 经常在最后一步（回报产物标记）没来得及再写一次 `todo_write` 就被判 idle，
 * 台账里于是留下一条永远 `in_progress` 的记录：页面会一直转圈、卡片一直显示
 * 「正在：回报产物标记与统计」，用户以为跑了几天还没结束。
 *
 * 规则：运行结束就不再有任何「正在进行」。
 *   - `succeeded` → 剩下的 in_progress 记成 completed（整轮跑完了，最后一步确实发生）；
 *   - `failed`    → 退回 pending（做到哪一步不知道，别假装完成）；
 *   - `running`   → 原样返回（还在跑，本来就有当前步骤）。
 */
export function settleTodos(todos: readonly TodoItem[], status: RunStatus): readonly TodoItem[] {
  if (status === 'running') return todos
  const next: TodoItem['status'] = status === 'succeeded' ? 'completed' : 'pending'
  let changed = false
  const settled = todos.map((todo) => {
    if (todo.status !== 'in_progress') return todo
    changed = true
    return { ...todo, status: next }
  })
  return changed ? settled : todos
}
