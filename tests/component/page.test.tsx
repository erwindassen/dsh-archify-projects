// @vitest-environment jsdom
/**
 * 页面组件测试（jsdom + RTL）。
 *
 * 覆盖的是「人真的会看到的几种状态」，不是内部实现：空态、总览卡片、工作台、
 * 新建图对话框、提问页签、以及接口失败。fetch 用桩替换，断言落在可见文本与可访问性属性上。
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { StudioPage } from '../../src/client/page.js'
import { PanelIcon } from '../../src/client/panel.js'
import { DICT } from '../../src/client/locale.js'
import { ROUTES } from '../../src/shared/protocol.js'
import { createProject, emptyGitSnapshot, type Project } from '../../src/shared/types.js'

const t = (key: string, vars?: Record<string, string | number>): string => {
  const template = DICT.zh[key] ?? key
  if (vars === undefined) return template
  return Object.entries(vars).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  )
}

const NOW = '2026-11-06T12:00:00.000Z'

function makeProject(overrides: Partial<Project> = {}): Project {
  const base = createProject({
    id: 'prj_1',
    name: '演示仓库',
    repoPath: '/work/demo',
    now: NOW,
    git: {
      ...emptyGitSnapshot(NOW),
      isRepo: true,
      branch: 'main',
      dirty: true,
      tree: { staged: 1, unstaged: 2, untracked: 0 },
    },
  })
  return {
    ...base,
    concepts: [
      {
        id: 'cpt_a',
        name: '台账',
        summary: '唯一真相',
        evidence: ['src/store.ts'],
        tags: [],
        updatedAt: NOW,
      },
      {
        id: 'cpt_b',
        name: '运行',
        summary: '受限会话',
        evidence: ['src/runner.ts'],
        tags: [],
        updatedAt: NOW,
      },
    ],
    diagrams: {
      structure: {
        ...base.diagrams.structure,
        status: 'ready',
        htmlPath: 'prj_1/.archify/s/a.html',
        generatedAt: NOW,
        branch: 'main',
        tree: { staged: 0, unstaged: 0, untracked: 0 },
      },
      domain: { ...base.diagrams.domain, status: 'idle' },
    },
    ...overrides,
  }
}

interface Call {
  readonly url: string
  readonly method: string
  readonly body: unknown
}

/** 装一个按「METHOD url」路由的 fetch 桩，并记录调用。 */
function stubFetch(routes: Record<string, unknown>): Call[] {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push({
        url,
        method,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      })
      const key = `${method} ${url}`
      const entry = routes[key] ?? routes[url]
      const payload =
        entry === undefined
          ? { ok: false, error: { code: 'not-found', message: '没有这个接口' } }
          : { ok: true, value: entry }
      return { status: 200, json: async () => payload } as unknown as Response
    }),
  )
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PanelIcon', () => {
  test('跟随 size 且对辅助技术隐藏', () => {
    const { container } = render(<PanelIcon size={18} active />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('18')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelectorAll('circle').length).toBe(3)
  })
})

