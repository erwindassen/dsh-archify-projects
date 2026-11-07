// @vitest-environment node
/**
 * skill 定位与工作区栅栏。
 *
 * `resolveArchifySkillDir` 决定「agent 到底有没有 skill 可用」，
 * `confineToRoot` 决定「产物路由会不会被穿越读到别处」—— 都是安全相关，逐条测。
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  parseFrontmatter,
  readSkillBody,
  resolveArchifySkillDir,
} from '../../src/host/archify-skill.js'
import { resolveConfig } from '../../src/host/config.js'
import {
  confineToRoot,
  ensureProjectWorkspace,
  ensureWorkspace,
  isDirectory,
} from '../../src/host/workspace.js'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'dap-skill-'))
})

async function makeSkill(dir: string, description = '画架构图', name = 'archify'): Promise<string> {
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, 'SKILL.md'),
    ['---', `name: ${name}`, `description: ${description}`, '---', '', '# 正文', '细节'].join('\n'),
    'utf8',
  )
  return dir
}

describe('parseFrontmatter', () => {
  test('读出 name 与 description', () => {
    const meta = parseFrontmatter('---\nname: x\ndescription: 说明\n---\n正文')
    expect(meta).toEqual({ name: 'x', description: '说明' })
  })

  test('没有 frontmatter 时给出可用兜底', () => {
    const meta = parseFrontmatter('# 只有正文')
    expect(meta.name).toBe('archify')
    expect(meta.description.length).toBeGreaterThan(0)
  })

  test('引号会被去掉', () => {
    expect(parseFrontmatter('---\nname: "a"\ndescription: \'b\'\n---').description).toBe('b')
  })
})

describe('readSkillBody', () => {
  test('读回原文', async () => {
    const dir = await makeSkill(path.join(root, 'skills', 'archify'))
    expect(await readSkillBody(dir)).toContain('# 正文')
  })

  test('目录里没有 SKILL.md 时抛错（不静默返回空）', async () => {
    const dir = path.join(root, 'empty')
    await mkdir(dir, { recursive: true })
    await expect(readSkillBody(dir)).rejects.toThrow()
  })
})

describe('resolveArchifySkillDir', () => {
  test('显式目录优先', async () => {
    const dir = await makeSkill(path.join(root, 'explicit'))
    expect(await resolveArchifySkillDir(dir)).toBe(path.resolve(dir))
  })

  test('显式目录无效时继续往上找，最后给 null', async () => {
    const result = await resolveArchifySkillDir(path.join(root, 'does-not-exist'))
    // 本机装没装 archify 都会给出确定答案（目录或 null），不能抛
    expect(result === null || typeof result === 'string').toBe(true)
  })
})

describe('confineToRoot', () => {
  test('根内路径通过', () => {
    expect(confineToRoot('C:/ws', 'prj_1/a.html')).toBe(path.resolve('C:/ws', 'prj_1/a.html'))
  })

  test('前缀相同但不是子目录的不算通过', () => {
    expect(confineToRoot('C:/ws', '../ws-secret/a.txt')).toBeNull()
  })

  test('绝对路径逃逸被拒', () => {
    expect(confineToRoot('C:/ws', 'C:/Windows/win.ini')).toBeNull()
  })

  test('根自身合法', () => {
    expect(confineToRoot('C:/ws', '.')).toBe(path.resolve('C:/ws'))
  })
})

describe('工作区准备', () => {
  const config = (): ReturnType<typeof resolveConfig> =>
    resolveConfig({ dataDir: path.join(root, 'data') }, [])

  test('isDirectory 区分文件与目录', async () => {
    expect(await isDirectory(root)).toBe(true)
    expect(await isDirectory(path.join(root, 'nope'))).toBe(false)
    const file = path.join(root, 'f.txt')
    await writeFile(file, 'x', 'utf8')
    expect(await isDirectory(file)).toBe(false)
  })

  test('ensureProjectWorkspace 建出项目目录', async () => {
    const dir = await ensureProjectWorkspace(config(), 'prj_1')
    expect(await isDirectory(dir)).toBe(true)
    expect(dir).toBe(path.join(config().dataDir, 'workspace', 'prj_1'))
  })

  test('没有 workspaceRegistry 时降级，但目录仍建好', async () => {
    const warnings: string[] = []
    const info = await ensureWorkspace(
      { logger: { info: () => {}, warn: () => {} } } as never,
      config(),
      { warn: (m) => warnings.push(m) },
    )
    expect(info.workspaceId).toBeNull()
    expect(await isDirectory(info.root)).toBe(true)
    expect(warnings.join('\n')).toContain('工作区注册表不可用')
  })

  test('注册表已存在同路径记录时复用，不重复创建', async () => {
    const target = path.join(config().dataDir, 'workspace')
    await mkdir(target, { recursive: true })
    const created: string[] = []
    const registry = {
      list: () => [{ id: 'ws_existing', path: target, title: '旧标题' }],
      create: async (p: string) => {
        created.push(p)
        return { id: 'ws_new', path: p }
      },
    }
    const info = await ensureWorkspace(
      { logger: { info: () => {}, warn: () => {} }, workspaceRegistry: registry } as never,
      config(),
      { warn: () => {} },
    )
    expect(info.workspaceId).toBe('ws_existing')
    expect(created).toEqual([])
  })

  test('注册表抛错时降级，不阻塞启动', async () => {
    const warnings: string[] = []
    const registry = {
      list: () => [],
      create: async () => {
        throw new Error('注册表炸了')
      },
    }
    const info = await ensureWorkspace(
      { logger: { info: () => {}, warn: () => {} }, workspaceRegistry: registry } as never,
      config(),
      { warn: (m) => warnings.push(m) },
    )
    expect(info.workspaceId).toBeNull()
    expect(warnings.join('\n')).toContain('注册工作区失败')
  })
})
