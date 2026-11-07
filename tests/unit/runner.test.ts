// @vitest-environment node
/**
 * 运行编排里能脱离宿主验证的那部分：产物回收、运行历史、超时。
 *
 * 真正跑 agent 的那段（建会话 → 投 prompt → whenIdle）必须有宿主，
 * 属于集成测试的范围；这里把「找产物」和「记历史」这两件容易出错的事钉死。
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { resolveConfig, projectDir } from '../../src/host/config.js'
import { discoverArtifacts, newRunId, pushRun, withTimeout } from '../../src/host/runner.js'
import type { RunRecord } from '../../src/shared/types.js'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'dap-runner-'))
})

const config = (): ReturnType<typeof resolveConfig> =>
  resolveConfig({ dataDir: path.join(root, 'data') }, [])

function run(id: string, status: RunRecord['status'] = 'running'): RunRecord {
  return {
    id,
    kind: 'update',
    status,
    sessionId: 's1',
    startedAt: '2026-11-06T12:00:00.000Z',
    finishedAt: null,
    error: null,
    note: null,
    diagramIds: [],
  }
}

describe('discoverArtifacts', () => {
  async function place(projectId: string, dir: string, file: string): Promise<string> {
    const target = path.join(projectDir(config(), projectId), '.archify', dir)
    await mkdir(target, { recursive: true })
    const full = path.join(target, file)
    await writeFile(full, '<html></html>', 'utf8')
    return full
  }

  test('按目录名前缀归类', async () => {
    await place('prj_a', 'structure-demo-20260101-000000', 'demo.html')
    await place('prj_a', 'domain-demo-20260101-000000', 'demo.html')
    const found = await discoverArtifacts(config(), 'prj_a', ['structure', 'domain'])
    expect(found.get('structure')).toContain('structure-demo')
    expect(found.get('domain')).toContain('domain-demo')
  })

  test('architecture- 前缀算结构图（archify 的 type 叫 architecture）', async () => {
    await place('prj_b', 'architecture-demo-20260101-000000', 'demo.html')
    const found = await discoverArtifacts(config(), 'prj_b', ['structure', 'domain'])
    expect(found.get('structure')).toContain('architecture-demo')
  })

  test('自定义图按 id 前缀归类', async () => {
    await place('prj_d', 'dgm_trace-20260101-000000', 'trace.html')
    const found = await discoverArtifacts(config(), 'prj_d', ['dgm_trace'])
    expect(found.get('dgm_trace')).toContain('dgm_trace-20260101')
  })

  test('没有 .archify 目录时返回空，不抛', async () => {
    const found = await discoverArtifacts(config(), 'prj_none', [])
    expect(found.size).toBe(0)
  })

  test('目录里没有 html 就跳过', async () => {
    const dir = path.join(projectDir(config(), 'prj_c'), '.archify', 'structure-x-1')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'candidate.json'), '{}', 'utf8')
    expect((await discoverArtifacts(config(), 'prj_c', ['structure'])).size).toBe(0)
  })
})

describe('pushRun', () => {
  test('追加并保留时间顺序', () => {
    const next = pushRun([run('a')], run('b', 'succeeded'), 10)
    expect(next.map((r) => r.id)).toEqual(['a', 'b'])
  })

  test('同 id 覆盖而不是重复', () => {
    const next = pushRun([run('a'), run('b')], { ...run('b'), status: 'succeeded' }, 10)
    expect(next).toHaveLength(2)
    expect(next.find((r) => r.id === 'b')?.status).toBe('succeeded')
  })

  test('超过上限丢最旧的', () => {
    let runs: readonly RunRecord[] = []
    for (const id of ['a', 'b', 'c']) runs = pushRun(runs, run(id), 2)
    expect(runs.map((r) => r.id)).toEqual(['b', 'c'])
  })
})

describe('withTimeout', () => {
  test('正常完成时把值透出来', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42)
  })

  test('超时给出可读错误', async () => {
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toThrow(/超时/)
  })

  test('原 promise 失败时错误不被吞掉', async () => {
    await expect(withTimeout(Promise.reject(new Error('agent 蹦了')), 1000)).rejects.toThrow(
      'agent 蹦了',
    )
  })
})

describe('newRunId', () => {
  test('带前缀且不重复', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newRunId()))
    expect(ids.size).toBe(100)
    for (const id of ids) expect(id.startsWith('run_')).toBe(true)
  })
})

describe('reconcileArtifacts：开库收尸', () => {
  async function seed(
    projectId: string,
    opts: {
      status?: 'idle' | 'running' | 'ready' | 'failed'
      runStatus?: RunRecord['status'] | null
      html?: boolean
    } = {},
  ): Promise<import('../../src/host/store.js').ProjectStore> {
    const { ProjectStore } = await import('../../src/host/store.js')
    const { createProject, emptyGitSnapshot } = await import('../../src/shared/types.js')
    const store = new ProjectStore(path.join(root, 'data', 'projects.json'))
    const project = createProject({
      id: projectId,
      name: projectId,
      repoPath: path.join(root, 'repo', projectId),
      now: '2026-11-07T00:00:00.000Z',
      git: emptyGitSnapshot('2026-11-07T00:00:00.000Z'),
    })
    const status = opts.status ?? 'running'
    const diagram = { ...project.diagrams.structure, status }
    const runRecord =
      opts.runStatus === null ? null : run(projectId + '-run', opts.runStatus ?? 'running')
    await store.upsert({
      ...project,
      diagrams: { structure: diagram, domain: { ...project.diagrams.domain } },
      lastRun: runRecord,
      runs: runRecord === null ? [] : [runRecord],
    })
    if (opts.html !== false) {
      const dir = path.join(
        projectDir(config(), projectId),
        '.archify',
        'structure-x-20260101-000000',
      )
      await mkdir(dir, { recursive: true })
      await writeFile(path.join(dir, 'x.html'), '<html></html>', 'utf8')
    }
    return store
  }

  test('卡在 running 的运行被标成失败，并给出原因', async () => {
    const { reconcileArtifacts } = await import('../../src/host/runner.js')
    const store = await seed('prj_orphan')
    await reconcileArtifacts(store, config())
    const project = await store.get('prj_orphan')
    expect(project?.lastRun?.status).toBe('failed')
    expect(project?.lastRun?.error).toContain('宿主重启')
    expect(project?.runs[0]?.status).toBe('failed')
    expect(project?.runs[0]?.finishedAt).not.toBeNull()
  })

  test('有产物就认领成 ready，不因为那次运行中断而丢掉结果', async () => {
    const { reconcileArtifacts } = await import('../../src/host/runner.js')
    const store = await seed('prj_salvage')
    await reconcileArtifacts(store, config())
    const project = await store.get('prj_salvage')
    expect(project?.diagrams.structure.status).toBe('ready')
    expect(project?.diagrams.structure.htmlPath).toContain('structure-x')
    expect(project?.lastRun?.status).toBe('failed')
  })

  test('没产物又没中断过的就放着不动', async () => {
    const { reconcileArtifacts } = await import('../../src/host/runner.js')
    const store = await seed('prj_clean', {
      status: 'ready',
      runStatus: 'succeeded',
      html: false,
    })
    const before = await store.get('prj_clean')
    await reconcileArtifacts(store, config())
    expect((await store.get('prj_clean'))?.updatedAt).toBe(before?.updatedAt)
  })
})
