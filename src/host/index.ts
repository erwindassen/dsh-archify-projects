/**
 * 宿主插件入口：`dsh-archify-projects`。
 *
 * 这里只做装配，不含业务逻辑：
 *   ① 解析配置、准备台账与工作区；
 *   ② 注册一条 prefix HTTP 路由，把所有请求交给 routes.ts 的分发器；
 *   ③ 把 archify skill 目录做一次懒解析并缓存（preset 侧与提示词侧共用同一份答案）。
 *
 * 页面由 `dist/client.js` 提供（package.json 的 `exports["./client"]`），
 * 受限于 preset 的那个受限 agent 组合由 `lib/host/preset.js` 提供。
 */

import path from 'node:path'
import { ROUTE_PREFIX } from '../shared/protocol.js'
import { resolveArchifySkillDir } from './archify-skill.js'
import { ledgerPath, resolveConfig, workspaceRoot, type RawPluginConfig } from './config.js'
import { serviceOf, type HostContext } from './context.js'
import { makeFence } from './http.js'
import { createDispatcher } from './routes.js'
import { reconcileArtifacts, Runner } from './runner.js'
import { ProjectStore } from './store.js'
import { ensureWorkspace } from './workspace.js'

/** 与 package.json 的 version 保持一致（有单测守着）。 */
export const VERSION = '0.1.1'

/** 插件入口。 */
export function apply(ctx: HostContext, rawConfig?: unknown): void {
  const warnings: string[] = []
  const config = resolveConfig(rawConfig as RawPluginConfig | undefined, warnings)
  for (const warning of warnings) log(ctx, 'warn', warning)

  const store = new ProjectStore(ledgerPath(config))

  let cachedSkill: Promise<string | null> | undefined
  const skillDir = (): Promise<string | null> => {
    cachedSkill ??= resolveArchifySkillDir(config.archifySkillDir)
    return cachedSkill
  }

  const runner = new Runner({ ctx, store, config, skillDir })
  const hasSessionService =
    serviceOf(ctx, 'sessionController') !== undefined || serviceOf(ctx, 'agents') !== undefined

  if (!hasSessionService) {
    log(ctx, 'warn', '宿主没有 sessionController / agents 服务：更新会失败，只能浏览台账')
  }

  const dispatcher = createDispatcher({
    ctx,
    store,
    config,
    runner,
    fence: makeFence(ctx),
    skillDir,
    version: VERSION,
    hasSessionService,
  })

  // 路由必须挂在 inject 出来的子 ctx 上：cordis 的 proxy 在没 inject 时读
  // `ctx.webServer` 会直接抛，注册就会被静默跳过（页面表现为「HTTP 404」）。
  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(
      () =>
        scoped.webServer.register({
          kind: 'prefix',
          path: ROUTE_PREFIX,
          handler: (req, res) => {
            void dispatcher(req, res)
          },
        }),
      'dsh-archify-projects: http routes',
    )
    log(ctx, 'info', `HTTP 路由已注册：${ROUTE_PREFIX}`)
  })

  // 开库对账：把上次没记完的产物认回来（宿主重启/断连后最常见的「明明有图却显示失败」）
  void reconcileArtifacts(store, config).then(
    (adopted) => {
      for (const line of adopted) log(ctx, 'info', `已认领磁盘上的产物：${line}`)
    },
    (err: unknown) => log(ctx, 'warn', `产物对账失败：${describe(err)}`),
  )

  // 工作区准备是异步的，不阻塞宿主启动；失败也不致命
  void ensureWorkspace(ctx, config, {
    warn: (message) => log(ctx, 'warn', message),
  }).then(
    (info) => {
      log(ctx, 'info', `工作区就绪：${path.basename(info.root)}（${ROUTE_PREFIX}）`)
      const drained = store.drainWarnings()
      for (const warning of drained) log(ctx, 'warn', warning)
    },
    (err: unknown) => log(ctx, 'warn', `准备插件工作区失败：${describe(err)}`),
  )

  log(
    ctx,
    'info',
    `已挂载 v${VERSION}，台账 ${ledgerPath(config)}，工作区 ${workspaceRoot(config)}`,
  )
}

function log(ctx: HostContext, level: 'info' | 'warn', message: string): void {
  try {
    ctx.logger[level](`[dsh-archify-projects] ${message}`)
  } catch {
    // 日志器不可用不影响功能
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
