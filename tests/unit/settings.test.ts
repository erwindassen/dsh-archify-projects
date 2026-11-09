// @vitest-environment node
/**
 * 插件设置（`settings.json`）：只存「分析用哪个模型」。
 *
 * 这一段守三条：坏文件不抛错、形状不对的字段被丢弃、写盘是「整份覆盖」
 * 且读回来与写进去的一致（页面靠这个回执刷新下拉）。
 */

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { resolveConfig } from '../../src/host/config.js'
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  readSettings,
  sanitizeModelRef,
  settingsPath,
  writeSettings,
} from '../../src/host/settings.js'

let root = ''
const config = (): ReturnType<typeof resolveConfig> => {
  return resolveConfig({ dataDir: path.join(root, 'data') }, [])
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'dap-settings-'))
})

describe('sanitizeModelRef', () => {
  test('接受 provider + model，可选 reasoningEffort', () => {
    expect(sanitizeModelRef({ provider: 'dsh', model: 'deepseek-v4' })).toEqual({
      provider: 'dsh',
      model: 'deepseek-v4',
    })
    expect(
      sanitizeModelRef({ provider: ' zifei ', model: ' claude ', reasoningEffort: 'high' }),
    ).toEqual({ provider: 'zifei', model: 'claude', reasoningEffort: 'high' })
  })

  test('空串、缺字段、非对象一律 null（不抛错）', () => {
    expect(sanitizeModelRef(null)).toBeNull()
    expect(sanitizeModelRef('dsh/deepseek')).toBeNull()
    expect(sanitizeModelRef({ provider: '', model: 'x' })).toBeNull()
    expect(sanitizeModelRef({ provider: 'dsh' })).toBeNull()
    expect(sanitizeModelRef({ provider: 'dsh', model: '   ' })).toBeNull()
  })

  test('空的 reasoningEffort 视为没填', () => {
    expect(sanitizeModelRef({ provider: 'dsh', model: 'm', reasoningEffort: '  ' })).toEqual({
      provider: 'dsh',
      model: 'm',
    })
  })
})

describe('normalizeSettings', () => {
  test('缺 model 字段 = 跟随宿主默认', () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ model: null })).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
  })

  test('保留合法 model，丢弃其余字段', () => {
    expect(
      normalizeSettings({ model: { provider: 'dsh', model: 'm' }, extra: 1, pricing: {} }),
    ).toEqual({ model: { provider: 'dsh', model: 'm' } })
  })
})

describe('readSettings / writeSettings', () => {
  test('文件不存在时回默认值', async () => {
    expect(await readSettings(config())).toEqual(DEFAULT_SETTINGS)
  })

  test('坏 JSON 回默认值，不抛', async () => {
    const target = settingsPath(config())
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, '{ not json', 'utf8')
    expect(await readSettings(config())).toEqual(DEFAULT_SETTINGS)
  })

  test('写进去再读回来是同一份（整份覆盖 + 原子 rename）', async () => {
    const saved = await writeSettings(config(), {
      model: { provider: 'zifei', model: 'claude-sonnet', reasoningEffort: 'high' },
    })
    expect(saved).toEqual({
      model: { provider: 'zifei', model: 'claude-sonnet', reasoningEffort: 'high' },
    })
    expect(await readSettings(config())).toEqual(saved)
    const text = await readFile(settingsPath(config()), 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)).toEqual(saved)
  })

  test('写 null 就是清除选择', async () => {
    await writeSettings(config(), { model: { provider: 'dsh', model: 'm' } })
    const cleared = await writeSettings(config(), { model: null })
    expect(cleared).toEqual(DEFAULT_SETTINGS)
    expect(await readSettings(config())).toEqual(DEFAULT_SETTINGS)
  })
})
