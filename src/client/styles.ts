/**
 * 页面样式。
 *
 * 两条硬规则：
 *   1. **只用 DSH alias 令牌**（`--dsw-alias-*` / `--dsw-radius-*`），不写死任何色值 ——
 *      宿主切深浅色时 alias 自动翻转，页面不需要第二条样式分支；
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
.dap-scroll { flex: 1; min-height: 0; overflow: auto; padding: 18px 22px 26px; }
/* 工作台整屏：三栏各自滚动，右栏再长也不撑高页面 */
.dap-scroll--wb { overflow: hidden; display: flex; flex-direction: column; padding-bottom: 12px; }

/* ---------------------------------------------------------------- 顶栏 */
.dap-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 20px;
  padding: 18px 22px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); flex: none;
}
.dap-head__title { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
.dap-head__sub { margin: 3px 0 0; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dap-head__actions { display: flex; gap: 8px; flex: none; }

/* ---------------------------------------------------------------- 通用 */
.dap-btn {
  display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 11px;
  border-radius: var(--dsw-radius-md); border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font-size: 12.5px; font-weight: 500; white-space: nowrap; cursor: pointer;
}
.dap-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dap-btn:disabled { opacity: .45; cursor: not-allowed; }
.dap-btn--primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-inverted); border-color: transparent; }
.dap-btn--primary:hover { background: var(--dsw-alias-button-primary-hover); }
.dap-btn--ghost { border-color: transparent; background: transparent; color: var(--dsw-alias-label-secondary); }
.dap-btn--ghost:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dap-btn--sm { height: 26px; padding: 0 8px; font-size: 11.5px; border-radius: var(--dsw-radius-md); }
.dap-btn__icon { width: 13px; height: 13px; display: block; }

.dap-chip {
  display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 7px;
  border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
  font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums;
}
.dap-chip--ok { color: var(--dsw-alias-state-success-primary); border-color: transparent; }
.dap-chip--warn { color: var(--dsw-alias-state-warn-primary); border-color: transparent; }
.dap-chip--accent { color: var(--dsw-alias-state-business-primary); border-color: transparent; }
.dap-chip__dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }

.dap-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); flex: none; }
.dap-dot--warn { background: var(--dsw-alias-state-warn-primary); }
.dap-dot--err { background: var(--dsw-alias-state-error-primary); }
.dap-dot--run { background: var(--dsw-alias-state-warn-primary); animation: dap-pulse 1.4s ease-in-out infinite; }
@keyframes dap-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }

/* ---------------------------------------------------------------- 总览 */
.dap-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 0 0 14px; }
.dap-stat { border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); padding: 11px 13px; }
.dap-stat__k { font-size: 11.5px; color: var(--dsw-alias-label-tertiary); }
.dap-stat__v { margin-top: 3px; font-size: 20px; font-weight: 600; letter-spacing: -0.02em; }
.dap-stat__v small { font-size: 11.5px; font-weight: 500; color: var(--dsw-alias-label-tertiary); margin-left: 6px; letter-spacing: 0; }

