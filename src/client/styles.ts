/**
 * 页面样式。
 *
 * 两条硬规则：
 *   1. **只用 DSH alias 令牌**（`--dsw-alias-*` / `--dsw-radius-*`），不写死任何色值 ——
 *      宿主切深浅色时 alias 自动翻转，页面不需要第二条样式分支，也就不存在
 *      「浅色好看深色发白」这种半成品状态；
 *   2. 所有类名带 `dap-` 前缀，样式以 `<style data-plugin>` 注入并在卸载时摘掉，
 *      不污染宿主。
 */

export const PAGE_CSS = `
.dap-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family, inherit);
  font-size: 13px;
  line-height: 1.5;
}

/* ---------------------------------------------------------------- 顶栏 */
.dap-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  flex: none;
}
.dap-head__title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.dap-head__subtitle {
  margin: 2px 0 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.dap-head__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

/* ---------------------------------------------------------------- 主体 */
.dap-body {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: 16px;
  padding: 16px 24px 24px;
  min-height: 0;
  flex: 1;
}
.dap-col {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
@media (max-width: 900px) {
  .dap-body {
    grid-template-columns: minmax(0, 1fr);
  }
  .dap-col--list {
    max-height: 240px;
  }
}

/* ---------------------------------------------------------------- 按钮 */
.dap-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: var(--dsw-radius-md, 8px);
  border: 1px solid var(--dsw-alias-border-l3);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
.dap-btn:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dap-btn:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid
    var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.dap-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dap-btn--primary {
  background: var(--dsw-alias-button-primary-fill);
  border-color: transparent;
  color: var(--dsw-alias-label-primary-inverted);
  font-weight: 500;
}
.dap-btn--primary:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover);
}
.dap-btn--danger {
  color: var(--dsw-alias-state-error-primary);
}
.dap-btn--quiet {
  border-color: transparent;
  color: var(--dsw-alias-label-secondary);
}
.dap-btn--icon {
  width: 28px;
  padding: 0;
}

/* ---------------------------------------------------------------- 卡片 */
.dap-card {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-lg, 12px);
  background: var(--dsw-alias-bg-layer-1);
  padding: 12px;
}
.dap-card + .dap-card {
  margin-top: 8px;
}

/* 项目列表项：整块可点，用 button 语义 */
.dap-item {
  display: block;
  width: 100%;
  text-align: left;
  appearance: none;
  font: inherit;
  cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-lg, 12px);
  background: var(--dsw-alias-bg-layer-1);
  color: inherit;
  padding: 10px 12px;
  transition:
    background 150ms cubic-bezier(0.16, 1, 0.3, 1),
    border-color 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
.dap-item:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dap-item:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid
    var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.dap-item[aria-current='true'] {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dap-item__top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.dap-item__name {
  font-weight: 600;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.dap-item__meta {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  min-width: 0;
}
.dap-item__dots {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex: none;
}

/* ---------------------------------------------------------------- 状态点 */
.dap-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
  background: var(--dsw-alias-state-idle-primary);
}
.dap-dot--ready {
  background: var(--dsw-alias-state-success-primary);
}
.dap-dot--running,
.dap-dot--queued {
  background: var(--dsw-alias-state-warn-primary);
  animation: dap-pulse 1.4s ease-in-out infinite;
}
.dap-dot--failed {
  background: var(--dsw-alias-state-error-primary);
}
@keyframes dap-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

/* ---------------------------------------------------------------- 文字 */
.dap-mono {
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11.5px;
}
.dap-muted {
  color: var(--dsw-alias-label-secondary);
}
.dap-faint {
  color: var(--dsw-alias-label-tertiary);
}
.dap-ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.dap-tag {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dap-tag--warn {
  color: var(--dsw-alias-state-warn-primary);
}
.dap-tag--error {
  color: var(--dsw-alias-state-error-primary);
}
.dap-tag--ok {
  color: var(--dsw-alias-state-success-primary);
}

/* ---------------------------------------------------------------- 详情 */
.dap-detail__head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  justify-content: space-between;
  min-width: 0;
}
.dap-detail__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.dap-gitbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  margin-top: 8px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
}
.dap-gitbar__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.dap-gitbar__label {
  color: var(--dsw-alias-label-tertiary);
}

/* ---------------------------------------------------------------- 图谱卡 */
.dap-diagram {
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
  /* 卡片本身也是 flex item：不锁住就会被祖先列压成一条标题栏，
     里面的 434px iframe 被 overflow:hidden 裁掉，看起来像「图没了」。 */
  flex: none;
}
.dap-diagram__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  min-width: 0;
}
.dap-diagram__title {
  font-weight: 600;
  font-size: 12.5px;
  flex: none;
}
.dap-diagram__desc {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}
.dap-diagram__actions {
  display: flex;
  gap: 6px;
  flex: none;
}
.dap-diagram__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 8px 12px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
}
.dap-diagram__frame {
  width: 100%;
  /* 父级是 flex column，iframe 作为 flex item 默认 flex-shrink:1——
     固定 height 会被压扁成一条工具栏，所以这里必须 flex:none 顶住。
     高度用 clamp 跟着视口走，笔记本和 4K 都不至于只剩标题栏。 */
  flex: none;
  height: clamp(420px, 58vh, 760px);
  border: 0;
  display: block;
  background: var(--dsw-alias-bg-base);
}
.dap-diagram__empty {
  padding: 28px 16px;
  text-align: center;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
}

/* ---------------------------------------------------------------- 运行记录 */
.dap-runs {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dap-runs__row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary);
  min-width: 0;
}

/* ---------------------------------------------------------------- 空状态 */
.dap-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px 24px;
  text-align: center;
}
.dap-empty__title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}
.dap-empty__body {
  margin: 0;
  max-width: 380px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
}

/* ---------------------------------------------------------------- 对话框 */
.dap-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.4));
}
.dap-dialog {
  width: min(440px, 100%);
  border-radius: var(--dsw-radius-lg, 12px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-shadow-lv2, 0 12px 32px rgba(0, 0, 0, 0.18));
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.dap-dialog__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.dap-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dap-field__label {
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary);
}
.dap-input {
  height: 32px;
  padding: 0 10px;
  border-radius: var(--dsw-radius-md, 8px);
  border: 1px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12.5px;
  width: 100%;
  box-sizing: border-box;
}
.dap-input:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid
    var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dap-input[aria-invalid='true'] {
  border-color: var(--dsw-alias-state-error-primary);
}
.dap-error {
  color: var(--dsw-alias-state-error-primary);
  font-size: 11.5px;
}
.dap-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* ---------------------------------------------------------------- 区块 */
.dap-banner {
  padding: 12px 24px 0;
}
.dap-detail__actions {
  display: flex;
  gap: 6px;
  flex: none;
}
.dap-runs__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

/* ---------------------------------------------------------------- 通知条 */
.dap-notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
}
.dap-notice--error {
  color: var(--dsw-alias-state-error-primary);
}

/* ---------------------------------------------------------------- 无障碍 */
@media (prefers-reduced-motion: reduce) {
  .dap-btn,
  .dap-item {
    transition: none;
  }
  .dap-dot--running,
  .dap-dot--queued {
    animation: none;
  }
}
`

/** 注入样式；返回卸载函数。 */
export function installStyles(): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-archify-projects'
  tag.textContent = PAGE_CSS
  document.head.appendChild(tag)
  return () => {
    try {
      tag.remove()
    } catch {
      // 已经不在文档里，忽略
    }
  }
}
