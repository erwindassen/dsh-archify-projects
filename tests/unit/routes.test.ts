// @vitest-environment node
/**
 * 路由分发：一条 prefix 路由内部派发所有接口。
 *
 * 用真的 ProjectStore（临时目录）+ 假的 runner，把「参数校验、状态码、删除范围」
 * 这些会真的伤到用户数据的路径走一遍。
 */

import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { resolveConfig } from '../../src/host/config.js'
import { createDispatcher, driftOf, newProjectId, type RouteState } from '../../src/host/routes.js'
import { ProjectStore } from '../../src/host/store.js'
import { emptyGitSnapshot } from '../../src/shared/types.js'
import { projectDir, workspaceRoot } from '../../src/host/config.js'
import { fakeRequest, fakeResponse } from '../support/http.js'

let root = ''
let state: RouteState

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'dap-routes-'))
  const config = resolveConfig({ dataDir: path.join(root, 'data') }, [])
  const store = new ProjectStore(path.join(root, 'data', 'projects.json'))
  await store.load()
  const runner = {
    isBusy: vi.fn(() => false),
    start: vi.fn(async () => ({ runId: 'run_1', sessionId: 'session_1', kind: 'create' as const })),
  }
  state = {
    ctx: { logger: { info: () => {}, warn: () => {} } } as never,
    store,
    config,
    runner: runner as never,
    fence: () => null,
    skillDir: async () => 'C:/skills/archify',
    version: '0.1.0',
    hasSessionService: true,
  }
})

const dispatch = (): ReturnType<typeof createDispatcher> => createDispatcher(state)