.dap-atlas { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.dap-card {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1); padding: 14px; display: flex; flex-direction: column; gap: 10px;
  cursor: pointer; text-align: left; width: 100%; transition: border-color .15s, box-shadow .15s;
}
.dap-card:hover { border-color: var(--dsw-alias-border-l3); box-shadow: var(--dsw-shadow-lv2); }
.dap-card__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.dap-repo { display: flex; align-items: center; gap: 7px; min-width: 0; }
.dap-repo__name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dap-repo__path { font-size: 11px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: ui-monospace, monospace; }
.dap-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.dap-thumbs { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.dap-thumb {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2); padding: 6px 8px; min-width: 0;
}
.dap-thumb--wide { grid-column: 1 / -1; }
.dap-thumb__title { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dap-thumb__title b { font-weight: 550; color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dap-thumb__count { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.dap-card__foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11.5px; color: var(--dsw-alias-label-tertiary); }

/* ---------------------------------------------------------------- 工作台 */
.dap-wb { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 12px; align-items: stretch; flex: 1; min-height: 0; }
.dap-panel { border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
.dap-panel__body { overflow: auto; flex: 1; min-height: 0; }
.dap-panel__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 11px; border-bottom: 1px solid var(--dsw-alias-border-l1); font-size: 11.5px; color: var(--dsw-alias-label-tertiary); }
.dap-panel__body { padding: 7px; }

.dap-strip {
  display: flex; gap: 8px; align-items: stretch; padding: 8px 10px;
  overflow-x: auto; border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1); flex: none;
}
.dap-strip__sep { flex: none; width: 1px; align-self: stretch; background: var(--dsw-alias-border-l1); margin: 0 2px; }
.dap-thumbcard {
  position: relative; flex: none; width: 132px; height: 74px; border-radius: var(--dsw-radius-md);
  overflow: hidden; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2); cursor: pointer; padding: 0; text-align: left;
}
.dap-thumbcard:hover { border-color: var(--dsw-alias-border-l3); }
.dap-thumbcard--on { border-color: var(--dsw-alias-label-primary); box-shadow: 0 0 0 1px var(--dsw-alias-label-primary) inset; }
.dap-thumbcard--child { margin-left: 12px; }
.dap-thumbcard--child::before {
  content: "└"; position: absolute; left: -10px; top: 24px; color: var(--dsw-alias-label-tertiary); font-size: 11px;
}
.dap-thumbcard__dot {
  position: absolute; top: 5px; left: 6px; width: 6px; height: 6px; border-radius: 50%;
  background: var(--dsw-alias-state-success-primary); box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-1); z-index: 2;
}
.dap-thumbcard__dot--warn { background: var(--dsw-alias-state-warn-primary); }
.dap-thumbcard__dot--err { background: var(--dsw-alias-state-error-primary); }
.dap-thumbcard__preview {
  display: block; width: 528px; height: 296px; border: 0; pointer-events: none;
  transform: scale(0.25); transform-origin: 0 0; background: var(--dsw-alias-bg-base);
}
.dap-thumbcard__empty {
  position: absolute; inset: 0; display: grid; place-items: center;
  font-size: 11px; color: var(--dsw-alias-label-tertiary);
}
.dap-thumbcard__title {
  position: absolute; left: 0; right: 0; bottom: 0; padding: 3px 6px;
  font-size: 10.5px; color: var(--dsw-alias-label-primary);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 88%, transparent);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; backdrop-filter: blur(4px);
}
.dap-thumbcard__tag {
  position: absolute; top: 4px; right: 5px; font-size: 9.5px; padding: 0 4px; border-radius: 4px;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 88%, transparent);
  color: var(--dsw-alias-label-tertiary);
}
.dap-strip__new {
  flex: none; width: 96px; border-radius: var(--dsw-radius-md); border: 1px dashed var(--dsw-alias-border-l2);
  background: transparent; color: var(--dsw-alias-label-tertiary); font-size: 11.5px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; cursor: pointer;
}
.dap-strip__new:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l3); }

