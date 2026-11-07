/**
 * 插件配置：默认值、解析与校验。
 *
 * 不用 schemastery 是因为本插件只有 5 个标量字段，而 schemastery 会引入一个
 * 宿主内部包的硬依赖；对第三方插件来说，手写解析 + 明确报错更稳。
 */

import os from 'node:os'
import path from 'node:path'

/** 宿主 profile 传入的原始配置（YAML 反序列化结果，什么都可能是）。 */
export interface RawPluginConfig {
  readonly dataDir?: unknown
  readonly presetId?: unknown
  readonly askPresetId?: unknown
  readonly archifySkillDir?: unknown
  readonly runTimeoutMs?: unknown
  readonly askTimeoutMs?: unknown
  readonly keepRuns?: unknown
}

/** 解析后的配置。 */
export interface ResolvedConfig {
  /** 插件数据根：台账 + 工作区。 */
  readonly dataDir: string
  /** 受限 agent preset 的 id（与 cordis.patch.yml 里声明的一致）。 */
  readonly presetId: string
  /** 只读问答会话的 preset id（没有 shell / 写工具）。 */
  readonly askPresetId: string
  /** 显式指定的 archify skill 目录；null 表示自动探测。 */
  readonly archifySkillDir: string | null
  /** 单次 agent 运行的超时（毫秒）。 */
  readonly runTimeoutMs: number
  /** 单次提问会话的超时（毫秒）。 */
  readonly askTimeoutMs: number
  /** 每个项目保留的运行记录条数。 */
  readonly keepRuns: number
}

/** DSH 配置根。 */
export function dshHome(): string {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim().length > 0) return path.resolve(env.trim())
  return path.join(os.homedir(), '.dsh')
}

/**
 * 解析配置。
 *
 * 非法值一律回落到默认值并**记录**（由调用方打印），不抛异常 ——
 * 一个配置项写错不应该让整个插件在宿主启动期炸掉。
 */
export function resolveConfig(
  raw: RawPluginConfig | undefined,
  warnings: string[],
): ResolvedConfig {
  const dataDirDefault = path.join(dshHome(), 'dsh-archify-projects')

  const dataDir = readString(raw?.dataDir, dataDirDefault, 'dataDir', warnings)
  const presetId = readString(raw?.presetId, 'archify-projects', 'presetId', warnings)
  const askPresetId = readString(raw?.askPresetId, 'archify-projects-ask', 'askPresetId', warnings)
  const skillRaw = raw?.archifySkillDir
  const archifySkillDir =
    typeof skillRaw === 'string' && skillRaw.trim().length > 0
      ? path.resolve(skillRaw.trim())
      : null

  return {
    dataDir: path.resolve(dataDir),
    presetId,
    askPresetId,
    archifySkillDir,
    runTimeoutMs: readPositiveInt(raw?.runTimeoutMs, 20 * 60 * 1000, 'runTimeoutMs', warnings),
    askTimeoutMs: readPositiveInt(raw?.askTimeoutMs, 6 * 60 * 1000, 'askTimeoutMs', warnings),
    keepRuns: readPositiveInt(raw?.keepRuns, 20, 'keepRuns', warnings),
  }
}

function readString(value: unknown, fallback: string, field: string, warnings: string[]): string {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string' || value.trim().length === 0) {
    warnings.push(`配置项 ${field} 不是非空字符串，已回落到默认值`)
    return fallback
  }
  return value.trim()
}

function readPositiveInt(
  value: unknown,
  fallback: number,
  field: string,
  warnings: string[],
): number {
  if (value === undefined || value === null) return fallback
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    warnings.push(`配置项 ${field} 不是正整数，已回落到默认值`)
    return fallback
  }
  return n
}

/** 台账文件的绝对路径。 */
export function ledgerPath(config: ResolvedConfig): string {
  return path.join(config.dataDir, 'projects.json')
}

/** 插件工作区目录（所有运行产物都在这里）。 */
export function workspaceRoot(config: ResolvedConfig): string {
  return path.join(config.dataDir, 'workspace')
}

/** 单个项目的工作目录。 */
export function projectDir(config: ResolvedConfig, projectId: string): string {
  return path.join(workspaceRoot(config), projectId)
}
