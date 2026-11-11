// @vitest-environment node
/**
 * 运行编排的端到端（桩 ctx + 真台账 + 真临时目录）。
 *
 * 这一段是插件的核心：建会话 → 收口工具面 → 投提示词 → 等结束 → 回收产物 → 写台账。
 * agent 本身用桩替代，其余全是真的，所以「产物路径算错」「状态卡在 running」
 * 这类问题在这里能真的红。
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { resolveConfig, projectDir } from '../../src/host/config.js'
import { Runner } from '../../src/host/runner.js'
import { ProjectStore } from '../../src/host/store.js'
import { createProject, emptyGitSnapshot, type Project } from '../../src/shared/types.js'

let root = ''
let store: ProjectStore

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'dap-run-'))
  store = new ProjectStore(path.join(root, 'data', 'projects.json'))
  await store.load()
})

const config = (): ReturnType<typeof resolveConfig> =>
  resolveConfig({ dataDir: path.join(root, 'data') }, [])

/** 造一个插件会用到的那几个宿主服务。 */
function makeCtx(options: {
  finalText?: string
  withAgent?: boolean
  withSessionController?: boolean
  todos?: readonly { content: string; status: 'pending' | 'in_progress' | 'completed' }[]
  usage?: {
    uncachedInputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }
}): {
  ctx: never
  scope: {
    tools: { restrict: ReturnType<typeof vi.fn>; guard: ReturnType<typeof vi.fn> }
    effect: ReturnType<typeof vi.fn>
  }
} {
  const restrict = vi.fn(() => () => {})
  const guard = vi.fn(() => () => {})
  const scope = { tools: { restrict, guard }, effect: vi.fn((fn: () => unknown) => fn()) }
  const agent = {
    id: 'session_1',
    ctx: scope,
    whenIdle: async () => {},
    session: {
      deriveMessages: () => [
        { role: 'user', content: [{ type: 'text', text: '任务' }] },
        { role: 'assistant', content: [{ type: 'text', text: options.finalText ?? '' }] },
      ],
    },
  }
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    ...(options.withSessionController === false
      ? {}
      : {
          sessionController: {
            create: vi.fn(async () => ({ sessionId: 'session_1' })),
            prompt: vi.fn(async () => ({ accepted: true })),
          },
        }),
    agents: {
      get: vi.fn((id: string) =>
        options.withAgent === false || id !== 'session_1' ? undefined : agent,
      ),
      createSession: vi.fn(),
    },
    ...(options.todos === undefined && options.usage === undefined
      ? {}
      : {
          sessionProjections: {
            snapshot: vi.fn((_session: unknown, keys?: readonly string[]) => {
              const values: Record<string, unknown> = {}
              if (keys?.includes('todos') && options.todos !== undefined)
                values.todos = options.todos
              if (keys?.includes('tokenUsage') && options.usage !== undefined) {
                values.tokenUsage = options.usage
              }
              return { values }
            }),
          },
        }),
    workspaceRegistry: undefined,
  }
  return { ctx: ctx as never, scope }
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

/** 让 agent 的「最终回复」里带产物标记，并真的把文件放到位。 */
async function placeArtifacts(
  markers: Partial<Record<'structure' | 'domain', string>>,
): Promise<string> {
  const lines: string[] = []
  for (const [kind, relative] of Object.entries(markers)) {
    const full = path.join(projectDir(config(), 'prj_1'), relative ?? '')
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, '<html></html>', 'utf8')
    await writeFile(path.join(path.dirname(full), 'candidate.json'), '{}', 'utf8')
    lines.push(`ARCHIFY_ARTIFACT ${kind} ${full}`)
  }
  return lines.join('\n')
}

