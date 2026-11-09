// @vitest-environment node
/**
 * 分析会话走「子代理会话」这条路（`ctx.agents.create` + `agentPresets.mount`）。
 *
 * 三条要守的性质：
 *   1. 建出来的会话带 `origin: 'subagent'` 与 `delegationDepth`：DSH 侧边栏按
 *      origin 过滤会话列表，分析不再往用户的对话列表里塞新会话；
 *   2. 模型来自插件设置（`agentOptions`），**不是**改宿主的全局默认；
 *   3. 宿主没这条路（或建会话抛错）时安静退回普通会话，功能不消失。
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { projectDir, resolveConfig } from '../../src/host/config.js'
import { Runner } from '../../src/host/runner.js'
import { ProjectStore } from '../../src/host/store.js'
import { writeSettings } from '../../src/host/settings.js'
import { createProject, emptyGitSnapshot, type Project } from '../../src/shared/types.js'

let root = ''
let store: ProjectStore

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'dap-subagent-'))
  store = new ProjectStore(path.join(root, 'data', 'projects.json'))
  await store.load()
})

const config = (): ReturnType<typeof resolveConfig> =>
  resolveConfig({ dataDir: path.join(root, 'data') }, [])

interface FakeAgent {
  id: string
  ctx: { tools: { restrict: ReturnType<typeof vi.fn>; guard: ReturnType<typeof vi.fn> } }
  followup: ReturnType<typeof vi.fn>
  whenIdle: () => Promise<void>
  session: { deriveMessages: () => unknown[] }
}

/** 造一个「能自己建子代理会话」的宿主。 */
function makeSubagentCtx(
  options: { createThrows?: boolean; withSessionController?: boolean } = {},
): {
  ctx: never
  agent: FakeAgent
  create: ReturnType<typeof vi.fn>
  mount: ReturnType<typeof vi.fn>
  resolve: ReturnType<typeof vi.fn>
  sessionCreate: ReturnType<typeof vi.fn>
} {
  const agent: FakeAgent = {
    id: 'session-generated',
    ctx: { tools: { restrict: vi.fn(() => () => {}), guard: vi.fn(() => () => {}) } },
    followup: vi.fn(() => {}),
    whenIdle: async () => {},
    session: { deriveMessages: () => [] },
  }
  const mount = vi.fn(async () => ({}))
  const resolve = vi.fn(async (id?: string) => ({ id: id ?? 'archify-projects' }))
  const create = vi.fn(async (request: { sessionId: string }) => {
    if (options.createThrows === true) throw new Error('宿主这个版本建不了')
    return { agent: { ...agent, id: request.sessionId }, dispose: async () => {} }
  })
  const sessionCreate = vi.fn(async () => ({ sessionId: 'session_plain' }))
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    agents: {
      create,
      get: vi.fn((id: string) => (id === 'session_plain' ? { ...agent, id } : undefined)),
    },
    agentPresets: { resolve, mount },
    ...(options.withSessionController === false
      ? {}
      : {
          sessionController: {
            create: sessionCreate,
            prompt: vi.fn(async () => ({ accepted: true })),
          },
        }),
  }
  return { ctx: ctx as never, agent, create, mount, resolve, sessionCreate }
}

async function seedProject(): Promise<Project> {
  const repo = path.join(root, 'repo')
  await mkdir(repo, { recursive: true })
  const now = '2026-11-06T12:00:00.000Z'
  const project = createProject({
    id: 'prj_1',
    name: '演示',
    repoPath: repo,
    now,
    git: { ...emptyGitSnapshot(now), isRepo: true, branch: 'main', commit: 'abcdef1234567890' },
  })
  await store.upsert(project)
  return project
}

