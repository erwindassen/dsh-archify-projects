/**
 * 定位 archify Skill 的磁盘目录。
 *
 * 插件不认识 archify 的内部实现，只需要 SKILL.md 与 bin/archify.mjs 的所在目录：
 *   - preset 侧的 skill 提供方按这个目录提供唯一一个 skill；
 *   - 提示词里把 `node <dir>/bin/archify.mjs` 写成绝对路径交给 agent。
 *
 * 探测顺序（谁先命中用谁）：
 *   1. 配置项 `archifySkillDir`；
 *   2. `@tt-a1i/archify-dsh` 包里的 `skills/archify`（随 profile 安装，最常见）；
 *   3. 本插件自带的 `skills/archify`（离线兜底）。
 *
 * 全部失败返回 null —— 上层据此走「降级产物」路径，而不是让运行直接失败。
 */

import { createRequire } from 'node:module'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 本插件的包根（由本文件位置反推：lib/host/*.js → 上两级）。 */
function packageRoot(): string {
  return path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
}

/** 一个目录是不是可用的 archify skill 根（有 SKILL.md 就算）。 */
async function hasSkillFile(dir: string): Promise<boolean> {
  try {
    await access(path.join(dir, 'SKILL.md'))
    return true
  } catch {
    return false
  }
}

/** 从若干包解析基准里找一个能解析 `@tt-a1i/archify-dsh/package.json` 的。 */
function resolveFromBases(specifier: string, bases: readonly string[]): string | null {
  for (const base of bases) {
    try {
      const require = createRequire(path.join(base, 'noop.js'))
      return require.resolve(specifier)
    } catch {
      // 这个基准下解析不到，换下一个
    }
  }
  return null
}

/**
 * 解析 archify skill 目录。
 *
 * @param explicit 配置里显式给的目录（可为 null）
 * @returns 绝对路径或 null
 */
export async function resolveArchifySkillDir(explicit: string | null): Promise<string | null> {
  if (explicit !== null) {
    return (await hasSkillFile(explicit)) ? explicit : null
  }

  const bases = [
    packageRoot(),
    process.env.DSH_PROFILE_DIR ?? '',
    process.env.DSH_HOME ?? '',
    process.cwd(),
  ].filter((b) => b.length > 0)

  const pkgJson = resolveFromBases('@tt-a1i/archify-dsh/package.json', bases)
  if (pkgJson !== null) {
    const candidate = path.join(path.dirname(pkgJson), 'skills', 'archify')
    if (await hasSkillFile(candidate)) return candidate
  }

  // 有些安装把 skill 平铺在包根下
  if (pkgJson !== null) {
    const pkgDir = path.dirname(pkgJson)
    if (await hasSkillFile(pkgDir)) return pkgDir
  }

  const bundled = path.join(packageRoot(), 'skills', 'archify')
  if (await hasSkillFile(bundled)) return bundled

  return null
}

/** 读 SKILL.md 正文（skill 提供方用）。 */
export async function readSkillBody(skillDir: string): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  return readFile(path.join(skillDir, 'SKILL.md'), 'utf8')
}

/**
 * 从 SKILL.md 的 YAML frontmatter 里取 `name` 与 `description`。
 *
 * 只支持单行标量与 `|`/`>` 折叠块 —— archify 的 frontmatter 就这两种写法，
 * 上完整 YAML 解析器不值得。
 */
export function parseFrontmatter(source: string): { name: string; description: string } {
  const fallback = { name: 'archify', description: 'Archify diagram authoring' }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (match === null) return fallback
  const body = match[1] ?? ''
  const name = readScalar(body, 'name') ?? fallback.name
  const description = readScalar(body, 'description') ?? fallback.description
  return { name, description }
}

function readScalar(frontmatter: string, key: string): string | null {
  const quoted = new RegExp(`^${key}\\s*:\\s*["'](.+?)["']\\s*$`, 'm').exec(frontmatter)
  if (quoted !== null) return quoted[1] ?? null
  const block = new RegExp(`^${key}\\s*:\\s*[|>]-?\\s*\\r?\\n((?:[ \\t]+.*\\r?\\n?)+)`, 'm').exec(
    frontmatter,
  )
  if (block !== null) {
    const text = (block[1] ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join(' ')
    return text.length > 0 ? text : null
  }
  const plain = new RegExp(`^${key}\\s*:\\s*(.+?)\\s*$`, 'm').exec(frontmatter)
  return plain === null ? null : (plain[1] ?? null)
}
