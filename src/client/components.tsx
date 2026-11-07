/**
 * 页面用的小组件：状态点、标签、Git 条、图谱卡、项目列表、运行记录、新增对话框、空态。
 *
 * 全部无状态（props 进、DOM 出），副作用只在 Page 里 —— 组件测试不用造 fetch 桩
 * 也能覆盖全部视觉分支。
 */

import type { ReactElement, ReactNode } from 'react'
import { ROUTES } from '../shared/protocol.js'
import {
  aheadBehindText,
  diagramTitle,
  PLACEHOLDER,
  relativeSpan,
  shortCommit,
  tailPath,
} from '../shared/format.js'
import type { DiagramKind, DiagramState, GitSnapshot, Project, RunRecord } from '../shared/types.js'
import type { Translate } from './panel.js'

/** 相对时间：结构化结果 + 词典，中英都通。 */
export function relativeText(iso: string | null, now: Date, t: Translate): string {
  const span = relativeSpan(iso, now)
  if (span === null) return PLACEHOLDER
  switch (span.kind) {
    case 'now':
      return t('time.now')
    case 'minutes':
      return t('time.minutes', { n: span.value })
    case 'hours':
      return t('time.hours', { n: span.value })
    case 'days':
      return t('time.days', { n: span.value })
    default:
      return span.date ?? PLACEHOLDER
  }
}

/** 状态点：颜色只走令牌，运行中带一点呼吸。 */
export function StatusDot({ status }: { status: DiagramState['status'] }): ReactElement {
  return <span className={`dap-dot dap-dot--${status}`} aria-hidden="true" />
}

/** 小标签。 */
export function Tag({
  children,
  tone,
  title,
}: {
  children: ReactNode
  tone?: 'ok' | 'warn' | 'error'
  title?: string
}): ReactElement {
  const suffix = tone === undefined ? '' : ` dap-tag--${tone}`
  return (
    <span className={`dap-tag${suffix}`} title={title}>
      {children}
    </span>
  )
}

/** Git 摘要条。非 Git 目录只留一条说明，不摆空字段。 */
export function GitBar({
  git,
  now,
  t,
}: {
  git: GitSnapshot
  now: Date
  t: Translate
}): ReactElement {
  if (!git.isRepo) {
    return (
      <div className="dap-gitbar">
        <span className="dap-gitbar__item">
          <Tag>{t('git.noRepo')}</Tag>
          <span className="dap-faint">{t('git.noRepoHint')}</span>
        </span>
      </div>
    )
  }
  const ab = aheadBehindText(git.ahead, git.behind)
  return (
    <div className="dap-gitbar">
      <span className="dap-gitbar__item">
        <span className="dap-gitbar__label">{t('git.branch')}</span>
        <span className="dap-mono dap-ellipsis" title={git.branch ?? PLACEHOLDER}>
          {git.detached ? t('git.detached') : (git.branch ?? PLACEHOLDER)}
        </span>
      </span>
      <span className="dap-gitbar__item">
        <span className="dap-gitbar__label">{t('git.commit')}</span>
        <span className="dap-mono" title={git.commitSubject ?? git.commit ?? PLACEHOLDER}>
          {shortCommit(git.commit)}
        </span>
      </span>
      {git.upstream !== null && (
        <span className="dap-gitbar__item">
          <span className="dap-gitbar__label">{t('git.upstream')}</span>
          <span className="dap-mono dap-ellipsis" title={git.upstream}>
            {git.upstream}
          </span>
        </span>
      )}
      {ab !== null && (
        <span className="dap-gitbar__item">
          <span className="dap-mono">{ab === '同步' ? t('git.inSync') : ab}</span>
        </span>
      )}
      {git.dirty === true && (
        <span className="dap-gitbar__item">
          <Tag tone="warn">{t('git.dirty')}</Tag>
        </span>
      )}
      {git.dirty === false && <span className="dap-gitbar__item dap-faint">{t('git.clean')}</span>}
      <span className="dap-gitbar__item dap-faint">
        {t('git.checkedAt', { time: relativeText(git.checkedAt, now, t) })}
      </span>
    </div>
  )
}