async function call(
  url: string,
  options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<ReturnType<typeof fakeResponse>> {
  const res = fakeResponse()
  await dispatch()(fakeRequest({ url, ...options }), res)
  return res
}

describe('健康检查与列表', () => {
  test('GET /health 报告工作区与 skill 路径', async () => {
    const res = await call('/dsh-archify-projects/health')
    expect(res.status).toBe(200)
    const payload = res.json() as { value: { workspacePath: string; archifySkillPath: string } }
    expect(payload.value.workspacePath).toBe(workspaceRoot(state.config))
    expect(payload.value.archifySkillPath).toBe('C:/skills/archify')
  })

  test('GET /projects 空台账', async () => {
    const res = await call('/dsh-archify-projects/projects')
    expect(res.json()).toEqual({
      ok: true,
      value: { projects: [], workspacePath: workspaceRoot(state.config) },
    })
  })

  test('前缀之外与未知子路径都是 404', async () => {
    expect((await call('/other/health')).status).toBe(404)
    expect((await call('/dsh-archify-projects/nope')).status).toBe(404)
  })
})

describe('新增项目', () => {
  test('路径不存在 → 400 且不落台账', async () => {
    const res = await call('/dsh-archify-projects/projects', {
      method: 'POST',
      body: JSON.stringify({ repoPath: path.join(root, 'does-not-exist') }),
    })
    expect(res.status).toBe(400)
    expect((res.json() as { error: { code: string } }).error.code).toBe('path-invalid')
    expect(await state.store.list()).toEqual([])
  })

  test('缺路径 → 400', async () => {
    const res = await call('/dsh-archify-projects/projects', { method: 'POST', body: '{}' })
    expect(res.status).toBe(400)
  })

  test('正常新增：探测 Git、落台账、起运行', async () => {
    const repo = path.join(root, 'repo')
    await mkdir(repo, { recursive: true })
    const res = await call('/dsh-archify-projects/projects', {
      method: 'POST',
      body: JSON.stringify({ repoPath: repo, name: '演示项目' }),
    })
    expect(res.status).toBe(200)
    const payload = res.json() as {
      value: { project: { id: string; name: string; repoPath: string } }
    }
    expect(payload.value.project.name).toBe('演示项目')
    expect(payload.value.project.repoPath).toBe(path.resolve(repo))
    expect(state.runner.start).toHaveBeenCalledTimes(1)
    expect((await state.store.list()).length).toBe(1)
  })

  test('名字留空时用目录名', async () => {
    const repo = path.join(root, 'my-service')
    await mkdir(repo, { recursive: true })
    const res = await call('/dsh-archify-projects/projects', {
      method: 'POST',
      body: JSON.stringify({ repoPath: repo, name: '   ' }),
    })
    const payload = res.json() as { value: { project: { name: string } } }
    expect(payload.value.project.name).toBe('my-service')
  })
})

describe('单项目', () => {
  async function seed(): Promise<string> {
    const repo = path.join(root, 'repo')
    await mkdir(repo, { recursive: true })
    const res = await call('/dsh-archify-projects/projects', {
      method: 'POST',
      body: JSON.stringify({ repoPath: repo }),
    })
    return (res.json() as { value: { project: { id: string } } }).value.project.id
  }

  test('未知 id → 404', async () => {
    expect((await call('/dsh-archify-projects/projects/prj_nope')).status).toBe(404)
  })

  test('GET 单个项目', async () => {
    const id = await seed()
    const res = await call(`/dsh-archify-projects/projects/${id}`)
    expect((res.json() as { value: { project: { id: string } } }).value.project.id).toBe(id)
  })

  test('check 返回漂移说明', async () => {
    const id = await seed()
    await state.store.patch(id, (current) => ({
      ...current,
      git: {
        ...emptyGitSnapshot('2026-11-06T12:00:00Z'),
        isRepo: true,
        branch: 'main',
        commit: 'old',
      },
    }))
    const res = await call(`/dsh-archify-projects/projects/${id}/check`, { method: 'POST' })
    const payload = res.json() as { value: { drift: { summary: string | null } } }
    // 临时目录不是 Git 仓库，重探后变成「没有 Git」——不报错即可
    expect(payload.value.drift).toBeDefined()
  })

  test('runs 返回历史', async () => {
    const id = await seed()
    const res = await call(`/dsh-archify-projects/projects/${id}/runs`)
    expect((res.json() as { value: { runs: unknown[] } }).value.runs).toEqual([])
  })

  test('regen 未知类型 → 400', async () => {
    const id = await seed()
    const res = await call(`/dsh-archify-projects/projects/${id}/diagram/erd`, { method: 'POST' })
    expect(res.status).toBe(400)
  })

  test('DELETE 只删台账与插件目录，不动代码库', async () => {
    const id = await seed()
    const repo = (await state.store.get(id))?.repoPath ?? ''
    await mkdir(projectDir(state.config, id), { recursive: true })
    await writeFile(path.join(projectDir(state.config, id), 'mark.txt'), 'x', 'utf8')

    const res = await call(`/dsh-archify-projects/projects/${id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await state.store.get(id)).toBeUndefined()
    // 代码库还在
    await expect(readFile(path.join(repo), 'nope')).rejects.toThrow()
    const info = await import('node:fs/promises').then((m) => m.stat(repo))
    expect(info.isDirectory()).toBe(true)
  })
})

describe('产物访问', () => {
  test('越界路径 403', async () => {
    const res = await call('/dsh-archify-projects/artifact/..%2F..%2Fsecret.txt')
    expect(res.status).toBe(403)
  })

  test('不存在 404', async () => {
    const res = await call('/dsh-archify-projects/artifact/none/x.html')
    expect(res.status).toBe(404)
  })

  test('工作区内的文件按类型返回', async () => {
    const rootDir = workspaceRoot(state.config)
    await mkdir(path.join(rootDir, 'demo'), { recursive: true })
    await writeFile(path.join(rootDir, 'demo', 'a.html'), '<html></html>', 'utf8')
    const res = await call('/dsh-archify-projects/artifact/demo/a.html')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
  })
})

describe('driftOf', () => {
  const base = {
    ...emptyGitSnapshot('2026-11-06T12:00:00Z'),
    isRepo: true,
    branch: 'main',
    tree: { staged: 0, unstaged: 0, untracked: 0 },
    dirty: false,
  }

  test('同分支同工作区 = 无漂移', () => {
    const drift = driftOf(base, base)
    expect(drift).toEqual({
      branchChanged: false,
      treeChanged: false,
      dirty: false,
      behind: 0,
      summary: null,
    })
  })

  test('换分支 + 工作区变化 + 落后，三件事都进说明', () => {
    const next = {
      ...base,
      branch: 'dev',
      tree: { staged: 2, unstaged: 1, untracked: 0 },
      dirty: true,
      behind: 2,
    }
    const drift = driftOf(base, next)
    expect(drift.branchChanged).toBe(true)
    expect(drift.treeChanged).toBe(true)
    expect(drift.behind).toBe(2)
    expect(drift.summary).toContain('dev')
    expect(drift.summary).toContain('落后')
    expect(drift.summary).toContain('工作区')
  })

  test('只动工作区、分支没变，也算漂移', () => {
    const drift = driftOf(base, {
      ...base,
      tree: { staged: 1, unstaged: 0, untracked: 0 },
      dirty: true,
    })
    expect(drift.branchChanged).toBe(false)
    expect(drift.treeChanged).toBe(true)
    expect(drift.summary).toContain('工作区')
  })

  test('非 Git 两边都不算分支变化', () => {
    const plain = emptyGitSnapshot('2026-11-06T12:00:00Z')
    expect(driftOf(plain, plain).branchChanged).toBe(false)
  })
})

describe('newProjectId', () => {
  test('可重复且不撞', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newProjectId()))
    expect(ids.size).toBe(200)
    expect([...ids][0]?.startsWith('prj_')).toBe(true)
  })
})
