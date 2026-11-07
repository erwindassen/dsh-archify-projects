// @vitest-environment node
/**
 * 共享层：格式化、状态判定、提示词、产物标记解析。
 *
 * 这一层是 host 与 client 的公共地基，坏了两个界面一起错，所以断言写到具体值。
 */

import { describe, expect, test } from 'vitest'
import {
  aheadBehindText,
  archifyDirName,
  diagramTitle,
  formatStamp,
  gitSummary,
  relativeSpan,
  shortCommit,
  slugify,
  tailPath,
} from '../../src/shared/format.js'
import {
  createProject,
  emptyGitSnapshot,
  hasStaleRun,
  isRunning,
  isStale,
  withDiagram,
  type Project,
} from '../../src/shared/types.js'
import { buildRunPrompt, parseArtifactMarkers } from '../../src/shared/prompt.js'

describe('format', () => {
  test('shortCommit 截七位，空值给占位符', () => {
    expect(shortCommit('0123456789abcdef')).toBe('0123456')
    expect(shortCommit(null)).toBe('—')
    expect(shortCommit('')).toBe('—')
  })

  test('formatStamp 是本地时间戳', () => {
    expect(formatStamp(new Date(2026, 10, 6, 13, 5, 9))).toBe('20261106-130509')
  })

  test('relativeSpan 分档，且不拼句子', () => {
    const now = new Date('2026-11-06T12:00:00Z')
    expect(relativeSpan('2026-11-06T11:59:30Z', now)).toEqual({ kind: 'now', value: 0 })
    expect(relativeSpan('2026-11-06T11:30:00Z', now)).toEqual({ kind: 'minutes', value: 30 })
    expect(relativeSpan('2026-11-06T09:00:00Z', now)).toEqual({ kind: 'hours', value: 3 })
    expect(relativeSpan('2026-11-01T12:00:00Z', now)).toEqual({ kind: 'days', value: 5 })
    expect(relativeSpan('2026-01-01T12:00:00Z', now)?.kind).toBe('date')
    expect(relativeSpan(null, now)).toBeNull()
    expect(relativeSpan('not-a-date', now)).toBeNull()
  })

  test('aheadBehindText：都空返回 null，都 0 返回同步', () => {
    expect(aheadBehindText(null, null)).toBeNull()
    expect(aheadBehindText(0, 0)).toBe('同步')
    expect(aheadBehindText(2, 3)).toBe('↑2 ↓3')
    expect(aheadBehindText(0, 1)).toBe('↓1')
  })

  test('gitSummary 区分有无 Git', () => {
    const git = {
      ...emptyGitSnapshot('2026-11-06T12:00:00Z'),
      isRepo: true,
      branch: 'main',
      commit: 'abcdef1234',
    }
    expect(gitSummary(git)).toBe('main @ abcdef1')
    expect(gitSummary(emptyGitSnapshot('2026-11-06T12:00:00Z'))).toContain('非 Git 目录')
  })

  test('slugify 只留 ASCII，空输入回落 project', () => {
    expect(slugify('My Repo!!')).toBe('my-repo')
    expect(slugify('中文仓库')).toBe('project')
    expect(slugify('--a--b--')).toBe('a-b')
  })

  test('archifyDirName 与 Skill 约定一致', () => {
    expect(archifyDirName('structure', 'My Repo', '20261106-130509')).toBe(
      'structure-my-repo-20261106-130509',
    )
    expect(diagramTitle('domain')).toBe('领域图')
  })

  test('tailPath 只留末两段', () => {
    expect(tailPath('D:/a/b/c', 2)).toBe('…/b/c')
    expect(tailPath('D:/a', 2)).toBe('D:/a')
  })
})

