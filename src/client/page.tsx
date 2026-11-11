/**
 * 插件主页面：图册（总览） + 工作台（三栏）。
 *
 * 数据全部走插件自己的 HTTP 路由；有任务在跑时 2.5s 轮询，跑完自动停 ——
 * 不新增 WebSocket、不新增宿主契约。所有动作都有「进行中」状态与错误回执，
 * 失败不吞。
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { ROUTES } from '../shared/protocol.js'
import type {
  AskValue,
  ModelRef,
  ProjectValue,
  ProjectsValue,
  QaActionValue,
  RunValue,
  SettingsValue,
  UpdateValue,
} from '../shared/protocol.js'
import {
  allDiagrams,
  findDiagram,
  isRunning,
  isStale,
  settleTodos,
  usageTotalOf,
  type DiagramState,
  type Project,
  type RunStatus,
  type TodoItem,
  type TokenUsage,
} from '../shared/types.js'
import { estimateCost, formatTokens, relativeSpan, type Pricing } from '../shared/format.js'
import { api, ApiError, send } from './api.js'
import {
  Chip,
  Dot,
  GearIcon,
  NewDiagramDialog,
  NewProjectDialog,
  SettingsDialog,
  clockText,
  type DiagramDraft,
} from './components.js'
import type { Translate } from './panel.js'

/** 页面状态。 */
interface PageState {
  readonly loading: boolean
  readonly error: string | null
  readonly projects: readonly Project[]
  readonly workspacePath: string | null
  readonly pricing: Pricing | null
}

const INITIAL: PageState = {
  loading: true,
  error: null,
  projects: [],
  workspacePath: null,
  pricing: null,
}

/** 有任务在跑时的轮询间隔。 */
const POLL_MS = 2500

/** 图册 / 工作台。 */
type Screen = 'atlas' | 'wb'

/** 右栏页签。 */
type Tab = 'info' | 'qa'

