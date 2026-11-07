/**
 * 客户端入口。
 *
 * 产物里的 `exports.apply` / `exports.inject` 就是 `window.__ModuleLoader__` 要的
 * Cordis 插件面；`load({ id, factory })` 的壳由 tsdown 的 banner/footer 生成
 * （见 tsdown.config.ts），这里只管导出。
 *
 * 两个槽：
 *   ① `sidebar.panellist` —— 左侧顶栏的入口图标，`id` 就是面板 id；
 *   ② `main` —— 点开后的整页，`key` 与 `id` 必须一模一样。
 */

import { StudioPage } from './page.js'
import { PanelIcon } from './panel.js'
import { DICT, LOCALE_NS } from './locale.js'
import { installStyles } from './styles.js'

/** 面板 id：侧栏入口与主面板共用的唯一标识。 */
export const PANEL_ID = 'archify-projects'

/** 需要客户端服务：插槽注册表 + 文案目录。 */
export const inject = ['slots', 'locale']

/** 绑好的 `t`。 */
export type Translate = (key: string, vars?: Record<string, string | number>) => string

/** 客户端需要的最小 ctx 面。 */
export interface ClientCtx {
  readonly slots: {
    inject: (owner: string, install: () => unknown) => void
    register: (options: Record<string, unknown>, component: unknown) => unknown
  }
  readonly locale: {
    register: (ns: string, dict: Record<string, Record<string, string>>) => () => void
    bind: (ns: string) => Translate
  }
  effect: (fn: () => (() => void) | void, label?: string) => unknown
}

/** 插件入口。 */
export function apply(ctx: ClientCtx): void {
  // 文案目录必须先注册：侧栏 label 在 slot 注册时求值一次，
  // 目录还没挂上时 t() 会退回返回原始 key，界面上就出现 "panel.title"。
  ctx.effect(() => ctx.locale.register(LOCALE_NS, DICT), 'dsh-archify-projects: dictionaries')
  const t = ctx.locale.bind(LOCALE_NS)

  // 组件里要拿 t，但 slot 的 props 由框架决定（`main` 不传 t）。
  // 在 apply 里包一层得到稳定身份，不在渲染期新建组件类型。
  const Page = (): ReturnType<typeof StudioPage> => <StudioPage t={t} />

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 16,
        locale: LOCALE_NS,
        label: () => t('panel.title'),
      },
      PanelIcon,
    ),
  )

  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
        locale: LOCALE_NS,
      },
      Page,
    ),
  )

  // 样式随插件生命周期装卸，HMR 重挂不会叠标签。
  ctx.effect(installStyles, 'dsh-archify-projects: styles')
}