.dap-viewer { display: flex; flex-direction: column; min-width: 0; }
.dap-viewer__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 11px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dap-viewer__title { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; min-width: 0; }
.dap-viewer__title span { color: var(--dsw-alias-label-tertiary); font-weight: 400; font-size: 11.5px; }
.dap-viewer__tools { display: flex; gap: 2px; }
.dap-stage { background: var(--dsw-alias-bg-layer-2); padding: 11px; flex: 1; min-height: 0; overflow: auto; }
.dap-frame { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md); overflow: hidden; }
.dap-frame__cap { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; font-size: 11px; color: var(--dsw-alias-label-tertiary); border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dap-iframe { display: block; width: 100%; height: clamp(420px, 56vh, 720px); border: 0; background: var(--dsw-alias-bg-base); }
.dap-insets { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 8px; }
.dap-inset {
  display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: var(--dsw-radius-md);
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); cursor: pointer;
  font-size: 11px; color: var(--dsw-alias-label-secondary); text-align: left; min-width: 0;
}
.dap-inset:hover { border-color: var(--dsw-alias-border-l3); }
.dap-inset--on { border-color: var(--dsw-alias-border-l3); box-shadow: 0 0 0 1px var(--dsw-alias-border-l3) inset; color: var(--dsw-alias-label-primary); }
.dap-inset__name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.dap-tabs { display: flex; gap: 2px; padding: 5px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dap-tab { height: 26px; padding: 0 10px; border-radius: var(--dsw-radius-md); font-size: 12px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dap-tab--on { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-weight: 550; }
.dap-insp { padding: 10px; display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 0; overflow: auto; }
.dap-field { display: flex; flex-direction: column; gap: 4px; }
.dap-field__label { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); letter-spacing: .02em; }
.dap-box {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2); padding: 7px 9px; font-size: 12px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word;
}
.dap-box__meta { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }

.dap-qa { display: flex; flex-direction: column; gap: 8px; }
.dap-msg { display: flex; flex-direction: column; gap: 3px; }
.dap-msg__who { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.dap-msg__bubble {
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2);
  border-radius: var(--dsw-radius-md); padding: 7px 9px; font-size: 12px; line-height: 1.55;
  white-space: pre-wrap; word-break: break-word;
}
.dap-msg--me .dap-msg__bubble { background: var(--dsw-alias-bg-layer-1); }
.dap-msg__acts { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 2px; }
.dap-ask { display: flex; gap: 6px; align-items: flex-end; padding: 9px 10px; border-top: 1px solid var(--dsw-alias-border-l1); position: sticky; bottom: 0; background: var(--dsw-alias-bg-layer-1); z-index: 2; }
.dap-ask textarea {
  flex: 1; resize: none; min-height: 40px; max-height: 120px; padding: 7px 9px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12px; outline: none;
}
.dap-ask textarea:focus { border-color: var(--dsw-alias-border-l3); }
.dap-hint { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); line-height: 1.5; }

.dap-runbar {
  display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding: 7px 10px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1); font-size: 11.5px; color: var(--dsw-alias-label-secondary);
  flex: none;
}
.dap-runbar b { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dap-runbar__step { color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dap-runbar__bar { flex: 1; max-width: 240px; height: 4px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.dap-runbar__bar i { display: block; height: 100%; background: var(--dsw-alias-state-business-primary); border-radius: inherit; }
.dap-runbar__pct { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-tertiary); }
.dap-runbar__tok { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; white-space: nowrap; }
.dap-spinner { width: 11px; height: 11px; border-radius: 50%; border: 2px solid var(--dsw-alias-state-business-primary); border-right-color: transparent; animation: dap-spin 1s linear infinite; flex: none; display: inline-block; }
@keyframes dap-spin { to { transform: rotate(360deg); } }

.dap-todos { display: flex; flex-direction: column; gap: 3px; border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); padding: 6px 8px; }
.dap-todo { display: flex; align-items: center; gap: 7px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.dap-todo__mark { width: 13px; flex: none; display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-state-success-primary); }
.dap-todo--done { color: var(--dsw-alias-label-tertiary); }
.dap-todo--now { color: var(--dsw-alias-label-primary); font-weight: 550; }
.dap-todo--now .dap-todo__mark { color: var(--dsw-alias-state-business-primary); }

.dap-usage { border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); padding: 7px 9px; display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; }
.dap-usage > div { display: flex; align-items: baseline; gap: 6px; }
.dap-usage span { color: var(--dsw-alias-label-tertiary); }
.dap-usage b { font-size: 13px; }
.dap-usage em { font-style: normal; color: var(--dsw-alias-label-tertiary); font-size: 10.5px; }
.dap-usage__detail { justify-content: space-between; font-size: 10.5px; }

