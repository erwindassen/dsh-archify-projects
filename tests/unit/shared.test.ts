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
  estimateCost,
  formatStamp,
  formatTokens,
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
import { buildAskPrompt, buildRunPrompt, parseArtifactMarkers } from '../../src/shared/prompt.js'

describe('format', () => {
  test('shortCommit 截七位，空值给占位符', () => {
    expect(shortCommit('0123456789abcdef')).toBe('0123456')
    expect(shortCommit(null)).toBe('—')
    expect(shortCommit('')).toBe('—')
  })

  test('formatTokens 用紧凑写法', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1234)).toBe('1.2k')
    expect(formatTokens(12_000)).toBe('12k')
    expect(formatTokens(12_300_000)).toBe('12.3M')
  })

  test('estimateCost 按每百万 token 单价折算，没配单价就不算', () => {
    const usage = { uncachedInput: 1_000_000, output: 500_000, cacheRead: 0, cacheWrite: 0 }
    const pricing = { inputPerMTok: 2, outputPerMTok: 8, cacheReadPerMTok: 0.5 }
    expect(estimateCost(usage, pricing)).toBeCloseTo(6)
    expect(estimateCost(usage, null)).toBeNull()
    expect(estimateCost(null, pricing)).toBeNull()
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

  test('isStale 看分支与工作区，不看 commit', () => {
    const tree = { staged: 0, unstaged: 0, untracked: 0 }
    const git = { ...emptyGitSnapshot(now), isRepo: true, branch: 'main', commit: 'aaa', tree }
    const project = createProject({ id: 'p', name: 'n', repoPath: 'D:/r', now, git })
    expect(isStale(project)).toBe(false)
    const ready = withDiagram(project, {
      ...project.diagrams.structure,
      status: 'ready',
      htmlPath: 'a.html',
      specPath: 'a.json',
      generatedAt: now,
      branch: 'main',
      tree,
    })
    expect(isStale(ready)).toBe(false)
    const branchChanged = { ...ready, git: { ...ready.git, branch: 'dev' } }
    expect(isStale(branchChanged)).toBe(true)
    const treeChanged = {
      ...ready,
      git: { ...ready.git, tree: { staged: 1, unstaged: 0, untracked: 0 } },
    }
    expect(isStale(treeChanged)).toBe(true)
    // 只是新 commit、分支与工作区都没变 -> 不算过期（v2 的版本键不看 commit）
    const commitMoved = { ...ready, git: { ...ready.git, commit: 'bbb' } }
    expect(isStale(commitMoved)).toBe(false)
  })
})

