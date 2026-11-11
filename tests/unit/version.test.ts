// @vitest-environment node
/**
 * `/health` 报的版本必须和 `package.json` 一致：升版时最容易漏的就是这个常量，
 * 而漏了以后现象很隐蔽 —— 页面显示旧版本，排查时误以为是旧构建。
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { VERSION } from '../../src/host/index.js'

describe('版本号', () => {
  test('VERSION 与 package.json 的 version 一致', async () => {
    const raw = await readFile(path.join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as { version?: string }
    expect(VERSION).toBe(pkg.version)
  })
})
