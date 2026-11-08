// @vitest-environment node
/**
 * 台账（projects.json）。
 *
 * 关键行为只有三条，但每条都会「丢用户数据」：
 *   ① 文件不存在时当空台账，不是报错；
 *   ② 文件坏了改名备份后从空开始，绝不静默覆盖；
 *   ③ 并发 mutate 串行化，两次写入不会互相吃掉。
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { ProjectStore } from '../../src/host/store.js'
import { createProject, emptyGitSnapshot, type Project } from '../../src/shared/types.js'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'dap-store-'))
})

function file(name = 'projects.json'): string {
  return path.join(dir, name)
}

function sampleProject(id = 'prj_1'): Project {
  const now = '2026-11-06T12:00:00.000Z'
  return createProject({
    id,
    name: 'Demo',
    repoPath: 'D:/repo',
    now,
    git: emptyGitSnapshot(now),
  })
}

describe('ProjectStore', () => {
  test('文件不存在 = 空台账', async () => {
    const store = new ProjectStore(file())
    await store.load()
    expect(await store.list()).toEqual([])
  })

  test('upsert / get / list / remove 往返', async () => {
    const store = new ProjectStore(file())
    await store.load()
    await store.upsert(sampleProject('prj_a'))
    await store.upsert(sampleProject('prj_b'))
    expect((await store.list()).map((p) => p.id)).toEqual(['prj_a', 'prj_b'])
    expect((await store.get('prj_a'))?.name).toBe('Demo')
    await store.remove('prj_a')
    expect((await store.list()).map((p) => p.id)).toEqual(['prj_b'])
    // 落盘了才算数
    const reloaded = new ProjectStore(file())
    await reloaded.load()
    expect((await reloaded.list()).map((p) => p.id)).toEqual(['prj_b'])
  })

  test('patch 改单个项目并刷新 updatedAt', async () => {
    const store = new ProjectStore(file())
    await store.load()
    await store.upsert(sampleProject('prj_a'))
    const next = await store.patch('prj_a', (current) => ({
      ...current,
      name: '改名了',
      updatedAt: '2026-11-07T00:00:00.000Z',
    }))
    expect(next?.name).toBe('改名了')
    expect((await store.get('prj_a'))?.name).toBe('改名了')
    expect(await store.patch('missing', (c) => c)).toBeUndefined()
  })

  test('坏文件改名备份，从空台账继续，并留下警告', async () => {
    await writeFile(file(), '{ 这不是 json', 'utf8')
    const store = new ProjectStore(file())
    await store.load()
    expect(await store.list()).toEqual([])
    const warnings = store.drainWarnings()
    expect(warnings.join('\n')).toContain('已备份')
    expect(store.drainWarnings()).toEqual([])
  })

  test('并发 mutate 串行，不丢写入', async () => {
    const store = new ProjectStore(file())
    await store.load()
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        store.mutate((ledger) => ({
          ...ledger,
          projects: [...ledger.projects, sampleProject(`prj_${i}`)],
        })),
      ),
    )
    const onDisk = JSON.parse(await readFile(file(), 'utf8')) as { projects: unknown[] }
    expect(onDisk.projects).toHaveLength(8)
  })

  test('读回时对缺字段的项目做归一化，不崩', async () => {
    await writeFile(
      file(),
      JSON.stringify({ version: 1, projects: [{ id: 'prj_x', name: 1, repoPath: null }] }),
      'utf8',
    )
    const store = new ProjectStore(file())
    await store.load()
    const project = await store.get('prj_x')
    // 缺 id/name/repoPath 的项目没有可用身份，归一化时被丢弃
    expect(project).toBeUndefined()
  })

  describe('v1 台账迁移', () => {
    test('老形状（只有两张图、没有 renderer/usage）读进来可用', async () => {
      const legacy = {
        version: 1,
        updatedAt: '2026-11-06T12:00:00.000Z',
        projects: [
          {
            id: 'prj_old',
            name: 'Old',
            repoPath: '/repo',
            createdAt: '2026-11-06T12:00:00.000Z',
            updatedAt: '2026-11-06T12:00:00.000Z',
            git: { ...emptyGitSnapshot('2026-11-06T12:00:00.000Z'), isRepo: true, branch: 'main' },
            diagrams: {
              structure: { status: 'ready', htmlPath: 'a.html', specPath: 'a.json' },
              domain: { status: 'idle' },
            },
            lastRun: null,
            runs: [],
          },
        ],
      }
      await writeFile(file(), JSON.stringify(legacy), 'utf8')
      const store = new ProjectStore(file())
      const project = await store.get('prj_old')
      expect(project?.diagrams.structure.status).toBe('ready')
      expect(project?.custom).toEqual([])
      expect(project?.concepts).toEqual([])
      expect(project?.qa).toEqual([])
      expect(project?.usageTotal).toBe(0)
      // 默认两张图的渲染器是 architecture（archify 的 type），不是 null
      expect(project?.diagrams.structure.renderer).toBe('architecture')
    })

    test('运行记录里的 todos/usage 会被归一化', async () => {
      const project = sampleProject('prj_runs')
      const withRun: Project = {
        ...project,
        usageTotal: 1234,
        runs: [
          {
            id: 'run_1',
            kind: 'update',
            status: 'succeeded',
            sessionId: 's1',
            startedAt: '2026-11-06T12:00:00.000Z',
            finishedAt: '2026-11-06T12:30:00.000Z',
            error: null,
            note: null,
            diagramIds: ['structure'],
            todos: [
              { content: '读代码', status: 'completed' },
              { content: '出图', status: 'in_progress' },
            ],
            usage: { uncachedInput: 100, output: 20, cacheRead: 5, cacheWrite: 0 },
          },
        ],
      }
      const store = new ProjectStore(file())
      await store.upsert(withRun)
      const reloaded = await store.get('prj_runs')
      expect(reloaded?.usageTotal).toBe(1234)
      expect(reloaded?.runs[0]?.todos.map((todo) => todo.status)).toEqual([
        'completed',
        'in_progress',
      ])
      expect(reloaded?.runs[0]?.usage?.output).toBe(20)
    })
  })
})
