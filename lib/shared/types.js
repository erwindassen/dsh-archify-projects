/**
 * 台账数据模型（纯类型 + 纯构造函数，零 IO）。
 *
 * 这里是 host 与 client 唯一的「事实形状」来源：宿主写盘用它，页面渲染用它，
 * 序列化契约（protocol.ts 的请求/响应）也复用它。改这里的字段等于改协议版本。
 *
 * v2（图册）：版本口径从 commit 级降到分支级；图谱从「两张固定图」变成
 * 「默认两张 + 任意自定义图」；概念（Concept）成为项目级一等公民；
 * 图可以临时（只跑这一次）或永久（下次更新沿用同一 prompt）。
 */
/** 台账文件格式版本。字段形状不兼容时 +1，并在 store 里做迁移。 */
export const LEDGER_VERSION = 2;
/** 两张默认图谱（自定义图统一用 `custom`）。 */
export const DIAGRAM_KINDS = ['structure', 'domain'];
/** Archify 的真实渲染器（见 skills/archify 的 Type router）。 */
export const ARCHIFY_TYPES = [
    'architecture',
    'workflow',
    'sequence',
    'dataflow',
    'lifecycle',
];
/** 一次运行/一次提问的 token 合计。 */
export function usageTotalOf(usage) {
    if (usage === null)
        return 0;
    return usage.uncachedInput + usage.output + usage.cacheRead + usage.cacheWrite;
}
/** 空 Git 快照（无 Git 或尚未探测）。 */
export function emptyGitSnapshot(checkedAt) {
    return {
        isRepo: false,
        root: null,
        branch: null,
        detached: false,
        commit: null,
        commitFull: null,
        commitTime: null,
        commitSubject: null,
        upstream: null,
        ahead: null,
        behind: null,
        dirty: null,
        tree: null,
        remoteUrl: null,
        checkedAt,
    };
}
/** 默认两张图的标题。 */
const DEFAULT_TITLES = {
    structure: '项目结构图',
    domain: '领域图',
};
/** 空图谱状态。 */
export function emptyDiagramState(kind = 'structure') {
    return {
        id: kind,
        kind,
        title: DEFAULT_TITLES[kind],
        prompt: null,
        persistence: 'permanent',
        parentId: null,
        setId: kind === 'structure' ? 'structure' : null,
        conceptIds: [],
        renderer: 'architecture',
        pathScope: [],
        status: 'idle',
        htmlPath: null,
        specPath: null,
        generatedAt: null,
        branch: null,
        tree: null,
        error: null,
    };
}
/** 空台账。 */
export function emptyLedger(now) {
    return { version: LEDGER_VERSION, updatedAt: now, projects: [] };
}
/** 默认两张 + 自定义图，统一成一条列表（默认在前）。 */
export function allDiagrams(project) {
    return [...DIAGRAM_KINDS.map((kind) => project.diagrams[kind]), ...project.custom];
}
/** 按 id 找图；`structure` / `domain` 也能命中默认图。 */
export function findDiagram(project, id) {
    if (DIAGRAM_KINDS.includes(id)) {
        return project.diagrams[id];
    }
    return project.custom.find((diagram) => diagram.id === id);
}
/** 不可变地替换一张图（默认图走 record，自定义图走数组）。 */
export function withDiagram(project, next) {
    if (DIAGRAM_KINDS.includes(next.kind)) {
        return {
            ...project,
            diagrams: { ...project.diagrams, [next.kind]: next },
        };
    }
    return { ...project, custom: project.custom.map((d) => (d.id === next.id ? next : d)) };
}
/** 需要「更新图册」的图：默认两张 + 所有永久自定义图。 */
export function runnableDiagrams(project) {
    return allDiagrams(project).filter((diagram) => diagram.persistence === 'permanent' || DIAGRAM_KINDS.includes(diagram.kind));
}
/** 工作区状态签名，用于判断图是否过期。 */
export function treeSignature(tree) {
    if (tree === null)
        return 'none';
    return `${tree.staged}:${tree.unstaged}:${tree.untracked}`;
}
/** 由 Git 快照派生「图谱是否落后于代码」——按分支 + 工作区，不看 commit。 */
export function isStale(project) {
    if (!project.git.isRepo)
        return false;
    const ready = allDiagrams(project).filter((d) => d.status === 'ready');
    if (ready.length === 0)
        return false;
    const currentTree = treeSignature(project.git.tree);
    return ready.some((d) => d.branch !== project.git.branch || treeSignature(d.tree) !== currentTree);
}
/** 运行记录超过这个时长还没结束，就当它已经死了。
 *
 * 宿主被 kill / 断电 / 重启时，`running` 会被原样留在台账里。页面如果照字面
 * 相信它，就会永远显示「生成中」并把按钮全部禁用——用户只能去手改 JSON。 */
