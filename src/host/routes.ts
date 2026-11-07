/**
 * 路由分发：一个 prefix 路由收全部请求，内部按「方法 + 路径模式」派发。
 *
 * 为什么只注册一条：宿主 webServer 的 exact 表只支持字面路径，而本插件的路由全都带
 * `:id`；用 prefix 路由 + 自己匹配，路由表集中在一处，读起来就是一张清单。
 */

import { rm, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { ROUTE_PREFIX } from '../shared/protocol.js'
import type {
  CheckValue,
  CreateProjectRequest,
  HealthValue,
  PatchProjectRequest,
  ProjectsValue,
  ProjectValue,
  RunValue,
  UpdateValue,
} from '../shared/protocol.js'
import {
  DIAGRAM_KINDS,
  createProject,
  defaultProjectName,
  type DiagramKind,
  type GitSnapshot,
  type Project,
} from '../shared/types.js'
import { projectDir, workspaceRoot, type ResolvedConfig } from './config.js'
import type { HostContext } from './context.js'
import { probeGit, syncToLatest } from './git.js'
import {
  BadRequest,
  matchPath,
  methodOf,
  pathOf,
  readJsonObject,
  sendError,
  sendOk,
} from './http.js'
import { RunnerBusy, RunnerUnavailable, type Runner } from './runner.js'
import type { ProjectStore } from './store.js'
import { confineToRoot, isDirectory } from './workspace.js'

/** 分发器需要的全部状态。 */
export interface RouteState {
  readonly ctx: HostContext
  readonly store: ProjectStore
  readonly config: ResolvedConfig
  readonly runner: Runner
  readonly fence: (req: import('./context.js').WebRequest) => string | null
  readonly skillDir: () => Promise<string | null>
  readonly version: string
  readonly hasSessionService: boolean
}

/** 生成项目 id。 */
export function newProjectId(now: Date = new Date()): string {
  return `prj_${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 分发入口，交给 `webServer.register({kind:'prefix'})`。 */
export function createDispatcher(state: RouteState) {
  return async function dispatch(
    req: import('./context.js').WebRequest,
    res: import('./context.js').WebResponse,
  ): Promise<void> {
    try {
      const rejection = state.fence(req)
      if (rejection !== null) {
        sendError(res, 403, 'forbidden', rejection)
        return
      }
      const pathname = pathOf(req)
      if (!pathname.startsWith(ROUTE_PREFIX)) {
        sendError(res, 404, 'not-found', '未知路径')
        return
      }
      const rest = pathname.slice(ROUTE_PREFIX.length) || '/'
      await route(state, req, res, rest)
    } catch (err) {
      if (err instanceof BadRequest) {
        sendError(res, 400, err.code, err.message)
        return
      }
      sendError(res, 500, 'internal', '插件内部错误', err)
    }
  }
}

async function route(
  state: RouteState,
  req: import('./context.js').WebRequest,
  res: import('./context.js').WebResponse,
  rest: string,
): Promise<void> {
  const method = methodOf(req)

  if (rest === '/health' && method === 'GET') return handleHealth(state, res)
  if (rest === '/projects' && method === 'GET') return handleList(state, res)
  if (rest === '/projects' && method === 'POST') return handleCreate(state, req, res)
  if (rest.startsWith('/artifact/') && method === 'GET') {
    return handleArtifact(state, req, res, rest.slice('/artifact/'.length))
  }

  const checkMatch = matchPath('/projects/:id/check', rest)
  if (checkMatch !== null && method === 'POST') {
    return handleCheck(state, res, checkMatch.id as string)
  }

  const updateMatch = matchPath('/projects/:id/update', rest)
  if (updateMatch !== null && method === 'POST') {
    return handleUpdate(state, res, updateMatch.id as string)
  }

  const runsMatch = matchPath('/projects/:id/runs', rest)
  if (runsMatch !== null && method === 'GET') {
    return handleRuns(state, res, runsMatch.id as string)
  }

  const diagramMatch = matchPath('/projects/:id/diagram/:kind', rest)
  if (diagramMatch !== null && method === 'POST') {
    return handleRegenerate(state, res, diagramMatch.id as string, diagramMatch.kind as string)
  }

  const oneMatch = matchPath('/projects/:id', rest)
  if (oneMatch !== null && method === 'GET') {
    return handleGet(state, res, oneMatch.id as string)
  }
  if (oneMatch !== null && method === 'PATCH') {
    return handlePatch(state, req, res, oneMatch.id as string)
  }
  if (oneMatch !== null && method === 'DELETE') {
    return handleDelete(state, res, oneMatch.id as string)
  }

  // 带上方法和路径：插件路由前缀下的 404 只有两种来源——页面拼错了 URL，
  // 或者宿主根本没把这条路由交过来。没有 method/path 就只能靠猜。
  sendError(res, 404, 'not-found', `未知路由：${method} ${rest}`)
}

// ------------------------------------------------------------------ 处理器

function handleHealth(state: RouteState, res: import('./context.js').WebResponse): void {
  void state.skillDir().then((dir) => {
    const value: HealthValue = {
      name: 'dsh-archify-projects',
      version: state.version,
      workspacePath: workspaceRoot(state.config),
      hasGit: true,
      hasSessionService: state.hasSessionService,
      presetId: state.config.presetId,
      archifySkillPath: dir,
    }
    sendOk(res, value)
  })
}

async function handleList(
  state: RouteState,
  res: import('./context.js').WebResponse,
): Promise<void> {
  const projects = await state.store.list()
  const value: ProjectsValue = { projects, workspacePath: workspaceRoot(state.config) }
  sendOk(res, value)
}

async function handleCreate(
  state: RouteState,
  req: import('./context.js').WebRequest,
  res: import('./context.js').WebResponse,
): Promise<void> {
  const body = (await readJsonObject(req)) as Partial<CreateProjectRequest>
  const repoPath = requireString(body.repoPath, '代码库路径')
  const resolved = path.resolve(repoPath)
  if (!(await isDirectory(resolved))) {
    throw new BadRequest('路径不存在或不是目录', 'path-invalid')
  }
  const now = new Date().toISOString()
  const git = await probeGit(resolved, now)
  const name = optionalString(body.name) ?? defaultProjectName(resolved)
  const project = createProject({ id: newProjectId(), name, repoPath: resolved, now, git })
  await state.store.upsert(project)
  const started = await startRun(state, project, 'create', DIAGRAM_KINDS)
  const value: ProjectValue = { project: started }
  sendOk(res, value)
}

async function handleGet(
  state: RouteState,
  res: import('./context.js').WebResponse,
  id: string,
): Promise<void> {
  const project = await state.store.get(id)
  if (project === undefined) {
    sendError(res, 404, 'not-found', '项目不存在')
    return
  }
  sendOk(res, { project } satisfies ProjectValue)
}

async function handlePatch(
  state: RouteState,
  req: import('./context.js').WebRequest,
  res: import('./context.js').WebResponse,
  id: string,
): Promise<void> {
  const existing = await state.store.get(id)
  if (existing === undefined) {
    sendError(res, 404, 'not-found', '项目不存在')
    return
  }
  const body = (await readJsonObject(req)) as Partial<PatchProjectRequest>
  const name = optionalString(body.name)
  const repoPathRaw = optionalString(body.repoPath)
  let nextRepoPath: string | null = null
  if (repoPathRaw !== null) {
    nextRepoPath = path.resolve(repoPathRaw)
    if (!(await isDirectory(nextRepoPath))) {
      throw new BadRequest('路径不存在或不是目录', 'path-invalid')
    }
  }
  const now = new Date().toISOString()
  const git =
    nextRepoPath !== null && nextRepoPath !== existing.repoPath
      ? await probeGit(nextRepoPath, now)
      : existing.git
  const updated = await state.store.patch(id, (current) => ({
    ...current,
    name: name ?? (nextRepoPath !== null ? defaultProjectName(nextRepoPath) : current.name),
    repoPath: nextRepoPath ?? current.repoPath,
    git,
    updatedAt: now,
  }))
  sendOk(res, { project: updated ?? existing } satisfies ProjectValue)
}

async function handleDelete(
  state: RouteState,
  res: import('./context.js').WebResponse,
  id: string,
): Promise<void> {
  const project = await state.store.get(id)
  if (project === undefined) {
    sendError(res, 404, 'not-found', '项目不存在')
    return
  }
  await state.store.remove(id)
  // 只删插件自己的工作目录，绝不碰用户的代码库
  await rm(projectDir(state.config, id), { recursive: true, force: true })
  sendOk(res, { removed: true })
}

async function handleCheck(
  state: RouteState,
  res: import('./context.js').WebResponse,
  id: string,
): Promise<void> {
  const project = await state.store.get(id)
  if (project === undefined) {
    sendError(res, 404, 'not-found', '项目不存在')
    return
  }
  const now = new Date().toISOString()
  const git = await probeGit(project.repoPath, now)
  const updated = await state.store.patch(id, (current) => ({ ...current, git, updatedAt: now }))
  const value: CheckValue = {
    project: updated ?? project,
    drift: driftOf(project.git, git),
  }
  sendOk(res, value)
}

async function handleUpdate(
  state: RouteState,
  res: import('./context.js').WebResponse,
  id: string,
): Promise<void> {
  const project = await state.store.get(id)
  if (project === undefined) {
    sendError(res, 404, 'not-found', '项目不存在')
    return
  }
  if (state.runner.isBusy(id)) {
    sendError(res, 409, 'conflict', '这个项目已有任务在运行')
    return
  }
  const sync = await syncToLatest(project.repoPath, project.git.branch)
  const now = new Date().toISOString()
  const git = await probeGit(project.repoPath, now)
  const synced = await state.store.patch(id, (current) => ({ ...current, git, updatedAt: now }))
  const started = await startRun(state, synced ?? project, 'update', DIAGRAM_KINDS)
  const value: UpdateValue = {
    project: started,
    git: { skipped: sync.skipped, reason: sync.reason, from: sync.from, to: sync.to },
  }
  sendOk(res, value)
}

async function handleRuns(
  state: RouteState,
  res: import('./context.js').WebResponse,
  id: string,
): Promise<void> {
  const project = await state.store.get(id)
  if (project === undefined) {
    sendError(res, 404, 'not-found', '项目不存在')
    return
  }
  sendOk(res, { project, runs: project.runs })
}

async function handleRegenerate(
  state: RouteState,
  res: import('./context.js').WebResponse,
  id: string,
  rawKind: string,
): Promise<void> {
  const kind = parseKind(rawKind)
  if (kind === null) {
    throw new BadRequest(`未知的图谱类型：${rawKind}`)
  }
  const project = await state.store.get(id)
  if (project === undefined) {
    sendError(res, 404, 'not-found', '项目不存在')
    return
  }
  const updated = await startRun(state, project, 'regenerate', [kind])
  const value: RunValue = {
    project: updated,
    run: {
      id: updated.lastRun?.id ?? '',
      kind: 'regenerate',
      sessionId: updated.lastRun?.sessionId ?? null,
    },
  }
  sendOk(res, value)
}

async function handleArtifact(
  state: RouteState,
  req: import('./context.js').WebRequest,
  res: import('./context.js').WebResponse,
  rawRelative: string,
): Promise<void> {
  const relative = rawRelative
    .split('/')
    .map((part) => decodeURIComponent(part))
    .join('/')
  const root = workspaceRoot(state.config)
  const target = confineToRoot(root, relative)
  if (target === null) {
    sendError(res, 403, 'forbidden', '路径越界')
    return
  }
  let info
  try {
    info = await stat(target)
  } catch {
    sendError(res, 404, 'not-found', '产物不存在')
    return
  }
  if (!info.isFile()) {
    sendError(res, 404, 'not-found', '产物不存在')
    return
  }
  res.writeHead(200, {
    'Content-Type': contentTypeOf(target),
    'Content-Length': String(info.size),
    // 产物是本地文件，允许缓存但要求重新验证
    'Cache-Control': 'no-cache',
  })
  if (methodOf(req) === 'HEAD') {
    res.end()
    return
  }
  createReadStream(target).pipe(res)
}

// ------------------------------------------------------------------ 工具

async function startRun(
  state: RouteState,
  project: Project,
  kind: 'create' | 'update' | 'regenerate',
  kinds: readonly DiagramKind[],
): Promise<Project> {
  try {
    await state.runner.start(project, kind, kinds)
  } catch (err) {
    if (err instanceof RunnerBusy) {
      throw new BadRequest('这个项目已有任务在运行', 'conflict')
    }
    if (err instanceof RunnerUnavailable) {
      throw new BadRequest(err.message, 'agent-unavailable')
    }
    throw err
  }
  return (await state.store.get(project.id)) ?? project
}

/** 比较两次 Git 快照，产出页面用的人话漂移说明。 */
export function driftOf(previous: GitSnapshot, next: GitSnapshot): CheckValue['drift'] {
  const branchChanged =
    previous.isRepo &&
    next.isRepo &&
    previous.branch !== null &&
    next.branch !== null &&
    previous.branch !== next.branch
  const commitChanged =
    previous.isRepo && next.isRepo && previous.commit !== null && previous.commit !== next.commit
  const dirty = next.dirty === true
  const behind = next.behind ?? 0
  const notes: string[] = []
  if (branchChanged) notes.push(`分支从 ${previous.branch ?? '?'} 变成 ${next.branch ?? '?'}`)
  if (commitChanged) notes.push('有新提交')
  if (behind > 0) notes.push(`落后上游 ${behind} 个提交`)
  if (dirty) notes.push('工作区有未提交改动')
  return {
    branchChanged,
    commitChanged,
    dirty,
    behind,
    summary: notes.length === 0 ? null : notes.join('；'),
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequest(`${field}不能为空`)
  }
  return value.trim()
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function parseKind(raw: string): DiagramKind | null {
  return (DIAGRAM_KINDS as readonly string[]).includes(raw) ? (raw as DiagramKind) : null
}

function contentTypeOf(target: string): string {
  const ext = path.extname(target).toLowerCase()
  if (ext === '.html') return 'text/html; charset=utf-8'
  if (ext === '.json') return 'application/json; charset=utf-8'
  if (ext === '.css') return 'text/css; charset=utf-8'
  if (ext === '.js') return 'text/javascript; charset=utf-8'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'application/octet-stream'
}