describe('types', () => {
  const now = '2026-11-06T12:00:00.000Z'

  test('createProject 给全默认值', () => {
    const project = createProject({
      id: 'prj_1',
      name: 'Demo',
      repoPath: 'D:/repo',
      now,
      git: emptyGitSnapshot(now),
    })
    expect(project.diagrams.structure.status).toBe('idle')
    expect(project.runs).toEqual([])
    expect(project.lastRun).toBeNull()
    expect(project.createdAt).toBe(now)
  })

  test('isRunning 看运行历史里有没有 running', () => {
    const base = createProject({
      id: 'prj_1',
      name: 'Demo',
      repoPath: 'D:/repo',
      now,
      git: emptyGitSnapshot(now),
    })
    expect(isRunning(base)).toBe(false)
    const busy: Project = {
      ...base,
      runs: [
        {
          id: 'run_1',
          kind: 'update',
          status: 'running',
          sessionId: 's1',
          startedAt: now,
          finishedAt: null,
          error: null,
          note: null,
        },
      ],
    }
    // 传固定的「当下」：真实时间里这条 2026-11-06 的 running 早已过期，
    // 用 Date.now() 会让这个用例在第二天起就一直失败。
    expect(isRunning(busy, Date.parse(now) + 60_000)).toBe(true)
  })

  test('isStale 只在已就绪且提交不同时为真', () => {
    const git = { ...emptyGitSnapshot(now), isRepo: true, branch: 'main', commit: 'aaa' }
    const project = createProject({ id: 'p', name: 'n', repoPath: 'D:/r', now, git })
    expect(isStale(project)).toBe(false)
    const ready = withDiagram(project, 'structure', {
      status: 'ready',
      htmlPath: 'a.html',
      specPath: 'a.json',
      generatedAt: now,
      branch: 'main',
      commit: 'aaa',
      error: null,
    })
    expect(isStale(ready)).toBe(false)
    const newer = { ...ready, git: { ...ready.git, commit: 'bbb' } }
    expect(isStale(newer)).toBe(true)
  })
})

describe('prompt', () => {
  const kinds = ['structure', 'domain'] as const

  test('提示词自包含：环境事实、两类图谱口径、产物标记都在', () => {
    const text = buildRunPrompt({
      projectName: 'Demo',
      repoPath: 'D:/repo',
      workspaceDir: 'C:/ws/demo',
      git: {
        ...emptyGitSnapshot('2026-11-06T12:00:00Z'),
        isRepo: true,
        branch: 'main',
        commit: 'abcdef1234',
      },
      kinds,
      stamp: '20261106-130509',
      archifySkillPath: 'C:/skills/archify',
      previous: { structure: null, domain: null },
    })
    expect(text).toContain('D:/repo')
    expect(text).toContain('C:/ws/demo')
    expect(text).toContain('main')
    expect(text).toContain('abcdef1')
    expect(text).toContain('C:/skills/archify')
    expect(text).toContain('ARCHIFY_ARTIFACT structure')
    expect(text).toContain('ARCHIFY_ARTIFACT domain')
    // 只跑一张图时不该要求另一张
    const onlyDomain = buildRunPrompt({
      projectName: 'Demo',
      repoPath: 'D:/repo',
      workspaceDir: 'C:/ws/demo',
      git: emptyGitSnapshot('2026-11-06T12:00:00Z'),
      kinds: ['domain'],
      stamp: '20261106-130509',
      archifySkillPath: null,
      previous: { structure: null, domain: null },
    })
    expect(onlyDomain).not.toContain('ARCHIFY_ARTIFACT structure')
    expect(onlyDomain).toContain('ARCHIFY_ARTIFACT domain')
  })

  test('skill 缺失时降级说明出现，而不是空口让人去调 skill', () => {
    const text = buildRunPrompt({
      projectName: 'Demo',
      repoPath: 'D:/repo',
      workspaceDir: 'C:/ws/demo',
      git: emptyGitSnapshot('2026-11-06T12:00:00Z'),
      kinds,
      stamp: '20261106-130509',
      archifySkillPath: null,
      previous: { structure: null, domain: null },
    })
    expect(text).toContain('skill')
    expect(text.toLowerCase()).toContain('.archify')
  })

  test('非 Git 目录不再要求切分支', () => {
    const text = buildRunPrompt({
      projectName: 'Demo',
      repoPath: 'D:/repo',
      workspaceDir: 'C:/ws/demo',
      git: emptyGitSnapshot('2026-11-06T12:00:00Z'),
      kinds,
      stamp: '20261106-130509',
      archifySkillPath: 'C:/skills/archify',
      previous: { structure: null, domain: null },
    })
    expect(text).toContain('不是 Git 仓库')
  })

  test('parseArtifactMarkers 大小写无关、去引号、后者优先', () => {
    const text = [
      'ARCHIFY_ARTIFACT structure "C:/ws/demo/.archify/structure-a/x.html"',
      '```',
      'archify_artifact DOMAIN C:/ws/demo/.archify/domain-b/y.html',
      '```',
      'ARCHIFY_ARTIFACT structure `C:/ws/demo/.archify/structure-c/z.html`',
    ].join('\n')
    const markers = parseArtifactMarkers(text)
    expect(markers.domain).toBe('C:/ws/demo/.archify/domain-b/y.html')
    expect(markers.structure).toBe('C:/ws/demo/.archify/structure-c/z.html')
  })

  test('parseArtifactMarkers 忽略行内提及与未知类型', () => {
    const text = [
      '我会把结果写进 ARCHIFY_ARTIFACT 行。',
      'ARCHIFY_ARTIFACT erd C:/x/y.html',
      'ARCHIFY_ARTIFACT structure',
    ].join('\n')
    expect(parseArtifactMarkers(text)).toEqual({})
  })
})