/** 单张图谱卡：状态、来源提交、内嵌预览。 */
export function DiagramCard({
  project,
  kind,
  state,
  now,
  t,
  onRegenerate,
  onOpenSession,
  busy,
}: {
  project: Project
  kind: DiagramKind
  state: DiagramState
  now: Date
  t: Translate
  onRegenerate: (kind: DiagramKind) => void
  onOpenSession: () => void
  busy: boolean
}): ReactElement {
  const html = state.htmlPath
  const ready = state.status === 'ready' && html !== null
  const stale =
    ready &&
    project.git.isRepo &&
    project.git.commit !== null &&
    state.commit !== project.git.commit
  const tone =
    state.status === 'ready'
      ? stale
        ? 'warn'
        : 'ok'
      : state.status === 'failed'
        ? 'error'
        : undefined
  const pending = state.status === 'running' || state.status === 'queued'

  return (
    <section className="dap-card dap-diagram" aria-label={t(`diagram.${kind}`)}>
      <header className="dap-diagram__head">
        <StatusDot status={state.status} />
        <span className="dap-diagram__title">{t(`diagram.${kind}`)}</span>
        <span className="dap-diagram__desc">{t(`diagram.${kind}Desc`)}</span>
        <div className="dap-diagram__actions">
          {html !== null && (
            <button
              type="button"
              className="dap-btn dap-btn--quiet"
              onClick={() => {
                window.open(ROUTES.artifact(html), '_blank', 'noopener')
              }}
            >
              {t('action.openTab')}
            </button>
          )}
          <button
            type="button"
            className="dap-btn"
            disabled={busy}
            onClick={() => {
              onRegenerate(kind)
            }}
          >
            {t('action.regenerate')}
          </button>
        </div>
      </header>

      <div className="dap-diagram__meta">
        <Tag tone={tone}>{t(`status.${state.status}`)}</Tag>
        {stale && <Tag tone="warn">{t('status.stale')}</Tag>}
        {state.generatedAt !== null && (
          <span>{t('meta.generatedAt', { time: relativeText(state.generatedAt, now, t) })}</span>
        )}
        {state.commit !== null && (
          <span className="dap-mono">
            {t('meta.basedOn', { commit: shortCommit(state.commit) })}
          </span>
        )}
        {state.error !== null && <span className="dap-error">{state.error}</span>}
      </div>

      {ready ? (
        <iframe
          className="dap-diagram__frame"
          title={`${project.name} · ${diagramTitle(kind)}`}
          src={ROUTES.artifact(html ?? '')}
          loading="lazy"
          sandbox="allow-scripts allow-same-origin"
        />
      ) : (
        <div className="dap-diagram__empty">
          {pending ? t('notice.running') : t(`status.${state.status}`)}
          {(pending || state.status === 'failed') && (
            <div style={{ marginTop: 10 }}>
              <button type="button" className="dap-btn" onClick={onOpenSession}>
                {t('action.openSession')}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** ISO 时间 → 本地 HH:mm:ss。
 *
 * 之前直接 `slice(11, 19)` 切的是 UTC 部分，运行记录里 13:51 会被显示成 05:51，
 * 用户会以为是别人的时区。 */
export function clockText(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso.slice(11, 19)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
}

/** 项目列表。 */
export function ProjectList({
  projects,
  selectedId,
  onSelect,
  t,
}: {
  projects: readonly Project[]
  selectedId: string | null
  onSelect: (id: string) => void
  t: Translate
}): ReactElement {
  return (
    <div className="dap-col dap-col--list" role="list" aria-label={t('page.title')}>
      {projects.map((project) => (
        <button
          key={project.id}
          type="button"
          role="listitem"
          className="dap-item"
          aria-current={project.id === selectedId ? 'true' : undefined}
          onClick={() => {
            onSelect(project.id)
          }}
        >
          <span className="dap-item__top">
            <span className="dap-item__name" title={project.name}>
              {project.name}
            </span>
            <span className="dap-item__dots">
              <StatusDot status={project.diagrams.structure.status} />
              <StatusDot status={project.diagrams.domain.status} />
            </span>
          </span>
          <span className="dap-item__meta">
            <span className="dap-mono dap-ellipsis" title={project.repoPath}>
              {tailPath(project.repoPath, 2)}
            </span>
            <span className="dap-mono" style={{ flex: 'none' }}>
              {shortCommit(project.git.commit)}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}

/** 运行记录，新的在上，最多 6 条。 */
export function RunList({ runs, t }: { runs: readonly RunRecord[]; t: Translate }): ReactElement {
  if (runs.length === 0) return <p className="dap-faint dap-muted">{t('run.none')}</p>
  const recent = [...runs].reverse().slice(0, 6)
  return (
    <ul className="dap-runs">
      {recent.map((run) => {
        const dot =
          run.status === 'running' ? 'running' : run.status === 'failed' ? 'failed' : 'ready'
        return (
          <li key={run.id} className="dap-runs__row">
            <span className={`dap-dot dap-dot--${dot}`} aria-hidden="true" />
            <span>{t(`run.kind.${run.kind}`)}</span>
            <span className="dap-faint">{t(`run.status.${run.status}`)}</span>
            <span className="dap-mono dap-faint">{clockText(run.startedAt)}</span>
            {run.error !== null && <span className="dap-error dap-ellipsis">{run.error}</span>}
          </li>
        )
      })}
    </ul>
  )
}

/** 空状态。 */
export function EmptyState({ onAdd, t }: { onAdd: () => void; t: Translate }): ReactElement {
  return (
    <div className="dap-empty">
      <p className="dap-empty__title">{t('empty.title')}</p>
      <p className="dap-empty__body">{t('empty.body')}</p>
      <button type="button" className="dap-btn dap-btn--primary" onClick={onAdd}>
        {t('empty.action')}
      </button>
    </div>
  )
}

/** 新增项目对话框。表单不经状态变量，避免受控输入带来的多余重渲染。 */
export function AddProjectDialog({
  open,
  onCancel,
  onSubmit,
  t,
}: {
  open: boolean
  onCancel: () => void
  onSubmit: (value: { name: string; repoPath: string }) => void
  t: Translate
}): ReactElement | null {
  if (!open) return null
  return (
    <div className="dap-overlay" role="presentation" onMouseDown={onCancel}>
      <form
        className="dap-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dap-dialog-title"
        onMouseDown={(event) => {
          event.stopPropagation()
        }}
        onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          onSubmit({
            name: String(data.get('name') ?? '').trim(),
            repoPath: String(data.get('repoPath') ?? '').trim(),
          })
        }}
      >
        <h2 className="dap-dialog__title" id="dap-dialog-title">
          {t('dialog.addTitle')}
        </h2>
        <label className="dap-field">
          <span className="dap-field__label">{t('field.name')}</span>
          <input
            className="dap-input"
            name="name"
            autoComplete="off"
            placeholder={t('field.namePlaceholder')}
          />
        </label>
        <label className="dap-field">
          <span className="dap-field__label">{t('field.path')}</span>
          <input
            className="dap-input dap-mono"
            name="repoPath"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder={t('field.pathPlaceholder')}
          />
        </label>
        <div className="dap-dialog__actions">
          <button type="button" className="dap-btn" onClick={onCancel}>
            {t('action.cancel')}
          </button>
          <button type="submit" className="dap-btn dap-btn--primary">
            {t('action.submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