describe('StudioPage', () => {
  test('空台账显示空态与引导按钮', async () => {
    stubFetch({
      [ROUTES.projects]: { projects: [], workspacePath: '/ws' },
    })
    render(<StudioPage t={t} />)
    expect(await screen.findByText(DICT.zh['empty.title'] ?? '')).toBeTruthy()
    expect(screen.getByRole('button', { name: DICT.zh['empty.action'] ?? '' })).toBeTruthy()
  })

  test('新增项目对话框：打开、必填校验、取消', async () => {
    stubFetch({ [ROUTES.projects]: { projects: [], workspacePath: '/ws' } })
    render(<StudioPage t={t} />)
    fireEvent.click(await screen.findByRole('button', { name: DICT.zh['empty.action'] ?? '' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeTruthy()
    expect(screen.getByLabelText(DICT.zh['field.path'] ?? '')).toBeTruthy()
    // 路径为空时提交 -> 红字提示，不发请求
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['action.submit'] ?? '' }))
    expect(await screen.findByText(DICT.zh['field.pathRequired'] ?? '')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['action.cancel'] ?? '' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('总览卡片显示分支、工作区与概念数，点开进工作台', async () => {
    stubFetch({ [ROUTES.projects]: { projects: [makeProject()], workspacePath: '/ws' } })
    const { container } = render(<StudioPage t={t} />)
    expect(await screen.findByText('演示仓库')).toBeTruthy()
    expect(
      screen.getByText(
        DICT.zh['git.treeShort']?.replace('{staged}', '1').replace('{unstaged}', '2') ?? '',
      ),
    ).toBeTruthy()
    expect(screen.getByText('2 概念')).toBeTruthy()

    fireEvent.click(container.querySelector('.dap-card') as Element)
    expect((await screen.findAllByText('项目结构图')).length).toBeGreaterThan(0)
    const iframe = container.querySelector('iframe')
    expect(iframe?.getAttribute('src')).toBe(
      '/dsh-archify-projects/artifact/prj_1/.archify/s/a.html',
    )
    expect(screen.getAllByText('台账').length).toBeGreaterThan(0)
  })

  test('新建图：prompt + 临时时效会带进请求', async () => {
    const project = makeProject()
    const created = makeProject({
      custom: [
        {
          ...project.diagrams.domain,
          id: 'dgm_x',
          kind: 'custom',
          title: '调用链',
          prompt: '画调用链',
          persistence: 'temporary',
          parentId: null,
          setId: null,
          status: 'idle',
          htmlPath: null,
          specPath: null,
          generatedAt: null,
          branch: null,
          tree: null,
          error: null,
        },
      ],
    })
    const calls = stubFetch({
      [ROUTES.projects]: { projects: [project], workspacePath: '/ws' },
      [`POST ${ROUTES.diagrams('prj_1')}`]: { project: created },
    })
    const { container } = render(<StudioPage t={t} />)
    fireEvent.click(await screen.findByText('演示仓库'))
    fireEvent.click((await screen.findAllByRole('button', { name: /新建图/ }))[0] as Element)

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(screen.getByPlaceholderText(DICT.zh['field.promptPlaceholder'] ?? ''), {
      target: { value: '画调用链' },
    })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['persistence.temporary'] ?? '' }))
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['action.submit'] ?? '' }))

    await waitFor(() => {
      const post = calls.find((call) => call.method === 'POST')
      expect(post?.body).toMatchObject({ prompt: '画调用链', persistence: 'temporary' })
    })
    expect(dialog).toBeTruthy()
    void container
  })

  test('提问页签显示回答，并能点「补进图里」', async () => {
    const project = makeProject({
      qa: [
        {
          id: 'qa_1',
          diagramId: 'structure',
          question: '路由失败会怎样？',
          answer: '会 warn 并跳过。',
          at: NOW,
          applied: false,
        },
      ],
    })
    const after = makeProject({ qa: [{ ...project.qa[0]!, applied: true }] })
    const calls = stubFetch({
      [ROUTES.projects]: { projects: [project], workspacePath: '/ws' },
      [`POST ${ROUTES.mergeQa('prj_1', 'qa_1')}`]: {
        project: after,
        qa: after.qa[0],
        diagramId: null,
      },
    })
    const { container } = render(<StudioPage t={t} />)
    fireEvent.click(await screen.findByText('演示仓库'))
    fireEvent.click(
      await screen.findByRole('button', { name: new RegExp(DICT.zh['tab.qa'] ?? '') }),
    )
    expect(screen.getByText('路由失败会怎样？')).toBeTruthy()
    expect(screen.getByText('会 warn 并跳过。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['action.merge'] ?? '' }))
    await waitFor(() => {
      expect(calls.some((call) => call.url === ROUTES.mergeQa('prj_1', 'qa_1'))).toBe(true)
    })
    void container
  })

  test('接口失败时给出错误提示，不假装成功', async () => {
    stubFetch({})
    render(<StudioPage t={t} />)
    expect(await screen.findByText(/没有这个接口/)).toBeTruthy()
  })
})
