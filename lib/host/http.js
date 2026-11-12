/**
 * 路由层公共设施：请求体解析、统一响应、信任栅栏。
 *
 * 三条硬约束（都是这一层唯一的正确写法）：
 *   1. 响应只从 `sendJson` / `sendError` 出，且不重复写头；
 *   2. 对外错误只回稳定 code + 一句人话，原始 message（常含绝对路径）只进日志；
 *   3. 请求体必须是 JSON 对象；空 body / 数组 / 标量在 `readJsonObject` 就抛。
 */
import { serviceOf } from './context.js';
/** 请求体上限：本插件只收短 JSON。 */
const MAX_BODY_BYTES = 256 * 1024;
/** 解析失败的类型，路由层据此回 400。 */
export class BadRequest extends Error {
    code;
    constructor(message, code = 'bad-request') {
        super(message);
        this.name = 'BadRequest';
        this.code = code;
    }
}
/** 读完整请求体并解析成 JSON 对象。 */
export async function readJsonObject(req) {
    const raw = await readBody(req);
    if (raw.trim().length === 0)
        return {};
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new BadRequest('请求体不是合法 JSON');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new BadRequest('请求体必须是 JSON 对象');
    }
    return parsed;
}
async function readBody(req) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > MAX_BODY_BYTES)
            throw new BadRequest('请求体过大');
        chunks.push(buf);
    }
    return Buffer.concat(chunks).toString('utf8');
}
/** 唯一响应出口：已发过就什么都不做。 */
export function sendJson(res, status, payload) {
    if (res.headersSent || res.writableEnded)
        return false;
    try {
        res.writeHead(status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(payload));
        return true;
    }
    catch {
        try {
            res.destroy();
        }
        catch {
            // 连接已经没了，无事可做
        }
        return false;
    }
}
/** 成功响应。 */
export function sendOk(res, value) {
    return sendJson(res, 200, { ok: true, value });
}
/** 错误响应。`err` 只进日志，不回给浏览器。 */
export function sendError(res, status, code, message, err) {
    const detail = err === undefined ? '' : ` | ${describe(err)}`;
    console.warn(`[dsh-archify-projects] ${code}: ${message}${detail}`);
    return sendJson(res, status, { ok: false, error: { code, message } });
}
function describe(err) {
    if (err instanceof Error)
        return err.message;
    try {
        return typeof err === 'string' ? err : JSON.stringify(err);
    }
    catch {
        return String(err);
    }
}
/** 请求方法（大写）。 */
export function methodOf(req) {
    return (req.method ?? 'GET').toUpperCase();
}
/** 请求路径（去掉 query）。 */
export function pathOf(req) {
    const url = req.url ?? '/';
    const index = url.indexOf('?');
    return index === -1 ? url : url.slice(0, index);
}
/**
 * 信任栅栏。
 *
 * 三道，任意一道不过即 403：
 *   1. `sec-fetch-site` 存在且不是同源/同站/直接输入；
 *   2. `Origin` 存在且 host 与请求 host 不一致；
 *   3. 宿主自己的 `connection.requestRejection`（若该服务存在）。
 *
 * 浏览器直连（无 Origin / 无 sec-fetch-site，如 curl）交给第 3 道与路由自身鉴权判断，
 * 本插件没有敏感凭据可泄露，默认放行。
 */
export function makeFence(ctx) {
    return (req) => {
        const site = firstHeader(req.headers['sec-fetch-site']);
        if (site !== null && !['same-origin', 'same-site', 'none'].includes(site)) {
            return '跨站请求被拒绝';
        }
        const hostHeader = firstHeader(req.headers.host);
        if (hostHeader === null)
            return '请求缺少 Host 头';
        const origin = firstHeader(req.headers.origin);
        if (origin !== null) {
            let originHost = null;
            try {
                originHost = new URL(origin).host.toLowerCase();
            }
            catch {
                return 'Origin 无法解析';
            }
            if (originHost !== hostHeader.toLowerCase())
                return 'Origin 与请求 host 不一致';
        }
        const connection = serviceOf(ctx, 'connection');
        if (connection !== undefined && typeof connection.requestRejection === 'function') {
            const rejected = connection.requestRejection(req);
            if (rejected !== undefined && rejected !== null && rejected !== false) {
                // 诊断信息：宿主连接的准入会同时做「可信 authority」和「浏览器会话认证」两件事，
                // 401 与 403 的处理方式完全不同，光看一条文案分不出来。
                try {
                    ctx.logger.warn(`[dsh-archify-projects] fence 拒绝 code=${String(rejected)} host=${hostHeader} origin=${origin ?? '-'} site=${site ?? '-'} method=${req.method ?? '-'} url=${req.url ?? '-'}`);
                }
                catch {
                    // 忽略日志失败
                }
                return '宿主拒绝该请求';
            }
        }
        return null;
    };
}
function firstHeader(value) {
    if (value === undefined)
        return null;
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined)
        return null;
    const trimmed = raw.trim();
    return trimmed.length === 0 ? null : trimmed;
}
/**
 * 匹配 `/projects/:id/check` 这类路径。
 *
 * 只支持 `:name` 段——本插件的路由表就这么浅，上正则引擎是过度设计。
 */
export function matchPath(pattern, pathname) {
    const patternParts = pattern.split('/').filter((p) => p.length > 0);
    const pathParts = pathname.split('/').filter((p) => p.length > 0);
    if (patternParts.length !== pathParts.length)
        return null;
    const params = {};
    for (let i = 0; i < patternParts.length; i += 1) {
        const patternPart = patternParts[i];
        const pathPart = pathParts[i];
        if (patternPart.startsWith(':')) {
            params[patternPart.slice(1)] = decodeURIComponent(pathPart);
            continue;
        }
        if (patternPart !== pathPart)
            return null;
    }
    return params;
}
//# sourceMappingURL=http.js.map