/**
 * 宿主模型目录：把「DSH 里配好的模型」搬进本插件的设置弹窗。
 *
 * **插件不定义任何模型**。选项全部来自 `sessionController.modelCatalog()`——
 * 也就是用户在 DSH 设置里配过凭据、当前真的能路由到的那些 provider/model。
 * 这里只做两件事：
 *   1. 把宿主的分组结构**收成扁平**（页面只有一个下拉，不需要分组头）；
 *   2. 形状不对/宿主没有这个能力时，明确返回 `source: 'unavailable'`，
 *      让页面退化成「跟随宿主默认」，而不是显示一个空下拉假装能选。
 *
 * 为什么需要防御式解析：宿主版本会变，`modelCatalog()` 的返回是宿主生成的
 * 结构。这里逐字段读、读不到就跳过，永远不因为一个字段缺失把整个设置面板打挂。
 */

import { modelKey } from '../shared/model-key.js'
import type { ModelCatalogValue, ModelFailure, ModelOption, ModelRef } from '../shared/protocol.js'
import { serviceOf, type HostContext } from './context.js'

/** 宿主没有模型目录能力时回这个（页面据此显示「跟随宿主默认」）。 */
export const NO_CATALOG: ModelCatalogValue = {
  options: [],
  fallback: null,
  failures: [],
  source: 'unavailable',
}

/**
 * 读一次宿主模型目录。
 *
 * 不抛错：缺服务、宿主版本没有这个方法、provider 集体超时，都变成
 * `source: 'unavailable'` 或一条 `failures`。调用方（路由）只关心结果形状。
 */
export async function readModelCatalog(ctx: HostContext): Promise<ModelCatalogValue> {
  const controller = serviceOf<{ modelCatalog?: () => Promise<unknown> }>(ctx, 'sessionController')
  if (controller === undefined || typeof controller.modelCatalog !== 'function') {
    return NO_CATALOG
  }
  let raw: unknown
  try {
    raw = await controller.modelCatalog()
  } catch (err) {
    return {
      options: [],
      fallback: null,
      failures: [
        {
          provider: '*',
          providerName: 'DSH',
          message: err instanceof Error ? err.message : String(err),
        },
      ],
      source: 'host',
    }
  }
  return normalizeCatalog(raw)
}

/** 把宿主的 `ModelCatalog` 收成插件的扁平形状。纯函数，单测直接打。 */
export function normalizeCatalog(raw: unknown): ModelCatalogValue {
  if (typeof raw !== 'object' || raw === null) return { ...NO_CATALOG, source: 'host' }
  const source = raw as Record<string, unknown>
  const options: ModelOption[] = []
  const seen = new Set<string>()
  const groups = Array.isArray(source.groups) ? source.groups : []
  for (const group of groups) {
    if (typeof group !== 'object' || group === null) continue
    const g = group as Record<string, unknown>
    const provider = text(g.id)
    if (provider === null) continue
    const providerName = text(g.name) ?? provider
    const models = Array.isArray(g.models) ? g.models : []
    for (const model of models) {
      if (typeof model !== 'object' || model === null) continue
      const m = model as Record<string, unknown>
      const id = text(m.id)
      if (id === null) continue
      const key = modelKey({ provider, model: id })
      if (seen.has(key)) continue
      seen.add(key)
      options.push({
        key,
        provider,
        providerName,
        model: id,
        name: text(m.name) ?? id,
        description: text(m.description),
      })
    }
  }

  const failures: ModelFailure[] = []
  const rawFailures = Array.isArray(source.failures) ? source.failures : []
  for (const failure of rawFailures) {
    if (typeof failure !== 'object' || failure === null) continue
    const f = failure as Record<string, unknown>
    const provider = text(f.id)
    if (provider === null) continue
    failures.push({
      provider,
      providerName: text(f.name) ?? provider,
      message: text(f.message) ?? '列不出模型',
    })
  }

  return {
    options,
    fallback: readModelRef(source.default),
    failures,
    source: 'host',
  }
}

/** 只接受 `{ provider, model, reasoningEffort? }` 形状；其余一律 null。 */
export function readModelRef(value: unknown): ModelRef | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const provider = text(raw.provider)
  const model = text(raw.model)
  if (provider === null || model === null) return null
  const effort = text(raw.reasoningEffort)
  return effort === null ? { provider, model } : { provider, model, reasoningEffort: effort }
}

/** 这个路由在目录里存在吗（PUT /settings 的校验）。 */
export function catalogHas(catalog: ModelCatalogValue, ref: ModelRef): boolean {
  const key = modelKey(ref)
  return catalog.options.some((option) => option.key === key)
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}
