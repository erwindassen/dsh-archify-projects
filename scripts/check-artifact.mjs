#!/usr/bin/env node
/**
 * 客户端产物检查（`pnpm artifact:check`）。
 *
 * 为什么需要它：`dist/client.js` 是宿主按经典 script 拼接加载的浏览器产物，
 * 形状错一点就是整个页面白屏，而且错法很隐蔽。这里把四条硬约束做成门禁：
 *
 *   1. 必须恰好一个 `window.__ModuleLoader__.load({id: '<包名>', factory})` 壳，
 *      且 id 与 package.json 的 name 一致；
 *   2. 不许出现顶层 `import` / `export`（会带崩后续所有 bundle）；
 *   3. 只允许外置 baseline 模块表里的 11 个包 —— 其余必须打进产物；
 *   4. 体积预算：≤ 220 KB（未压缩），超了先想清楚再抬；
 *   5. **真的把它跑起来**：用只含 `window.__ModuleLoader__` 的沙箱执行，
 *      取到注册项、用 seed 桩调用 `factory(require)`，断言 `apply` 是函数、
 *      `inject` 是数组。前四条是静态形状，这条才是「装上不会白屏」的证明。
 *
 * 退出码非 0 即失败。输出是给人看的，不 JSON。
 */
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const DIST = path.join(ROOT, 'dist', 'client.js')
const SIZE_BUDGET = 220 * 1024

const BASELINE_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const failures = []

const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'))

let source
try {
  source = await readFile(DIST, 'utf8')
} catch {
  console.error(`artifact:check ✗ 找不到产物 ${DIST}，先跑 pnpm build`)
  process.exit(1)
}

// 1. 模块壳
const loaderCalls = source.match(/window\.__ModuleLoader__\.load\(/g) ?? []
if (loaderCalls.length !== 1) {
  failures.push(`期望恰好 1 处 window.__ModuleLoader__.load(，实际 ${loaderCalls.length} 处`)
}
const idMatch = source.match(
  /window\.__ModuleLoader__\.load\(\s*\{\s*id:\s*(?:"([^"]+)"|'([^']+)')/,
)
const declaredId = idMatch?.[1] ?? idMatch?.[2]
if (declaredId === undefined) {
  failures.push('模块壳缺少字符串字面量 id')
} else if (declaredId !== pkg.name) {
  failures.push(`模块 id "${declaredId}" 与 package.json name "${pkg.name}" 不一致`)
}
if (!/factory:\s*\(?\s*require\s*\)?\s*=>/.test(source)) {
  failures.push('模块壳缺少 `factory: (require) =>`')
}

// 2. 顶层 import / export
const head = source.slice(0, 4000)
if (/^[ \t]*import[ \t{*]/m.test(head) || /^[ \t]*export[ \t{*]/m.test(head)) {
  failures.push('产物出现顶层 import/export —— 宿主按经典 script 拼接，会把后续 bundle 带崩')
}

// 3. 外置模块白名单
const required = new Set()
for (const m of source.matchAll(/\brequire\(\s*(?:"([^"]+)"|'([^']+)')\s*\)/g)) {
  const spec = m[1] ?? m[2]
  if (spec !== undefined && !spec.startsWith('.')) required.add(spec)
}
for (const spec of required) {
  if (!BASELINE_EXTERNALS.includes(spec)) {
    failures.push(`产物 require 了非 baseline 模块 "${spec}" —— 运行期会 missed the module table`)
  }
}

// 4. 体积
const { size } = await stat(DIST)
if (size > SIZE_BUDGET) {
  failures.push(`产物 ${(size / 1024).toFixed(1)} KB 超出预算 ${SIZE_BUDGET / 1024} KB`)
}

// 5. 运行时形状：沙箱里真的执行一遍
try {
  let registration
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(entry) {
          registration = entry
        },
      },
    },
  }
  vm.runInNewContext(source, sandbox, { filename: 'dist/client.js' })
  if (registration === undefined) {
    failures.push('执行产物后没有登记任何模块（window.__ModuleLoader__.load 未被调用）')
  } else {
    const stubs = {
      react: { createElement: () => null, useState: () => [undefined, () => {}] },
      'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: 'Fragment' },
    }
    const exports = registration.factory((id) => {
      if (id in stubs) return stubs[id]
      throw new Error(`非 baseline 模块请求：${id}`)
    })
    if (typeof exports?.apply !== 'function')
      failures.push('factory 返回的 exports 没有 apply 函数')
    if (!Array.isArray(exports?.inject)) failures.push('factory 返回的 exports 没有 inject 数组')
    else if (!exports.inject.includes('slots')) failures.push('inject 里没有 slots —— 页面挂不上去')
  }
} catch (err) {
  failures.push(`沙箱执行产物失败：${err instanceof Error ? err.message : String(err)}`)
}

// 6. sourcemap 存在（宿主只认外置 .map）
try {
  await stat(`${DIST}.map`)
} catch {
  failures.push('缺少 dist/client.js.map')
}

if (failures.length > 0) {
  console.error('artifact:check ✗')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}

console.log('artifact:check ✓')
console.log(`  id: ${declaredId}`)
console.log(`  size: ${(size / 1024).toFixed(1)} KB / ${SIZE_BUDGET / 1024} KB`)
console.log(`  externals: ${[...required].sort().join(', ') || '(none)'}`)
