/**
 * Agent 提示词构建与产物标记解析（纯函数）。
 *
 * 这段文本是插件与 agent 之间唯一的契约面：agent 只有 archify 一个 skill、
 * 只有 fs / fs-search / shell 几个工具，所以提示词必须把「做什么、产物写哪、
 * 怎么回报」讲死，不能依赖模型猜。
 *
 * 契约的另一半是 {@link parseArtifactMarkers}：agent 最后必须打印两行机器可读
 * 标记，runner 靠它定位产物；解析失败时 runner 走目录兜底，但那是补救不是常态。
 */

import { ARTIFACT_MARKER } from './protocol.js'
import type { DiagramKind, GitSnapshot } from './types.js'

/** 构建提示词需要的全部事实。 */
export interface RunPromptInput {
  readonly projectName: string
  readonly repoPath: string
  readonly workspaceDir: string
  readonly git: GitSnapshot
  /** 本次要出的图；create/update 给两张，regenerate 只给一张。 */
  readonly kinds: readonly DiagramKind[]
  /** `YYYYMMDD-HHMMSS`，用于 archify 目录名。 */
  readonly stamp: string
  /** archify Skill 的绝对根目录；null 表示环境降级（没有 skill 可用）。 */
  readonly archifySkillPath: string | null
  /** 上次产物的 commit，用来告诉 agent 「代码变了什么都不知道，重新读」。 */
  readonly previous: Partial<Record<DiagramKind, string | null>>
}

/** 两张图各自的建模口径。 */
const KIND_SPEC: Record<DiagramKind, string> = {
  structure: [
    '项目结构图（structure）——回答「这个代码库由什么组成、怎么依赖」。',
    '必含：入口/装配层、核心业务模块、基础设施适配层、外部依赖（数据库/队列/第三方服务）。',
    '必须画出至少一条主调用链，以及必要的分支；不要把每个文件都画成一个节点。',
    '用 boundary 表达进程/网络/信任边界（如「主进程」「外部服务」）。',
  ].join('\n'),
  domain: [
    '领域图（domain）——回答「这块业务的领域模型是什么」。',
    '必含：限界上下文、聚合根、实体/值对象、领域事件，以及上下文之间的协作关系。',
    '必须写清聚合内的一致性边界；不要把它画成技术架构图。',
    '如果你判断仓库规模不足以建模领域层（例如纯脚手架），就在图的 meta 里写明这一点，并退化为「模块职责图」。',
  ].join('\n'),
}

/** 渲染 Git 事实块。 */
function gitBlock(git: GitSnapshot): string {
  if (!git.isRepo) {
    return [
      '- 这个目录**不是 Git 仓库**：没有分支、没有 commit。',
      '- 因此不要执行任何 git 命令，也不要在报告里编造分支名或 hash。',
      '- 分析对象就是当前目录下的代码。',
    ].join('\n')
  }
  const lines = [
    `- 分支：${git.detached ? `detached HEAD` : (git.branch ?? '未知')}`,
    `- 提交：${git.commitFull ?? git.commit ?? '未知'}`,
  ]
  if (git.commitSubject !== null) lines.push(`- 提交信息：${git.commitSubject}`)
  if (git.commitTime !== null) lines.push(`- 提交时间：${git.commitTime}`)
  if (git.upstream !== null) lines.push(`- 上游：${git.upstream}`)
  if (git.dirty === true) lines.push('- 工作区**有未提交改动**：分析时以工作区当前内容为准。')
  return lines.join('\n')
}