describe('Runner', () => {
  test('成功：收口工具面、投提示词、回收产物、写回台账', async () => {
    const project = await seedProject()
    const finalText = await placeArtifacts({
      structure: '.archify/structure-demo-1/demo.html',
      domain: '.archify/domain-demo-1/demo.html',
    })
    const { ctx, scope } = makeCtx({ finalText })
    const runner = new Runner({
      ctx,
      store,
      config: config(),
      skillDir: async () => 'C:/skills/archify',
    })

    const started = await runner.start(project, 'create', ['structure', 'domain'])
    expect(started.sessionId).toBe('session_1')

    // 立刻能读到「运行中」的记录
    const during = await store.get('prj_1')
    expect(during?.lastRun?.status).toBe('running')
    expect(during?.diagrams.structure.status).toBe('running')

    await runner.whenSettled('prj_1')

    const after = await store.get('prj_1')
    expect(after?.lastRun?.status).toBe('succeeded')
    expect(after?.diagrams.structure.status).toBe('ready')
    expect(after?.diagrams.structure.branch).toBe('main')
    // 路径存成相对工作区的 posix 形式，页面拼 URL 才不会错
    expect(after?.diagrams.structure.htmlPath).toBe('prj_1/.archify/structure-demo-1/demo.html')

    // 工具面在这个会话上真的收口了
    expect(scope.tools.restrict).toHaveBeenCalledTimes(1)
    expect(scope.tools.guard).toHaveBeenCalledTimes(1)
    const allow = scope.tools.restrict.mock.calls[0]?.[0] as { allow: string[] }
    expect(allow.allow).toContain('skill')
    expect(allow.allow).not.toContain('web_search')
  })

  test('只有一张图有标记时，另一张记失败而不是假装成功', async () => {
    const project = await seedProject()
    const finalText = await placeArtifacts({ structure: '.archify/structure-demo-1/demo.html' })
    const { ctx } = makeCtx({ finalText })
    const runner = new Runner({ ctx, store, config: config(), skillDir: async () => null })

    await runner.start(project, 'update', ['structure', 'domain'])
    await runner.whenSettled('prj_1')

    const after = await store.get('prj_1')
    expect(after?.diagrams.structure.status).toBe('ready')
    expect(after?.diagrams.domain.status).toBe('failed')
    expect(after?.lastRun?.status).toBe('failed')
  })

  test('标记缺失时用 .archify 目录兜底，而不是空手而归', async () => {
    const project = await seedProject()
    await placeArtifacts({
      structure: '.archify/structure-x-1/x.html',
      domain: '.archify/domain-x-1/x.html',
    })
    const { ctx } = makeCtx({ finalText: '我忘了打标记' })
    const runner = new Runner({ ctx, store, config: config(), skillDir: async () => null })

    await runner.start(project, 'create', ['structure', 'domain'])
    await runner.whenSettled('prj_1')

    const after = await store.get('prj_1')
    expect(after?.diagrams.structure.status).toBe('ready')
    expect(after?.diagrams.domain.status).toBe('ready')
  })

  test('会话拿不到 agent 时把运行标失败，不留永远 running 的记录', async () => {
    const project = await seedProject()
    const { ctx } = makeCtx({ withAgent: false })
    const runner = new Runner({ ctx, store, config: config(), skillDir: async () => null })

    await runner.start(project, 'create', ['structure', 'domain'])
    await runner.whenSettled('prj_1')

    const after = await store.get('prj_1')
    expect(after?.lastRun?.status).toBe('failed')
    expect(after?.lastRun?.error).toContain('会话')
    expect(after?.diagrams.structure.status).toBe('failed')
  })

  test('运行结束写回 todo 与 token 用量，并累加项目总量', async () => {
    const project = await seedProject()
    const finalText = await placeArtifacts({
      structure: '.archify/structure-demo-1/demo.html',
      domain: '.archify/domain-demo-1/demo.html',
    })
    const { ctx } = makeCtx({
      finalText,
      todos: [
        { content: '读代码', status: 'completed' },
        { content: '出图', status: 'in_progress' },
      ],
      usage: {
        uncachedInputTokens: 1200,
        outputTokens: 300,
        cacheReadTokens: 500,
        cacheWriteTokens: 0,
      },
    })
    const runner = new Runner({ ctx, store, config: config(), skillDir: async () => null })
    await runner.start(project, 'create', ['structure', 'domain'])
    await runner.whenSettled('prj_1')

    const after = await store.get('prj_1')
    expect(after?.lastRun?.todos.map((todo) => todo.content)).toEqual(['读代码', '出图'])
    // 成功的运行不允许留 in_progress：agent 收尾时常常来不及再写一次 todo_write，
    // 台账要是原样存着，页面就会永远显示「正在：出图」。
    expect(after?.lastRun?.todos.map((todo) => todo.status)).toEqual(['completed', 'completed'])
    expect(after?.lastRun?.usage).toEqual({
      uncachedInput: 1200,
      output: 300,
      cacheRead: 500,
      cacheWrite: 0,
    })
    expect(after?.usageTotal).toBe(2000)
  })

  test('失败的运行把残留的 in_progress 退回 pending，不假装完成', async () => {
    const project = await seedProject()
    const { ctx } = makeCtx({
      finalText: '',
      todos: [
        { content: '读代码', status: 'completed' },
        { content: '出图', status: 'in_progress' },
      ],
    })
    const runner = new Runner({ ctx, store, config: config(), skillDir: async () => null })
    await runner.start(project, 'create', ['structure', 'domain'])
    await runner.whenSettled('prj_1')

    const after = await store.get('prj_1')
    expect(after?.lastRun?.status).toBe('failed')
    expect(after?.lastRun?.todos.map((todo) => todo.status)).toEqual(['completed', 'pending'])
  })

  test('已有任务在跑时再点一次会被拒（不叠加第二次运行）', async () => {
    const project = await seedProject()
    const { ctx } = makeCtx({ finalText: '' })
    const runner = new Runner({ ctx, store, config: config(), skillDir: async () => null })

    await runner.start(project, 'create', ['structure'])
    await expect(runner.start(project, 'update', ['structure'])).rejects.toThrow(/已有任务/)
    await runner.whenSettled('prj_1')
  })

  test('运行历史按新旧追加', async () => {
    const project = await seedProject()
    const { ctx } = makeCtx({ finalText: '' })
    const runner = new Runner({ ctx, store, config: config(), skillDir: async () => null })

    await runner.start(project, 'create', ['structure'])
    await runner.whenSettled('prj_1')
    const again = (await store.get('prj_1')) as Project
    await runner.start(again, 'regenerate', ['domain'])
    await runner.whenSettled('prj_1')

    const after = await store.get('prj_1')
    expect(after?.runs).toHaveLength(2)
    expect(after?.runs.map((r) => r.kind)).toEqual(['create', 'regenerate'])
  })

  test('自定义图按 id 回收产物，并把 concepts.json 并进概念表', async () => {
    const project = await seedProject()
    const custom = {
      ...project.diagrams.structure,
      id: 'dgm_trace',
      kind: 'custom' as const,
      title: '调用链',
      prompt: '画出更新调用链',
      persistence: 'permanent' as const,
      parentId: null,
      setId: null,
      status: 'idle' as const,
      htmlPath: null,
      specPath: null,
      generatedAt: null,
      branch: null,
      tree: null,
      error: null,
    }
    await store.patch('prj_1', (current) => ({ ...current, custom: [custom] }))
    const full = path.join(projectDir(config(), 'prj_1'), '.archify', 'dgm_trace-1', 'x.html')
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, '<html></html>', 'utf8')
    await writeFile(path.join(path.dirname(full), 'candidate.json'), '{}', 'utf8')
    await writeFile(
      path.join(projectDir(config(), 'prj_1'), 'concepts.json'),
      JSON.stringify({
        concepts: [{ id: 'cpt_a', name: '台账', summary: '唯一真相', evidence: ['src/store.ts'] }],
      }),
      'utf8',
    )
    const { ctx } = makeCtx({ finalText: `ARCHIFY_ARTIFACT dgm_trace ${full}` })
    const runner = new Runner({ ctx, store, config: config(), skillDir: async () => null })
    const latest = (await store.get('prj_1')) as Project
    await runner.start(latest, 'create', ['dgm_trace'])
    await runner.whenSettled('prj_1')
    const after = await store.get('prj_1')
    expect(after?.custom[0]?.status).toBe('ready')
    expect(after?.custom[0]?.htmlPath).toBe('prj_1/.archify/dgm_trace-1/x.html')
    expect(after?.concepts.map((c) => c.id)).toEqual(['cpt_a'])
  })

  test('提问会话只给 read/glob/grep/skill，回答落 qa', async () => {
    const project = await seedProject()
    const { ctx, scope } = makeCtx({
      finalText: '路由注册失败会 warn 并跳过（src/host/index.ts）。',
    })
    const runner = new Runner({ ctx, store, config: config(), skillDir: async () => null })
    const result = await runner.ask(project, 'structure', '路由注册失败会怎样？')
    expect(result.entry.answer).toContain('warn')
    const after = await store.get('prj_1')
    expect(after?.qa).toHaveLength(1)
    expect(after?.qa[0]?.question).toContain('路由注册失败')
    const allow = scope.tools.restrict.mock.calls[0]?.[0] as { allow: string[] }
    expect(allow.allow).toEqual(['read', 'glob', 'grep', 'skill', 'todo_write'])
    expect(allow.allow).not.toContain('bash')
  })
})