/* ---------------------------------------------------------------- 对话框 */
.dap-mask { position: fixed; inset: 0; background: var(--dsw-alias-bg-mask-1); display: grid; place-items: center; z-index: 40; }
.dap-dialog {
  width: 540px; max-width: calc(100vw - 40px); max-height: calc(100vh - 60px); overflow: auto;
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg); box-shadow: var(--dsw-shadow-lv2); padding: 16px;
}
.dap-dialog__title { margin: 0 0 2px; font-size: 15px; font-weight: 600; }
.dap-dialog__sub { font-size: 11.5px; color: var(--dsw-alias-label-tertiary); margin-bottom: 12px; }
.dap-dialog__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 10px 0 4px; font-size: 12px; }
.dap-dialog__foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 14px; }
.dap-seg { display: inline-flex; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md); padding: 2px; }
.dap-seg__btn { height: 26px; padding: 0 9px; border-radius: var(--dsw-radius-md); font-size: 11.5px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dap-seg__btn--on { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-weight: 550; box-shadow: var(--dsw-shadow-lv2); }
.dap-input, .dap-textarea {
  width: 100%; padding: 7px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12.5px; outline: none;
}
.dap-input:focus, .dap-textarea:focus { border-color: var(--dsw-alias-border-l3); }
.dap-textarea { resize: vertical; min-height: 84px; line-height: 1.6; }
.dap-concepts { display: flex; flex-wrap: wrap; gap: 4px; }
.dap-concept {
  height: 20px; display: inline-flex; align-items: center; padding: 0 7px; border-radius: 999px;
  font-size: 11px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.dap-concept--on { border-color: transparent; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-state-business-primary); }


.dap-dialog--wide { width: 680px; }
.dap-typebar { display: flex; flex-wrap: wrap; gap: 5px; margin: 6px 0 8px; }
.dap-type-tag {
  display: inline-flex; align-items: center; gap: 5px; height: 27px; padding: 0 9px;
  border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary);
  font-size: 11.5px; cursor: pointer; white-space: nowrap;
}
.dap-type-tag:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dap-type-tag--on { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); border-color: transparent; }
.dap-type-tag__k { font-size: 9.5px; opacity: .65; font-family: ui-monospace, monospace; }
.dap-type-detail {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2); padding: 8px 10px; display: flex;
  flex-direction: column; gap: 5px; min-height: 82px;
}
.dap-type-detail__empty { font-size: 11.5px; color: var(--dsw-alias-label-secondary); line-height: 1.6; margin: auto 0; }
.dap-type-detail__head { display: flex; align-items: center; gap: 7px; font-size: 12.5px; }
.dap-type-detail__head code { font: 10px/1 ui-monospace, monospace; color: var(--dsw-alias-label-tertiary); }
.dap-type-detail__row { display: grid; grid-template-columns: 56px 1fr; gap: 8px; font-size: 11.5px; line-height: 1.55; }
.dap-type-detail__row span { color: var(--dsw-alias-label-tertiary); }
.dap-type-detail__row p { margin: 0; color: var(--dsw-alias-label-primary); }

/* ---------------------------------------------------------------- 空状态 / 提示 */
.dap-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 44px 20px; text-align: center; color: var(--dsw-alias-label-secondary); }
.dap-empty__title { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dap-empty__body { max-width: 460px; font-size: 12px; }
.dap-notice { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; padding: 7px 10px; border-radius: var(--dsw-radius-md); font-size: 11.5px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); }
.dap-notice--error { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }

@media (max-width: 1180px) {
  .dap-wb { grid-template-columns: minmax(0, 1fr); }
  .dap-wb > .dap-panel:last-child { grid-column: 1 / -1; max-height: 420px; }
  .dap-atlas { grid-template-columns: repeat(2, 1fr); }
  .dap-stats { grid-template-columns: repeat(2, 1fr); }
}
`

/** 把样式挂到 document；返回卸载函数（HMR / 插件停用时摘标签）。 */
export function installStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-archify-projects'
  style.textContent = PAGE_CSS
  document.head.appendChild(style)
  return () => style.remove()
}