/** 渲染 archify 调用方式。 */
function archifyBlock(
  skillPath: string | null,
  kinds: readonly DiagramKind[],
  stamp: string,
): string {
  if (skillPath === null) {
    return [
      '## 环境降级：archify Skill 不可用',
      '',
      '本次没有挂载 archify skill。请退化为「手写 JSON + 内联 SVG 的单页 HTML」：',
      '每张图输出一个自包含的 HTML 文件（inline SVG，深浅色都可用），放在当前工作目录的 `.archify/` 下：',
      ...kinds.map((kind) => `  - ${kind} -> .archify/${kind}-<slug>-${stamp}/`),
      '仍然要遵守下面的回报标记约定；并在最终回复里明确说明本次是降级产物。',
    ].join('\n')
  }
  const slugArg = '<slug>'
  const rows = kinds.map((kind) => `  - ${kind} → \`.archify/${kind}-${slugArg}-${stamp}/\``)
  return [
    '## 出图方式（必须用 archify skill）',
    '',
    `1. 先用 \`skill\` 工具加载 \`archify\`（name 必须正好是 \`archify\`）。`,
    `2. 按 Skill 里的「Fast authoring path」执行：选类型 → 读 references → 写 \`candidate.json\` → 跑 \`finalize\`。`,
    '3. 每张图一个独立目录，统一放在当前工作目录下的 `.archify/` 里：',
    ...rows,
    `4. \`finalize\` 命令（把 \`<skill>\` 换成 \`${skillPath}\`，把 \`<slug>\` 换成你选的短名）：`,
    '   ```',
    `   node "${skillPath}/bin/archify.mjs" finalize architecture ` +
      `<目录>/candidate.json <目录>/<slug>.html --repo-root "<REPO_ROOT>" --quality showcase --json`,
    '   ```',
    '5. 两张图都用 type `architecture`（structure 与 domain 的区别在建模口径，不在 type）。',
    '6. `finalize` 非 0 退出就是失败：按 Skill 的修复流程改 candidate 再跑，别把失败当成功上报。',
  ].join('\n')
}

/**
 * 构建一次运行的完整提示词。
 *
 * 结果必须是**自包含**的：agent 看不到本插件的任何文档，只有这段文本 + SKILL.md。
 */
export function buildRunPrompt(input: RunPromptInput): string {
  const { projectName, repoPath, workspaceDir, git, kinds, stamp, archifySkillPath, previous } =
    input
  const kindSections = kinds
    .map((kind) => {
      const prevCommit = previous[kind] ?? null
      const prevLine =
        prevCommit === null
          ? '- 这张图以前没生成过。'
          : `- 上一版基于提交 \`${prevCommit}\`，本次代码可能已变，请重新读源码取证，不要沿用旧结论。`
      return `### ${kind === 'structure' ? '项目结构图' : '领域图'}\n${KIND_SPEC[kind]}\n${prevLine}`
    })
    .join('\n\n')

  const markers = kinds
    .map((kind) => `${ARTIFACT_MARKER} ${kind} <该图的 HTML 绝对路径>`)
    .join('\n')

  return `# 任务：为代码库「${projectName}」生成 Archify 图谱

## 环境事实

- 你的工作目录（也是产物目录）：\`${workspaceDir}\`
- 待分析的代码库根目录：\`${repoPath}\`
- 本次时间戳：\`${stamp}\`
${gitBlock(git)}

## 本次要交付的图

${kindSections}

${archifyBlock(archifySkillPath, kinds, stamp)}

## 硬约束

1. **只读代码库**：可以 read / grep / glob 任意文件，可以跑只读 git 命令；不许 write / edit / 删除 / 移动代码库里的任何文件，不许切分支、不许 commit。
2. **产物只写工作目录**：所有 \`candidate.json\` 与 HTML 都落在工作目录下，不要写进代码库。
3. 不要输出与图谱无关的总结长文；不要中途问问题，需要的信息自己去代码里查。
4. 证据优先：每个节点/关系都要能对应到真实文件或目录，别凭项目名猜。

## 结束前必须打印的回报

在最终回复的最后，单独列出这两行（替换尖括号内容，路径必须是绝对路径）：

\`\`\`
${markers}
\`\`\`

另外请一并说明每张图的节点数、关系数，以及你在代码里实际读过的关键路径（3–8 条）。`
}

/**
 * 从 agent 的最终文本里解析产物标记。
 *
 * 容错：大小写不敏感、行内可有前后空白、路径可带引号。同一 kind 多次出现取最后一次。
 */
export function parseArtifactMarkers(text: string): Partial<Record<DiagramKind, string>> {
  const result: Partial<Record<DiagramKind, string>> = {}
  const pattern = new RegExp(`^\\s*${ARTIFACT_MARKER}\\s+(structure|domain)\\s+(.+?)\\s*$`, 'gim')
  for (const match of text.matchAll(pattern)) {
    const rawKind = match[1]?.toLowerCase()
    const rawPath = match[2]?.trim()
    if (rawKind === undefined || rawPath === undefined || rawPath.length === 0) continue
    const cleaned = rawPath.replace(/^[`'"]+|[`'"]+$/g, '').trim()
    if (cleaned.length === 0) continue
    result[rawKind === 'domain' ? 'domain' : 'structure'] = cleaned
  }
  return result
}
