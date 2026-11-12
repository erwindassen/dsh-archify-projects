/**
 * 插件工作区：一个真实目录 + 一条 DSH workspace 记录。
 *
 * 为什么要注册进 `ctx.workspaceRegistry`：每次运行都会在该工作区里起会话，
 * 注册之后这些会话在 DSH 的会话列表里归到同一个工作区，用户能找回来。
 * 取不到 registry 服务时只建目录，功能不受影响（只是会话不归组）。
 */
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { projectDir, workspaceRoot } from './config.js';
import { serviceOf, } from './context.js';
/** 确保目录存在并尽量拿到注册表里的 workspace 记录。 */
export async function ensureWorkspace(ctx, config, logger) {
    const root = workspaceRoot(config);
    await mkdir(root, { recursive: true });
    const registry = serviceOf(ctx, 'workspaceRegistry');
    if (registry === undefined) {
        logger.warn(`工作区注册表不可用：会话不会归组，产物目录仍是 ${root}`);
        return { root, workspaceId: null };
    }
    try {
        const existing = registry
            .list()
            .find((w) => path.resolve(w.path) === path.resolve(root));
        if (existing !== undefined)
            return { root, workspaceId: existing.id };
        const created = await registry.create(root, 'Archify Projects');
        return { root, workspaceId: created.id };
    }
    catch (err) {
        logger.warn(`注册工作区失败（不致命）：${describe(err)}`);
        return { root, workspaceId: null };
    }
}
/** 确保单个项目的工作目录存在，并返回绝对路径。 */
export async function ensureProjectWorkspace(config, projectId) {
    const dir = projectDir(config, projectId);
    await mkdir(dir, { recursive: true });
    return dir;
}
/** 目录存在性检查（创建项目时用于路径校验）。 */
export async function isDirectory(target) {
    try {
        const info = await stat(target);
        return info.isDirectory();
    }
    catch {
        return false;
    }
}
/** 把路径限制在一个根目录内，防穿越。返回 null 表示越界。 */
export function confineToRoot(root, candidate) {
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(root, candidate);
    const rel = path.relative(resolvedRoot, resolved);
    if (rel.length === 0)
        return resolved;
    if (rel.startsWith('..') || path.isAbsolute(rel))
        return null;
    return resolved;
}
function describe(err) {
    return err instanceof Error ? err.message : String(err);
}
//# sourceMappingURL=workspace.js.map