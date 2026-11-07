/**
 * 侧栏入口图标。
 *
 * 契约：`sidebar.panellist` 只给 `{ size, active }`，组件**只画图标** ——
 * 外层容器、点击、aria、选中态全部由 sidebar 自己负责，插件不要抢。
 */

import type { CSSProperties, ReactElement } from 'react'

/** 文案取值函数。 */
export type Translate = (key: string, vars?: Record<string, string | number>) => string

export interface PanelIconProps {
  readonly size?: number
  readonly active?: boolean
}

/** 三点连接的结构图小图标，用 currentColor 跟随侧栏配色。 */
export function PanelIcon({ size = 16 }: PanelIconProps): ReactElement {
  const style: CSSProperties = { display: 'block' }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.6 6.3V5.2c0-.9.7-1.6 1.6-1.6h3" opacity="0.55" />
      <path d="M20.4 17.7v1.1c0 .9-.7 1.6-1.6 1.6h-3" opacity="0.55" />
      <circle cx="7.6" cy="9.4" r="2.1" />
      <circle cx="16.4" cy="7.1" r="1.7" />
      <circle cx="12.6" cy="16.6" r="1.7" />
      <path d="M9.5 8.4l5.1-1" />
      <path d="M8.6 11.2l2.9 3.6" />
      <path d="M15.9 8.8l-2.2 5.9" opacity="0.7" />
    </svg>
  )
}
