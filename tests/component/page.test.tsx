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

  test('总览卡片的图条不再有单独拉长的整行（横线不许长过卡片）', async () => {
    stubFetch({ [ROUTES.projects]: { projects: [makeProject()], workspacePath: '/ws' } })
    const { container } = render(<StudioPage t={t} />)
    await screen.findByText('演示仓库')
    const thumbs = container.querySelectorAll('.dap-thumb')
    expect(thumbs.length).toBe(2)
    // 曾经 `grid-column: 1 / -1` + `1fr 1fr` 会把结构图那条拉到卡片里最宽，
    // 甚至压到卡片右边框外；现在两张图等宽分栏。
    for (const thumb of thumbs) expect(thumb.classList.contains('dap-thumb--wide')).toBe(false)
    expect(container.querySelector('.dap-atlas')).toBeTruthy()
  })

  test('运行结束后的 todo 不再显示转圈：最后一步是 ✓ 不是 in_progress', async () => {
    const project = makeProject()
    const ended = {
      ...project,
      lastRun: {
        id: 'run_1',
        kind: 'create' as const,
        status: 'succeeded' as const,
        sessionId: 'session_1',
        startedAt: NOW,
        finishedAt: NOW,
        error: null,
        note: null,
        diagramIds: ['structure', 'domain'],
        // 台账里真实出现过的形态：agent 收尾时没来得及把最后一步写成 completed
        todos: [
          { content: '读代码库结构', status: 'completed' as const },
          { content: '回报产物标记与统计', status: 'in_progress' as const },
        ],
        usage: null,
      },
    }
    stubFetch({ [ROUTES.projects]: { projects: [ended], workspacePath: '/ws' } })
    const { container } = render(<StudioPage t={t} />)
    fireEvent.click(await screen.findByText('演示仓库'))
    await screen.findByText('回报产物标记与统计')
    expect(container.querySelector('.dap-todo--now')).toBeNull()
    expect(container.querySelectorAll('.dap-todo--done').length).toBe(2)
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

  test('图名 tab 条：默认两张 + 新建图，点 tab 切图', async () => {
    const project = makeProject({
      diagrams: {
        ...makeProject().diagrams,
        domain: {
          ...makeProject().diagrams.domain,
          status: 'ready',
          htmlPath: 'prj_1/.archify/d/b.html',
          generatedAt: NOW,
        },
      },
    })
    stubFetch({ [ROUTES.projects]: { projects: [project], workspacePath: '/ws' } })
    const { container } = render(<StudioPage t={t} />)
    fireEvent.click(await screen.findByText('演示仓库'))
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['项目结构图', '领域图'])
    // 纯文字 tab：条高不应超过 40px，也不再渲染缩略图 iframe
    expect(container.querySelectorAll('.dap-thumbcard, .dap-thumbcard__preview')).toHaveLength(0)
    // 第一张是结构图
    expect(container.querySelector('.dap-iframe')?.getAttribute('src')).toContain('a.html')
    fireEvent.click(tabs[1] as Element)
    await waitFor(() => {
      expect(container.querySelector('.dap-iframe')?.getAttribute('src')).toContain('b.html')
    })
    // 左栏已移除：文档里不该再有概念索引面板
    expect(container.querySelector('.dap-rail__group')).toBeNull()
    // 新建图按钮在缩略图条里（不是 tab，是条尾的虚线按钮）
    const add = container.querySelector('.dap-strip__new') as Element
    expect(add.textContent).toContain(DICT.zh['action.newDiagram'])
    fireEvent.click(add)
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  test('新建图：选图型 tag 会显示说明并带进请求', async () => {
    const project = makeProject()
    const calls = stubFetch({
      [ROUTES.projects]: { projects: [project], workspacePath: '/ws' },
      [`POST ${ROUTES.diagrams('prj_1')}`]: { project },
    })
    render(<StudioPage t={t} />)
    fireEvent.click(await screen.findByText('演示仓库'))
    fireEvent.click((await screen.findAllByRole('button', { name: /新建图/ }))[0] as Element)

    // 默认「不限」：显示「不选也行」
    expect(await screen.findByText(DICT.zh['renderer.autoHint'] ?? '')).toBeTruthy()

    // 选时序图 -> 说明卡出现三行
    fireEvent.click(screen.getByRole('button', { name: /时序图/ }))
    expect(await screen.findByText(DICT.zh['renderer.sequence.fit'] ?? '')).toBeTruthy()
    expect(screen.getByText(DICT.zh['renderer.sequence.show'] ?? '')).toBeTruthy()
    expect(screen.getByText(DICT.zh['renderer.sequence.grasp'] ?? '')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText(/不需要看|画出一次|关注点|类型/), {
      target: { value: '只看调用链' },
    })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['action.submit'] ?? '' }))
    await waitFor(() => {
      const post = calls.find((call) => call.method === 'POST')
      expect(post?.body).toMatchObject({ prompt: '只看调用链', renderer: 'sequence' })
    })
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

describe('设置入口（模型选择）', () => {
  const SETTINGS = {
    model: null,
    subagentSessions: true,
    catalog: {
      source: 'host',
      fallback: { provider: 'dsh', model: 'deepseek-v4' },
      failures: [],
      options: [
        {
          key: 'dsh::deepseek-v4',
          provider: 'dsh',
          providerName: 'DeepSeek',
          model: 'deepseek-v4',
          name: 'DeepSeek V4',
          description: null,
        },
        {
          key: 'zifei::claude-sonnet',
          provider: 'zifei',
          providerName: '自费网关',
          model: 'claude-sonnet',
          name: 'Claude Sonnet',
          description: null,
        },
      ],
    },
  }

  test('头部有齿轮入口，弹窗里只有一个模型下拉，选项来自宿主目录', async () => {
    stubFetch({
      [ROUTES.projects]: { projects: [], workspacePath: '/ws' },
      [ROUTES.settings]: SETTINGS,
    })
    const { container } = render(<StudioPage t={t} />)
    await screen.findByText(DICT.zh['empty.title'] ?? '')

    const gear = screen.getByRole('button', { name: DICT.zh['action.settings'] ?? '' })
    expect(container.querySelector('.dap-iconbtn')).toBeTruthy()
    fireEvent.click(gear)

    const dialog = await screen.findByRole('dialog')
    // 弹窗里只有一张「模型」下拉，没有第二个可输入控件
    expect(dialog.querySelectorAll('select').length).toBe(1)
    expect(dialog.querySelectorAll('input, textarea').length).toBe(0)
    const select = screen.getByLabelText(DICT.zh['field.model'] ?? '') as HTMLSelectElement
    const labels = [...select.options].map((option) => option.textContent)
    expect(labels[0]).toBe(
      (DICT.zh['model.followDefaultNamed'] ?? '').replace('{model}', 'dsh / deepseek-v4'),
    )
    expect(labels).toContain('DeepSeek · DeepSeek V4')
    expect(labels).toContain('自费网关 · Claude Sonnet')
  })

  test('选一个模型并保存 → PUT /settings 带上 provider/model', async () => {
    const calls = stubFetch({
      [ROUTES.projects]: { projects: [], workspacePath: '/ws' },
      [ROUTES.settings]: SETTINGS,
      [`PUT ${ROUTES.settings}`]: {
        ...SETTINGS,
        model: { provider: 'zifei', model: 'claude-sonnet' },
      },
    })
    render(<StudioPage t={t} />)
    await screen.findByText(DICT.zh['empty.title'] ?? '')
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['action.settings'] ?? '' }))

    fireEvent.change(await screen.findByLabelText(DICT.zh['field.model'] ?? ''), {
      target: { value: 'zifei::claude-sonnet' },
    })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['action.save'] ?? '保存' }))

    await waitFor(() => {
      const put = calls.find((call) => call.method === 'PUT')
      expect(put?.url).toBe(ROUTES.settings)
      expect(put?.body).toEqual({ model: { provider: 'zifei', model: 'claude-sonnet' } })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('宿主没有模型目录时只留「跟随宿主默认」，且不假装能选', async () => {
    stubFetch({
      [ROUTES.projects]: { projects: [], workspacePath: '/ws' },
      [ROUTES.settings]: {
        model: null,
        subagentSessions: false,
        catalog: { source: 'unavailable', fallback: null, failures: [], options: [] },
      },
    })
    render(<StudioPage t={t} />)
    await screen.findByText(DICT.zh['empty.title'] ?? '')
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['action.settings'] ?? '' }))

    const dialog = await screen.findByRole('dialog')
    const select = screen.getByLabelText(DICT.zh['field.model'] ?? '') as HTMLSelectElement
    expect(select.options.length).toBe(1)
    expect(dialog.textContent).toContain(DICT.zh['settings.unavailable'] ?? '')
    expect(dialog.textContent).toContain(DICT.zh['settings.sessionPlain'] ?? '')
  })
})
