import { defineConfig } from 'vitest/config'

/**
 * 测试基座。
 *
 *   tests/unit、tests/contract → node 环境（默认），测纯逻辑与宿主侧路由
 *   tests/integration          → node 环境，桩 ctx + 临时目录
 *   tests/component            → 文件头 `// @vitest-environment jsdom` + RTL，测渲染
 *
 * 环境不用 environmentMatchGlobs（v5 已移除），统一靠文件头 docblock 声明。
 *
 * 覆盖率只量宿主侧源码，不量客户端渲染：jsdom 覆盖不到布局/悬停/滚动分支，
 * 硬卡 src/client 的行数只会逼出一堆假测试。客户端由 artifact:check 与真机验证兜着。
 */
export default defineConfig({
  test: {
    include: [
      'tests/unit/**/*.test.ts',
      'tests/features/**/*.test.ts',
      'tests/contract/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/component/**/*.test.{ts,tsx}',
    ],
    globals: false,
    restoreMocks: true,
    environment: 'node',
    setupFiles: ['tests/support/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/host/**/*.ts', 'src/shared/**/*.ts'],
      // 纯装配文件没有可测逻辑：index.ts 是 apply 的连线，context.ts 全是类型
      exclude: ['src/host/index.ts', 'src/host/context.ts'],
      thresholds: {
        lines: 70,
        branches: 60,
        functions: 70,
        // 这三个文件错了就丢用户数据或切错分支，收紧
        'src/host/git.ts': { lines: 90, branches: 80, functions: 90 },
        'src/host/store.ts': { lines: 85, branches: 75, functions: 85 },
        'src/shared/prompt.ts': { lines: 95, branches: 85, functions: 95 },
      },
    },
  },
})
