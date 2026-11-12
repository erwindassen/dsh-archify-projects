/**
 * 展示与文件名用的纯函数（零 IO）。
 *
 * 这些函数被 host（拼目录名、写日志）和 client（渲染 Git 条、时间）同时使用，
 * 所以不能碰 Date.now() —— 当前时间一律由调用方传入，测试才能确定性。
 */
import { allDiagrams } from './types.js';
/** 空值占位符，页面统一用它，避免各处出现 '' / '-' / '—' 三种。 */
export const PLACEHOLDER = '—';
/** commit 短写（7 位）；空值给占位符。 */
export function shortCommit(commit) {
    if (commit === null || commit === undefined || commit.length === 0)
        return PLACEHOLDER;
    return commit.slice(0, 7);
}
/** 本地时间戳 `YYYYMMDD-HHMMSS`，用作 archify 目录名后缀。 */
export function formatStamp(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return (`${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
        `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`);
}
/**
 * 相对时间（结构化）。
 *
 * 页面要中英双语，日文/德文同理，所以这里**不拼句子**，只回答
 * 「多久以前、以什么粒度」—— 拼句子是渲染层的事。
 */
export function relativeSpan(iso, now) {
    if (iso === null || iso === undefined || iso.length === 0)
        return null;
    const then = new Date(iso).getTime();
    if (Number.isNaN(then))
        return null;
    const deltaSec = Math.round((now.getTime() - then) / 1000);
    if (deltaSec < 60)
        return { kind: 'now', value: 0 };
    if (deltaSec < 3600)
        return { kind: 'minutes', value: Math.floor(deltaSec / 60) };
    if (deltaSec < 86400)
        return { kind: 'hours', value: Math.floor(deltaSec / 3600) };
    if (deltaSec < 86400 * 30)
        return { kind: 'days', value: Math.floor(deltaSec / 86400) };
    return { kind: 'date', value: 0, date: new Date(then).toISOString().slice(0, 10) };
}
/** 相对时间文案（中文）。宿主日志与兜底用；页面走 `relativeSpan`。 */
export function formatRelative(iso, now) {
    if (iso === null || iso === undefined || iso.length === 0)
        return PLACEHOLDER;
    const then = new Date(iso).getTime();
    if (Number.isNaN(then))
        return PLACEHOLDER;
    const deltaSec = Math.round((now.getTime() - then) / 1000);
    if (deltaSec < 0)
        return '刚刚';
    if (deltaSec < 60)
        return '刚刚';
    if (deltaSec < 3600)
        return `${Math.floor(deltaSec / 60)} 分钟前`;
    if (deltaSec < 86400)
        return `${Math.floor(deltaSec / 3600)} 小时前`;
    if (deltaSec < 86400 * 30)
        return `${Math.floor(deltaSec / 86400)} 天前`;
    return new Date(then).toISOString().slice(0, 10);
}
/** ahead / behind 文案。两者都为 null（无上游）时返回 null，页面据此隐藏整块。 */
export function aheadBehindText(ahead, behind) {
    if (ahead === null && behind === null)
        return null;
    const parts = [];
    if (ahead !== null && ahead > 0)
        parts.push(`↑${ahead}`);
    if (behind !== null && behind > 0)
        parts.push(`↓${behind}`);
    return parts.length > 0 ? parts.join(' ') : '同步';
}
/** Git 单行摘要：`branch @ shortcommit`，无 Git 时说明来源是当前目录。 */
export function gitSummary(git) {
    if (!git.isRepo)
        return '非 Git 目录 · 基于当前目录分析';
    const where = git.detached ? `detached ${shortCommit(git.commit)}` : (git.branch ?? PLACEHOLDER);
    return `${where} @ ${shortCommit(git.commit)}`;
}
/** 目录名安全化：只留 ASCII 字母数字与短横，其它折叠成单个短横。 */
export function slugify(input) {
    const ascii = input
        .normalize('NFKD')
        .replace(/[^\x20-\x7E]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (ascii.length === 0)
        return 'project';
    return ascii.slice(0, 40).replace(/-+$/g, '');
}
/** archify 目录名：`<type>-<slug>-<stamp>`，与 Skill 的约定一致。 */
export function archifyDirName(kind, slug, stamp) {
    return `${kind}-${slugify(slug)}-${stamp}`;
}
/** 图谱类型的中文标题。 */
export function diagramTitle(kind) {
    return kind === 'structure' ? '项目结构图' : '领域图';
}
/** 两张图里最新的生成时间（用于「上次分析」）。 */
export function latestGeneratedAt(project) {
    const stamps = allDiagrams(project)
        .map((diagram) => diagram.generatedAt)
        .filter((v) => v !== null)
        .sort();
    return stamps.length > 0 ? stamps[stamps.length - 1] : null;
}
/** token 数的紧凑写法：1234 → 1.2k，12_345_678 → 12.3M。 */
export function formatTokens(n) {
    if (!Number.isFinite(n) || n <= 0)
        return '0';
    if (n < 1000)
        return String(Math.round(n));
    if (n < 1_000_000)
        return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
    return `${(n / 1_000_000).toFixed(1)}M`;
}
/** 估算费用（单位：货币，由配置决定是人民币还是美元）。 */
export function estimateCost(usage, pricing) {
    if (usage === null || pricing === null)
        return null;
    const perM = 1_000_000;
    const cost = (usage.uncachedInput / perM) * pricing.inputPerMTok +
        (usage.output / perM) * pricing.outputPerMTok +
        (usage.cacheRead / perM) * pricing.cacheReadPerMTok;
    return cost;
}
/** 把绝对路径缩成「末两段」，页面里放不下全路径时用。 */
export function tailPath(fullPath, segments = 2) {
    const parts = fullPath.split(/[\\/]+/).filter((p) => p.length > 0);
    if (parts.length <= segments)
        return fullPath;
    return `…/${parts.slice(-segments).join('/')}`;
}
//# sourceMappingURL=format.js.map