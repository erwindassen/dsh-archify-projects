/**
 * 台账读写。
 *
 * 三条设计决定：
 *   1. **原子写**：先写 `<file>.tmp` 再 rename，进程被杀不会留下半个 JSON；
 *   2. **串行化**：所有写操作排在同一条 Promise 链上，并发路由不会互相覆盖；
 *   3. **坏文件不致命**：解析失败就改名备份并从空台账起步，日志说清楚 ——
 *      插件不该因为一个手工改坏的 json 让宿主起不来。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  ARCHIFY_TYPES,
  LEDGER_VERSION,
  emptyGitSnapshot,
  emptyLedger,
  type Concept,
  type DiagramKind,
  type DiagramState,
  type Project,
  type ProjectLedger,
  type QaEntry,
  type TodoItem,
  type TokenUsage,
  type TreeState,
} from '../shared/types.js'

/** 台账容器。 */
export class ProjectStore {
  readonly file: string
  private chain: Promise<unknown> = Promise.resolve()
  private warnings: string[] = []

  constructor(file: string) {
    this.file = path.resolve(file)
  }

  /** 最近一次读写过程中产生的、应该被上层日志记录的告警。 */
  drainWarnings(): string[] {
    const out = this.warnings
    this.warnings = []
    return out
  }

  /** 读台账。文件不存在或损坏都返回空台账（损坏件会被备份）。 */
  async load(): Promise<ProjectLedger> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch (err) {
      if (isNotFound(err)) return emptyLedger(new Date().toISOString())
      throw err
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      await this.quarantine('台账不是合法 JSON')
      return emptyLedger(new Date().toISOString())
    }
    return this.normalize(parsed)
  }

  /** 写入台账（原子）。 */
  async save(ledger: ProjectLedger): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmp, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')
    await rename(tmp, this.file)
  }

  /** 串行读-改-写。`fn` 必须是纯函数：拿到旧台账，返回新台账。 */
  async mutate(fn: (ledger: ProjectLedger) => ProjectLedger): Promise<ProjectLedger> {
    const run = async (): Promise<ProjectLedger> => {
      const current = await this.load()
      const next = fn(current)
      const stamped: ProjectLedger = { ...next, updatedAt: new Date().toISOString() }
      await this.save(stamped)
      return stamped
    }
    const queued = this.chain.then(run, run)
    this.chain = queued.then(
      () => undefined,
      () => undefined,
    )
    return queued
  }

  /** 全量列表（按创建时间倒序，新项目在前）。 */
  async list(): Promise<readonly Project[]> {
    const ledger = await this.load()
    return [...ledger.projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /** 取单个项目。 */
  async get(id: string): Promise<Project | undefined> {
    const ledger = await this.load()
    return ledger.projects.find((p) => p.id === id)
  }

  /** 有则替换、无则追加。 */
  async upsert(project: Project): Promise<Project> {
    await this.mutate((ledger) => {
      const exists = ledger.projects.some((p) => p.id === project.id)
      const projects = exists
        ? ledger.projects.map((p) => (p.id === project.id ? project : p))
        : [...ledger.projects, project]
      return { ...ledger, projects }
    })
    return project
  }

  /** 就地改一个项目；项目不存在时返回 undefined（不创建）。 */
  async patch(id: string, fn: (project: Project) => Project): Promise<Project | undefined> {
    let updated: Project | undefined
    await this.mutate((ledger) => {
      const projects = ledger.projects.map((p) => {
        if (p.id !== id) return p
        updated = fn(p)
        return updated
      })
      return { ...ledger, projects }
    })
    return updated
  }

  /** 删除一个项目。 */
  async remove(id: string): Promise<boolean> {
    let removed = false
    await this.mutate((ledger) => {
      const projects = ledger.projects.filter((p) => {
        if (p.id === id) {
          removed = true
          return false
        }
        return true
      })
      return { ...ledger, projects }
    })
    return removed
  }

  // ---------------------------------------------------------------- 内部

  private async quarantine(reason: string): Promise<void> {
    const backup = `${this.file}.corrupt-${Date.now()}`
    try {
      await rename(this.file, backup)
      this.warnings.push(`${reason}，已备份到 ${path.basename(backup)} 并从空台账起步`)
    } catch (err) {
      this.warnings.push(`${reason}，备份失败：${String(err)}`)
    }
  }

  /** 把任意形状的 JSON 收敛成合法台账：丢字段不如丢整条记录。 */
  private normalize(parsed: unknown): ProjectLedger {
    if (typeof parsed !== 'object' || parsed === null) {
      this.warnings.push('台账根不是对象，已按空台账处理')
      return emptyLedger(new Date().toISOString())
    }
    const raw = parsed as { version?: unknown; updatedAt?: unknown; projects?: unknown }
    const projectsRaw = Array.isArray(raw.projects) ? raw.projects : []
    const projects: Project[] = []
    for (const item of projectsRaw) {
      const project = normalizeProject(item)
      if (project === null) {
        this.warnings.push('台账里有条目结构不合法，已跳过')
        continue
      }
      projects.push(project)
    }
    return {
      version: typeof raw.version === 'number' ? raw.version : LEDGER_VERSION,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
      projects,
    }
  }
}

/** 单条记录的最小合法性：id / repoPath / 两张默认图齐全即可。 */
function normalizeProject(item: unknown): Project | null {
  if (typeof item !== 'object' || item === null) return null
  const p = item as Record<string, unknown>
  if (typeof p.id !== 'string' || p.id.length === 0) return null
  if (typeof p.repoPath !== 'string' || p.repoPath.length === 0) return null
  const now = new Date().toISOString()
  const diagrams = (
    typeof p.diagrams === 'object' && p.diagrams !== null ? p.diagrams : {}
  ) as Record<string, unknown>
  const customRaw = Array.isArray(p.diagrams) ? p.diagrams : p.custom
  return {
    id: p.id,
    name: typeof p.name === 'string' && p.name.length > 0 ? p.name : p.repoPath,
    repoPath: p.repoPath,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : now,
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : now,
    git: normalizeGit(p.git),
    diagrams: {
      structure: normalizeDiagram(diagrams.structure, 'structure'),
      domain: normalizeDiagram(diagrams.domain, 'domain'),
    },
    custom: Array.isArray(customRaw)
      ? customRaw
          .map((item) => normalizeCustomDiagram(item))
          .filter((d): d is DiagramState => d !== null)
      : [],
    concepts: Array.isArray(p.concepts)
      ? p.concepts.map((c) => normalizeConcept(c)).filter((c): c is Concept => c !== null)
      : [],
    qa: Array.isArray(p.qa)
      ? p.qa.map((q) => normalizeQa(q)).filter((q): q is QaEntry => q !== null)
      : [],
    usageTotal: typeof p.usageTotal === 'number' ? p.usageTotal : 0,
    lastRun: normalizeRun(p.lastRun),
    runs: Array.isArray(p.runs)
      ? p.runs
          .map((run) => normalizeRun(run))
          .filter((run): run is NonNullable<typeof run> => run !== null)
      : [],
  }
}

function normalizeDiagram(value: unknown, kind: DiagramKind): DiagramState {
  const d = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return {
    id: typeof d.id === 'string' && d.id.length > 0 ? d.id : kind,
    kind,
    title: typeof d.title === 'string' && d.title.length > 0 ? d.title : kind,
    prompt: typeof d.prompt === 'string' ? d.prompt : null,
    persistence: d.persistence === 'temporary' ? 'temporary' : 'permanent',
    parentId: typeof d.parentId === 'string' ? d.parentId : null,
    setId: typeof d.setId === 'string' ? d.setId : kind === 'structure' ? 'structure' : null,
    conceptIds: readStringArray(d.conceptIds),
    // 默认两张图固定用 architecture 渲染；老台账没有这个字段
    renderer: readRenderer(d.renderer) ?? 'architecture',
    pathScope: readStringArray(d.pathScope),
    status: readStatus(d.status),
    htmlPath: typeof d.htmlPath === 'string' ? d.htmlPath : null,
    specPath: typeof d.specPath === 'string' ? d.specPath : null,
    generatedAt: typeof d.generatedAt === 'string' ? d.generatedAt : null,
    branch: typeof d.branch === 'string' ? d.branch : null,
    tree: normalizeTree(d.tree),
    error: typeof d.error === 'string' ? d.error : null,
  }
}

function normalizeCustomDiagram(value: unknown): DiagramState | null {
  if (typeof value !== 'object' || value === null) return null
  const d = value as Record<string, unknown>
  if (typeof d.id !== 'string' || d.id.length === 0) return null
  return {
    id: d.id,
    kind: 'custom',
    title: typeof d.title === 'string' && d.title.length > 0 ? d.title : '自定义图',
    prompt: typeof d.prompt === 'string' ? d.prompt : null,
    persistence: d.persistence === 'temporary' ? 'temporary' : 'permanent',
    parentId: typeof d.parentId === 'string' && d.parentId.length > 0 ? d.parentId : null,
    setId: typeof d.setId === 'string' && d.setId.length > 0 ? d.setId : null,
    conceptIds: readStringArray(d.conceptIds),
    renderer: readRenderer(d.renderer),
    pathScope: readStringArray(d.pathScope),
    status: readStatus(d.status),
    htmlPath: typeof d.htmlPath === 'string' ? d.htmlPath : null,
    specPath: typeof d.specPath === 'string' ? d.specPath : null,
    generatedAt: typeof d.generatedAt === 'string' ? d.generatedAt : null,
    branch: typeof d.branch === 'string' ? d.branch : null,
    tree: normalizeTree(d.tree),
    error: typeof d.error === 'string' ? d.error : null,
  }
}

function normalizeConcept(value: unknown): Concept | null {
  if (typeof value !== 'object' || value === null) return null
  const c = value as Record<string, unknown>
  if (typeof c.id !== 'string' || c.id.length === 0) return null
  return {
    id: c.id,
    name: typeof c.name === 'string' && c.name.length > 0 ? c.name : c.id,
    summary: typeof c.summary === 'string' ? c.summary : '',
    evidence: readStringArray(c.evidence),
    tags: readStringArray(c.tags),
    updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : new Date().toISOString(),
  }
}

function normalizeQa(value: unknown): QaEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const q = value as Record<string, unknown>
  if (typeof q.id !== 'string' || typeof q.question !== 'string') return null
  return {
    id: q.id,
    diagramId: typeof q.diagramId === 'string' ? q.diagramId : '',
    question: q.question,
    answer: typeof q.answer === 'string' ? q.answer : '',
    at: typeof q.at === 'string' ? q.at : new Date().toISOString(),
    applied: q.applied === true,
    status: q.status === 'running' || q.status === 'failed' ? q.status : 'done',
    todos: normalizeTodos(q.todos),
    usage: normalizeUsage(q.usage),
  }
}

