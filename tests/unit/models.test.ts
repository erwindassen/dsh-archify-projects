// @vitest-environment node
/**
 * 宿主模型目录的收纳（`normalizeCatalog`）。
 *
 * 宿主返回的是**分组**结构，插件页面只有一个下拉，所以这里收成扁平。
 * 关键是**防御式**：宿主版本变化、某个字段缺失、provider 报错，
 * 都不能把设置面板打挂 —— 最差结果是「一个选项都没有 + 一条 failure」。
 */

import { describe, expect, test } from 'vitest'
import { NO_CATALOG, catalogHas, normalizeCatalog, readModelRef } from '../../src/host/models.js'
import { modelKey } from '../../src/shared/model-key.js'

/** 一份与 DSH `ModelCatalog` 同形的样本。 */
const SAMPLE = {
  default: { provider: 'dsh', model: 'deepseek-v4' },
  routableProviders: ['dsh', 'zifei'],
  groups: [
    {
      id: 'dsh',
      name: 'DeepSeek',
      models: [
        {
          id: 'deepseek-v4',
          name: 'DeepSeek V4',
          reasoning: { efforts: [{ id: 'high', name: 'High' }] },
        },
        { id: 'deepseek-v4-mini', name: 'DeepSeek V4 mini' },
      ],
    },
    { id: 'zifei', name: '自费网关', models: [{ id: 'claude-sonnet', name: 'Claude Sonnet' }] },
  ],
  failures: [{ id: 'openrouter', name: 'OpenRouter', message: 'timeout' }],
}

describe('normalizeCatalog', () => {
  test('分组收成扁平选项，provider 显示名与模型名都保留', () => {
    const catalog = normalizeCatalog(SAMPLE)
    expect(catalog.source).toBe('host')
    expect(catalog.options.map((option) => option.key)).toEqual([
      'dsh::deepseek-v4',
      'dsh::deepseek-v4-mini',
      'zifei::claude-sonnet',
    ])
    expect(catalog.options[0]).toMatchObject({
      provider: 'dsh',
      providerName: 'DeepSeek',
      model: 'deepseek-v4',
      name: 'DeepSeek V4',
    })
    expect(catalog.fallback).toEqual({ provider: 'dsh', model: 'deepseek-v4' })
    expect(catalog.failures).toEqual([
      { provider: 'openrouter', providerName: 'OpenRouter', message: 'timeout' },
    ])
  })

  test('同一 provider/model 只出现一次（key 去重）', () => {
    const catalog = normalizeCatalog({
      groups: [
        { id: 'dsh', models: [{ id: 'm' }, { id: 'm' }] },
        { id: 'dsh', name: 'Dup', models: [{ id: 'm' }] },
      ],
    })
    expect(catalog.options).toHaveLength(1)
    expect(catalog.options[0]?.providerName).toBe('dsh')
  })

  test('形状不对的组/模型被跳过，不抛错', () => {
    const catalog = normalizeCatalog({
      groups: [null, 42, { id: 'dsh', models: [null, { name: 'no id' }, { id: 'ok' }] }, {}],
      failures: ['nope', { message: 'no id' }],
    })
    expect(catalog.options.map((option) => option.model)).toEqual(['ok'])
    expect(catalog.options[0]).toMatchObject({ name: 'ok', description: null })
    expect(catalog.failures).toEqual([])
  })

  test('非对象/缺字段 → 空目录但仍算 host 能力可用', () => {
    expect(normalizeCatalog(null)).toMatchObject({ options: [], fallback: null, source: 'host' })
    expect(normalizeCatalog({})).toMatchObject({ options: [], source: 'host' })
    expect(NO_CATALOG.source).toBe('unavailable')
  })
})

describe('readModelRef / catalogHas / modelKey', () => {
  test('只接受 provider + model，effort 可选', () => {
    expect(readModelRef({ provider: 'dsh', model: 'm', reasoningEffort: 'high' })).toEqual({
      provider: 'dsh',
      model: 'm',
      reasoningEffort: 'high',
    })
    expect(readModelRef({ provider: 'dsh' })).toBeNull()
    expect(readModelRef('dsh/m')).toBeNull()
  })

  test('catalogHas 按 provider::model 判定，不看 reasoningEffort', () => {
    const catalog = normalizeCatalog(SAMPLE)
    expect(catalogHas(catalog, { provider: 'zifei', model: 'claude-sonnet' })).toBe(true)
    expect(
      catalogHas(catalog, { provider: 'zifei', model: 'claude-sonnet', reasoningEffort: 'low' }),
    ).toBe(true)
    expect(catalogHas(catalog, { provider: 'zifei', model: 'nope' })).toBe(false)
  })

  test('modelKey 与 catalog key 是同一套口径', () => {
    expect(modelKey({ provider: 'dsh', model: 'm' })).toBe('dsh::m')
  })
})
