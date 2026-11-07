// @vitest-environment node
/**
 * Git 层：解析纯函数 + 用假 exec 驱动的探测与同步。
 *
 * 这一层决定「项目记录的分支与 commit 准不准」，也决定「更新会不会动坏用户的工作区」，
 * 所以每条分支都要有用例：非 Git、脏工作区、切分支失败、快进失败。
 */

import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import {
  gitExec,
  parseAheadBehind,
  parseLog,
  probeGit,
  syncToLatest,
  type GitExec,
  type GitResult,
} from '../../src/host/git.js'

const ok = (stdout: string): GitResult => ({ code: 0, stdout, stderr: '' })
const bad = (stderr = 'fatal'): GitResult => ({ code: 1, stdout: '', stderr })

/** 用「命令 → 结果」表造一个假 exec，顺带记录调用顺序。 */
function fakeExec(table: Record<string, GitResult>, calls: string[] = []): GitExec {
  return async (args) => {
    const key = args.join(' ')
    calls.push(key)
    const hit = table[key]
    if (hit === undefined) return bad(`unexpected: ${key}`)
    return hit
  }
}

/** 一个健康的仓库基线。 */
function healthyTable(overrides: Record<string, GitResult> = {}): Record<string, GitResult> {
  return {
    'rev-parse --show-toplevel': ok('D:/repo\n'),
    'rev-parse --abbrev-ref HEAD': ok('main\n'),
    'rev-parse HEAD': ok('abcdef1234567890\n'),
    'log -1 --format=%cI%n%s': ok('2026-11-06T10:00:00+08:00\nfeat: 初始化\n'),
    'rev-parse --abbrev-ref --symbolic-full-name @{u}': ok('origin/main\n'),
    'status --porcelain': ok(''),
    'remote get-url origin': ok('git@example.com:repo.git\n'),
    'rev-list --left-right --count HEAD...@{u}': ok('2\t1\n'),
    'merge --ff-only @{u}': ok('Fast-forward'),
    ...overrides,
  }
}

describe('parseLog', () => {
  test('拆出时间与标题', () => {
    expect(parseLog('2026-11-06T10:00:00+08:00\nfeat: 初始化\n')).toEqual({
      commitTime: '2026-11-06T10:00:00+08:00',
      commitSubject: 'feat: 初始化',
    })
  })

  test('只有时间时不编造标题', () => {
    expect(parseLog('2026-11-06T10:00:00+08:00')).toEqual({
      commitTime: '2026-11-06T10:00:00+08:00',
      commitSubject: null,
    })
  })

  test('空输出', () => {
    expect(parseLog('')).toEqual({ commitTime: null, commitSubject: null })
  })
})

describe('parseAheadBehind', () => {
  test('制表分隔的两个数字', () => {
    expect(parseAheadBehind('3\t5\n')).toEqual({ ahead: 3, behind: 5 })
  })
  test('无法解析时给 null，不假装同步', () => {
    expect(parseAheadBehind('')).toEqual({ ahead: null, behind: null })
    expect(parseAheadBehind('garbage')).toEqual({ ahead: null, behind: null })
  })
})

describe('probeGit', () => {
  const now = '2026-11-06T12:00:00.000Z'

  test('非 Git 目录返回空快照，不抛', async () => {
    const snapshot = await probeGit('D:/plain', now, fakeExec({}))
    expect(snapshot.isRepo).toBe(false)
    expect(snapshot.branch).toBeNull()
    expect(snapshot.checkedAt).toBe(now)
  })

  test('正常仓库：分支、提交、上游、ahead/behind、脏标记', async () => {
    const snapshot = await probeGit(
      'D:/repo',
      now,
      fakeExec(healthyTable({ 'status --porcelain': ok(' M a.ts\n') })),
    )
    expect(snapshot.isRepo).toBe(true)
    expect(snapshot.root).toBe('D:/repo')
    expect(snapshot.branch).toBe('main')
    expect(snapshot.commit).toBe('abcdef1234567890')
    expect(snapshot.commitSubject).toBe('feat: 初始化')
    expect(snapshot.upstream).toBe('origin/main')
    expect(snapshot.dirty).toBe(true)
    expect(snapshot.ahead).toBe(2)
    expect(snapshot.behind).toBe(1)
    expect(snapshot.remoteUrl).toBe('git@example.com:repo.git')
  })

  test('没有上游时 ahead/behind 为 null（不谎报同步）', async () => {
    const snapshot = await probeGit(
      'D:/repo',
      now,
      fakeExec(
        healthyTable({
          'rev-parse --abbrev-ref --symbolic-full-name @{u}': bad(),
          'rev-list --left-right --count HEAD...@{u}': bad(),
        }),
      ),
    )
    expect(snapshot.upstream).toBeNull()
    expect(snapshot.ahead).toBeNull()
    expect(snapshot.behind).toBeNull()
  })

  test('可选命令全失败时仍给出一份可用的快照（字段为 null，不抛）', async () => {
    const snapshot = await probeGit(
      'D:/repo',
      now,
      fakeExec({
        'rev-parse --show-toplevel': ok('D:/repo\n'),
        'rev-parse --abbrev-ref HEAD': bad(),
        'rev-parse HEAD': bad(),
        'log -1 --format=%cI%n%s': bad(),
        'rev-parse --abbrev-ref --symbolic-full-name @{u}': bad(),
        'status --porcelain': bad(),
        'remote get-url origin': bad(),
      }),
    )
    expect(snapshot.isRepo).toBe(true)
    expect(snapshot.branch).toBeNull()
    expect(snapshot.commit).toBeNull()
    expect(snapshot.commitSubject).toBeNull()
    expect(snapshot.commitTime).toBeNull()
    expect(snapshot.remoteUrl).toBeNull()
    expect(snapshot.dirty).toBeNull()
  })

  test('空 toplevel 输出按非仓库处理', async () => {
    const snapshot = await probeGit(
      'D:/repo',
      now,
      fakeExec({ 'rev-parse --show-toplevel': ok('\n') }),
    )
    expect(snapshot.isRepo).toBe(false)
  })

  test('detached HEAD 单独标记', async () => {
    const snapshot = await probeGit(
      'D:/repo',
      now,
      fakeExec(healthyTable({ 'rev-parse --abbrev-ref HEAD': ok('HEAD\n') })),
    )
    expect(snapshot.detached).toBe(true)
    expect(snapshot.branch).toBeNull()
  })
})

