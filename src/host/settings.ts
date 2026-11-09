/**
 * 插件级设置：目前只有一个字段——**这次分析用哪个模型**。
 *
 * 为什么单独落一个 `settings.json`，不塞进台账：
 *   - 台账是「项目数据」，删除/重建项目不该动到全局偏好；
 *   - 设置是**部署级**的（一台机器一份），和 `projects.json` 的生命周期不同；
 *   - 读写都在宿主侧，页面只通过 `GET/PUT /settings` 拿和存，不碰文件。
 *
 * 模型本身**不在插件里定义**：选项来自宿主已配置的模型目录
 * （`sessionController.modelCatalog()`），这里只记住用户挑了哪一个。
 * 挑的模型走 `agents.create({ agentOptions })` 创建会话，因此**不会**改到
 * DSH 的全局默认模型——分析用哪个模型是插件自己的事。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ModelRef } from '../shared/protocol.js'
import { type ResolvedConfig } from './config.js'

/** 设置文件形状。字段一律可选：文件损坏/手工改错都要能回落。 */
export interface PluginSettings {
  /** 分析（出图 + 提问）使用的模型；null = 用宿主的默认模型。 */
  readonly model: ModelRef | null
}

/** 默认设置：不指定模型，跟随宿主默认。 */
export const DEFAULT_SETTINGS: PluginSettings = { model: null }

/** 设置文件的绝对路径。 */
export function settingsPath(config: ResolvedConfig): string {
  return path.join(config.dataDir, 'settings.json')
}

/**
 * 校验一个模型引用。
 *
 * 只做**形状**校验（非空字符串），不校验「宿主是否有这个模型」——那是
 * catalog 的职责，由路由在写入前做一次；这里保证落盘的东西永远可用。
 */
export function sanitizeModelRef(value: unknown): ModelRef | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const provider = typeof raw.provider === 'string' ? raw.provider.trim() : ''
  const model = typeof raw.model === 'string' ? raw.model.trim() : ''
  if (provider.length === 0 || model.length === 0) return null
  const effort = typeof raw.reasoningEffort === 'string' ? raw.reasoningEffort.trim() : ''
  return effort.length === 0 ? { provider, model } : { provider, model, reasoningEffort: effort }
}

/** 把任意解析结果收成全量的设置对象（缺字段补默认值）。 */
export function normalizeSettings(value: unknown): PluginSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_SETTINGS
  const raw = value as Record<string, unknown>
  // `model: null` 与「没有 model 字段」都表示「跟随宿主默认」
  return { model: sanitizeModelRef(raw.model) }
}

/**
 * 读设置。
 *
 * 文件不存在、是坏 JSON、或字段形状不对，都回落到默认值而不是抛错：
 * 一个坏掉的偏好文件不应该让整个页面打不开。真正的 IO 错误（权限）也吞掉，
 * 由调用方在日志里看到 `settings.json` 的读失败（见 index.ts）。
 */
export async function readSettings(config: ResolvedConfig): Promise<PluginSettings> {
  let text: string
  try {
    text = await readFile(settingsPath(config), 'utf8')
  } catch {
    return DEFAULT_SETTINGS
  }
  try {
    return normalizeSettings(JSON.parse(text))
  } catch {
    return DEFAULT_SETTINGS
  }
}

/**
 * 写设置（整份覆盖，先写临时文件再 rename，避免半截 JSON）。
 *
 * 返回落盘后的最终值：调用方拿它回给页面，页面就不用再猜「到底存成了什么」。
 */
export async function writeSettings(
  config: ResolvedConfig,
  next: PluginSettings,
): Promise<PluginSettings> {
  const normalized = normalizeSettings(next)
  const target = settingsPath(config)
  await mkdir(path.dirname(target), { recursive: true })
  const temp = `${target}.tmp`
  await writeFile(temp, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  await rename(temp, target)
  return normalized
}
