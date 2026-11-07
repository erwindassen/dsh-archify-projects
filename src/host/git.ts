/**
 * Git 探测与同步。
 *
 * 所有命令都走 `execFile('git', argv, {cwd})` —— 不拼 shell 字符串，分支名作为独立
 * argv 传入，用户仓库里再奇怪的分支名也不会变成注入点。
 *
 * 只做**只读探测**与**安全同步**：
 *   - 探测：rev-parse / log / rev-list / status / remote
 *   - 同步：fetch、checkout <记录的分支>、merge --ff-only
 * 永远不 reset --hard、不 clean、不 stash、不强推。工作区脏就停下来说清楚。
 */

import { execFile } from 'node:child_process'
import { emptyGitSnapshot, type GitSnapshot, type TreeState } from '../shared/types.js'

/** 单条命令的结果。 */
export interface GitResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** 可替换的 git 执行器（测试用它注入假数据）。 */
export type GitExec = (args: readonly string[], cwd: string) => Promise<GitResult>

/** 单条 git 命令的超时。fetch 在慢网络上要久一点，所以给 60s。 */
const GIT_TIMEOUT_MS = 60_000

/** 默认执行器。 */
export const gitExec: GitExec = (args, cwd) =>
  new Promise<GitResult>((resolve) => {
    execFile(
      'git',
      [...args],
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        // 输出按 UTF-8 解，中文提交信息才不会乱码
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) })
          return
        }
        const code = typeof error.code === 'number' ? error.code : 1
        // 进程根本没起来（cwd 不存在、git 不在 PATH）时 stderr 是空串，
        // 真正的原因只存在于 error.message 里 —— 不能因为「stderr 有值」就丢掉它
        const detail = String(stderr ?? '').trim()
        resolve({
          code,
          stdout: String(stdout ?? ''),
          stderr: detail.length > 0 ? detail : error.message,
        })
      },
    )
  })

/**
 * 探测一个目录的 Git 状态。
 *
 * 任何子命令失败都只让对应字段为 null，不让整个探测失败 ——
 * 老 git 版本、浅克隆、没有 upstream 都是正常情况。
 */
export async function probeGit(
  repoPath: string,
  now: string,
  exec: GitExec = gitExec,
): Promise<GitSnapshot> {
  const top = await exec(['rev-parse', '--show-toplevel'], repoPath)
  if (top.code !== 0) return emptyGitSnapshot(now)
  const root = top.stdout.trim()
  if (root.length === 0) return emptyGitSnapshot(now)

  const [branchRes, commitRes, logRes, upstreamRes, statusRes, remoteRes] = await Promise.all([
    exec(['rev-parse', '--abbrev-ref', 'HEAD'], root),
    exec(['rev-parse', 'HEAD'], root),
    exec(['log', '-1', '--format=%cI%n%s'], root),
    exec(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], root),
    exec(['status', '--porcelain'], root),
    exec(['remote', 'get-url', 'origin'], root),
  ])

  const branchRaw = branchRes.code === 0 ? branchRes.stdout.trim() : ''
  const detached = branchRaw === 'HEAD' || branchRaw.length === 0
  const branch = detached ? null : branchRaw

  const commitFull = commitRes.code === 0 ? commitRes.stdout.trim() : null
  const commit = commitFull === null || commitFull.length === 0 ? null : commitFull.slice(0, 40)

  const { commitTime, commitSubject } = parseLog(logRes.code === 0 ? logRes.stdout : '')

  const upstream = upstreamRes.code === 0 ? emptyToNull(upstreamRes.stdout) : null

  let ahead: number | null = null
  let behind: number | null = null
  if (upstream !== null) {
    const counts = await exec(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], root)
    if (counts.code === 0) {
      const parsed = parseAheadBehind(counts.stdout)
      ahead = parsed.ahead
      behind = parsed.behind
    }
  }

  const tree = statusRes.code === 0 ? parseTree(statusRes.stdout) : null
  const dirty = statusRes.code === 0 ? statusRes.stdout.trim().length > 0 : null

  return {
    isRepo: true,
    root,
    branch,
    detached,
    commit,
    commitFull: commitFull === null || commitFull.length === 0 ? null : commitFull,
    commitTime,
    commitSubject,
    upstream,
    ahead,
    behind,
    dirty,
    tree,
    remoteUrl: remoteRes.code === 0 ? emptyToNull(remoteRes.stdout) : null,
    checkedAt: now,
  }
}

