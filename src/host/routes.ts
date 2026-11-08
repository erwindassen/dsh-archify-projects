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
  AskRequest,
  AskValue,
  CheckValue,
  CreateDiagramRequest,
  CreateProjectRequest,
  HealthValue,
  PatchDiagramRequest,
  PatchProjectRequest,
  ProjectsValue,
  ProjectValue,
  QaActionValue,
  RunValue,
  UpdateValue,
} from '../shared/protocol.js'
import {
  allDiagrams,
  createProject,
  defaultProjectName,
  findDiagram,
  runnableDiagrams,
  ARCHIFY_TYPES,
  type ArchifyType,
  type DiagramState,
  type GitSnapshot,
  type Persistence,
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

/** 生成自定义图 id。 */
export function newDiagramId(now: Date = new Date()): string {
  return `dgm_${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 5)}`
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

  const diagramsMatch = matchPath('/projects/:id/diagrams', rest)
  if (diagramsMatch !== null && method === 'POST') {
    return handleCreateDiagram(state, req, res, diagramsMatch.id as string)
  }

  const regenerateMatch = matchPath('/projects/:id/diagrams/:diagramId/regenerate', rest)
  if (regenerateMatch !== null && method === 'POST') {
    return handleRegenerateDiagram(
      state,
      res,
      regenerateMatch.id as string,
      regenerateMatch.diagramId as string,
    )
  }

  const askMatch = matchPath('/projects/:id/diagrams/:diagramId/ask', rest)
  if (askMatch !== null && method === 'POST') {
    return handleAsk(state, req, res, askMatch.id as string, askMatch.diagramId as string)
  }

  const mergeMatch = matchPath('/projects/:id/qa/:qaId/merge', rest)
  if (mergeMatch !== null && method === 'POST') {
    return handleMergeQa(state, res, mergeMatch.id as string, mergeMatch.qaId as string)
  }

  const childMatch = matchPath('/projects/:id/qa/:qaId/child', rest)
  if (childMatch !== null && method === 'POST') {
    return handleChildQa(state, res, childMatch.id as string, childMatch.qaId as string)
  }

  const diagramMatch = matchPath('/projects/:id/diagrams/:diagramId', rest)
  if (diagramMatch !== null && method === 'PATCH') {
    return handlePatchDiagram(
      state,
      req,
      res,
      diagramMatch.id as string,
      diagramMatch.diagramId as string,
    )
  }
  if (diagramMatch !== null && method === 'DELETE') {
    return handleDeleteDiagram(
      state,
      res,
      diagramMatch.id as string,
      diagramMatch.diagramId as string,
    )
  }

  const runsMatch = matchPath('/projects/:id/runs', rest)
  if (runsMatch !== null && method === 'GET') {
    return handleRuns(state, res, runsMatch.id as string)
  }

  const kindMatch = matchPath('/projects/:id/diagram/:kind', rest)
  if (kindMatch !== null && method === 'POST') {
    return handleRegenerate(state, res, kindMatch.id as string, kindMatch.kind as string)
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
  const value: ProjectsValue = {
    projects,
    workspacePath: workspaceRoot(state.config),
    pricing: state.config.pricing,
  }
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
  const started = await startRun(state, project, 'create', ['structure', 'domain'])
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
  const next = synced ?? project
  const ids = runnableDiagrams(next).map((diagram) => diagram.id)
  const started = await startRun(
    state,
    next,
    'update',
    ids.length > 0 ? ids : ['structure', 'domain'],
  )
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

async function handleCreateDiagram(
  state: RouteState,
  req: import('./context.js').WebRequest,
  res: import('./context.js').WebResponse,
  projectId: string,
): Promise<void> {
  const project = await state.store.get(projectId)
  if (project === undefined) {
    sendError(res, 404, 'not-found', '项目不存在')
    return
  }
  const body = (await readJsonObject(req)) as Partial<CreateDiagramRequest>
  const title = requireString(body.title, '图标题')
  const prompt = requireString(body.prompt, '出图要求')
  const persistence: Persistence = body.persistence === 'temporary' ? 'temporary' : 'permanent'
  const parentId = optionalString(body.parentId ?? null)
  if (parentId !== null && findDiagram(project, parentId) === undefined) {
    throw new BadRequest('父图不存在', 'path-invalid')
  }
  const conceptIds = readStringArray(body.conceptIds)
  const renderer = parseRenderer(body.renderer)
  const pathScope = sanitizeScope(body.pathScope)
  const now = new Date().toISOString()
  const diagram: DiagramState = {
    id: newDiagramId(),
    kind: 'custom',
    title,
    prompt,
    persistence,
    parentId,
    setId: optionalString(body.setId ?? null) ?? parentId,
    conceptIds,
    renderer,
    pathScope,
    status: 'idle',
    htmlPath: null,
    specPath: null,
    generatedAt: null,
    branch: null,
    tree: null,
    error: null,
  }
  const created = await state.store.patch(projectId, (current) => ({
    ...current,
    updatedAt: now,
    custom: [...current.custom, diagram],
  }))
  const next = created ?? project
  const run = body.run === false ? next : await startRun(state, next, 'create', [diagram.id])
  const value: ProjectValue = { project: run }
  sendOk(res, value)
}

async function handlePatchDiagram(
  state: RouteState,
  req: import('./context.js').WebRequest,
  res: import('./context.js').WebResponse,
  projectId: string,
  diagramId: string,
): Promise<void> {
  const project = await state.store.get(projectId)
  if (project === undefined) {
    sendError(res, 404, 'not-found', '项目不存在')
    return
  }
  const diagram = findDiagram(project, diagramId)
  if (diagram === undefined) {
    sendError(res, 404, 'not-found', '图不存在')
    return
  }
  const body = (await readJsonObject(req)) as Partial<PatchDiagramRequest>
  const now = new Date().toISOString()
  const updated: DiagramState = {
    ...diagram,
    title: optionalString(body.title) ?? diagram.title,
    prompt: body.prompt === undefined ? diagram.prompt : optionalString(body.prompt),
    persistence:
      body.persistence === 'temporary' || body.persistence === 'permanent'
        ? body.persistence
        : diagram.persistence,
    conceptIds:
      body.conceptIds === undefined ? diagram.conceptIds : readStringArray(body.conceptIds),
  }
  const patched = await state.store.patch(projectId, (current) => ({
    ...current,
    updatedAt: now,
    ...(diagram.kind === 'custom'
      ? { custom: current.custom.map((d) => (d.id === diagram.id ? updated : d)) }
      : { diagrams: { ...current.diagrams, [diagram.kind]: updated } }),
  }))
  sendOk(res, { project: patched ?? project } satisfies ProjectValue)
}

async function handleDeleteDiagram(
  state: RouteState,
  res: import('./context.js').WebResponse,
  projectId: string,
  diagramId: string,
): Promise<void> {
  const project = await state.store.get(projectId)
  if (project === undefined) {
    sendError(res, 404, 'not-found', '项目不存在')
    return
  }
  const diagram = findDiagram(project, diagramId)
  if (diagram === undefined) {
    sendError(res, 404, 'not-found', '图不存在')
    return
  }
  if (diagram.kind !== 'custom') {
    throw new BadRequest('默认图不能删除，只能重画', 'forbidden')
  }
  const now = new Date().toISOString()
  const removedIds = new Set([diagram.id])
  // 子图跟着父图一起删（现场可能还有更深一层，循环到不增长为止）
  let grew = true
  while (grew) {
    grew = false
    for (const candidate of project.custom) {
      if (
        candidate.parentId !== null &&
        removedIds.has(candidate.parentId) &&
        !removedIds.has(candidate.id)
      ) {
        removedIds.add(candidate.id)
        grew = true
      }
    }
  }
  const patched = await state.store.patch(projectId, (current) => ({
    ...current,
    updatedAt: now,
    custom: current.custom.filter((d) => !removedIds.has(d.id)),
    qa: current.qa.filter((q) => !removedIds.has(q.diagramId)),
  }))
  sendOk(res, { project: patched ?? project } satisfies ProjectValue)
}

async function handleRegenerateDiagram(
  state: RouteState,
  res: import('./context.js').WebResponse,
  projectId: string,
  diagramId: string,
): Promise<void> {
  const project = await state.store.get(projectId)
  if (project === undefined) {
    sendError(res, 404, 'not-found', '项目不存在')
    return
  }
  if (findDiagram(project, diagramId) === undefined) {
    sendError(res, 404, 'not-found', '图不存在')
    return
  }
  const updated = await startRun(state, project, 'regenerate', [diagramId])
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

async function handleRegenerate(
  state: RouteState,
  res: import('./context.js').WebResponse,
  projectId: string,
  rawKind: string,
): Promise<void> {
  const allowed: readonly string[] = ['structure', 'domain']
  if (!allowed.includes(rawKind)) {
    throw new BadRequest(`未知的图谱类型：${rawKind}`)
  }
  const project = await state.store.get(projectId)
  if (project === undefined) {
    sendError(res, 404, 'not-found', '项目不存在')
    return
  }
  const updated = await startRun(state, project, 'regenerate', [rawKind])
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

async function handleAsk(
  state: RouteState,
  req: import('./context.js').WebRequest,
  res: import('./context.js').WebResponse,
  projectId: string,
  diagramId: string,
): Promise<void> {
  const project = await state.store.get(projectId)
  if (project === undefined) {
    sendError(res, 404, 'not-found', '项目不存在')
    return
  }
  const body = (await readJsonObject(req)) as Partial<AskRequest>
  const question = requireString(body.question, '问题')
  let result
  try {
    result = await state.runner.ask(project, diagramId, question)
  } catch (err) {
    if (err instanceof RunnerBusy) throw new BadRequest('这个项目已有任务在运行', 'conflict')
    if (err instanceof RunnerUnavailable) throw new BadRequest(err.message, 'agent-unavailable')
    throw err
  }
  const latest = (await state.store.get(projectId)) ?? project
  const value: AskValue = { sessionId: result.sessionId, entry: result.entry, project: latest }
  sendOk(res, value)
}

async function handleMergeQa(
  state: RouteState,
  res: import('./context.js').WebResponse,
  projectId: string,
  qaId: string,
): Promise<void> {
  const project = await state.store.get(projectId)
  if (project === undefined) {
    sendError(res, 404, 'not-found', '项目不存在')
    return
  }
  const qa = project.qa.find((entry) => entry.id === qaId)
  if (qa === undefined) {
    sendError(res, 404, 'not-found', '提问记录不存在')
    return
  }
  const diagram = findDiagram(project, qa.diagramId)
  if (diagram === undefined) {
    sendError(res, 404, 'not-found', '图不存在')
    return
  }
  const merged: DiagramState = {
    ...diagram,
    prompt: mergePrompt(diagram.prompt, qa.question, qa.answer),
  }
  const prepared = await state.store.patch(projectId, (current) => ({
    ...current,
    ...(diagram.kind === 'custom'
      ? { custom: current.custom.map((d) => (d.id === diagram.id ? merged : d)) }
      : { diagrams: { ...current.diagrams, [diagram.kind]: merged } }),
    qa: current.qa.map((entry) => (entry.id === qaId ? { ...entry, applied: true } : entry)),
  }))
  const next = prepared ?? project
  const started = await startRun(state, next, 'regenerate', [diagram.id])
  const latest = (await state.store.get(projectId)) ?? started
  const entry = latest.qa.find((item) => item.id === qaId) ?? { ...qa, applied: true }
  const value: QaActionValue = { project: latest, qa: entry, diagramId: null }
  sendOk(res, value)
}

async function handleChildQa(
  state: RouteState,
  res: import('./context.js').WebResponse,
  projectId: string,
  qaId: string,
): Promise<void> {
  const project = await state.store.get(projectId)
  if (project === undefined) {
    sendError(res, 404, 'not-found', '项目不存在')
    return
  }
  const qa = project.qa.find((entry) => entry.id === qaId)
  if (qa === undefined) {
    sendError(res, 404, 'not-found', '提问记录不存在')
    return
  }
  const parent = findDiagram(project, qa.diagramId)
  if (parent === undefined) {
    sendError(res, 404, 'not-found', '图不存在')
    return
  }
  const now = new Date().toISOString()
  const diagram: DiagramState = {
    id: newDiagramId(),
    kind: 'custom',
    title: childTitle(qa.question),
    prompt: `基于「${parent.title}」的这张子图，回答并画出：${qa.question}\n\n${qa.answer}`,
    persistence: 'permanent',
    parentId: parent.id,
    setId: parent.setId ?? parent.id,
    conceptIds: parent.conceptIds,
    renderer: parent.renderer,
    pathScope: parent.pathScope,
    status: 'idle',
    htmlPath: null,
    specPath: null,
    generatedAt: null,
    branch: null,
    tree: null,
    error: null,
  }
  const created = await state.store.patch(projectId, (current) => ({
    ...current,
    updatedAt: now,
    custom: [...current.custom, diagram],
  }))
  const next = created ?? project
  const started = await startRun(state, next, 'create', [diagram.id])
  const latest = (await state.store.get(projectId)) ?? started
  const entry = latest.qa.find((item) => item.id === qaId) ?? qa
  const value: QaActionValue = { project: latest, qa: entry, diagramId: diagram.id }
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
  diagramIds: readonly string[],
): Promise<Project> {
  try {
    await state.runner.start(project, kind, diagramIds)
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

/** 比较两次 Git 快照，产出页面用的人话漂移说明（分支 + 工作区）。 */
export function driftOf(previous: GitSnapshot, next: GitSnapshot): CheckValue['drift'] {
  const branchChanged =
    previous.isRepo &&
    next.isRepo &&
    previous.branch !== null &&
    next.branch !== null &&
    previous.branch !== next.branch
  const treeChanged = treeKey(previous) !== treeKey(next)
  const dirty = next.dirty === true
  const behind = next.behind ?? 0
  const notes: string[] = []
  if (branchChanged) notes.push(`分支从 ${previous.branch ?? '?'} 变成 ${next.branch ?? '?'}`)
  if (treeChanged) notes.push('工作区有改动')
  if (behind > 0) notes.push(`落后上游 ${behind} 个提交`)
  if (dirty && !treeChanged) notes.push('工作区有未提交改动')
  return {
    branchChanged,
    treeChanged,
    dirty,
    behind,
    summary: notes.length === 0 ? null : notes.join('；'),
  }
}

function treeKey(git: GitSnapshot): string {
  if (git.tree === null) return git.dirty === true ? 'dirty' : 'clean'
  return `${git.tree.staged}:${git.tree.unstaged}:${git.tree.untracked}`
}

function mergePrompt(prompt: string | null, question: string, answer: string): string {
  const base = prompt ?? '按这张图原有的口径重画'
  return `${base}\n\n## 用户追问补充（本次必须体现）\n\n问题：${question}\n\n回答里的细节：${answer}`
}

function childTitle(question: string): string {
  const trimmed = question.replace(/\s+/g, ' ').trim()
  return trimmed.length > 24 ? `子图：${trimmed.slice(0, 24)}…` : `子图：${trimmed}`
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequest(`${field}不能为空`)
  }
  return value.trim()
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function parseRenderer(value: unknown): ArchifyType | null {
  return typeof value === 'string' && (ARCHIFY_TYPES as readonly string[]).includes(value)
    ? (value as ArchifyType)
    : null
}

/** 目录范围只接受仓库内的相对路径：拒绝绝对路径与 `..`。 */
function sanitizeScope(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim().replace(/^\.\//, '').replace(/\/+$/, '')
    if (trimmed.length === 0 || trimmed.startsWith('/') || trimmed.includes('\\')) continue
    const parts = trimmed.split('/')
    if (parts.some((part) => part === '..' || part === '.' || part.length === 0)) continue
    if (!out.includes(trimmed)) out.push(trimmed)
  }
  return out
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
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

// 供 index.ts 记录「有哪些图需要跑」
export { allDiagrams }