function normalizeTodos(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) return []
  const out: TodoItem[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const raw = item as Record<string, unknown>
    if (typeof raw.content !== 'string' || raw.content.length === 0) continue
    const status =
      raw.status === 'in_progress' || raw.status === 'completed' ? raw.status : 'pending'
    out.push({ content: raw.content, status })
  }
  return out
}

/** 读 token 用量；任何字段缺失都按 0，整块缺失给 null。 */
export function normalizeUsage(value: unknown): TokenUsage | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const num = (key: string): number => {
    const n = Number(raw[key])
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  return {
    uncachedInput: num('uncachedInput'),
    output: num('output'),
    cacheRead: num('cacheRead'),
    cacheWrite: num('cacheWrite'),
  }
}

function normalizeGit(value: unknown): Project['git'] {
  const g = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const base = emptyGitSnapshot(new Date().toISOString())
  return {
    ...base,
    ...g,
    tree: normalizeTree(g.tree),
  } as Project['git']
}

function normalizeTree(value: unknown): TreeState | null {
  if (typeof value !== 'object' || value === null) return null
  const t = value as Record<string, unknown>
  const staged = Number(t.staged)
  const unstaged = Number(t.unstaged)
  const untracked = Number(t.untracked)
  if (!Number.isFinite(staged) || !Number.isFinite(unstaged) || !Number.isFinite(untracked)) {
    return null
  }
  return { staged, unstaged, untracked }
}

function readStatus(value: unknown): DiagramState['status'] {
  return value === 'queued' || value === 'running' || value === 'ready' || value === 'failed'
    ? value
    : 'idle'
}

function readRenderer(value: unknown): DiagramState['renderer'] {
  return typeof value === 'string' && (ARCHIFY_TYPES as readonly string[]).includes(value)
    ? (value as DiagramState['renderer'])
    : null
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function normalizeRun(value: unknown): Project['lastRun'] {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  const kind = r.kind === 'update' || r.kind === 'regenerate' ? r.kind : 'create'
  const status = r.status === 'succeeded' || r.status === 'failed' ? r.status : 'running'
  return {
    id: r.id,
    kind,
    status,
    sessionId: typeof r.sessionId === 'string' ? r.sessionId : null,
    startedAt: typeof r.startedAt === 'string' ? r.startedAt : new Date().toISOString(),
    finishedAt: typeof r.finishedAt === 'string' ? r.finishedAt : null,
    error: typeof r.error === 'string' ? r.error : null,
    note: typeof r.note === 'string' ? r.note : null,
    diagramIds: readStringArray(r.diagramIds),
    todos: normalizeTodos(r.todos),
    usage: normalizeUsage(r.usage),
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ENOENT'
}
