import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { fileURLToPath } from 'node:url'

const tsRoot = fileURLToPath(new URL('.', import.meta.url))

/**
 * dsh-archify-projects 静态检测配置（ESLint flat config）。
 *
 * 原则：ESLint 只管「正确性 + 架构边界」，排版交给 Prettier，类型与未用检查交给 tsc。
 * 报错信息要说得出「你做错了什么」，而不是「你怎么排的版」。
 *
 * 硬边界：
 *   1. src/client 是构建源码（ESM → tsdown 单 bundle），不许 Node 全局；
 *   2. src/host 不许 import src/client（这一条与「不许有 import 环」由
 *      dependency-cruiser 在 `pnpm deps:check` 守）；
 *   3. 测试与脚本按 Node ESM 处理；
 *   4. `skills/` 是 vendored 的 archify skill，整目录不参与静态检测。
 */

const baseRules = {
  ...js.configs.recommended.rules,
  'no-var': 'error',
  'prefer-const': ['error', { destructuring: 'all' }],
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-unused-vars': [
    'error',
    {
      args: 'after-used',
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrors: 'none',
    },
  ],
  'no-console': 'off',
}

const nodeZone = {
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    globals: { ...globals.node },
  },
}

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'lib/**',
      'coverage/**',
      'locale/**',
      '.tmp/**',
      '**/*.min.js',
      // vendored 第三方 skill：不是我们的代码，排版和质量由上游负责。
      // 把它排除出 lint/format，才不会每加一行自己的代码都被它刷屏。
      'skills/**',
    ],
  },

  // ---- 浏览器侧构建源码：ESM + 浏览器全局 --------------------------------
  {
    files: ['src/client/**/*.ts', 'src/client/**/*.tsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      ...baseRules,
      'no-restricted-globals': [
        'error',
        { name: 'process', message: '客户端源码跑在浏览器，没有 process。' },
        { name: '__dirname', message: '客户端源码跑在浏览器，没有 __dirname。' },
        { name: 'Buffer', message: '客户端源码跑在浏览器，没有 Buffer。' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: '客户端源码不许 import Node 内置模块。' },
            { group: ['**/host/**'], message: '客户端不许 import 宿主层。' },
          ],
        },
      ],
    },
  },

  // ---- shared 层：零 IO，两边共用 ----------------------------------------
  {
    files: ['src/shared/**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {},
    },
    rules: {
      ...baseRules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: 'shared 层必须保持零 IO，不许 import Node 内置模块。' },
            { group: ['**/host/**'], message: 'shared 不许依赖宿主层。' },
            { group: ['**/client/**'], message: 'shared 不许依赖客户端层。' },
          ],
        },
      ],
    },
  },

  // ---- TypeScript：语法规则 + 三条能命中真实缺陷的类型感知规则 -----------
  ...tseslint.configs.recommended.map(function (cfg) {
    return { ...cfg, files: ['**/*.ts', '**/*.tsx'] }
  }),
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: { project: ['./tsconfig.eslint.json'], tsconfigRootDir: tsRoot },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // 宿主 ctx / 路由入参的边界来自 cordis（无类型），这里必然出现 any。
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },

  // ---- 测试与脚本：Node ESM ---------------------------------------------
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx', 'scripts/**/*.mjs', '*.config.ts', '*.config.js'],
    ...nodeZone,
    rules: {
      ...baseRules,
      'no-console': 'off',
    },
  },
]
