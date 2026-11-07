// @vitest-environment node
/**
 * 会话策略：白名单 + 守卫。
 *
 * 这是「无关工具禁用 / skill 只有 archify」的**执行层**，所以断言写死拒绝理由，
 * 不做「返回了字符串就算过」的松断言。
 */

import { describe, expect, test, vi } from 'vitest'
import { allowedToolNames, makeGuard, tightenAgent } from '../../src/host/policy.js'
import type { ToolsLike } from '../../src/host/context.js'

describe('allowedToolNames', () => {
  test('Windows 给 pwsh，其它平台给 bash', () => {
    expect(allowedToolNames('win32')).toContain('pwsh')
    expect(allowedToolNames('win32')).not.toContain('bash')
    expect(allowedToolNames('linux')).toContain('bash')
    expect(allowedToolNames('linux')).not.toContain('pwsh')
  })

  test('不含会破坏只读出图语义的工具', () => {
    for (const forbidden of ['web_search', 'subagent', 'workflow', 'present', 'todo_write']) {
      expect(allowedToolNames('win32')).not.toContain(forbidden)
    }
  })
})

describe('makeGuard', () => {
  const guard = makeGuard(allowedToolNames('win32'))

  test('skill 只放 archify', () => {
    expect(guard({ name: 'skill', arguments: { name: 'archify' } })).toBeUndefined()
    expect(guard({ name: 'skill', arguments: { name: 'lark-im' } })).toContain('archify')
    expect(guard({ name: 'skill', arguments: {} })).toContain('未指定')
    expect(guard({ name: 'skill', arguments: null })).toContain('archify')
  })

  test('白名单内的工具放行', () => {
    for (const name of ['read', 'write', 'edit', 'glob', 'grep', 'pwsh']) {
      expect(guard({ name, arguments: {} })).toBeUndefined()
    }
  })

  test('白名单外的工具拒绝，理由里带工具名', () => {
    expect(guard({ name: 'web_fetch', arguments: {} })).toContain('web_fetch')
    expect(guard({ name: 'subagent', arguments: {} })).toContain('禁用')
  })
})

describe('tightenAgent', () => {
  function tools(behaviour: { restrictThrows?: boolean } = {}): {
    tools: ToolsLike
    restrict: ReturnType<typeof vi.fn>
    guard: ReturnType<typeof vi.fn>
  } {
    const restrict = vi.fn(() => {
      if (behaviour.restrictThrows === true) throw new Error('unknown global tool "bash"')
      return () => {}
    })
    const guard = vi.fn(() => () => {})
    return { tools: { restrict, guard } as unknown as ToolsLike, restrict, guard }
  }

  test('两步都装上', () => {
    const { tools: api, restrict, guard } = tools()
    const result = tightenAgent({ tools: api }, ['read', 'skill'], () => {})
    expect(result).toEqual({ restricted: true, guarded: true, message: null })
    expect(restrict).toHaveBeenCalledWith({ allow: ['read', 'skill'] })
    expect(guard).toHaveBeenCalledTimes(1)
  })

  test('restrict 抛了也要装 guard，并留下原因', () => {
    const { tools: api, guard } = tools({ restrictThrows: true })
    const warn = vi.fn()
    const result = tightenAgent({ tools: api }, ['read'], warn)
    expect(result.restricted).toBe(false)
    expect(result.guarded).toBe(true)
    expect(result.message).toContain('unknown global tool')
    expect(warn).toHaveBeenCalled()
    expect(guard).toHaveBeenCalledTimes(1)
  })

  test('没有 tools 服务时明确说清楚，而不是静默放行', () => {
    const warn = vi.fn()
    const result = tightenAgent(undefined, ['read'], warn)
    expect(result.restricted).toBe(false)
    expect(result.guarded).toBe(false)
    expect(warn.mock.calls[0]?.[0]).toContain('白名单未生效')
  })

  test('作用域有 effect 时把 disposer 交给它管', () => {
    const { tools: api } = tools()
    const effect = vi.fn((fn: () => (() => void) | void) => fn())
    tightenAgent({ tools: api, effect }, ['read'], () => {})
    expect(effect).toHaveBeenCalledTimes(2)
  })
})
