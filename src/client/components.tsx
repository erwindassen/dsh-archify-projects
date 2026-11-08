/**
 * 页面里可复用的小组件：标签、状态点、两个对话框。
 *
 * 只做展示与受控输入；请求与状态全部留在 page.tsx —— 组件不碰 fetch，
 * 测试才能只渲染、不 mock 网络。
 */

import { useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import {
  ARCHIFY_TYPES,
  type ArchifyType,
  type Concept,
  type Persistence,
  type Project,
} from '../shared/types.js'
import type { Translate } from './panel.js'

/** 运行记录里的时钟：按本地时区显示 HH:mm:ss。 */
export function clockText(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso.slice(11, 19)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
}

/** 小标签。 */
export function Chip({
  tone = 'default',
  dot = false,
  children,
}: {
  tone?: 'default' | 'ok' | 'warn' | 'accent'
  dot?: boolean
  children: ReactNode
}): ReactElement {
  const cls = tone === 'default' ? 'dap-chip' : `dap-chip dap-chip--${tone}`
  return (
    <span className={cls}>
      {dot ? <span className="dap-chip__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

/** 状态点。 */
export function Dot({ tone = 'ok' }: { tone?: 'ok' | 'warn' | 'err' | 'run' }): ReactElement {
  return (
    <span className={tone === 'ok' ? 'dap-dot' : `dap-dot dap-dot--${tone}`} aria-hidden="true" />
  )
}

/** 新增项目对话框。 */
export function NewProjectDialog({
  t,
  busy,
  onClose,
  onSubmit,
}: {
  t: Translate
  busy: boolean
  onClose: () => void
  onSubmit: (name: string, repoPath: string) => void
}): ReactElement {
  const [name, setName] = useState('')
  const [repoPath, setRepoPath] = useState('')
  const [invalid, setInvalid] = useState(false)

  const submit = (): void => {
    if (repoPath.trim().length === 0) {
      setInvalid(true)
      return
    }
    onSubmit(name.trim(), repoPath.trim())
  }

  return (
    <div
      className="dap-mask"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="dap-dialog" role="dialog" aria-modal="true" aria-label={t('dialog.addTitle')}>
        <h2 className="dap-dialog__title">{t('dialog.addTitle')}</h2>
        <p className="dap-dialog__sub">{t('empty.body')}</p>
        <label className="dap-field">
          <span className="dap-field__label">{t('field.name')}</span>
          <input
            className="dap-input"
            value={name}
            placeholder={t('field.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="dap-field" style={{ marginTop: 8 }}>
          <span className="dap-field__label">{t('field.path')}</span>
          <input
            className="dap-input"
            value={repoPath}
            placeholder={t('field.pathPlaceholder')}
            aria-invalid={invalid}
            onChange={(e) => {
              setRepoPath(e.target.value)
              setInvalid(false)
            }}
          />
        </label>
        {invalid ? <p className="dap-notice dap-notice--error">{t('field.pathRequired')}</p> : null}
        <div className="dap-dialog__foot">
          <span className="dap-hint">{t('git.noRepoHint')}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="dap-btn dap-btn--sm" onClick={onClose} disabled={busy}>
              {t('action.cancel')}
            </button>
            <button
              className="dap-btn dap-btn--sm dap-btn--primary"
              onClick={submit}
              disabled={busy}
            >
              {t('action.submit')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export interface DiagramDraft {
  readonly title: string
  readonly prompt: string
  readonly persistence: Persistence
  readonly parentId: string | null
  readonly conceptIds: readonly string[]
  readonly renderer: ArchifyType | null
  readonly pathScope: readonly string[]
}

/** 从概念证据里推几个目录候选，够弹窗做「目录范围」。 */
export function scopeOptions(project: Project): readonly string[] {
  const dirs = new Set<string>()
  for (const concept of project.concepts) {
    for (const evidence of concept.evidence) {
      const parts = evidence.split('/').filter((part) => part.length > 0)
      if (parts.length === 0) continue
      const top = parts[0] as string
      dirs.add(
        parts.length >= 2 && (top === 'src' || top === 'packages' || top === 'apps')
          ? `${top}/${parts[1] as string}`
          : top,
      )
    }
  }
  const out = [...dirs].slice(0, 8)
  return out.length > 0 ? out : ['src']
}

/** 新建图对话框。 */
export function NewDiagramDialog({
  t,
  project,
  selectedId,
  busy,
  onClose,
  onSubmit,
}: {
  t: Translate
  project: Project
  selectedId: string | null
  busy: boolean
  onClose: () => void
  onSubmit: (draft: DiagramDraft) => void
}): ReactElement {
  const [prompt, setPrompt] = useState('')
  const [persistence, setPersistence] = useState<Persistence>('permanent')
  const [underCurrent, setUnderCurrent] = useState(selectedId !== null)
  const [chosen, setChosen] = useState<readonly string[]>([])
  const [renderer, setRenderer] = useState<ArchifyType | null>(null)
  const [pathScope, setPathScope] = useState<readonly string[]>([])
  const concepts = useMemo(() => project.concepts.slice(0, 24), [project.concepts])
  const scopes = useMemo(() => scopeOptions(project), [project])

  const toggleConcept = (id: string): void => {
    setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }
  const toggleScope = (dir: string): void => {
    setPathScope((prev) => (prev.includes(dir) ? prev.filter((x) => x !== dir) : [...prev, dir]))
  }

  const submit = (): void => {
    onSubmit({
      title: prompt.trim().slice(0, 24),
      prompt: prompt.trim(),
      persistence,
      parentId: underCurrent && selectedId !== null ? selectedId : null,
      conceptIds: chosen,
      renderer,
      pathScope,
    })
  }

  return (
    <div
      className="dap-mask"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="dap-dialog dap-dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-label={t('dialog.newDiagram')}
      >
        <h2 className="dap-dialog__title">{t('dialog.newDiagram')}</h2>
        <p className="dap-dialog__sub">{t('dialog.newDiagramSub')}</p>

        <div className="dap-dialog__row" style={{ marginBottom: 4 }}>
          <span className="dap-field__label">{t('field.renderer')}</span>
          <span className="dap-hint">{t('field.rendererHint')}</span>
        </div>
        <div className="dap-typebar">
          <button
            className={renderer === null ? 'dap-type-tag dap-type-tag--on' : 'dap-type-tag'}
            onClick={() => setRenderer(null)}
          >
            {t('renderer.auto')} <span className="dap-type-tag__k">agent</span>
          </button>
          {ARCHIFY_TYPES.map((kind) => (
            <button
              key={kind}
              className={renderer === kind ? 'dap-type-tag dap-type-tag--on' : 'dap-type-tag'}
              onClick={() => setRenderer(kind)}
            >
              {t(`renderer.${kind}`)} <span className="dap-type-tag__k">{kind}</span>
            </button>
          ))}
        </div>
        <div className="dap-type-detail">
          {renderer === null ? (
            <div className="dap-type-detail__empty">{t('renderer.autoHint')}</div>
          ) : (
            <>
              <div className="dap-type-detail__head">
                <b>{t(`renderer.${renderer}`)}</b>
                <code>{renderer}</code>
              </div>
              <div className="dap-type-detail__row">
                <span>{t('renderer.fit')}</span>
                <p>{t(`renderer.${renderer}.fit`)}</p>
              </div>
              <div className="dap-type-detail__row">
                <span>{t('renderer.show')}</span>
                <p>{t(`renderer.${renderer}.show`)}</p>
              </div>
              <div className="dap-type-detail__row">
                <span>{t('renderer.grasp')}</span>
                <p>{t(`renderer.${renderer}.grasp`)}</p>
              </div>
            </>
          )}
        </div>

        <div className="dap-field" style={{ marginTop: 10 }}>
          <span className="dap-field__label">{t('field.prompt')}</span>
          <textarea
            className="dap-textarea"
            value={prompt}
            placeholder={
              renderer === null
                ? t('field.promptPlaceholder')
                : `${t(`renderer.${renderer}`)}：${t('field.promptPlaceholder')}`
            }
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div className="dap-dialog__row" style={{ alignItems: 'flex-start' }}>
          <span className="dap-field__label" style={{ flex: 'none' }}>
            {t('field.concepts')}
          </span>
          <div>
            <div className="dap-concepts">
              {concepts.map((concept: Concept) => (
                <button
                  key={concept.id}
                  className={
                    chosen.includes(concept.id) ? 'dap-concept dap-concept--on' : 'dap-concept'
                  }
                  onClick={() => toggleConcept(concept.id)}
                  title={concept.summary}
                >
                  {concept.name}
                </button>
              ))}
            </div>
            <p className="dap-hint">{t('scope.conceptHint')}</p>
          </div>
        </div>

        <div className="dap-dialog__row" style={{ alignItems: 'flex-start' }}>
          <span className="dap-field__label" style={{ flex: 'none' }}>
            {t('field.pathScope')}
          </span>
          <div>
            <div className="dap-concepts">
              {scopes.map((dir) => (
                <button
                  key={dir}
                  className={
                    pathScope.includes(dir) ? 'dap-concept dap-concept--on' : 'dap-concept'
                  }
                  onClick={() => toggleScope(dir)}
                >
                  {dir}
                </button>
              ))}
            </div>
            <p className="dap-hint">{t('scope.pathHint')}</p>
          </div>
        </div>

        <div className="dap-dialog__row">
          <span className="dap-field__label">{t('field.persistence')}</span>
          <div className="dap-seg">
            <button
              className={
                persistence === 'permanent' ? 'dap-seg__btn dap-seg__btn--on' : 'dap-seg__btn'
              }
              onClick={() => setPersistence('permanent')}
            >
              {t('persistence.permanent')}
            </button>
            <button
              className={
                persistence === 'temporary' ? 'dap-seg__btn dap-seg__btn--on' : 'dap-seg__btn'
              }
              onClick={() => setPersistence('temporary')}
            >
              {t('persistence.temporary')}
            </button>
          </div>
        </div>
        <p className="dap-hint">
          {persistence === 'permanent'
            ? t('persistence.permanentHint')
            : t('persistence.temporaryHint')}
        </p>

        <div className="dap-dialog__row">
          <span className="dap-field__label">{t('field.parent')}</span>
          <div className="dap-seg">
            <button
              className={!underCurrent ? 'dap-seg__btn dap-seg__btn--on' : 'dap-seg__btn'}
              onClick={() => setUnderCurrent(false)}
            >
              {t('parent.none')}
            </button>
            <button
              className={underCurrent ? 'dap-seg__btn dap-seg__btn--on' : 'dap-seg__btn'}
              onClick={() => setUnderCurrent(true)}
              disabled={selectedId === null}
            >
              {t('parent.current')}
            </button>
          </div>
        </div>

        <div className="dap-dialog__foot">
          <span className="dap-hint">{t('qa.mergeHint')}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="dap-btn dap-btn--sm" onClick={onClose} disabled={busy}>
              {t('action.cancel')}
            </button>
            <button
              className="dap-btn dap-btn--sm dap-btn--primary"
              onClick={submit}
              disabled={busy || prompt.trim().length === 0}
            >
              {t('action.submit')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
