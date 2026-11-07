// @vitest-environment node
/**
 * HTTP 工具：body 上限、路径匹配、信任栅栏。
 *
 * 栅栏是「别的网页借浏览器打本机接口」的唯一拦截点，所以三条分支都测：
 * 跨站拒绝、Origin 与 Host 不同源拒绝、同源放行。
 */

import { describe, expect, test } from 'vitest'
import {
  BadRequest,
  matchPath,
  methodOf,
  makeFence,
  pathOf,
  readJsonObject,
  sendError,
  sendOk,
} from '../../src/host/http.js'
import { fakeRequest, fakeResponse } from '../support/http.js'

describe('readJsonObject', () => {
  test('读出对象', async () => {
    const body = await readJsonObject(fakeRequest({ url: '/x', body: '{"a":1}' }))
    expect(body).toEqual({ a: 1 })
  })

  test('非对象拒绝', async () => {
    await expect(readJsonObject(fakeRequest({ url: '/x', body: '[1,2]' }))).rejects.toBeInstanceOf(
      BadRequest,
    )
  })

  test('坏 JSON 拒绝且说明是请求体问题', async () => {
    await expect(readJsonObject(fakeRequest({ url: '/x', body: '{oops' }))).rejects.toThrow(/JSON/)
  })

  test('超限拒绝', async () => {
    const huge = `{"a":"${'x'.repeat(300 * 1024)}"}`
    await expect(readJsonObject(fakeRequest({ url: '/x', body: huge }))).rejects.toThrow(/过大/)
  })
})

describe('matchPath', () => {
  test('钉住参数名', () => {
    expect(matchPath('/projects/:id/check', '/projects/prj_1/check')).toEqual({ id: 'prj_1' })
    expect(matchPath('/projects/:id/diagram/:kind', '/projects/p/diagram/domain')).toEqual({
      id: 'p',
      kind: 'domain',
    })
  })

  test('段数不同不匹配', () => {
    expect(matchPath('/projects/:id', '/projects/p/extra')).toBeNull()
    expect(matchPath('/projects/:id', '/projects')).toBeNull()
  })

  test('字面量不等不匹配', () => {
    expect(matchPath('/projects/:id/check', '/projects/p/update')).toBeNull()
  })
})

describe('methodOf / pathOf', () => {
  test('缺省 GET，路径去掉 query', () => {
    const req = fakeRequest({ url: '/dsh-archify-projects/projects?x=1' })
    expect(methodOf(req)).toBe('GET')
    expect(pathOf(req)).toBe('/dsh-archify-projects/projects')
  })
})

describe('makeFence', () => {
  const ctx = { logger: { info: () => {}, warn: () => {} } } as never

  test('跨站直接拒', () => {
    const fence = makeFence(ctx)
    expect(
      fence(
        fakeRequest({
          url: '/x',
          headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' },
        }),
      ),
    ).not.toBeNull()
  })

  test('Origin 与 Host 不同源拒', () => {
    const fence = makeFence(ctx)
    expect(
      fence(
        fakeRequest({
          url: '/x',
          headers: {
            host: '127.0.0.1:3080',
            origin: 'https://evil.example',
            'sec-fetch-site': 'same-site',
          },
        }),
      ),
    ).not.toBeNull()
  })

  test('同源放行', () => {
    const fence = makeFence(ctx)
    expect(
      fence(
        fakeRequest({
          url: '/x',
          headers: {
            host: '100.115.120.50:3080',
            origin: 'http://100.115.120.50:3080',
            'sec-fetch-site': 'same-origin',
          },
        }),
      ),
    ).toBeNull()
  })

  test('没有 Host 头时按拒处理（fail-closed）', () => {
    const fence = makeFence(ctx)
    expect(fence(fakeRequest({ url: '/x', headers: {} }))).not.toBeNull()
  })
})

describe('sendOk / sendError', () => {
  test('成功包成 {ok:true,value}', () => {
    const res = fakeResponse()
    sendOk(res, { hello: 1 })
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ ok: true, value: { hello: 1 } })
  })

  test('失败带 code，内部错误不外泄 detail', () => {
    const res = fakeResponse()
    sendError(res, 400, 'path-invalid', '路径不对')
    expect(res.status).toBe(400)
    expect(res.json()).toEqual({ ok: false, error: { code: 'path-invalid', message: '路径不对' } })
  })
})