describe('prompt：Git 事实块与旧产物提示', () => {
  const base = {
    projectName: 'Demo',
    repoPath: 'D:/repo',
    workspaceDir: 'C:/ws/demo',
    kinds: ['structure', 'domain'] as const,
    stamp: '20261106-130509',
    archifySkillPath: 'C:/skills/archify',
  }

  test('完整事实块：提交信息、时间、上游、脏工作区、detached', () => {
    const text = buildRunPrompt({
      ...base,
      git: {
        ...emptyGitSnapshot('2026-11-06T12:00:00Z'),
        isRepo: true,
        branch: null,
        detached: true,
        commit: 'abcdef1',
        commitFull: 'abcdef1234567890',
        commitSubject: 'feat: 初始化',
        commitTime: '2026-11-06T10:00:00+08:00',
        upstream: 'origin/main',
        dirty: true,
      },
      previous: { structure: 'abcdef1', domain: null },
    })
    expect(text).toContain('detached HEAD')
    expect(text).toContain('feat: 初始化')
    expect(text).toContain('2026-11-06T10:00:00+08:00')
    expect(text).toContain('origin/main')
    expect(text).toContain('未提交改动')
    // 有旧产物的那张要提示重新取证，没有的说没生成过
    expect(text).toContain('上一版基于提交 `abcdef1`')
    expect(text).toContain('这张图以前没生成过')
  })

  test('提交信息/时间/上游缺失时不写占位行', () => {
    const text = buildRunPrompt({
      ...base,
      git: {
        ...emptyGitSnapshot('2026-11-06T12:00:00Z'),
        isRepo: true,
        branch: 'main',
        commit: 'abcdef1',
      },
      previous: {},
    })
    expect(text).toContain('- 分支：main')
    expect(text).not.toContain('- 提交信息：')
    expect(text).not.toContain('- 上游：')
  })
})

describe('isRunning：宿主被 kill 留下的 running 不该把页面锁死', () => {
  const base = createProject({
    id: 'prj_stale',
    name: 'Stale',
    repoPath: 'D:/repo',
    now: '2026-11-07T05:00:00.000Z',
    git: emptyGitSnapshot('2026-11-07T05:00:00.000Z'),
  })
  const withRun = (startedAt: string): Project => ({
    ...base,
    runs: [
      {
        id: 'run_x',
        kind: 'update',
        status: 'running',
        sessionId: null,
        startedAt,
        finishedAt: null,
        error: null,
        note: null,
      },
    ],
  })

  test('刚开始的运行算在跑', () => {
    const now = Date.parse('2026-11-07T05:05:00.000Z')
    expect(isRunning(withRun('2026-11-07T05:00:00.000Z'), now)).toBe(true)
    expect(hasStaleRun(withRun('2026-11-07T05:00:00.000Z'), now)).toBe(false)
  })

  test('过了阈值就不再算在跑，且被认成过期', () => {
    const now = Date.parse('2026-11-07T09:00:00.000Z')
    expect(isRunning(withRun('2026-11-07T05:00:00.000Z'), now)).toBe(false)
    expect(hasStaleRun(withRun('2026-11-07T05:00:00.000Z'), now)).toBe(true)
  })

  test('时间戳坏了按过期处理，不按活着处理', () => {
    const now = Date.parse('2026-11-07T09:00:00.000Z')
    expect(isRunning(withRun('not-a-date'), now)).toBe(false)
  })
})