describe('syncToLatest', () => {
  test('非 Git 目录直接跳过', async () => {
    const result = await syncToLatest('D:/plain', null, fakeExec({}))
    expect(result).toEqual({ skipped: true, reason: 'no-git', from: null, to: null })
  })

  test('脏工作区不动用户文件', async () => {
    const calls: string[] = []
    const result = await syncToLatest(
      'D:/repo',
      'main',
      fakeExec(healthyTable({ 'status --porcelain': ok(' M a.ts\n') }), calls),
    )
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('dirty')
    // 关键：既不 fetch 也不 checkout
    expect(calls.some((c) => c.startsWith('fetch'))).toBe(false)
    expect(calls.some((c) => c.startsWith('checkout'))).toBe(false)
  })

  test('有远端就 fetch，且只在分支不同时 checkout', async () => {
    const calls: string[] = []
    const result = await syncToLatest('D:/repo', 'main', fakeExec(healthyTable(), calls))
    expect(calls).toContain('fetch --all --prune')
    expect(calls.some((c) => c.startsWith('checkout'))).toBe(false)
    expect(result.skipped).toBe(false)
  })

  test('记录的分支与当前不同就切回去', async () => {
    const calls: string[] = []
    const table = healthyTable()
    table['rev-parse --abbrev-ref HEAD'] = ok('feature/x\n')
    table['checkout main'] = ok('')
    await syncToLatest('D:/repo', 'main', fakeExec(table, calls))
    expect(calls).toContain('checkout main')
  })

  test('切分支失败要把原因带出来，不假装成功', async () => {
    const table = healthyTable()
    table['rev-parse --abbrev-ref HEAD'] = ok('feature/x\n')
    table['checkout main'] = bad('error: local changes')
    const result = await syncToLatest('D:/repo', 'main', fakeExec(table))
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('checkout-failed')
  })

  test('快进失败（本地有分叉）报 ff-failed', async () => {
    const table = healthyTable()
    table['merge --ff-only @{u}'] = bad('fatal: Not possible to fast-forward')
    const result = await syncToLatest('D:/repo', 'main', fakeExec(table))
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('ff-failed')
  })
})

describe('gitExec（真 git 子进程）', () => {
  test('成功命令走 resolve 而不是 reject', async () => {
    const result = await gitExec(['--version'], tmpdir())
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('git version')
  })

  test('工作目录不存在时把错误折成非 0（error.code 是字符串的分支）', async () => {
    const result = await gitExec(['rev-parse', '--show-toplevel'], 'D:/definitely/not/here/dap')
    expect(result.code).not.toBe(0)
    expect(result.stderr.length).toBeGreaterThan(0)
  })

  test('非仓库目录返回非 0，而不是抛异常', async () => {
    const result = await gitExec(['rev-parse', '--show-toplevel'], tmpdir())
    expect(result.code).not.toBe(0)
    expect(typeof result.stderr).toBe('string')
  })

  test('探测一个非仓库目录给出 isRepo=false 的快照', async () => {
    const snapshot = await probeGit(tmpdir(), '2026-11-06T12:00:00.000Z')
    expect(snapshot.isRepo).toBe(false)
    expect(snapshot.checkedAt).toBe('2026-11-06T12:00:00.000Z')
  })
})
