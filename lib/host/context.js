/**
 * 宿主 ctx 的窄化类型。
 *
 * cordis 的 `ctx` 在运行期是一个动态服务容器，没有可用的静态类型。与其到处 `any`，
 * 不如在这里把「本插件实际用到的那几个面」逐项写出来：改宿主 API 时，
 * 编译错误会集中出现在这一个文件，而不是散落几十处。
 */
/** 取一个服务，取不到时返回 undefined（而不是抛）。 */
export function serviceOf(ctx, name) {
    try {
        const viaGet = ctx.get(name);
        if (viaGet !== undefined && viaGet !== null)
            return viaGet;
    }
    catch {
        // ctx.get 在服务不存在时会抛，这里当作「没有」
    }
    // cordis 的 ctx 是 proxy：访问未 inject 的服务，取属性这一步本身就会抛
    // 「cannot get property "x" without inject」，所以 `direct` 也必须在 try 里。
    try {
        const direct = ctx[name];
        return direct ?? undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=context.js.map