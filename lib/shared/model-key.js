/**
 * 模型路由的稳定键：`provider::model`。
 *
 * 只在 host 与 client 之间共享这一个纯函数：页面用它决定下拉里「当前选中的
 * 是哪一项」，宿主用它判重与校验。**不含推理强度**——同一个 provider/model
 * 在下拉的语义里就是同一条路由（换了 effort 也不该出现两个「同一个模型」）。
 */
/** 生成路由键。 */
export function modelKey(ref) {
    return `${ref.provider}::${ref.model}`;
}
//# sourceMappingURL=model-key.js.map