/**
 * 台账数据模型（纯类型 + 纯构造函数，零 IO）。
 *
 * 这里是 host 与 client 唯一的「事实形状」来源：宿主写盘用它，页面渲染用它，
 * 序列化契约（protocol.ts 的请求/响应）也复用它。改这里的字段等于改协议版本。
 */

/** 台账文件格式版本。字段形状不兼容时 +1，并在 store 里做迁移。 */
export const LEDGER_VERSION = 1

/** 两张固定的图谱。 */
export const DIAGRAM_KINDS = ['structure', 'domain'] as const
export type DiagramKind = (typeof DIAGRAM_KINDS)[number]

/** 一次运行因何而起。 */
export type RunKind = 'create' | 'update' | 'regenerate'

/** 运行状态。 */
export type RunStatus = 'running' | 'succeeded' | 'failed'

/** 单张图谱的产物状态机：idle → queued → running → ready | failed。 */
export type DiagramStatus = 'idle' | 'queued' | 'running' | 'ready' | 'failed'

/**
 * 代码库的 Git 快照。
 *
 * 无 Git 目录时 `isRepo=false`，其余字段一律 `null` ——「不知道」和「空」必须能区分，
 * 否则页面会把 `null` 渲染成 0 或空串，用户会以为仓库干净。
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
  readonly remoteUrl: string | null
  readonly checkedAt: string
}

/** 一张图谱的产物与元信息。`htmlPath` / `specPath` 都是相对插件工作区的路径。 */
export interface DiagramState {
  readonly status: DiagramStatus
  readonly htmlPath: string | null
  readonly specPath: string | null
  readonly generatedAt: string | null
  readonly branch: string | null
  readonly commit: string | null
  readonly error: string | null
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
}

/** 一个项目。 */
export interface Project {
  readonly id: string
  readonly name: string
  readonly repoPath: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly git: GitSnapshot
  readonly diagrams: Readonly<Record<DiagramKind, DiagramState>>
  /** 最近一次运行（`runs` 的末条，单独冗余一份方便渲染）。 */
  readonly lastRun: RunRecord | null
  /** 运行历史，旧→新，上限由 config.keepRuns 控制。 */
  readonly runs: readonly RunRecord[]
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
    remoteUrl: null,
    checkedAt,
  }
}

/** 空图谱状态。 */
export function emptyDiagramState(): DiagramState {
  return {
    status: 'idle',
    htmlPath: null,
    specPath: null,
    generatedAt: null,
    branch: null,
    commit: null,
    error: null,
  }
}

/** 空台账。 */
export function emptyLedger(now: string): ProjectLedger {
  return { version: LEDGER_VERSION, updatedAt: now, projects: [] }
}

/** 由 Git 快照派生「图谱是否落后于代码」——两张图看最新那张。 */
export function isStale(project: Project): boolean {
  if (!project.git.isRepo || project.git.commit === null) return false
  const ready = DIAGRAM_KINDS.map((kind) => project.diagrams[kind]).filter(
    (d) => d.status === 'ready' && d.commit !== null,
  )
  if (ready.length === 0) return false
  return ready.some((d) => d.commit !== project.git.commit)
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
    DIAGRAM_KINDS.some((kind) => {
      const status = project.diagrams[kind].status
      return status === 'queued' || status === 'running'
    })
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
    diagrams: { structure: emptyDiagramState(), domain: emptyDiagramState() },
    lastRun: null,
    runs: [],
  }
}

/** 不可变地替换两张图谱之一。 */
export function withDiagram(project: Project, kind: DiagramKind, next: DiagramState): Project {
  return {
    ...project,
    diagrams: { ...project.diagrams, [kind]: next },
  }
}