export const RUN_STALE_MS = 25 * 60 * 1000;
/** 这条运行记录还算不算「活着」。 */
export function isRunAlive(run, now = Date.now()) {
    if (run.status !== 'running')
        return false;
    const started = Date.parse(run.startedAt);
    if (Number.isNaN(started))
        return false;
    return now - started < RUN_STALE_MS;
}
/** 项目是否有正在进行的运行。 */
export function isRunning(project, now = Date.now()) {
    return (project.runs.some((run) => isRunAlive(run, now)) ||
        allDiagrams(project).some((d) => d.status === 'queued' || d.status === 'running'));
}
/** 有运行记录卡在 running、但其实早就过期了的项目。 */
export function hasStaleRun(project, now = Date.now()) {
    return project.runs.some((run) => run.status === 'running' && !isRunAlive(run, now));
}
/** 项目名兜底：名称空时用仓库目录名。 */
export function defaultProjectName(repoPath) {
    const parts = repoPath.split(/[\\/]+/).filter((part) => part.length > 0);
    return parts.length > 0 ? parts[parts.length - 1] : repoPath;
}
/** 纯构造：不读盘、不探测，把已知事实拼成一条台账记录。 */
export function createProject(input) {
    return {
        id: input.id,
        name: input.name,
        repoPath: input.repoPath,
        createdAt: input.now,
        updatedAt: input.now,
        git: input.git,
        diagrams: { structure: emptyDiagramState('structure'), domain: emptyDiagramState('domain') },
        custom: [],
        concepts: [],
        qa: [],
        lastRun: null,
        runs: [],
        usageTotal: 0,
    };
}
/** 当前正在进行的 todo（没有就是 null）。 */
export function activeTodo(run) {
    if (run === null)
        return null;
    return run.todos.find((todo) => todo.status === 'in_progress') ?? null;
}
/**
 * 把 todo 收敛到「已经没人在跑」的状态。
 *
 * agent 经常在最后一步（回报产物标记）没来得及再写一次 `todo_write` 就被判 idle，
 * 台账里于是留下一条永远 `in_progress` 的记录：页面会一直转圈、卡片一直显示
 * 「正在：回报产物标记与统计」，用户以为跑了几天还没结束。
 *
 * 规则：运行结束就不再有任何「正在进行」。
 *   - `succeeded` → 剩下的 in_progress 记成 completed（整轮跑完了，最后一步确实发生）；
 *   - `failed`    → 退回 pending（做到哪一步不知道，别假装完成）；
 *   - `running`   → 原样返回（还在跑，本来就有当前步骤）。
 */
export function settleTodos(todos, status) {
    if (status === 'running')
        return todos;
    const next = status === 'succeeded' ? 'completed' : 'pending';
    let changed = false;
    const settled = todos.map((todo) => {
        if (todo.status !== 'in_progress')
            return todo;
        changed = true;
        return { ...todo, status: next };
    });
    return changed ? settled : todos;
}
//# sourceMappingURL=types.js.map