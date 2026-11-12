/**
 * 插件配置：默认值、解析与校验。
 *
 * 不用 schemastery 是因为本插件只有 5 个标量字段，而 schemastery 会引入一个
 * 宿主内部包的硬依赖；对第三方插件来说，手写解析 + 明确报错更稳。
 */
import os from 'node:os';
import path from 'node:path';
import { resolveOutputLanguage } from '../shared/language.js';
/** DSH 配置根。 */
export function dshHome() {
    const env = process.env.DSH_HOME;
    if (typeof env === 'string' && env.trim().length > 0)
        return path.resolve(env.trim());
    return path.join(os.homedir(), '.dsh');
}
/**
 * 解析配置。
 *
 * 非法值一律回落到默认值并**记录**（由调用方打印），不抛异常 ——
 * 一个配置项写错不应该让整个插件在宿主启动期炸掉。
 */
export function resolveConfig(raw, warnings) {
    const dataDirDefault = path.join(dshHome(), 'dsh-archify-projects');
    const dataDir = readString(raw?.dataDir, dataDirDefault, 'dataDir', warnings);
    const presetId = readString(raw?.presetId, 'archify-projects', 'presetId', warnings);
    const askPresetId = readString(raw?.askPresetId, 'archify-projects-ask', 'askPresetId', warnings);
    const skillRaw = raw?.archifySkillDir;
    const archifySkillDir = typeof skillRaw === 'string' && skillRaw.trim().length > 0
        ? path.resolve(skillRaw.trim())
        : null;
    const languageRaw = raw?.outputLanguage;
    let outputLanguage = null;
    if (languageRaw !== undefined && languageRaw !== null) {
        if (typeof languageRaw !== 'string' || languageRaw.trim().length === 0) {
            warnings.push('配置项 outputLanguage 不是非空字符串，已忽略');
        }
        else {
            outputLanguage = resolveOutputLanguage(languageRaw);
        }
    }
    return {
        dataDir: path.resolve(dataDir),
        presetId,
        askPresetId,
        archifySkillDir,
        outputLanguage,
        runTimeoutMs: readPositiveInt(raw?.runTimeoutMs, 20 * 60 * 1000, 'runTimeoutMs', warnings),
        askTimeoutMs: readPositiveInt(raw?.askTimeoutMs, 6 * 60 * 1000, 'askTimeoutMs', warnings),
        keepRuns: readPositiveInt(raw?.keepRuns, 20, 'keepRuns', warnings),
        pricing: readPricing(raw?.pricing, warnings),
    };
}
function readString(value, fallback, field, warnings) {
    if (value === undefined || value === null)
        return fallback;
    if (typeof value !== 'string' || value.trim().length === 0) {
        warnings.push(`配置项 ${field} 不是非空字符串，已回落到默认值`);
        return fallback;
    }
    return value.trim();
}
function readPositiveInt(value, fallback, field, warnings) {
    if (value === undefined || value === null)
        return fallback;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        warnings.push(`配置项 ${field} 不是正整数，已回落到默认值`);
        return fallback;
    }
    return n;
}
/** 读单价配置；三个字段都必须是非负数，否则整块作废。 */
function readPricing(value, warnings) {
    if (value === undefined || value === null)
        return null;
    if (typeof value !== 'object') {
        warnings.push('配置项 pricing 不是对象，已忽略（页面只显示 token）');
        return null;
    }
    const raw = value;
    const read = (key) => {
        const n = Number(raw[key]);
        return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const inputPerMTok = read('inputPerMTok');
    const outputPerMTok = read('outputPerMTok');
    const cacheReadPerMTok = read('cacheReadPerMTok');
    if (inputPerMTok === null || outputPerMTok === null || cacheReadPerMTok === null) {
        warnings.push('配置项 pricing 缺字段或不是非负数，已忽略（页面只显示 token）');
        return null;
    }
    return { inputPerMTok, outputPerMTok, cacheReadPerMTok };
}
/** 台账文件的绝对路径。 */
export function ledgerPath(config) {
    return path.join(config.dataDir, 'projects.json');
}
/** 插件工作区目录（所有运行产物都在这里）。 */
export function workspaceRoot(config) {
    return path.join(config.dataDir, 'workspace');
}
/** 单个项目的工作目录。 */
export function projectDir(config, projectId) {
    return path.join(workspaceRoot(config), projectId);
}
//# sourceMappingURL=config.js.map