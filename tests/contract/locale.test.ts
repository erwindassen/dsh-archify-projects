// @vitest-environment node
/**
 * 文案契约。
 *
 * DSH 有两条互不相干的 locale 通道，两边都要守：
 *   A. `ctx.locale.register` 的双语字典 —— 少一个键就是英文界面露中文；
 *   B. 包级 `locale/<lang>.json` 的 meta —— 少一个键插件列表里就是空白。
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { DICT, LOCALE_NS } from '../../src/client/locale.js'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))

describe('客户端字典', () => {
  test('命名空间与包名一致', () => {
    expect(LOCALE_NS).toBe('dsh-archify-projects')
  })

  test('中英键集合完全相同', () => {
    const zh = Object.keys(DICT.zh).sort()
    const en = Object.keys(DICT.en).sort()
    expect(en).toEqual(zh)
    expect(zh.length).toBeGreaterThan(50)
  })

  test('没有空值', () => {
    for (const [lang, dict] of Object.entries(DICT)) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim(), `${lang}.${key}`).not.toBe('')
      }
    }
  })

  test('页面用到的模板变量都在（{time} / {n} / {message} / {commit}）', () => {
    for (const key of ['git.checkedAt', 'meta.createdAt', 'meta.generatedAt']) {
      expect(DICT.zh[key]).toContain('{time}')
      expect(DICT.en[key]).toContain('{time}')
    }
    expect(DICT.zh['error.generic']).toContain('{message}')
    expect(DICT.en['time.minutes']).toContain('{n}')
    expect(DICT.zh['meta.basedOn']).toContain('{commit}')
  })

  test('状态键覆盖 DiagramState 的全部取值', () => {
    for (const status of ['idle', 'queued', 'running', 'ready', 'failed', 'stale']) {
      expect(DICT.zh[`status.${status}`]).toBeDefined()
      expect(DICT.en[`status.${status}`]).toBeDefined()
    }
  })

  test('运行类型与状态键齐全', () => {
    for (const kind of ['create', 'update', 'regenerate']) {
      expect(DICT.zh[`run.kind.${kind}`]).toBeDefined()
    }
    for (const status of ['running', 'succeeded', 'failed']) {
      expect(DICT.zh[`run.status.${status}`]).toBeDefined()
    }
  })
})

describe('包级 locale 元数据', () => {
  async function dictionaries(): Promise<Map<string, { title?: string; description?: string }>> {
    const dir = path.join(ROOT, 'locale')
    const files = (await readdir(dir)).filter((name) => name.endsWith('.json'))
    const out = new Map<string, { title?: string; description?: string }>()
    for (const file of files) {
      const raw = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as {
        meta?: { title?: string; description?: string }
      }
      out.set(file.slice(0, -'.json'.length), raw.meta ?? {})
    }
    return out
  }

  test('文件名就是语言 id，且必须有 en', async () => {
    const dicts = await dictionaries()
    expect([...dicts.keys()]).toContain('en')
    for (const lang of dicts.keys()) {
      expect(lang).toMatch(/^[a-z]{2}(-[A-Za-z]{2,4})?$/)
    }
  })

  test('每种语言都有非空 title 与 description', async () => {
    const dicts = await dictionaries()
    for (const [lang, meta] of dicts) {
      expect(meta.title, `${lang}.title`).toBeTruthy()
      expect(meta.description, `${lang}.description`).toBeTruthy()
    }
    expect([...dicts.keys()].sort()).toEqual(['en', 'zh'])
  })
})