describe('子代理会话', () => {
  test('建会话带 origin=subagent + delegationDepth，模型来自插件设置', async () => {
    const project = await seedProject()
    await writeSettings(config(), { model: { provider: 'zifei', model: 'claude-sonnet' } })
    const { ctx, create } = makeSubagentCtx()
    const runner = new Runner({ ctx, store, config: config(), skillDir: async () => null })

    const started = await runner.start(project, 'create', ['structure', 'domain'])
    await runner.whenSettled('prj_1')

    expect(create).toHaveBeenCalledTimes(1)
    const request = create.mock.calls[0]?.[0] as {
      sessionId: string
      meta: { cwd: string; origin?: string; delegationDepth?: number; agentPreset?: string }
      agentOptions?: { provider?: string; model?: string }
      setup?: (_agentCtx: unknown) => Promise<void>
    }
    expect(request.sessionId.startsWith('session-')).toBe(true)
    expect(started.sessionId).toBe(request.sessionId)
    expect(request.meta.origin).toBe('subagent')
    expect(request.meta.delegationDepth).toBe(1)
    expect(request.meta.agentPreset).toBe('archify-projects')
    expect(request.meta.cwd).toBe(path.join(root, 'data', 'workspace', 'prj_1'))
    // 选了模型就带上；不改宿主的全局默认
    expect(request.agentOptions).toEqual({ provider: 'zifei', model: 'claude-sonnet' })
  })

  test('setup 里 mount 指定 preset；提示词投到这条会话上', async () => {
    const project = await seedProject()
    const { ctx, create, mount, agent } = makeSubagentCtx({ withSessionController: false })
    const runner = new Runner({ ctx, store, config: config(), skillDir: async () => null })

    const started = await runner.start(project, 'create', ['structure'])
    await runner.whenSettled('prj_1')

    const request = create.mock.calls[0]?.[0] as {
      setup?: (_agentCtx: unknown) => Promise<void>
    }
    await request.setup?.({ scoped: true })
    expect(mount).toHaveBeenCalledWith({ scoped: true }, 'archify-projects')

    // 提示词经 followup 进入这条会话（不是 sessionController.prompt）
    const delivered = agent.followup.mock.calls[0]?.[0] as {
      role: string
      content: { type: string; text?: string }[]
    }
    expect(delivered.role).toBe('user')
    expect(delivered.content[0]?.text).toContain('演示')

    // 工具面照样收口
    expect(agent.ctx.tools.restrict).toHaveBeenCalledTimes(1)
    expect(agent.ctx.tools.guard).toHaveBeenCalledTimes(1)
    expect(started.sessionId.startsWith('session-')).toBe(true)
  })

  test('建会话失败时退回普通会话，不把运行判死', async () => {
    const project = await seedProject()
    const { ctx, sessionCreate } = makeSubagentCtx({ createThrows: true })
    const runner = new Runner({ ctx, store, config: config(), skillDir: async () => null })

    const started = await runner.start(project, 'create', ['structure'])
    await runner.whenSettled('prj_1')

    expect(started.sessionId).toBe('session_plain')
    expect(sessionCreate).toHaveBeenCalledTimes(1)
  })

  test('没选模型时不带 agentOptions（跟随宿主默认）', async () => {
    const project = await seedProject()
    const { ctx, create } = makeSubagentCtx()
    const runner = new Runner({ ctx, store, config: config(), skillDir: async () => null })

    await runner.start(project, 'create', ['structure'])
    await runner.whenSettled('prj_1')

    const request = create.mock.calls[0]?.[0] as { agentOptions?: unknown }
    expect(request.agentOptions).toBeUndefined()
  })

  test('宿主没有 agentPresets 时不走子代理这条路', async () => {
    const project = await seedProject()
    const { ctx, create } = makeSubagentCtx()
    // 抹掉 preset 服务：只剩 agents.create 也建不出「带工具面的会话」
    ;(ctx as unknown as { agentPresets?: unknown }).agentPresets = undefined
    const runner = new Runner({ ctx, store, config: config(), skillDir: async () => null })

    const started = await runner.start(project, 'create', ['structure'])
    await runner.whenSettled('prj_1')

    expect(create).not.toHaveBeenCalled()
    expect(started.sessionId).toBe('session_plain')
  })
})

describe('产物回收仍然照旧', () => {
  test('子代理会话产出的 .archify 目录照样被认领', async () => {
    const project = await seedProject()
    const dir = path.join(projectDir(config(), 'prj_1'), '.archify', 'structure-demo-1')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'demo.html'), '<html></html>', 'utf8')
    const { ctx } = makeSubagentCtx({ withSessionController: false })
    const runner = new Runner({ ctx, store, config: config(), skillDir: async () => null })

    await runner.start(project, 'create', ['structure'])
    await runner.whenSettled('prj_1')

    const after = await store.get('prj_1')
    expect(after?.diagrams.structure.status).toBe('ready')
    expect(after?.diagrams.structure.htmlPath).toBe('prj_1/.archify/structure-demo-1/demo.html')
  })
})
