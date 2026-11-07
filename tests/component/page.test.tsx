// @vitest-environment jsdom
/**
 * 页面组件测试（jsdom + RTL）。
 *
 * 覆盖的是「人真的会看到的五种状态」，不是内部实现：空态、有项目、生成中、
 * 失败、以及新增项目对话框。fetch 用桩替换，断言落在可见文本与可访问性属性上。
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { StudioPage } from '../../src/client/page.js'
import { PanelIcon } from '../../src/client/panel.js'
import { DICT } from '../../src/client/locale.js'
import type { Project } from '../../src/shared/types.js'
import { emptyDiagramState } from '../../src/shared/types.js'

const t = (key: string, vars?: Record<string, string | number>): string => {
  const template = DICT.zh[key] ?? key
  if (vars === undefined) return template
  return Object.entries(vars).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  )
}

function project(overrides: Partial<Project> = {}): Project {
  const now = '2026-11-06T12:00:00.000Z'
  return {
    id: 'prj_1',
    name: '演示仓库',
    repoPath: 'D:/work/demo',
    createdAt: now,
    updatedAt: now,
    git: {
      isRepo: true,
      root: 'D:/work/demo',
      branch: 'main',
      detached: false,
      commit: 'abcdef1234567890',
      commitFull: 'abcdef1234567890',
      commitSubject: 'feat: 初始化',
      commitTime: now,
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
      dirty: false,
      remoteUrl: 'git@example.com:demo.git',
      checkedAt: now,
    },
    diagrams: {
      structure: { ...emptyDiagramState(), status: 'ready', htmlPath: 'prj_1/.archify/s/a.html' },
      domain: emptyDiagramState(),
    },
    lastRun: null,
    runs: [],
    ...overrides,
  }
}

/** 装一个只返回固定响应的 fetch。 */
function stubFetch(routes: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const entry = routes[url]
      const payload =
        entry === undefined
          ? { ok: false, error: { code: 'not-found', message: '没有这个接口' } }
          : { ok: true, value: entry }
      return { status: 200, json: async () => payload } as unknown as Response
    }),
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  )
})

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
    stubFetch({ '/dsh-archify-projects/projects': { projects: [], workspacePath: 'C:/ws' } })
    render(<StudioPage t={t} />)
    expect(await screen.findByText(DICT.zh['empty.title'] ?? '')).toBeTruthy()
    expect(screen.getByRole('button', { name: DICT.zh['empty.action'] ?? '' })).toBeTruthy()
    expect(screen.getAllByText('C:/ws').length).toBeGreaterThan(0)
  })

  test('点「新增项目」打开对话框，取消后关闭', async () => {
    stubFetch({ '/dsh-archify-projects/projects': { projects: [], workspacePath: 'C:/ws' } })
    render(<StudioPage t={t} />)
    fireEvent.click(await screen.findByRole('button', { name: DICT.zh['empty.action'] ?? '' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeTruthy()
    expect(screen.getByLabelText(DICT.zh['field.path'] ?? '')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['action.cancel'] ?? '' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  test('有项目时显示 Git 信息与两张图谱卡', async () => {
    stubFetch({
      '/dsh-archify-projects/projects': { projects: [project()], workspacePath: 'C:/ws' },
    })
    render(<StudioPage t={t} />)
    expect((await screen.findAllByText('演示仓库')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('main').length).toBeGreaterThan(0)
    expect(screen.getAllByText('abcdef1').length).toBeGreaterThan(0)
    // 两张图各有一个卡片
    expect(screen.getByRole('region', { name: '项目结构图' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '领域图' })).toBeTruthy()
    // 就绪的那张嵌了 iframe，未生成的显示状态
    const frame = screen.getByTitle(/项目结构图/)
    expect(frame.getAttribute('src')).toBe('/dsh-archify-projects/artifact/prj_1/.archify/s/a.html')
    expect(screen.getAllByText(DICT.zh['status.idle'] ?? '').length).toBeGreaterThan(0)
  })

  test('生成中显示进度说明与轮询', async () => {
    const running = project({
      diagrams: {
        structure: { ...emptyDiagramState(), status: 'running' },
        domain: emptyDiagramState(),
      },
      lastRun: {
        id: 'run_1',
        kind: 'update',
        status: 'running',
        sessionId: 'session_9',
        startedAt: '2026-11-06T12:00:00.000Z',
        finishedAt: null,
        error: null,
        note: null,
      },
      runs: [
        {
          id: 'run_1',
          kind: 'update',
          status: 'running',
          sessionId: 'session_9',
          startedAt: '2026-11-06T12:00:00.000Z',
          finishedAt: null,
          error: null,
          note: null,
        },
      ],
    })
    stubFetch({ '/dsh-archify-projects/projects': { projects: [running], workspacePath: 'C:/ws' } })
    render(<StudioPage t={t} />)
    expect((await screen.findAllByText(DICT.zh['notice.running'] ?? '')).length).toBeGreaterThan(0)
    expect(screen.getAllByText(DICT.zh['action.openSession'] ?? '').length).toBeGreaterThan(0)
    // 运行中「更新」按钮禁用，避免叠加第二次运行
    const update = screen.getByRole('button', { name: DICT.zh['action.update'] ?? '' })
    expect((update as HTMLButtonElement).disabled).toBe(true)
  })

  test('失败状态把错误原因显示出来', async () => {
    const failed = project({
      diagrams: {
        structure: { ...emptyDiagramState(), status: 'failed', error: 'archify finalize 退出码 1' },
        domain: emptyDiagramState(),
      },
    })
    stubFetch({ '/dsh-archify-projects/projects': { projects: [failed], workspacePath: 'C:/ws' } })
    render(<StudioPage t={t} />)
    expect(await screen.findByText('archify finalize 退出码 1')).toBeTruthy()
    expect(screen.getAllByText(DICT.zh['status.failed'] ?? '').length).toBeGreaterThan(0)
  })

  test('接口失败时给出错误提示，不假装成功', async () => {
    stubFetch({})
    render(<StudioPage t={t} />)
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/没有这个接口/).length).toBeGreaterThan(0)
  })

  test('非 Git 目录不摆分支字段，直说原因', async () => {
    const plain = project({
      git: {
        isRepo: false,
        root: null,
        branch: null,
        detached: false,
        commit: null,
        commitFull: null,
        commitSubject: null,
        commitTime: null,
        upstream: null,
        ahead: null,
        behind: null,
        dirty: null,
        remoteUrl: null,
        checkedAt: '2026-11-06T12:00:00.000Z',
      },
    })
    stubFetch({ '/dsh-archify-projects/projects': { projects: [plain], workspacePath: 'C:/ws' } })
    render(<StudioPage t={t} />)
    expect((await screen.findAllByText(DICT.zh['git.noRepo'] ?? '')).length).toBeGreaterThan(0)
    expect(screen.queryByText(DICT.zh['git.branch'] ?? '')).toBeNull()
  })
})
