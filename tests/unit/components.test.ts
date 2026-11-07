import { describe, expect, it } from 'vitest'
import { clockText } from '../../src/client/components.js'

describe('clockText：运行记录里的时钟', () => {
  it('按本地时区显示 HH:mm:ss，而不是切 ISO 的 UTC 段', () => {
    const iso = '2026-11-07T05:51:44.000Z'
    const at = new Date(iso)
    const pad = (n: number): string => String(n).padStart(2, '0')
    const expected = `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
    expect(clockText(iso)).toBe(expected)
  })

  it('东八区下 05:51Z 必须不是 05:51', () => {
    const shown = clockText('2026-11-07T05:51:44.000Z')
    const offset = new Date().getTimezoneOffset()
    if (offset < 0) expect(shown).not.toBe('05:51:44')
  })

  it('坏时间串退回原始切片，不抛', () => {
    expect(clockText('not-a-date')).toBe('not-a-date'.slice(11, 19))
  })
})
