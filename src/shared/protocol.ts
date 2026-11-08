/**
 * HTTP 协议：路由、请求/响应类型、错误码。
 *
 * host 与 client 共用；改这里等于改接口契约，两侧同时失配会立刻被类型检查抓到。
 */

import type { Pricing } from './format.js'
import type {
  ArchifyType,
  Concept,
  DiagramKind,
  Persistence,
  Project,
  QaEntry,
  RunKind,
} from './types.js'

/** 所有路由的前缀。 */
export const ROUTE_PREFIX = '/dsh-archify-projects'

/** 路由表。host 注册与 client 请求都从这里取，避免字符串各写一份。 */
export const ROUTES = {
  health: `${ROUTE_PREFIX}/health`,
  projects: `${ROUTE_PREFIX}/projects`,
  project: (id: string) => `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}`,
  check: (id: string) => `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}/check`,
  update: (id: string) => `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}/update`,
  /** 兼容旧接口：按 kind 重画默认图。 */
  diagram: (id: string, kind: DiagramKind) =>
    `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}/diagram/${kind}`,
  diagrams: (id: string) => `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}/diagrams`,
  customDiagram: (id: string, diagramId: string) =>
    `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}/diagrams/${encodeURIComponent(diagramId)}`,
  regenerate: (id: string, diagramId: string) =>
    `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}/diagrams/${encodeURIComponent(diagramId)}/regenerate`,
  ask: (id: string, diagramId: string) =>
    `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}/diagrams/${encodeURIComponent(diagramId)}/ask`,
  mergeQa: (id: string, qaId: string) =>
    `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}/qa/${encodeURIComponent(qaId)}/merge`,
  childQa: (id: string, qaId: string) =>
    `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}/qa/${encodeURIComponent(qaId)}/child`,
  runs: (id: string) => `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}/runs`,
  artifact: (relativePath: string) =>
    `${ROUTE_PREFIX}/artifact/${relativePath
      .split(/[\\/]+/)
      .map((part) => encodeURIComponent(part))
      .join('/')}`,
} as const

/** 错误码。页面按码决定文案与重试策略，不解析 message。 */
export type ApiErrorCode =
  | 'bad-request'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'path-invalid'
  | 'git-failed'
  | 'agent-unavailable'
  | 'internal'

/** 统一响应外壳。 */
export type ApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly error: { readonly code: ApiErrorCode; readonly message: string }
    }

/** GET /health */
export interface HealthValue {
  readonly name: string
  readonly version: string
  readonly workspacePath: string
  readonly hasGit: boolean
  readonly hasSessionService: boolean
  readonly presetId: string
  readonly archifySkillPath: string | null
}

/** POST /projects */
export interface CreateProjectRequest {
  readonly name?: string
  readonly repoPath: string
}

/** POST /projects/:id 的响应：建项目即触发首次运行，所以回整条记录。 */
export interface ProjectValue {
  readonly project: Project
}

/** GET /projects */
export interface ProjectsValue {
  readonly projects: readonly Project[]
  readonly workspacePath: string
  /** token 单价；null 表示页面只显示 token，不估算费用。 */
  readonly pricing: Pricing | null
}

/** PATCH /projects/:id */
export interface PatchProjectRequest {
  readonly name?: string
  readonly repoPath?: string
}

/** POST /projects/:id/update */
export interface UpdateValue {
  readonly project: Project
  readonly git: {
    readonly skipped: boolean
    readonly reason: string | null
    readonly from: string | null
    readonly to: string | null
  }
}

/** POST /projects/:id/check */
export interface CheckValue {
  readonly project: Project
  readonly drift: GitDrift
}

/** Git 漂移：页面用它决定要不要提示「更新」。分支 + 工作区，不看 commit。 */
export interface GitDrift {
  readonly branchChanged: boolean
  readonly treeChanged: boolean
  readonly dirty: boolean
  readonly behind: number
  readonly summary: string | null
}

/** POST /projects/:id/diagram/:kind（旧的按 kind 重画） */
export interface RegenerateRequest {
  readonly kind: DiagramKind
}

/** POST /projects/:id/diagrams：新建一张自定义图。 */
export interface CreateDiagramRequest {
  readonly title: string
  readonly prompt: string
  readonly persistence?: Persistence
  readonly parentId?: string | null
  readonly setId?: string | null
  readonly conceptIds?: readonly string[]
  /** archify 渲染器；不传 = 由 agent 判断。 */
  readonly renderer?: ArchifyType | null
  /** 限定取证的目录（相对仓库根）；不传 = 全仓库。 */
  readonly pathScope?: readonly string[]
  /** 建完立刻跑；默认 true。 */
  readonly run?: boolean
}

/** PATCH /projects/:id/diagrams/:diagramId */
export interface PatchDiagramRequest {
  readonly title?: string
  readonly prompt?: string
  readonly persistence?: Persistence
  readonly conceptIds?: readonly string[]
  readonly renderer?: ArchifyType | null
  readonly pathScope?: readonly string[]
}

/** POST .../diagrams/:diagramId/ask */
export interface AskRequest {
  readonly question: string
}

/** 提问回执。 */
export interface AskValue {
  readonly sessionId: string | null
  readonly entry: QaEntry
  readonly project: Project
}

/** 「补进图里」/「创建子图」的回执。 */
export interface QaActionValue {
  readonly project: Project
  readonly qa: QaEntry
  /** 「创建子图」时返回新图的 id。 */
  readonly diagramId: string | null
}

/** 运行发起的统一回执。 */
export interface RunValue {
  readonly project: Project
  readonly run: { readonly id: string; readonly kind: RunKind; readonly sessionId: string | null }
}

/** 概念表回执（GET /projects/:id 里已带 concepts，这里留给未来单独刷新）。 */
export interface ConceptsValue {
  readonly concepts: readonly Concept[]
}

/** 生成产物在 res 里的机器标记（prompt 要求 agent 输出，runner 解析）。 */
export const ARTIFACT_MARKER = 'ARCHIFY_ARTIFACT'
