import { defineConfig } from 'tsdown'

const PLUGIN_ID = 'dsh-archify-projects'

/**
 * DSH 浏览器模块表（baseline externals）。
 *
 * 来源：`dsh-web-frontend/dist/assets/index-*.js` 的 staticModules 种子表（11 个）。
 * 这些模块只能从宿主 `require` 取，绝不能打进产物 —— 打进去就是第二份 React，
 * 上下文/插槽全部对不上。
 */
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

// 与 dsh-client-modules/lib/client.js 的官方壳逐字同形。
// 产物是经典 script + 单个 lazy CJS factory，不是 ESM：宿主按 `;\n` 拼接多个
// bundle，出现顶层 import/export 会直接把后续脚本全部带崩。
const banner = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(PLUGIN_ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
`
const footer = `\t\treturn module.exports;
\t}
});
`

export default defineConfig({
  entry: { client: 'src/client/entry.tsx' },
  outDir: 'dist',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  minify: false,
  clean: true,
  dts: false,
  deps: { neverBundle: BASELINE_EXTERNALS },
  inputOptions: { platform: 'browser' },
  outExtensions: () => ({ js: '.js' }),
  banner,
  footer,
})
