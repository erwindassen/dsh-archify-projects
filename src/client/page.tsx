/**
 * 插件主页面（`main` 槽，key 与侧栏入口一致）。
 *
 * 数据全部走插件自己的 HTTP 路由；有任务在跑时 2.5s 轮询，跑完自动停 ——
 * 不新增 WebSocket、不新增宿主契约。所有动作都有「进行中」状态与错误回执，
 * 失败不吞。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { ROUTES } from '../shared/protocol.js'
import type { ProjectValue, ProjectsValue, UpdateValue } from '../shared/protocol.js'
import { isRunning, type DiagramKind, type Project } from '../shared/types.js'
import { api, ApiError, send } from './api.js'
import {
  AddProjectDialog,
  DiagramCard,
  EmptyState,
  GitBar,
  ProjectList,
  RunList,
  Tag,
} from './components.js'
import type { Translate } from './panel.js'

/** 页面状态。 */
interface PageState {
  readonly loading: boolean
  readonly error: string | null
  readonly projects: readonly Project[]
  readonly workspacePath: string | null
}

const INITIAL: PageState = { loading: true, error: null, projects: [], workspacePath: null }

/** 有任务在跑时的轮询间隔。 */
const POLL_MS = 2500

/** 页面组件。 */
export function StudioPage({ t }: { t: Translate }): ReactElement {
  const [state, setState] = useState<PageState>(INITIAL)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
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
      })
      setSelectedId((current) => {
        if (current !== null && value.projects.some((p) => p.id === current)) return current
        return value.projects[0]?.id ?? null
      })
    } catch (err) {
      if (!mounted.current) return
      setState((current) => ({ ...current, loading: false, error: describe(err, t) }))
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const running = state.projects.some((project) => isRunning(project))
  useEffect(() => {
    if (!running) return undefined
    const timer = setInterval(() => {
      void load()
    }, POLL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [running, load])

  const selected = useMemo(
    () => state.projects.find((project) => project.id === selectedId) ?? null,
    [state.projects, selectedId],
  )
  const now = new Date()

  const runAction = useCallback(
    async (key: string, action: () => Promise<void>): Promise<void> => {
      setBusy(key)
      setNotice(null)
      try {
        await action()
      } catch (err) {
        if (mounted.current) setNotice({ text: describe(err, t), error: true })
      } finally {
        if (mounted.current) setBusy(null)
      }
    },
    [t],
  )

  const handleCreate = useCallback(
    (value: { name: string; repoPath: string }) => {
      void runAction('create', async () => {
        const result = await send<ProjectValue>(ROUTES.projects, 'POST', {
          name: value.name.length > 0 ? value.name : undefined,
          repoPath: value.repoPath,
        })
        setDialogOpen(false)
        setSelectedId(result.project.id)
        await load()
      })
    },
    [load, runAction],
  )

  const handleUpdate = useCallback(() => {
    if (selected === null) return
    if (!window.confirm(t('confirm.update'))) return
    void runAction('update', async () => {
      const result = await send<UpdateValue>(ROUTES.update(selected.id), 'POST', {})
      if (result.git.skipped) {
        setNotice({ text: syncReasonText(result.git.reason, t), error: false })
      }
      await load()
    })
  }, [load, runAction, selected, t])

  const handleCheck = useCallback(() => {
    if (selected === null) return
    void runAction('check', async () => {
      const result = await send<{ project: Project }>(ROUTES.check(selected.id), 'POST', {})
      if (result.project.git.isRepo === false) {
        setNotice({ text: t('notice.noGit'), error: false })
      }
      await load()
    })
  }, [load, runAction, selected, t])

  const handleRegenerate = useCallback(
    (kind: DiagramKind) => {
      if (selected === null) return
      void runAction(`regen-${kind}`, async () => {
        await send(ROUTES.diagram(selected.id, kind), 'POST', {})
        await load()
      })
    },
    [load, runAction, selected],
  )

  const handleDelete = useCallback(() => {
    if (selected === null) return
    if (!window.confirm(t('confirm.delete'))) return
    void runAction('delete', async () => {
      await send(ROUTES.project(selected.id), 'DELETE')
      await load()
    })
  }, [load, runAction, selected, t])

  const openSession = useCallback((sessionId: string) => {
    window.open(
      `${window.location.origin}/?session=${encodeURIComponent(sessionId)}`,
      '_blank',
      'noopener',
    )
  }, [])

  return (
    <div className="dap-page">
      <header className="dap-head">
        <div>
          <h1 className="dap-head__title">{t('page.title')}</h1>
          <p className="dap-head__subtitle">{t('page.subtitle')}</p>
        </div>
        <div className="dap-head__actions">
          {state.workspacePath !== null && (
            <span className="dap-faint dap-mono dap-ellipsis" title={state.workspacePath}>
              {state.workspacePath}
            </span>
          )}
          <button
            type="button"
            className="dap-btn"
            disabled={state.loading}
            onClick={() => {
              void load()
            }}
          >
            {t('action.refresh')}
          </button>
          <button
            type="button"
            className="dap-btn dap-btn--primary"
            onClick={() => {
              setDialogOpen(true)
            }}
          >
            {t('action.add')}
          </button>
        </div>
      </header>

      {state.error !== null && (
        <div className="dap-banner">
          <div className="dap-notice dap-notice--error" role="alert">
            {state.error}
          </div>
        </div>
      )}
      {notice !== null && (
        <div className="dap-banner">
          <div
            className={notice.error ? 'dap-notice dap-notice--error' : 'dap-notice'}
            role={notice.error ? 'alert' : 'status'}
          >
            {notice.text}
          </div>
        </div>
      )}

      {state.loading && state.projects.length === 0 ? (
        <div className="dap-empty">
          <span className="dap-muted">…</span>
        </div>
      ) : state.projects.length === 0 ? (
        <EmptyState
          onAdd={() => {
            setDialogOpen(true)
          }}
          t={t}
        />
      ) : (
        <div className="dap-body">
          <ProjectList
            projects={state.projects}
            selectedId={selectedId}
            onSelect={setSelectedId}
            t={t}
          />
          <div className="dap-col">
            {selected !== null && (
              <>
                <section className="dap-card">
                  <div className="dap-detail__head">
                    <div style={{ minWidth: 0 }}>
                      <h2 className="dap-detail__title" title={selected.name}>
                        {selected.name}
                      </h2>
                      <GitBar git={selected.git} now={now} t={t} />
                    </div>
                    <div className="dap-detail__actions">
                      <button
                        type="button"
                        className="dap-btn"
                        disabled={busy !== null}
                        onClick={handleCheck}
                      >
                        {t('action.check')}
                      </button>
                      <button
                        type="button"
                        className="dap-btn dap-btn--primary"
                        disabled={busy !== null || isRunning(selected)}
                        onClick={handleUpdate}
                      >
                        {t('action.update')}
                      </button>
                      <button
                        type="button"
                        className="dap-btn dap-btn--danger"
                        disabled={busy !== null}
                        onClick={handleDelete}
                      >
                        {t('action.delete')}
                      </button>
                    </div>
                  </div>
                  <div className="dap-gitbar">
                    <span className="dap-gitbar__item">
                      <span className="dap-gitbar__label">{t('meta.repoPath')}</span>
                      <span className="dap-mono dap-ellipsis" title={selected.repoPath}>
                        {selected.repoPath}
                      </span>
                    </span>
                    <span className="dap-gitbar__item dap-faint">
                      {t('meta.createdAt', { time: selected.createdAt.slice(0, 10) })}
                    </span>
                    {selected.git.isRepo && selected.git.dirty === true && (
                      <Tag tone="warn">{t('git.dirty')}</Tag>
                    )}
                    {!selected.git.isRepo && <Tag>{t('notice.noGit')}</Tag>}
                  </div>
                </section>

                <DiagramCard
                  project={selected}
                  kind="structure"
                  state={selected.diagrams.structure}
                  now={now}
                  t={t}
                  onRegenerate={handleRegenerate}
                  onOpenSession={() => {
                    const sessionId = selected.lastRun?.sessionId
                    if (sessionId != null) openSession(sessionId)
                  }}
                  busy={busy !== null}
                />
                <DiagramCard
                  project={selected}
                  kind="domain"
                  state={selected.diagrams.domain}
                  now={now}
                  t={t}
                  onRegenerate={handleRegenerate}
                  onOpenSession={() => {
                    const sessionId = selected.lastRun?.sessionId
                    if (sessionId != null) openSession(sessionId)
                  }}
                  busy={busy !== null}
                />

                <section className="dap-card">
                  <div className="dap-runs__head">
                    <span className="dap-diagram__title">{t('run.history')}</span>
                    {selected.lastRun?.sessionId != null && (
                      <button
                        type="button"
                        className="dap-btn dap-btn--quiet"
                        onClick={() => {
                          const sessionId = selected.lastRun?.sessionId
                          if (sessionId != null) openSession(sessionId)
                        }}
                      >
                        {t('action.openSession')}
                      </button>
                    )}
                  </div>
                  <RunList runs={selected.runs} t={t} />
                </section>
              </>
            )}
          </div>
        </div>
      )}

      <AddProjectDialog
        open={dialogOpen}
        onCancel={() => {
          setDialogOpen(false)
        }}
        onSubmit={handleCreate}
        t={t}
      />
    </div>
  )
}

function describe(err: unknown, t: Translate): string {
  if (err instanceof ApiError) return t('error.generic', { message: err.message })
  if (err instanceof Error) return t('error.generic', { message: err.message })
  return t('error.generic', { message: String(err) })
}

function syncReasonText(reason: string | null, t: Translate): string {
  if (reason === 'dirty') return t('notice.dirty')
  if (reason === 'no-git') return t('notice.noGit')
  return t('error.generic', { message: reason ?? '?' })
}
