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
import { emptyGitSnapshot, type Project } from '../../src/shared/types.js'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'dap-store-'))
})

function file(name = 'projects.json'): string {
  return path.join(dir, name)
}

function sampleProject(id = 'prj_1'): Project {
  const now = '2026-11-06T12:00:00.000Z'
  return {
    id,
    name: 'Demo',
    repoPath: 'D:/repo',
    createdAt: now,
    updatedAt: now,
    git: emptyGitSnapshot(now),
    diagrams: {
      structure: {
        status: 'idle',
        htmlPath: null,
        specPath: null,
        generatedAt: null,
        branch: null,
        commit: null,
        error: null,
      },
      domain: {
        status: 'idle',
        htmlPath: null,
        specPath: null,
        generatedAt: null,
        branch: null,
        commit: null,
        error: null,
      },
    },
    lastRun: null,
    runs: [],
  }
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
})
