/**
 * HTTP 协议：路由、请求/响应类型、错误码。
 *
 * host 与 client 共用；改这里等于改接口契约，两侧同时失配会立刻被类型检查抓到。
 */
/** 所有路由的前缀。 */
export const ROUTE_PREFIX = '/dsh-archify-projects';
/** 路由表。host 注册与 client 请求都从这里取，避免字符串各写一份。 */
export const ROUTES = {
    health: `${ROUTE_PREFIX}/health`,
    projects: `${ROUTE_PREFIX}/projects`,
    project: (id) => `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}`,
    check: (id) => `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}/check`,
    update: (id) => `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}/update`,
    /** 兼容旧接口：按 kind 重画默认图。 */
    diagram: (id, kind) => `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}/diagram/${kind}`,
    diagrams: (id) => `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}/diagrams`,
    customDiagram: (id, diagramId) => `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}/diagrams/${encodeURIComponent(diagramId)}`,
    regenerate: (id, diagramId) => `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}/diagrams/${encodeURIComponent(diagramId)}/regenerate`,
    ask: (id, diagramId) => `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}/diagrams/${encodeURIComponent(diagramId)}/ask`,
    mergeQa: (id, qaId) => `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}/qa/${encodeURIComponent(qaId)}/merge`,
    childQa: (id, qaId) => `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}/qa/${encodeURIComponent(qaId)}/child`,
    runs: (id) => `${ROUTE_PREFIX}/projects/${encodeURIComponent(id)}/runs`,
    /** 插件级设置（目前只有「分析用哪个模型」）。 */
    settings: `${ROUTE_PREFIX}/settings`,
    artifact: (relativePath) => `${ROUTE_PREFIX}/artifact/${relativePath
        .split(/[\\/]+/)
        .map((part) => encodeURIComponent(part))
        .join('/')}`,
};
/** 生成产物在 res 里的机器标记（prompt 要求 agent 输出，runner 解析）。 */
export const ARTIFACT_MARKER = 'ARCHIFY_ARTIFACT';
//# sourceMappingURL=protocol.js.map