describe('prompt', () => {
  const diagram = (
    id: string,
    kind: 'structure' | 'domain' | 'custom',
    prompt: string | null = null,
  ) => ({
    id,
    kind,
    title: id,
    prompt,
    persistence: 'permanent' as const,
    conceptIds: [],
    renderer: null,
    pathScope: [],
  })

  const base = {
    projectName: 'Demo',
    repoPath: 'D:/repo',
    workspaceDir: 'C:/ws/demo',
    stamp: '20261106-130509',
    archifySkillPath: 'C:/skills/archify',
    concepts: [],
    previous: {},
  }

  test('提示词自包含：环境事实、两类图谱口径、产物标记都在', () => {
    const text = buildRunPrompt({
      ...base,
      git: {
        ...emptyGitSnapshot('2026-11-06T12:00:00Z'),
        isRepo: true,
        branch: 'main',
        commit: 'abcdef1234',
      },
      diagrams: [diagram('structure', 'structure'), diagram('domain', 'domain')],
    })
    expect(text).toContain('D:/repo')
    expect(text).toContain('C:/ws/demo')
    expect(text).toContain('main')
    expect(text).toContain('C:/skills/archify')
    expect(text).toContain('ARCHIFY_ARTIFACT structure')
    expect(text).toContain('ARCHIFY_ARTIFACT domain')
    expect(text).toContain('concepts.json')

    const onlyDomain = buildRunPrompt({
      ...base,
      git: emptyGitSnapshot('2026-11-06T12:00:00Z'),
      archifySkillPath: null,
      diagrams: [diagram('domain', 'domain')],
    })
    expect(onlyDomain).not.toContain('ARCHIFY_ARTIFACT structure')
    expect(onlyDomain).toContain('ARCHIFY_ARTIFACT domain')
  })

  test('自定义图会把自己的 prompt 原样带进去', () => {
    const text = buildRunPrompt({
      ...base,
      git: emptyGitSnapshot('2026-11-06T12:00:00Z'),
      diagrams: [diagram('dgm_trace', 'custom', '画出一次更新的调用链，标出失败分支')],
    })
    expect(text).toContain('画出一次更新的调用链，标出失败分支')
    expect(text).toContain('ARCHIFY_ARTIFACT dgm_trace')
  })

  test('选了渲染器与目录范围时写死约束', () => {
    const text = buildRunPrompt({
      ...base,
      git: emptyGitSnapshot('2026-11-06T12:00:00Z'),
      diagrams: [
        {
          ...diagram('dgm_seq', 'custom', '画出一次更新'),
          renderer: 'sequence',
          pathScope: ['src/host', 'src/shared'],
        },
      ],
    })
    expect(text).toContain('必须使用 `sequence`')
    expect(text).toContain('只看这些目录')
    expect(text).toContain('src/host')
    expect(text).toContain('src/shared')
  })

  test('没选渲染器时让 agent 自己判断，范围默认全仓库', () => {
    const text = buildRunPrompt({
      ...base,
      git: emptyGitSnapshot('2026-11-06T12:00:00Z'),
      diagrams: [diagram('structure', 'structure')],
    })
    expect(text).toContain('由你按 prompt 自行选择')
    expect(text).toContain('取证范围：全仓库')
  })

  test('skill 缺失时降级说明出现，而不是空口让人去调 skill', () => {
    const text = buildRunPrompt({
      ...base,
      git: emptyGitSnapshot('2026-11-06T12:00:00Z'),
      archifySkillPath: null,
      diagrams: [diagram('structure', 'structure'), diagram('domain', 'domain')],
    })
    expect(text).toContain('skill')
    expect(text.toLowerCase()).toContain('.archify')
  })

  test('非 Git 目录不再要求切分支', () => {
    const text = buildRunPrompt({
      ...base,
      git: emptyGitSnapshot('2026-11-06T12:00:00Z'),
      diagrams: [diagram('structure', 'structure')],
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
    expect(markers.get('domain')).toBe('C:/ws/demo/.archify/domain-b/y.html')
    expect(markers.get('structure')).toBe('C:/ws/demo/.archify/structure-c/z.html')
  })

  test('parseArtifactMarkers 忽略行内提及与缺路径', () => {
    const text = ['我会把结果写进 ARCHIFY_ARTIFACT 行。', 'ARCHIFY_ARTIFACT structure'].join('\n')
    expect(parseArtifactMarkers(text).size).toBe(0)
  })

  test('已有概念会进提示词，让 agent 复用而不是重造', () => {
    const text = buildRunPrompt({
      ...base,
      git: emptyGitSnapshot('2026-11-06T12:00:00Z'),
      diagrams: [diagram('structure', 'structure')],
      concepts: [
        {
          id: 'cpt_ledger',
          name: '项目台账',
          summary: 'projects.json 是唯一真相',
          evidence: ['src/host/store.ts'],
          tags: [],
          updatedAt: '2026-11-06T00:00:00.000Z',
        },
      ],
    })
    expect(text).toContain('cpt_ledger')
    expect(text).toContain('项目台账')
    expect(text).toContain('src/host/store.ts')
  })

  test('问答提示词：只给这张图、概念与代码库，并要求建议补图', () => {
    const text = buildAskPrompt({
      projectName: 'Demo',
      repoPath: '/work/demo',
      diagram: { ...diagram('structure', 'structure'), conceptIds: ['cpt_a'] },
      concepts: [
        {
          id: 'cpt_a',
          name: '台账',
          summary: '唯一真相',
          evidence: ['src/store.ts'],
          tags: [],
          updatedAt: '2026-11-06T00:00:00.000Z',
        },
      ],
      candidate: '{"nodes":[]}',
      question: '路由注册失败会怎样？',
    })
    expect(text).toContain('/work/demo')
    expect(text).toContain('路由注册失败会怎样？')
    expect(text).toContain('cpt_a')
    expect(text).toContain('建议补进图里的节点/关系')
    expect(text).toContain('{"nodes":[]}')
  })

  test('问答提示词：没有 candidate 与概念时给明确兜底', () => {
    const text = buildAskPrompt({
      projectName: 'Demo',
      repoPath: '/work/demo',
      diagram: diagram('dgm_x', 'custom', '画出调用链'),
      concepts: [],
      candidate: null,
      question: '超时怎么算？',
    })
    expect(text).toContain('没有读到 candidate.json')
    expect(text).toContain('画出调用链')
    expect(text).toContain('项目概念表')
  })

  test('自定义图的标记也能解析', () => {
    const markers = parseArtifactMarkers('ARCHIFY_ARTIFACT dgm_trace C:/ws/x.html')
    expect(markers.get('dgm_trace')).toBe('C:/ws/x.html')
  })

  test('Git 事实块：detached 与工作区计数', () => {
    const text = buildRunPrompt({
      ...base,
      git: {
        ...emptyGitSnapshot('2026-11-06T12:00:00Z'),
        isRepo: true,
        branch: null,
        detached: true,
        dirty: true,
        tree: { staged: 2, unstaged: 1, untracked: 3 },
      },
      diagrams: [diagram('structure', 'structure')],
      previous: { structure: 'dev' },
    })
    expect(text).toContain('detached HEAD')
    expect(text).toContain('暂存 2')
    expect(text).toContain('未暂存 1')
    expect(text).toContain('上一版生成于分支 `dev`')
  })

  test('问答提示词带目录范围时限制引用', () => {
    const text = buildAskPrompt({
      projectName: 'Demo',
      repoPath: '/work/demo',
      diagram: { ...diagram('structure', 'structure'), pathScope: ['src/host'] },
      concepts: [],
      candidate: null,
      question: '超时怎么算？',
    })
    expect(text).toContain('只看 src/host')
  })

  test('问答提示词未限定目录时不提限制', () => {
    const text = buildAskPrompt({
      projectName: 'Demo',
      repoPath: '/work/demo',
      diagram: diagram('structure', 'structure'),
      concepts: [],
      candidate: null,
      question: '超时怎么算？',
    })
    expect(text).toContain('取证范围：全仓库')
  })

  test('没有 tree 明细但 dirty=true 时仍要提醒以工作区为准', () => {
    const text = buildRunPrompt({
      ...base,
      git: {
        ...emptyGitSnapshot('2026-11-06T12:00:00Z'),
        isRepo: true,
        branch: 'main',
        dirty: true,
      },
      diagrams: [diagram('structure', 'structure')],
    })
    expect(text).toContain('未提交改动')
    expect(text).toContain('以工作区当前内容为准')
  })

  test('自定义图没给 prompt 时要求按最重要的结构画', () => {
    const text = buildRunPrompt({
      ...base,
      git: emptyGitSnapshot('2026-11-06T12:00:00Z'),
      diagrams: [diagram('dgm_free', 'custom', null)],
    })
    expect(text).toContain('没有给 prompt')
  })

  test('干净工作区不写改动行', () => {
    const text = buildRunPrompt({
      ...base,
      git: {
        ...emptyGitSnapshot('2026-11-06T12:00:00Z'),
        isRepo: true,
        branch: 'main',
        tree: { staged: 0, unstaged: 0, untracked: 0 },
      },
      diagrams: [diagram('structure', 'structure')],
    })
    expect(text).toContain('- 分支：main')
    expect(text).toContain('工作区干净')
    expect(text).not.toContain('提交信息')
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