/** 页面组件。 */
export function StudioPage({ t }: { t: Translate }): ReactElement {
  const [state, setState] = useState<PageState>(INITIAL)
  const [screen, setScreen] = useState<Screen>('atlas')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [diagramId, setDiagramId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('info')
  const [dialog, setDialog] = useState<'project' | 'diagram' | 'settings' | null>(null)
  // 设置（模型选择）：拿不到就保持 null，设置面板退化成「跟随宿主默认」，不报错打扰用户
  const [settings, setSettings] = useState<SettingsValue | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [question, setQuestion] = useState('')
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    try {
      const value = await api<ProjectsValue>(ROUTES.projects)
      if (!mounted.current) return
      setState({
        loading: false,
        error: null,
        projects: value.projects,
        workspacePath: value.workspacePath,
        pricing: value.pricing ?? null,
      })
    } catch (err) {
      if (!mounted.current) return
      setState((prev) => ({ ...prev, loading: false, error: messageOf(err) }))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 设置只拉一次：模型目录是部署级事实，不必跟着项目轮询。
  // 失败静默 —— 设置面板退化成「跟随宿主默认」，不往页面上甩错误。
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const value = await api<SettingsValue>(ROUTES.settings)
        if (alive) setSettings(value)
      } catch {
        // 宿主版本没有 /settings（或栅栏拒了）时保持 null
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const running = state.projects.some((project) => isRunning(project))
  useEffect(() => {
    if (!running) return undefined
    const timer = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(timer)
  }, [running, load])

  const project = useMemo(
    () => state.projects.find((item) => item.id === projectId) ?? null,
    [state.projects, projectId],
  )
  const diagram = useMemo(
    () => (project !== null && diagramId !== null ? findDiagram(project, diagramId) : undefined),
    [project, diagramId],
  )

  // 数据刷新后选中的图可能被删：回落到第一张默认图
  useEffect(() => {
    if (project === null) return
    if (diagramId !== null && findDiagram(project, diagramId) !== undefined) return
    setDiagramId(project.diagrams.structure.id)
  }, [project, diagramId])

  const applyProject = useCallback((next: Project): void => {
    if (!mounted.current) return
    setState((prev) => ({
      ...prev,
      projects: prev.projects.map((item) => (item.id === next.id ? next : item)),
    }))
  }, [])

  const fail = useCallback(
    (err: unknown): void => {
      setNotice({ text: t('error.generic', { message: messageOf(err) }), error: true })
    },
    [t],
  )

  const openProject = useCallback((id: string): void => {
    setProjectId(id)
    setScreen('wb')
    setTab('info')
    setDiagramId('structure')
  }, [])

  const runUpdate = async (target: Project): Promise<void> => {
    setBusy(`update:${target.id}`)
    setNotice(null)
    try {
      const value = await send<UpdateValue>(ROUTES.update(target.id), 'POST')
      applyProject(value.project)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const saveSettings = async (model: ModelRef | null): Promise<void> => {
    setBusy('settings')
    setNotice(null)
    try {
      const value = await send<SettingsValue>(ROUTES.settings, 'PUT', { model })
      if (mounted.current) setSettings(value)
      setDialog(null)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const updateAll = async (): Promise<void> => {
    for (const item of state.projects) {
      if (isRunning(item)) continue
      await runUpdate(item)
    }
  }

  const regenerate = async (): Promise<void> => {
    if (project === null || diagram === undefined) return
    setBusy(`regen:${diagram.id}`)
    setNotice(null)
    try {
      const value = await send<RunValue>(ROUTES.regenerate(project.id, diagram.id), 'POST')
      applyProject(value.project)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const createProject = async (name: string, repoPath: string): Promise<void> => {
    setBusy('create:project')
    setNotice(null)
    try {
      const value = await send<ProjectValue>(ROUTES.projects, 'POST', { name, repoPath })
      setDialog(null)
      if (!mounted.current) return
      setState((prev) => ({
        ...prev,
        projects: [value.project, ...prev.projects.filter((p) => p.id !== value.project.id)],
      }))
      setProjectId(value.project.id)
      setDiagramId('structure')
      setScreen('wb')
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const createDiagram = async (draft: DiagramDraft): Promise<void> => {
    if (project === null) return
    setBusy('create:diagram')
    setNotice(null)
    try {
      const value = await send<ProjectValue>(ROUTES.diagrams(project.id), 'POST', draft)
      setDialog(null)
      applyProject(value.project)
      const newest = value.project.custom[value.project.custom.length - 1]
      if (newest !== undefined) setDiagramId(newest.id)
      setNotice({ text: t('notice.running'), error: false })
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const ask = async (): Promise<void> => {
    if (project === null || diagram === undefined || question.trim().length === 0) return
    setBusy('ask')
    setNotice(null)
    try {
      const value = await send<AskValue>(ROUTES.ask(project.id, diagram.id), 'POST', {
        question: question.trim(),
      })
      setQuestion('')
      applyProject(value.project)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const applyQa = async (qaId: string, action: 'merge' | 'child'): Promise<void> => {
    if (project === null) return
    setBusy(`${action}:${qaId}`)
    setNotice(null)
    try {
      const path =
        action === 'merge' ? ROUTES.mergeQa(project.id, qaId) : ROUTES.childQa(project.id, qaId)
      const value = await send<QaActionValue>(path, 'POST')
      applyProject(value.project)
      setNotice({ text: t(action === 'merge' ? 'notice.merged' : 'notice.child'), error: false })
      if (action === 'child' && value.diagramId !== null) setDiagramId(value.diagramId)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const setPersistence = async (persistence: 'permanent' | 'temporary'): Promise<void> => {
    if (project === null || diagram === undefined) return
    setBusy('persistence')
    try {
      const value = await send<ProjectValue>(
        ROUTES.customDiagram(project.id, diagram.id),
        'PATCH',
        {
          persistence,
        },
      )
      applyProject(value.project)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const removeDiagram = async (): Promise<void> => {
    if (project === null || diagram === undefined) return
    setBusy('delete:diagram')
    try {
      const value = await send<ProjectValue>(ROUTES.customDiagram(project.id, diagram.id), 'DELETE')
      applyProject(value.project)
      setDiagramId('structure')
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const ago = (iso: string | null): string => {
    const span = relativeSpan(iso, new Date())
    if (span === null) return t('status.none')
    if (span.kind === 'now') return t('time.now')
    if (span.kind === 'minutes') return t('time.minutes', { n: span.value })
    if (span.kind === 'hours') return t('time.hours', { n: span.value })
    if (span.kind === 'days') return t('time.days', { n: span.value })
    return span.date ?? t('status.none')
  }

  if (screen === 'wb' && project !== null) {
    return (
      <div className="dap-page">
        <header className="dap-head">
          <div>
            <button
              className="dap-btn dap-btn--ghost dap-btn--sm"
              onClick={() => setScreen('atlas')}
            >
              ← {t('action.back')}
            </button>
            <h1 className="dap-head__title" style={{ marginTop: 6 }}>
              {project.name}
            </h1>
            <p className="dap-head__sub">{project.repoPath}</p>
          </div>
          <div className="dap-head__actions">
            <button
              className="dap-iconbtn"
              onClick={() => setDialog('settings')}
              title={t('action.settings')}
              aria-label={t('action.settings')}
            >
              <GearIcon />
            </button>
            <button
              className="dap-btn dap-btn--sm dap-btn--primary"
              onClick={() => void runUpdate(project)}
              disabled={busy !== null || isRunning(project)}
            >
              {t('action.update')}
            </button>
          </div>
        </header>
        <div className="dap-scroll dap-scroll--wb">
          {notice !== null ? (
            <p className={notice.error ? 'dap-notice dap-notice--error' : 'dap-notice'}>
              {notice.text}
            </p>
          ) : null}
          <Workbench
            t={t}
            project={project}
            diagram={diagram}
            tab={tab}
            busy={busy}
            question={question}
            pricing={state.pricing}
            ago={ago}
            onTab={setTab}
            onQuestion={setQuestion}
            onAsk={() => void ask()}
            onSelect={setDiagramId}
            onRegenerate={() => void regenerate()}
            onPersistence={(p) => void setPersistence(p)}
            onDelete={() => void removeDiagram()}
            onQa={(id, action) => void applyQa(id, action)}
            onNewDiagram={() => setDialog('diagram')}
          />
        </div>
        {dialog === 'settings' ? (
          <SettingsDialog
            t={t}
            settings={settings}
            busy={busy !== null}
            onClose={() => setDialog(null)}
            onSubmit={(model) => void saveSettings(model)}
          />
        ) : null}
        {dialog === 'diagram' ? (
          <NewDiagramDialog
            t={t}
            project={project}
            selectedId={diagram?.id ?? null}
            busy={busy !== null}
            onClose={() => setDialog(null)}
            onSubmit={(draft) => void createDiagram(draft)}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="dap-page">
      <header className="dap-head">
        <div>
          <h1 className="dap-head__title">{t('page.title')}</h1>
          <p className="dap-head__sub">{t('page.subtitle')}</p>
        </div>
        <div className="dap-head__actions">
          <button
            className="dap-iconbtn"
            onClick={() => setDialog('settings')}
            title={t('action.settings')}
            aria-label={t('action.settings')}
          >
            <GearIcon />
          </button>
          <button
            className="dap-btn dap-btn--sm"
            onClick={() => void updateAll()}
            disabled={busy !== null || state.projects.length === 0}
          >
            {t('action.updateAll')}
          </button>
          <button
            className="dap-btn dap-btn--sm dap-btn--primary"
            onClick={() => setDialog('project')}
          >
            + {t('action.add')}
          </button>
        </div>
      </header>
      <div className="dap-scroll">
        {notice !== null ? (
          <p className={notice.error ? 'dap-notice dap-notice--error' : 'dap-notice'}>
            {notice.text}
          </p>
        ) : null}
        {state.error !== null ? (
          <p className="dap-notice dap-notice--error">{state.error}</p>
        ) : null}
        {state.projects.length === 0 && !state.loading ? (
          <div className="dap-empty">
            <div className="dap-empty__title">{t('empty.title')}</div>
            <div className="dap-empty__body">{t('empty.body')}</div>
            <button
              className="dap-btn dap-btn--sm dap-btn--primary"
              onClick={() => setDialog('project')}
            >
              {t('empty.action')}
            </button>
          </div>
        ) : (
          <>
            <div className="dap-stats">
              <div className="dap-stat">
                <div className="dap-stat__k">{t('stat.repos')}</div>
                <div className="dap-stat__v">{state.projects.length}</div>
              </div>
              <div className="dap-stat">
                <div className="dap-stat__k">{t('stat.concepts')}</div>
                <div className="dap-stat__v">
                  {state.projects.reduce((sum, item) => sum + item.concepts.length, 0)}
                </div>
              </div>
              <div className="dap-stat">
                <div className="dap-stat__k">{t('stat.diagrams')}</div>
                <div className="dap-stat__v">
                  {state.projects.reduce((sum, item) => sum + allDiagrams(item).length, 0)}
                </div>
              </div>
              <div className="dap-stat">
                <div className="dap-stat__k">{t('stat.running')}</div>
                <div className="dap-stat__v">
                  {state.projects.filter((item) => isRunning(item)).length}
                </div>
              </div>
            </div>
            <div className="dap-atlas">
              {state.projects.map((item) => (
                <AtlasCard
                  key={item.id}
                  t={t}
                  project={item}
                  busy={busy}
                  ago={ago}
                  onOpen={() => openProject(item.id)}
                  onUpdate={() => void runUpdate(item)}
                />
              ))}
            </div>
          </>
        )}
      </div>
      {dialog === 'settings' ? (
        <SettingsDialog
          t={t}
          settings={settings}
          busy={busy !== null}
          onClose={() => setDialog(null)}
          onSubmit={(model) => void saveSettings(model)}
        />
      ) : null}
      {dialog === 'project' ? (
        <NewProjectDialog
          t={t}
          busy={busy !== null}
          onClose={() => setDialog(null)}
          onSubmit={(name, repoPath) => void createProject(name, repoPath)}
        />
      ) : null}
    </div>
  )
}

// ------------------------------------------------------------------ 总览卡片

function AtlasCard({
  t,
  project,
  busy,
  ago,
  onOpen,
  onUpdate,
}: {
  t: Translate
  project: Project
  busy: string | null
  ago: (iso: string | null) => string
  onOpen: () => void
  onUpdate: () => void
}): ReactElement {
  const diagrams = allDiagrams(project)
  const stale = isStale(project)
  const running = isRunning(project)
  const tree = project.git.tree
  return (
    <article
      className="dap-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onOpen()
      }}
    >
      <div className="dap-card__top">
        <div className="dap-repo">
          <Dot tone={running ? 'run' : stale ? 'warn' : 'ok'} />
          <div style={{ minWidth: 0 }}>
            <div className="dap-repo__name">{project.name}</div>
            <div className="dap-repo__path">{project.repoPath}</div>
          </div>
        </div>
      </div>
      <div className="dap-chips">
        <Chip dot>
          {project.git.isRepo ? (project.git.branch ?? t('git.detached')) : t('git.noRepo')}
        </Chip>
        {tree !== null && tree.staged + tree.unstaged + tree.untracked > 0 ? (
          <Chip tone="warn">
            {t('git.treeShort', { staged: tree.staged, unstaged: tree.unstaged })}
          </Chip>
        ) : (
          <Chip tone="ok">{t('git.clean')}</Chip>
        )}
        <Chip tone="accent">
          {project.concepts.length} {t('concept.title')}
        </Chip>
        {stale ? <Chip tone="warn">{t('status.stale')}</Chip> : null}
      </div>
      <div className="dap-thumbs">
        {diagrams.slice(0, 3).map((item) => (
          <div key={item.id} className="dap-thumb">
            <div className="dap-thumb__title">
              <b>{item.title}</b>
              <span className="dap-thumb__count">
                {item.persistence === 'temporary' ? t('persistence.temporary') : t('status.ready')}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="dap-card__foot">
        <span>
          {running
            ? t('runbar.step', { step: activeStep(project) ?? t('runbar.unknown') })
            : `${project.git.branch ?? t('git.noRepo')} · ${ago(
                diagrams.find((d) => d.generatedAt)?.generatedAt ?? null,
              )}`}
          {project.usageTotal > 0 ? ` · ${formatTokens(project.usageTotal)} tokens` : ''}
        </span>
        <button
          className="dap-btn dap-btn--sm"
          onClick={(event) => {
            event.stopPropagation()
            onUpdate()
          }}
        >
          {t('action.update')}
        </button>
      </div>
      {busy === `update:${project.id}` ? (
        <span className="dap-hint">{t('notice.running')}</span>
      ) : null}
    </article>
  )
}

// ------------------------------------------------------------------ 工作台

function Workbench({
  t,
  project,
  diagram,
  tab,
  busy,
  question,
  pricing,
  ago,
  onTab,
  onQuestion,
  onAsk,
  onSelect,
  onRegenerate,
  onPersistence,
  onDelete,
  onQa,
  onNewDiagram,
}: {
  t: Translate
  project: Project
  diagram: DiagramState | undefined
  tab: Tab
  busy: string | null
  question: string
  pricing: Pricing | null
  ago: (iso: string | null) => string
  onTab: (tab: Tab) => void
  onQuestion: (value: string) => void
  onAsk: () => void
  onSelect: (id: string) => void
  onRegenerate: () => void
  onPersistence: (persistence: 'permanent' | 'temporary') => void
  onDelete: () => void
  onQa: (qaId: string, action: 'merge' | 'child') => void
  onNewDiagram: () => void
}): ReactElement {
  const custom = project.custom
  const children =
    diagram === undefined ? [] : custom.filter((item) => item.parentId === diagram.id)
  const parent = diagram?.parentId != null ? findDiagram(project, diagram.parentId) : undefined
  const thread = project.qa.filter((entry) => entry.diagramId === diagram?.id)

  const tree = project.git.tree
  return (
    <>
      <div className="dap-chips" style={{ marginBottom: 10 }}>
        <Chip dot>
          {project.git.isRepo ? (project.git.branch ?? t('git.detached')) : t('git.noRepo')}
        </Chip>
        {tree !== null ? (
          <Chip tone="warn">
            {t('git.tree', {
              staged: tree.staged,
              unstaged: tree.unstaged,
              untracked: tree.untracked,
            })}
          </Chip>
        ) : null}
        <span className="dap-hint">
          {t('meta.branchLevel', { branch: project.git.branch ?? '—' })}
        </span>
      </div>

      <RunBar t={t} project={project} />

      <div className="dap-wb">
        <div className="dap-panel dap-viewer">
          <ThumbStrip
            t={t}
            project={project}
            selectedId={diagram?.id ?? null}
            onSelect={onSelect}
            onNewDiagram={onNewDiagram}
          />
          <div className="dap-viewer__head">
            <div className="dap-viewer__title">
              {diagram?.title ?? t('status.none')}
              {parent !== undefined ? <span>/ {parent.title}</span> : null}
            </div>
            <div className="dap-viewer__tools">
              {diagram?.htmlPath != null ? (
                <>
                  <a
                    className="dap-btn dap-btn--ghost dap-btn--sm"
                    href={ROUTES.artifact(diagram.htmlPath)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('action.openTab')}
                  </a>
                  <a
                    className="dap-btn dap-btn--ghost dap-btn--sm"
                    href={ROUTES.artifact(diagram.htmlPath)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('action.fullscreen')}
                  </a>
                </>
              ) : null}
              <button
                className="dap-btn dap-btn--ghost dap-btn--sm"
                onClick={onRegenerate}
                disabled={busy !== null}
              >
                {t('action.regenerate')}
              </button>
            </div>
          </div>
          <div className="dap-stage">
            {diagram?.status === 'ready' && diagram.htmlPath !== null ? (
              <div className="dap-frame">
                <div className="dap-frame__cap">
                  <span>
                    {project.git.branch ?? t('git.noRepo')} · {ago(diagram.generatedAt)}
                  </span>
                  <span>{diagram.title}</span>
                </div>
                <iframe
                  className="dap-iframe"
                  title={diagram.title}
                  src={ROUTES.artifact(diagram.htmlPath)}
                  sandbox="allow-scripts allow-same-origin"
                  onLoad={(event) => hideArtifactHeader(event.currentTarget)}
                />
              </div>
            ) : (
              <div className="dap-frame">
                <div className="dap-empty">
                  <div className="dap-empty__title">
                    {diagram === undefined
                      ? t('status.none')
                      : t(`status.${diagram.status}` as never)}
                  </div>
                  {diagram?.error != null ? (
                    <div className="dap-empty__body">{diagram.error}</div>
                  ) : (
                    <div className="dap-empty__body">{t('notice.running')}</div>
                  )}
                  <button
                    className="dap-btn dap-btn--sm dap-btn--primary"
                    onClick={onRegenerate}
                    disabled={busy !== null}
                  >
                    {t('action.regenerate')}
                  </button>
                </div>
              </div>
            )}
            {children.length > 0 ? (
              <div className="dap-insets">
                {children.map((child) => (
                  <button
                    key={child.id}
                    className={child.id === diagram?.id ? 'dap-inset dap-inset--on' : 'dap-inset'}
                    onClick={() => onSelect(child.id)}
                  >
                    <Dot
                      tone={
                        child.status === 'ready' ? 'ok' : child.status === 'failed' ? 'err' : 'run'
                      }
                    />
                    <span className="dap-inset__name">{child.title}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="dap-panel">
          <div className="dap-tabs">
            <button
              className={tab === 'info' ? 'dap-tab dap-tab--on' : 'dap-tab'}
              onClick={() => onTab('info')}
            >
              {t('field.status')}
            </button>
            <button
              className={tab === 'qa' ? 'dap-tab dap-tab--on' : 'dap-tab'}
              onClick={() => onTab('qa')}
            >
              {t('qa.title')}
              {thread.length > 0 ? ` ${thread.length}` : ''}
            </button>
          </div>
          {tab === 'info' ? (
            <div className="dap-insp">
              {diagram === undefined ? (
                <p className="dap-hint">{t('status.none')}</p>
              ) : (
                <>
                  <div className="dap-field">
                    <span className="dap-field__label">{t('field.status')}</span>
                    <div className="dap-chips">
                      <Chip
                        tone={
                          diagram.status === 'ready'
                            ? 'ok'
                            : diagram.status === 'failed'
                              ? 'warn'
                              : 'default'
                        }
                      >
                        {t(`status.${diagram.status}` as never)}
                      </Chip>
                      <Chip tone={diagram.persistence === 'permanent' ? 'accent' : 'default'}>
                        {diagram.persistence === 'permanent'
                          ? t('persistence.permanent')
                          : t('persistence.temporary')}
                      </Chip>
                      <Chip>{ago(diagram.generatedAt)}</Chip>
                    </div>
                  </div>
                  {diagram.kind === 'custom' ? (
                    <div className="dap-field">
                      <span className="dap-field__label">{t('field.prompt')}</span>
                      <div className="dap-box">
                        {diagram.prompt ?? t('status.none')}
                        <div className="dap-box__meta">
                          <button
                            className="dap-btn dap-btn--ghost dap-btn--sm"
                            onClick={() =>
                              onPersistence(
                                diagram.persistence === 'permanent' ? 'temporary' : 'permanent',
                              )
                            }
                            disabled={busy !== null}
                          >
                            {diagram.persistence === 'permanent'
                              ? t('persistence.temporary')
                              : t('persistence.permanent')}
                          </button>
                          <button
                            className="dap-btn dap-btn--ghost dap-btn--sm"
                            onClick={onDelete}
                            disabled={busy !== null}
                          >
                            {t('action.delete')}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {diagram.error !== null ? (
                    <p className="dap-notice dap-notice--error">{diagram.error}</p>
                  ) : null}
                  <div className="dap-field">
                    <span className="dap-field__label">{t('field.branch')}</span>
                    <div className="dap-chips">
                      <Chip dot>{diagram.branch ?? project.git.branch ?? t('git.noRepo')}</Chip>
                      {diagram.tree !== null ? (
                        <Chip>
                          {t('git.treeShort', {
                            staged: diagram.tree.staged,
                            unstaged: diagram.tree.unstaged,
                          })}
                        </Chip>
                      ) : null}
                    </div>
                  </div>
                  <div className="dap-field">
                    <span className="dap-field__label">{t('field.concepts')}</span>
                    <div className="dap-chips">
                      {diagram.conceptIds.length === 0
                        ? project.concepts
                            .slice(0, 6)
                            .map((concept) => <Chip key={concept.id}>{concept.name}</Chip>)
                        : diagram.conceptIds.map((id) => {
                            const concept = project.concepts.find((item) => item.id === id)
                            return <Chip key={id}>{concept?.name ?? id}</Chip>
                          })}
                    </div>
                  </div>
                  <div className="dap-field">
                    <span className="dap-field__label">{t('progress.title')}</span>
                    <TodoList
                      t={t}
                      todos={project.lastRun?.todos ?? []}
                      status={project.lastRun?.status ?? null}
                    />
                  </div>
                  <div className="dap-field">
                    <span className="dap-field__label">{t('usage.title')}</span>
                    <UsageBlock t={t} project={project} pricing={pricing} />
                  </div>
                  <div className="dap-field">
                    <span className="dap-field__label">{t('run.history')}</span>
                    <div className="dap-hint">
                      {project.runs
                        .slice(-3)
                        .reverse()
                        .map((run) => (
                          <div key={run.id}>
                            {clockText(run.startedAt)} · {t(`run.kind.${run.kind}` as never)} ·{' '}
                            {t(`run.status.${run.status}` as never)}
                          </div>
                        ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="dap-insp">
                {thread.length === 0 ? <p className="dap-hint">{t('qa.empty')}</p> : null}
                {thread.map((entry) => (
                  <div key={entry.id} className="dap-qa">
                    <div className="dap-msg dap-msg--me">
                      <span className="dap-msg__who">{t('qa.me')}</span>
                      <div className="dap-msg__bubble">{entry.question}</div>
                    </div>
                    <div className="dap-msg">
                      <span className="dap-msg__who">{t('qa.answer')}</span>
                      <div className="dap-msg__bubble">{entry.answer}</div>
                      <div className="dap-msg__acts">
                        {entry.applied ? (
                          <Chip tone="ok">{t('qa.applied')}</Chip>
                        ) : (
                          <>
                            <button
                              className="dap-btn dap-btn--sm"
                              onClick={() => onQa(entry.id, 'merge')}
                              disabled={busy !== null}
                            >
                              {t('action.merge')}
                            </button>
                            <button
                              className="dap-btn dap-btn--sm"
                              onClick={() => onQa(entry.id, 'child')}
                              disabled={busy !== null}
                            >
                              {t('action.child')}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="dap-ask">
                <textarea
                  value={question}
                  placeholder={t('qa.placeholder')}
                  onChange={(event) => onQuestion(event.target.value)}
                  disabled={busy === 'ask'}
                />
                <button
                  className="dap-btn dap-btn--sm dap-btn--primary"
                  onClick={onAsk}
                  disabled={busy !== null || question.trim().length === 0}
                >
                  {busy === 'ask' ? t('qa.working') : t('action.send')}
                </button>
              </div>
              <p className="dap-hint" style={{ padding: '0 10px 10px' }}>
                {t('qa.mergeHint')}
              </p>
            </>
          )}
        </div>
      </div>
    </>
  )
}

/** 图片上方的图名 tab 条：默认两张 + 自定义图（子图挂在父图后面）。 */
export function ThumbStrip({
  t,
  project,
  selectedId,
  onSelect,
  onNewDiagram,
}: {
  t: Translate
  project: Project
  selectedId: string | null
  onSelect: (id: string) => void
  onNewDiagram: () => void
}): ReactElement {
  const diagrams = allDiagrams(project)
  const defaults = diagrams.filter((item) => item.kind !== 'custom')
  const custom = diagrams.filter((item) => item.kind === 'custom')
  const roots = custom.filter((item) => item.parentId === null)
  const childrenOf = (id: string): readonly DiagramState[] =>
    custom.filter((item) => item.parentId === id)

  return (
    <div className="dap-strip" role="tablist" aria-label={t('page.title')}>
      {defaults.map((item) => (
        <Thumb
          key={item.id}
          t={t}
          diagram={item}
          active={item.id === selectedId}
          onSelect={onSelect}
        />
      ))}
      {roots.length > 0 ? <span className="dap-strip__sep" aria-hidden="true" /> : null}
      {roots.map((item) => (
        <Fragment key={item.id}>
          <Thumb t={t} diagram={item} active={item.id === selectedId} onSelect={onSelect} />
          {childrenOf(item.id).map((child) => (
            <Thumb
              key={child.id}
              t={t}
              diagram={child}
              active={child.id === selectedId}
              child
              onSelect={onSelect}
            />
          ))}
        </Fragment>
      ))}
      <button className="dap-strip__new" onClick={onNewDiagram} title={t('action.newDiagram')}>
        ＋ {t('action.newDiagram')}
      </button>
    </div>
  )
}

/**
 * 内嵌查看器里去掉成品自带的页头（大标题 + 状态圆点）。
 *
 * 成品 HTML 顶部有一行「<项目名> · 图名」的大标题和一个 pulse-dot，而插件自己的
 * 查看器标题栏已经写了图名、帧头也写了分支与时间——重复一遍只是白吃画布高度。
 * 只在 iframe 里注入，点「新窗口」单独打开时仍是成品原样（那里没有外层标题）。
 * 同源才改得动；被沙箱或跨域挡住就静默跳过，不影响看图。
 */
export function hideArtifactHeader(frame: HTMLIFrameElement): void {
  try {
    const doc = frame.contentDocument
    if (doc === null) return
    if (doc.head.querySelector('style[data-embedded="compact"]') !== null) return
    const style = doc.createElement('style')
    style.dataset.embedded = 'compact'
    style.textContent = '.header{display:none!important}'
    doc.head.appendChild(style)
  } catch {
    // 跨域或沙箱拦截：保留成品原样
  }
}

/**
 * 一个图名 tab：只有文字，没有缩略图。
 *
 * 之前用 0.25 倍 iframe 做真预览，一条占 91px，把图片本身压下去；改成纯文字后
 * 整条 32px，状态用一个 5px 圆点表达，临时图挂一个小标签。
 */
function Thumb({
  t,
  diagram,
  active,
  child = false,
  onSelect,
}: {
  t: Translate
  diagram: DiagramState
  active: boolean
  child?: boolean
  onSelect: (id: string) => void
}): ReactElement {
  const tone = diagram.status === 'ready' ? 'ok' : diagram.status === 'failed' ? 'err' : 'warn'
  return (
    <button
      className={['dap-tabitem', active ? 'dap-tabitem--on' : '', child ? 'dap-tabitem--child' : '']
        .filter((part) => part.length > 0)
        .join(' ')}
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(diagram.id)}
      title={`${diagram.title} · ${t(`status.${diagram.status}` as never)}`}
    >
      <Dot tone={tone} />
      <span className="dap-tabitem__name">{diagram.title}</span>
      {diagram.persistence === 'temporary' ? (
        <span className="dap-tabitem__tag">{t('persistence.temporaryShort')}</span>
      ) : null}
    </button>
  )
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return err instanceof Error ? err.message : String(err)
}

// ------------------------------------------------------------------ 进度与用量

/** 运行中当前步骤；没有 todo 时返回 null。 */
function activeStep(project: Project): string | null {
  const todo = project.lastRun?.todos.find((item) => item.status === 'in_progress')
  return todo?.content ?? null
}

/** 顶部运行进度条：只在有 agent 在跑时出现。 */
function RunBar({ t, project }: { t: Translate; project: Project }): ReactElement | null {
  const run = project.lastRun
  const running = isRunning(project)
  const qaRunning = project.qa.find((entry) => entry.status === 'running')
  if (!running && qaRunning === undefined) return null

  const todos = running ? (run?.todos ?? []) : (qaRunning?.todos ?? [])
  const current = todos.find((todo) => todo.status === 'in_progress')
  const done = todos.filter((todo) => todo.status === 'completed').length
  const percent = todos.length === 0 ? 0 : Math.round((done / todos.length) * 100)
  const usage = running ? (run?.usage ?? null) : (qaRunning?.usage ?? null)

  return (
    <div className="dap-runbar">
      <span className="dap-spinner" aria-hidden="true" />
      <b>{t('runbar.running')}</b>
      <span className="dap-runbar__step">
        {t('runbar.step', { step: current?.content ?? todos[0]?.content ?? t('runbar.unknown') })}
        {todos.length > 0 ? `（${done}/${todos.length}）` : ''}
      </span>
      {todos.length > 0 ? (
        <>
          <span className="dap-runbar__bar">
            <i style={{ width: `${percent}%` }} />
          </span>
          <span className="dap-runbar__pct">{percent}%</span>
        </>
      ) : null}
      {usage !== null ? (
        <span className="dap-runbar__tok">
          {t('runbar.tokens', { n: formatTokens(usageTotalOf(usage)) })}
        </span>
      ) : null}
    </div>
  )
}

/** todo 列表：✓ / spinner / ○。 */
export function TodoList({
  t,
  todos,
  status = null,
}: {
  t: Translate
  todos: readonly TodoItem[]
  /** 这份 todo 归属的运行状态：给终态时先把残留的 in_progress 收敛掉再渲染。 */
  status?: RunStatus | null
}): ReactElement {
  if (todos.length === 0) return <p className="dap-hint">{t('progress.none')}</p>
  const shown = status === null ? todos : settleTodos(todos, status)
  return (
    <div className="dap-todos">
      {shown.map((todo) => (
        <div
          key={todo.content}
          className={
            todo.status === 'completed'
              ? 'dap-todo dap-todo--done'
              : todo.status === 'in_progress'
                ? 'dap-todo dap-todo--now'
                : 'dap-todo'
          }
        >
          <span className="dap-todo__mark" aria-hidden="true">
            {todo.status === 'completed' ? (
              '✓'
            ) : todo.status === 'in_progress' ? (
              <span className="dap-spinner" />
            ) : (
              '○'
            )}
          </span>
          {todo.content}
        </div>
      ))}
    </div>
  )
}

/** 用量块：本次 / 累计 tokens，配了单价才算钱。 */
export function UsageBlock({
  t,
  project,
  pricing,
}: {
  t: Translate
  project: Project
  pricing: Pricing | null
}): ReactElement {
  const current: TokenUsage | null = project.lastRun?.usage ?? null
  const cost = estimateCost(current, pricing)
  return (
    <div className="dap-usage">
      <div>
        <span>{t('usage.current')}</span>
        <b>{formatTokens(usageTotalOf(current))}</b>
        {cost !== null ? <em>{t('usage.estimated', { cost: cost.toFixed(3) })}</em> : null}
      </div>
      <div>
        <span>{t('usage.total')}</span>
        <b>{formatTokens(project.usageTotal)}</b>
      </div>
      {current !== null ? (
        <div className="dap-usage__detail">
          <span>
            {t('usage.detail', {
              input: formatTokens(current.uncachedInput),
              cacheRead: formatTokens(current.cacheRead),
              output: formatTokens(current.output),
            })}
          </span>
        </div>
      ) : null}
      {pricing === null ? <span className="dap-hint">{t('usage.estimateNote')}</span> : null}
    </div>
  )
}