/**
 * 解析 `git status --porcelain` 的 XY 两列：
 *   - X = 暂存区状态，Y = 工作区状态；`??` 是未跟踪；
 *   - 只看计数，不看文件名（页面只需要「有改动 / 几处」）。
 */
export function parseTree(stdout: string): TreeState {
  let staged = 0
  let unstaged = 0
  let untracked = 0
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    const x = line[0] ?? ' '
    const y = line[1] ?? ' '
    if (x === '?' && y === '?') {
      untracked += 1
      continue
    }
    if (x !== ' ' && x !== '?') staged += 1
    if (y !== ' ' && y !== '?') unstaged += 1
  }
  return { staged, unstaged, untracked }
}

/** `log -1 --format=%cI%n%s` 的两行结果。 */
export function parseLog(stdout: string): {
  commitTime: string | null
  commitSubject: string | null
} {
  const lines = stdout.split(/\r?\n/)
  const time = lines[0]?.trim() ?? ''
  const subject = lines.slice(1).join(' ').trim()
  return {
    commitTime: time.length > 0 ? time : null,
    commitSubject: subject.length > 0 ? subject : null,
  }
}

/**
 * `rev-list --left-right --count HEAD...@{u}` 的输出是 `<HEAD 独有>\t<上游独有>`，
 * 也就是 `<ahead>\t<behind>`。方向搞反会让页面把「落后 3 个提交」显示成「领先 3 个」，
 * 所以这里单独抽出来测。
 */
export function parseAheadBehind(stdout: string): { ahead: number | null; behind: number | null } {
  const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(stdout)
  if (m === null) return { ahead: null, behind: null }
  return { ahead: Number(m[1]), behind: Number(m[2]) }
}

/** 同步结果。`skipped` 为真时 `reason` 一定非空，页面据此给人话。 */
export interface SyncResult {
  readonly skipped: boolean
  readonly reason: string | null
  readonly from: string | null
  readonly to: string | null
}

/**
 * 把仓库切回记录的分支并快进到最新提交。
 *
 * 顺序：脏工作区先停 → fetch（有 origin 才做，失败只记录）→ checkout → merge --ff-only → 重新探测。
 */
export async function syncToLatest(
  repoPath: string,
  recordedBranch: string | null,
  exec: GitExec = gitExec,
): Promise<SyncResult> {
  const before = await probeGit(repoPath, new Date().toISOString(), exec)
  if (!before.isRepo || before.root === null) {
    return { skipped: true, reason: 'no-git', from: null, to: null }
  }
  const root = before.root
  const from = before.commit

  if (before.dirty === true) {
    return { skipped: true, reason: 'dirty', from, to: from }
  }

  if (before.remoteUrl !== null) {
    // fetch 失败（离线、无权限）不该阻断后续 checkout/ff：本地可能已经是最新的
    await exec(['fetch', '--all', '--prune'], root)
  }

  const target = recordedBranch ?? before.branch
  if (target !== null && target !== before.branch) {
    const checkout = await exec(['checkout', target], root)
    if (checkout.code !== 0) {
      return { skipped: true, reason: 'checkout-failed', from, to: from }
    }
  }

  const afterCheckout = await probeGit(repoPath, new Date().toISOString(), exec)
  if (afterCheckout.upstream !== null) {
    const merge = await exec(['merge', '--ff-only', '@{u}'], root)
    if (merge.code !== 0) {
      return { skipped: true, reason: 'ff-failed', from, to: afterCheckout.commit }
    }
  }

  const after = await probeGit(repoPath, new Date().toISOString(), exec)
  return { skipped: false, reason: null, from, to: after.commit }
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}
