window.__ModuleLoader__.load({
	id: "dsh-archify-projects",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
let react = require("react");
let react_jsx_runtime = require("react/jsx-runtime");

// src/shared/protocol.ts
/** 所有路由的前缀。 */
const ROUTE_PREFIX = "/dsh-archify-projects";
/** 路由表。host 注册与 client 请求都从这里取，避免字符串各写一份。 */
const ROUTES = {
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
	artifact: (relativePath) => `${ROUTE_PREFIX}/artifact/${relativePath.split(/[\\/]+/).map((part) => encodeURIComponent(part)).join("/")}`
};

// src/shared/types.ts
/** 两张默认图谱（自定义图统一用 `custom`）。 */
const DIAGRAM_KINDS = ["structure", "domain"];
/** Archify 的真实渲染器（见 skills/archify 的 Type router）。 */
const ARCHIFY_TYPES = [
	"architecture",
	"workflow",
	"sequence",
	"dataflow",
	"lifecycle"
];
/** 一次运行/一次提问的 token 合计。 */
function usageTotalOf(usage) {
	if (usage === null) return 0;
	return usage.uncachedInput + usage.output + usage.cacheRead + usage.cacheWrite;
}
/** 默认两张 + 自定义图，统一成一条列表（默认在前）。 */
function allDiagrams(project) {
	return [...DIAGRAM_KINDS.map((kind) => project.diagrams[kind]), ...project.custom];
}
/** 按 id 找图；`structure` / `domain` 也能命中默认图。 */
function findDiagram(project, id) {
	if (DIAGRAM_KINDS.includes(id)) return project.diagrams[id];
	return project.custom.find((diagram) => diagram.id === id);
}
/** 工作区状态签名，用于判断图是否过期。 */
function treeSignature(tree) {
	if (tree === null) return "none";
	return `${tree.staged}:${tree.unstaged}:${tree.untracked}`;
}
/** 由 Git 快照派生「图谱是否落后于代码」——按分支 + 工作区，不看 commit。 */
function isStale(project) {
	if (!project.git.isRepo) return false;
	const ready = allDiagrams(project).filter((d) => d.status === "ready");
	if (ready.length === 0) return false;
	const currentTree = treeSignature(project.git.tree);
	return ready.some((d) => d.branch !== project.git.branch || treeSignature(d.tree) !== currentTree);
}
/** 运行记录超过这个时长还没结束，就当它已经死了。
*
* 宿主被 kill / 断电 / 重启时，`running` 会被原样留在台账里。页面如果照字面
* 相信它，就会永远显示「生成中」并把按钮全部禁用——用户只能去手改 JSON。 */
const RUN_STALE_MS = 15e5;
/** 这条运行记录还算不算「活着」。 */
function isRunAlive(run, now = Date.now()) {
	if (run.status !== "running") return false;
	const started = Date.parse(run.startedAt);
	if (Number.isNaN(started)) return false;
	return now - started < RUN_STALE_MS;
}
/** 项目是否有正在进行的运行。 */
function isRunning(project, now = Date.now()) {
	return project.runs.some((run) => isRunAlive(run, now)) || allDiagrams(project).some((d) => d.status === "queued" || d.status === "running");
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
function settleTodos(todos, status) {
	if (status === "running") return todos;
	const next = status === "succeeded" ? "completed" : "pending";
	let changed = false;
	const settled = todos.map((todo) => {
		if (todo.status !== "in_progress") return todo;
		changed = true;
		return {
			...todo,
			status: next
		};
	});
	return changed ? settled : todos;
}

// src/shared/format.ts
/**
* 相对时间（结构化）。
*
* 页面要中英双语，日文/德文同理，所以这里**不拼句子**，只回答
* 「多久以前、以什么粒度」—— 拼句子是渲染层的事。
*/
function relativeSpan(iso, now) {
	if (iso === null || iso === void 0 || iso.length === 0) return null;
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return null;
	const deltaSec = Math.round((now.getTime() - then) / 1e3);
	if (deltaSec < 60) return {
		kind: "now",
		value: 0
	};
	if (deltaSec < 3600) return {
		kind: "minutes",
		value: Math.floor(deltaSec / 60)
	};
	if (deltaSec < 86400) return {
		kind: "hours",
		value: Math.floor(deltaSec / 3600)
	};
	if (deltaSec < 2592e3) return {
		kind: "days",
		value: Math.floor(deltaSec / 86400)
	};
	return {
		kind: "date",
		value: 0,
		date: new Date(then).toISOString().slice(0, 10)
	};
}
/** token 数的紧凑写法：1234 → 1.2k，12_345_678 → 12.3M。 */
function formatTokens(n) {
	if (!Number.isFinite(n) || n <= 0) return "0";
	if (n < 1e3) return String(Math.round(n));
	if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`;
	return `${(n / 1e6).toFixed(1)}M`;
}
/** 估算费用（单位：货币，由配置决定是人民币还是美元）。 */
function estimateCost(usage, pricing) {
	if (usage === null || pricing === null) return null;
	const perM = 1e6;
	return usage.uncachedInput / perM * pricing.inputPerMTok + usage.output / perM * pricing.outputPerMTok + usage.cacheRead / perM * pricing.cacheReadPerMTok;
}

// src/client/api.ts
/** 带错误码的失败。 */
var ApiError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "ApiError";
		this.code = code;
	}
};
/** 发一次请求并解包 `{ok, value}`。 */
async function api(path, init) {
	const response = await fetch(path, {
		credentials: "same-origin",
		headers: init?.body === void 0 ? void 0 : { "Content-Type": "application/json" },
		...init
	});
	let payload;
	try {
		payload = await response.json();
	} catch {
		throw new ApiError("bad-response", `服务返回了非 JSON 内容（HTTP ${response.status}）`);
	}
	const result = payload;
	if (result.ok === true) return result.value;
	const code = result.error?.code ?? "unknown";
	const message = result.error?.message ?? "未知错误";
	throw new ApiError(code, message);
}
/** POST/PUT/PATCH/DELETE 的便捷封装。 */
function send(path, method, body) {
	return api(path, {
		method,
		body: body === void 0 ? void 0 : JSON.stringify(body)
	});
}

// src/shared/model-key.ts
/** 生成路由键。 */
function modelKey(ref) {
	return `${ref.provider}::${ref.model}`;
}

// src/client/components.tsx
/**
* 页面里可复用的小组件：标签、状态点、两个对话框。
*
* 只做展示与受控输入；请求与状态全部留在 page.tsx —— 组件不碰 fetch，
* 测试才能只渲染、不 mock 网络。
*/
/** 运行记录里的时钟：按本地时区显示 HH:mm:ss。 */
function clockText(iso) {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return iso.slice(11, 19);
	const pad = (n) => String(n).padStart(2, "0");
	return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}
/** 小标签。 */
function Chip({ tone = "default", dot = false, children }) {
	const cls = tone === "default" ? "dap-chip" : `dap-chip dap-chip--${tone}`;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
		className: cls,
		children: [dot ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			className: "dap-chip__dot",
			"aria-hidden": "true"
		}) : null, children]
	});
}
/** 状态点。 */
function Dot({ tone = "ok" }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		className: tone === "ok" ? "dap-dot" : `dap-dot dap-dot--${tone}`,
		"aria-hidden": "true"
	});
}
/** 新增项目对话框。 */
function NewProjectDialog({ t, busy, onClose, onSubmit }) {
	const [name, setName] = (0, react.useState)("");
	const [repoPath, setRepoPath] = (0, react.useState)("");
	const [invalid, setInvalid] = (0, react.useState)(false);
	const submit = () => {
		if (repoPath.trim().length === 0) {
			setInvalid(true);
			return;
		}
		onSubmit(name.trim(), repoPath.trim());
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "dap-mask",
		role: "presentation",
		onClick: (e) => e.target === e.currentTarget && onClose(),
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "dap-dialog",
			role: "dialog",
			"aria-modal": "true",
			"aria-label": t("dialog.addTitle"),
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
					className: "dap-dialog__title",
					children: t("dialog.addTitle")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dap-dialog__sub",
					children: t("empty.body")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "dap-field",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dap-field__label",
						children: t("field.name")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: "dap-input",
						value: name,
						placeholder: t("field.namePlaceholder"),
						onChange: (e) => setName(e.target.value)
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "dap-field",
					style: { marginTop: 8 },
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dap-field__label",
						children: t("field.path")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: "dap-input",
						value: repoPath,
						placeholder: t("field.pathPlaceholder"),
						"aria-invalid": invalid,
						onChange: (e) => {
							setRepoPath(e.target.value);
							setInvalid(false);
						}
					})]
				}),
				invalid ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dap-notice dap-notice--error",
					children: t("field.pathRequired")
				}) : null,
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dap-dialog__foot",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dap-hint",
						children: t("git.noRepoHint")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 6
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "dap-btn dap-btn--sm",
							onClick: onClose,
							disabled: busy,
							children: t("action.cancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "dap-btn dap-btn--sm dap-btn--primary",
							onClick: submit,
							disabled: busy,
							children: t("action.submit")
						})]
					})]
				})
			]
		})
	});
}
/** 从概念证据里推几个目录候选，够弹窗做「目录范围」。 */
function scopeOptions(project) {
	const dirs = /* @__PURE__ */ new Set();
	for (const concept of project.concepts) for (const evidence of concept.evidence) {
		const parts = evidence.split("/").filter((part) => part.length > 0);
		if (parts.length === 0) continue;
		const top = parts[0];
		dirs.add(parts.length >= 2 && (top === "src" || top === "packages" || top === "apps") ? `${top}/${parts[1]}` : top);
	}
	const out = [...dirs].slice(0, 8);
	return out.length > 0 ? out : ["src"];
}
/** 新建图对话框。 */
function NewDiagramDialog({ t, project, selectedId, busy, onClose, onSubmit }) {
	const [prompt, setPrompt] = (0, react.useState)("");
	const [persistence, setPersistence] = (0, react.useState)("permanent");
	const [underCurrent, setUnderCurrent] = (0, react.useState)(selectedId !== null);
	const [chosen, setChosen] = (0, react.useState)([]);
	const [renderer, setRenderer] = (0, react.useState)(null);
	const [pathScope, setPathScope] = (0, react.useState)([]);
	const concepts = (0, react.useMemo)(() => project.concepts.slice(0, 24), [project.concepts]);
	const scopes = (0, react.useMemo)(() => scopeOptions(project), [project]);
	const toggleConcept = (id) => {
		setChosen((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
	};
	const toggleScope = (dir) => {
		setPathScope((prev) => prev.includes(dir) ? prev.filter((x) => x !== dir) : [...prev, dir]);
	};
	const submit = () => {
		onSubmit({
			title: prompt.trim().slice(0, 24),
			prompt: prompt.trim(),
			persistence,
			parentId: underCurrent && selectedId !== null ? selectedId : null,
			conceptIds: chosen,
			renderer,
			pathScope
		});
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "dap-mask",
		role: "presentation",
		onClick: (e) => e.target === e.currentTarget && onClose(),
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "dap-dialog dap-dialog--wide",
			role: "dialog",
			"aria-modal": "true",
			"aria-label": t("dialog.newDiagram"),
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
					className: "dap-dialog__title",
					children: t("dialog.newDiagram")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dap-dialog__sub",
					children: t("dialog.newDiagramSub")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dap-dialog__row",
					style: { marginBottom: 4 },
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dap-field__label",
						children: t("field.renderer")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dap-hint",
						children: t("field.rendererHint")
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dap-typebar",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						className: renderer === null ? "dap-type-tag dap-type-tag--on" : "dap-type-tag",
						onClick: () => setRenderer(null),
						children: [
							t("renderer.auto"),
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dap-type-tag__k",
								children: "agent"
							})
						]
					}), ARCHIFY_TYPES.map((kind) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						className: renderer === kind ? "dap-type-tag dap-type-tag--on" : "dap-type-tag",
						onClick: () => setRenderer(kind),
						children: [
							t(`renderer.${kind}`),
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dap-type-tag__k",
								children: kind
							})
						]
					}, kind))]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dap-type-detail",
					children: renderer === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dap-type-detail__empty",
						children: t("renderer.autoHint")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dap-type-detail__head",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: t(`renderer.${renderer}`) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: renderer })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dap-type-detail__row",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("renderer.fit") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t(`renderer.${renderer}.fit`) })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dap-type-detail__row",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("renderer.show") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t(`renderer.${renderer}.show`) })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dap-type-detail__row",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("renderer.grasp") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t(`renderer.${renderer}.grasp`) })]
						})
					] })
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dap-field",
					style: { marginTop: 10 },
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dap-field__label",
						children: t("field.prompt")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						className: "dap-textarea",
						value: prompt,
						placeholder: renderer === null ? t("field.promptPlaceholder") : `${t(`renderer.${renderer}`)}：${t("field.promptPlaceholder")}`,
						onChange: (e) => setPrompt(e.target.value)
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dap-dialog__row",
					style: { alignItems: "flex-start" },
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dap-field__label",
						style: { flex: "none" },
						children: t("field.concepts")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dap-concepts",
						children: concepts.map((concept) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: chosen.includes(concept.id) ? "dap-concept dap-concept--on" : "dap-concept",
							onClick: () => toggleConcept(concept.id),
							title: concept.summary,
							children: concept.name
						}, concept.id))
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dap-hint",
						children: t("scope.conceptHint")
					})] })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dap-dialog__row",
					style: { alignItems: "flex-start" },
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dap-field__label",
						style: { flex: "none" },
						children: t("field.pathScope")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dap-concepts",
						children: scopes.map((dir) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: pathScope.includes(dir) ? "dap-concept dap-concept--on" : "dap-concept",
							onClick: () => toggleScope(dir),
							children: dir
						}, dir))
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dap-hint",
						children: t("scope.pathHint")
					})] })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dap-dialog__row",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dap-field__label",
						children: t("field.persistence")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dap-seg",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: persistence === "permanent" ? "dap-seg__btn dap-seg__btn--on" : "dap-seg__btn",
							onClick: () => setPersistence("permanent"),
							children: t("persistence.permanent")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: persistence === "temporary" ? "dap-seg__btn dap-seg__btn--on" : "dap-seg__btn",
							onClick: () => setPersistence("temporary"),
							children: t("persistence.temporary")
						})]
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dap-hint",
					children: persistence === "permanent" ? t("persistence.permanentHint") : t("persistence.temporaryHint")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dap-dialog__row",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dap-field__label",
						children: t("field.parent")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dap-seg",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: !underCurrent ? "dap-seg__btn dap-seg__btn--on" : "dap-seg__btn",
							onClick: () => setUnderCurrent(false),
							children: t("parent.none")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: underCurrent ? "dap-seg__btn dap-seg__btn--on" : "dap-seg__btn",
							onClick: () => setUnderCurrent(true),
							disabled: selectedId === null,
							children: t("parent.current")
						})]
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dap-dialog__foot",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dap-hint",
						children: t("qa.mergeHint")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 6
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "dap-btn dap-btn--sm",
							onClick: onClose,
							disabled: busy,
							children: t("action.cancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "dap-btn dap-btn--sm dap-btn--primary",
							onClick: submit,
							disabled: busy || prompt.trim().length === 0,
							children: t("action.submit")
						})]
					})]
				})
			]
		})
	});
}
/** 齿轮图标（设置入口）。尺寸跟随字号，颜色跟随按钮。 */
function GearIcon({ size = 13 }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
		width: size,
		height: size,
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 1.7,
		strokeLinecap: "round",
		strokeLinejoin: "round",
		"aria-hidden": "true",
		focusable: "false",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
			cx: "12",
			cy: "12",
			r: "3.1"
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a1.9 1.9 0 1 1-2.7 2.7l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.47V21a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.77.32l-.06.06a1.9 1.9 0 1 1-2.7-2.7l.06-.06A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-1.47-.97H3a1.9 1.9 0 1 1 0-3.8h.1a1.6 1.6 0 0 0 1.47-1.05 1.6 1.6 0 0 0-.32-1.77l-.06-.06a1.9 1.9 0 1 1 2.7-2.7l.06.06A1.6 1.6 0 0 0 9 4.6a1.6 1.6 0 0 0 .97-1.47V3a1.9 1.9 0 1 1 3.8 0v.1a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a1.9 1.9 0 1 1 2.7 2.7l-.06.06a1.6 1.6 0 0 0-.32 1.77V9a1.6 1.6 0 0 0 1.47.97H21a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.47.97z" })]
	});
}
/**
* 设置对话框：**只有一个字段**——分析用哪个模型。
*
* 模型选项不是插件编的，是宿主 `modelCatalog()` 列出来的（用户在 DSH 里
* 配好、当前真的能路由到的那些）。目录拿不到时只留「跟随宿主默认」一项，
* 并且把原因写在提示里，不假装能选。
*/
function SettingsDialog({ t, settings, busy, onClose, onSubmit }) {
	const catalog = settings?.catalog ?? null;
	const current = settings?.model ?? null;
	const [chosen, setChosen] = (0, react.useState)(current === null ? "" : modelKey(current));
	const options = catalog?.options ?? [];
	const selectedOption = options.find((option) => option.key === chosen) ?? null;
	const submit = () => {
		onSubmit(selectedOption === null ? null : {
			provider: selectedOption.provider,
			model: selectedOption.model
		});
	};
	const fallbackText = catalog !== null && catalog.fallback !== null ? `${catalog.fallback.provider} / ${catalog.fallback.model}` : null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "dap-mask",
		role: "presentation",
		onClick: (e) => e.target === e.currentTarget && onClose(),
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "dap-dialog",
			role: "dialog",
			"aria-modal": "true",
			"aria-label": t("dialog.settings"),
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
					className: "dap-dialog__title",
					children: t("dialog.settings")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dap-dialog__sub",
					children: t("dialog.settingsSub")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dap-dialog__row",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dap-field__label",
						children: t("field.model")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
						className: "dap-select",
						value: chosen,
						onChange: (e) => setChosen(e.target.value),
						"aria-label": t("field.model"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "",
							children: fallbackText === null ? t("model.followDefault") : t("model.followDefaultNamed", { model: fallbackText })
						}), options.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
							value: option.key,
							children: [
								option.providerName,
								" · ",
								option.name
							]
						}, option.key))]
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dap-hint",
					children: catalog === null || catalog.source === "unavailable" ? t("settings.unavailable") : options.length === 0 ? t("settings.noModels") : t("field.modelHint")
				}),
				selectedOption?.description != null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dap-hint",
					children: selectedOption.description
				}) : null,
				catalog !== null && catalog.failures.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dap-hint dap-hint--warn",
					children: t("settings.providerFailed", { list: catalog.failures.map((f) => f.providerName).join("、") })
				}) : null,
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dap-dialog__row",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dap-field__label",
						children: t("field.sessionMode")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dap-hint",
						children: settings?.subagentSessions === true ? t("settings.sessionSubagent") : t("settings.sessionPlain")
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dap-dialog__foot",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dap-hint",
						children: t("settings.scopeHint")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 6
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "dap-btn dap-btn--sm",
							onClick: onClose,
							disabled: busy,
							children: t("action.cancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "dap-btn dap-btn--sm dap-btn--primary",
							onClick: submit,
							disabled: busy,
							children: t("action.save")
						})]
					})]
				})
			]
		})
	});
}

// src/client/page.tsx
/**
* 插件主页面：图册（总览） + 工作台（三栏）。
*
* 数据全部走插件自己的 HTTP 路由；有任务在跑时 2.5s 轮询，跑完自动停 ——
* 不新增 WebSocket、不新增宿主契约。所有动作都有「进行中」状态与错误回执，
* 失败不吞。
*/
const INITIAL = {
	loading: true,
	error: null,
	projects: [],
	workspacePath: null,
	pricing: null
};
/** 有任务在跑时的轮询间隔。 */
const POLL_MS = 2500;
/** 页面组件。 */
function StudioPage({ t }) {
	const [state, setState] = (0, react.useState)(INITIAL);
	const [screen, setScreen] = (0, react.useState)("atlas");
	const [projectId, setProjectId] = (0, react.useState)(null);
	const [diagramId, setDiagramId] = (0, react.useState)(null);
	const [tab, setTab] = (0, react.useState)("info");
	const [dialog, setDialog] = (0, react.useState)(null);
	const [settings, setSettings] = (0, react.useState)(null);
	const [busy, setBusy] = (0, react.useState)(null);
	const [notice, setNotice] = (0, react.useState)(null);
	const [question, setQuestion] = (0, react.useState)("");
	const mounted = (0, react.useRef)(true);
	(0, react.useEffect)(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const load = (0, react.useCallback)(async () => {
		try {
			const value = await api(ROUTES.projects);
			if (!mounted.current) return;
			setState({
				loading: false,
				error: null,
				projects: value.projects,
				workspacePath: value.workspacePath,
				pricing: value.pricing ?? null
			});
		} catch (err) {
			if (!mounted.current) return;
			setState((prev) => ({
				...prev,
				loading: false,
				error: messageOf(err)
			}));
		}
	}, []);
	(0, react.useEffect)(() => {
		load();
	}, [load]);
	(0, react.useEffect)(() => {
		let alive = true;
		(async () => {
			try {
				const value = await api(ROUTES.settings);
				if (alive) setSettings(value);
			} catch {}
		})();
		return () => {
			alive = false;
		};
	}, []);
	const running = state.projects.some((project) => isRunning(project));
	(0, react.useEffect)(() => {
		if (!running) return void 0;
		const timer = setInterval(() => void load(), POLL_MS);
		return () => clearInterval(timer);
	}, [running, load]);
	const project = (0, react.useMemo)(() => state.projects.find((item) => item.id === projectId) ?? null, [state.projects, projectId]);
	const diagram = (0, react.useMemo)(() => project !== null && diagramId !== null ? findDiagram(project, diagramId) : void 0, [project, diagramId]);
	(0, react.useEffect)(() => {
		if (project === null) return;
		if (diagramId !== null && findDiagram(project, diagramId) !== void 0) return;
		setDiagramId(project.diagrams.structure.id);
	}, [project, diagramId]);
	const applyProject = (0, react.useCallback)((next) => {
		if (!mounted.current) return;
		setState((prev) => ({
			...prev,
			projects: prev.projects.map((item) => item.id === next.id ? next : item)
		}));
	}, []);
	const fail = (0, react.useCallback)((err) => {
		setNotice({
			text: t("error.generic", { message: messageOf(err) }),
			error: true
		});
	}, [t]);
	const openProject = (0, react.useCallback)((id) => {
		setProjectId(id);
		setScreen("wb");
		setTab("info");
		setDiagramId("structure");
	}, []);
	const runUpdate = async (target) => {
		setBusy(`update:${target.id}`);
		setNotice(null);
		try {
			const value = await send(ROUTES.update(target.id), "POST");
			applyProject(value.project);
		} catch (err) {
			fail(err);
		} finally {
			setBusy(null);
		}
	};
	const saveSettings = async (model) => {
		setBusy("settings");
		setNotice(null);
		try {
			const value = await send(ROUTES.settings, "PUT", { model });
			if (mounted.current) setSettings(value);
			setDialog(null);
		} catch (err) {
			fail(err);
		} finally {
			setBusy(null);
		}
	};
	const updateAll = async () => {
		for (const item of state.projects) {
			if (isRunning(item)) continue;
			await runUpdate(item);
		}
	};
	const regenerate = async () => {
		if (project === null || diagram === void 0) return;
		setBusy(`regen:${diagram.id}`);
		setNotice(null);
		try {
			const value = await send(ROUTES.regenerate(project.id, diagram.id), "POST");
			applyProject(value.project);
		} catch (err) {
			fail(err);
		} finally {
			setBusy(null);
		}
	};
	const createProject = async (name, repoPath) => {
		setBusy("create:project");
		setNotice(null);
		try {
			const value = await send(ROUTES.projects, "POST", {
				name,
				repoPath
			});
			setDialog(null);
			if (!mounted.current) return;
			setState((prev) => ({
				...prev,
				projects: [value.project, ...prev.projects.filter((p) => p.id !== value.project.id)]
			}));
			setProjectId(value.project.id);
			setDiagramId("structure");
			setScreen("wb");
		} catch (err) {
			fail(err);
		} finally {
			setBusy(null);
		}
	};
	const createDiagram = async (draft) => {
		if (project === null) return;
		setBusy("create:diagram");
		setNotice(null);
		try {
			const value = await send(ROUTES.diagrams(project.id), "POST", draft);
			setDialog(null);
			applyProject(value.project);
			const newest = value.project.custom[value.project.custom.length - 1];
			if (newest !== void 0) setDiagramId(newest.id);
			setNotice({
				text: t("notice.running"),
				error: false
			});
		} catch (err) {
			fail(err);
		} finally {
			setBusy(null);
		}
	};
	const ask = async () => {
		if (project === null || diagram === void 0 || question.trim().length === 0) return;
		setBusy("ask");
		setNotice(null);
		try {
			const value = await send(ROUTES.ask(project.id, diagram.id), "POST", { question: question.trim() });
			setQuestion("");
			applyProject(value.project);
		} catch (err) {
			fail(err);
		} finally {
			setBusy(null);
		}
	};
	const applyQa = async (qaId, action) => {
		if (project === null) return;
		setBusy(`${action}:${qaId}`);
		setNotice(null);
		try {
			const path = action === "merge" ? ROUTES.mergeQa(project.id, qaId) : ROUTES.childQa(project.id, qaId);
			const value = await send(path, "POST");
			applyProject(value.project);
			setNotice({
				text: t(action === "merge" ? "notice.merged" : "notice.child"),
				error: false
			});
			if (action === "child" && value.diagramId !== null) setDiagramId(value.diagramId);
		} catch (err) {
			fail(err);
		} finally {
			setBusy(null);
		}
	};
	const setPersistence = async (persistence) => {
		if (project === null || diagram === void 0) return;
		setBusy("persistence");
		try {
			const value = await send(ROUTES.customDiagram(project.id, diagram.id), "PATCH", { persistence });
			applyProject(value.project);
		} catch (err) {
			fail(err);
		} finally {
			setBusy(null);
		}
	};
	const removeDiagram = async () => {
		if (project === null || diagram === void 0) return;
		setBusy("delete:diagram");
		try {
			const value = await send(ROUTES.customDiagram(project.id, diagram.id), "DELETE");
			applyProject(value.project);
			setDiagramId("structure");
		} catch (err) {
			fail(err);
		} finally {
			setBusy(null);
		}
	};
	const ago = (iso) => {
		const span = relativeSpan(iso, /* @__PURE__ */ new Date());
		if (span === null) return t("status.none");
		if (span.kind === "now") return t("time.now");
		if (span.kind === "minutes") return t("time.minutes", { n: span.value });
		if (span.kind === "hours") return t("time.hours", { n: span.value });
		if (span.kind === "days") return t("time.days", { n: span.value });
		return span.date ?? t("status.none");
	};
	if (screen === "wb" && project !== null) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "dap-page",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
				className: "dap-head",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						className: "dap-btn dap-btn--ghost dap-btn--sm",
						onClick: () => setScreen("atlas"),
						children: ["← ", t("action.back")]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
						className: "dap-head__title",
						style: { marginTop: 6 },
						children: project.name
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dap-head__sub",
						children: project.repoPath
					})
				] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dap-head__actions",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: "dap-iconbtn",
						onClick: () => setDialog("settings"),
						title: t("action.settings"),
						"aria-label": t("action.settings"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GearIcon, {})
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: "dap-btn dap-btn--sm dap-btn--primary",
						onClick: () => void runUpdate(project),
						disabled: busy !== null || isRunning(project),
						children: t("action.update")
					})]
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dap-scroll dap-scroll--wb",
				children: [notice !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: notice.error ? "dap-notice dap-notice--error" : "dap-notice",
					children: notice.text
				}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Workbench, {
					t,
					project,
					diagram,
					tab,
					busy,
					question,
					pricing: state.pricing,
					ago,
					onTab: setTab,
					onQuestion: setQuestion,
					onAsk: () => void ask(),
					onSelect: setDiagramId,
					onRegenerate: () => void regenerate(),
					onPersistence: (p) => void setPersistence(p),
					onDelete: () => void removeDiagram(),
					onQa: (id, action) => void applyQa(id, action),
					onNewDiagram: () => setDialog("diagram")
				})]
			}),
			dialog === "settings" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SettingsDialog, {
				t,
				settings,
				busy: busy !== null,
				onClose: () => setDialog(null),
				onSubmit: (model) => void saveSettings(model)
			}) : null,
			dialog === "diagram" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NewDiagramDialog, {
				t,
				project,
				selectedId: diagram?.id ?? null,
				busy: busy !== null,
				onClose: () => setDialog(null),
				onSubmit: (draft) => void createDiagram(draft)
			}) : null
		]
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "dap-page",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
				className: "dap-head",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
					className: "dap-head__title",
					children: t("page.title")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dap-head__sub",
					children: t("page.subtitle")
				})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dap-head__actions",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "dap-iconbtn",
							onClick: () => setDialog("settings"),
							title: t("action.settings"),
							"aria-label": t("action.settings"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GearIcon, {})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "dap-btn dap-btn--sm",
							onClick: () => void updateAll(),
							disabled: busy !== null || state.projects.length === 0,
							children: t("action.updateAll")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							className: "dap-btn dap-btn--sm dap-btn--primary",
							onClick: () => setDialog("project"),
							children: ["+ ", t("action.add")]
						})
					]
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dap-scroll",
				children: [
					notice !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: notice.error ? "dap-notice dap-notice--error" : "dap-notice",
						children: notice.text
					}) : null,
					state.error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dap-notice dap-notice--error",
						children: state.error
					}) : null,
					state.projects.length === 0 && !state.loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dap-empty",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dap-empty__title",
								children: t("empty.title")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dap-empty__body",
								children: t("empty.body")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dap-btn dap-btn--sm dap-btn--primary",
								onClick: () => setDialog("project"),
								children: t("empty.action")
							})
						]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dap-stats",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dap-stat",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dap-stat__k",
									children: t("stat.repos")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dap-stat__v",
									children: state.projects.length
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dap-stat",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dap-stat__k",
									children: t("stat.concepts")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dap-stat__v",
									children: state.projects.reduce((sum, item) => sum + item.concepts.length, 0)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dap-stat",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dap-stat__k",
									children: t("stat.diagrams")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dap-stat__v",
									children: state.projects.reduce((sum, item) => sum + allDiagrams(item).length, 0)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dap-stat",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dap-stat__k",
									children: t("stat.running")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dap-stat__v",
									children: state.projects.filter((item) => isRunning(item)).length
								})]
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dap-atlas",
						children: state.projects.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AtlasCard, {
							t,
							project: item,
							busy,
							ago,
							onOpen: () => openProject(item.id),
							onUpdate: () => void runUpdate(item)
						}, item.id))
					})] })
				]
			}),
			dialog === "settings" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SettingsDialog, {
				t,
				settings,
				busy: busy !== null,
				onClose: () => setDialog(null),
				onSubmit: (model) => void saveSettings(model)
			}) : null,
			dialog === "project" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NewProjectDialog, {
				t,
				busy: busy !== null,
				onClose: () => setDialog(null),
				onSubmit: (name, repoPath) => void createProject(name, repoPath)
			}) : null
		]
	});
}
function AtlasCard({ t, project, busy, ago, onOpen, onUpdate }) {
	const diagrams = allDiagrams(project);
	const stale = isStale(project);
	const running = isRunning(project);
	const tree = project.git.tree;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
		className: "dap-card",
		role: "button",
		tabIndex: 0,
		onClick: onOpen,
		onKeyDown: (event) => {
			if (event.key === "Enter" || event.key === " ") onOpen();
		},
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dap-card__top",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dap-repo",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, { tone: running ? "run" : stale ? "warn" : "ok" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: { minWidth: 0 },
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dap-repo__name",
							children: project.name
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dap-repo__path",
							children: project.repoPath
						})]
					})]
				})
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dap-chips",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chip, {
						dot: true,
						children: project.git.isRepo ? project.git.branch ?? t("git.detached") : t("git.noRepo")
					}),
					tree !== null && tree.staged + tree.unstaged + tree.untracked > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chip, {
						tone: "warn",
						children: t("git.treeShort", {
							staged: tree.staged,
							unstaged: tree.unstaged
						})
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chip, {
						tone: "ok",
						children: t("git.clean")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Chip, {
						tone: "accent",
						children: [
							project.concepts.length,
							" ",
							t("concept.title")
						]
					}),
					stale ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chip, {
						tone: "warn",
						children: t("status.stale")
					}) : null
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dap-thumbs",
				children: diagrams.slice(0, 3).map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dap-thumb",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dap-thumb__title",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: item.title }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dap-thumb__count",
							children: item.persistence === "temporary" ? t("persistence.temporary") : t("status.ready")
						})]
					})
				}, item.id))
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dap-card__foot",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [running ? t("runbar.step", { step: activeStep(project) ?? t("runbar.unknown") }) : `${project.git.branch ?? t("git.noRepo")} · ${ago(diagrams.find((d) => d.generatedAt)?.generatedAt ?? null)}`, project.usageTotal > 0 ? ` · ${formatTokens(project.usageTotal)} tokens` : ""] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					className: "dap-btn dap-btn--sm",
					onClick: (event) => {
						event.stopPropagation();
						onUpdate();
					},
					children: t("action.update")
				})]
			}),
			busy === `update:${project.id}` ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dap-hint",
				children: t("notice.running")
			}) : null
		]
	});
}
function Workbench({ t, project, diagram, tab, busy, question, pricing, ago, onTab, onQuestion, onAsk, onSelect, onRegenerate, onPersistence, onDelete, onQa, onNewDiagram }) {
	const custom = project.custom;
	const children = diagram === void 0 ? [] : custom.filter((item) => item.parentId === diagram.id);
	const parent = diagram?.parentId != null ? findDiagram(project, diagram.parentId) : void 0;
	const thread = project.qa.filter((entry) => entry.diagramId === diagram?.id);
	const tree = project.git.tree;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "dap-chips",
			style: { marginBottom: 10 },
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chip, {
					dot: true,
					children: project.git.isRepo ? project.git.branch ?? t("git.detached") : t("git.noRepo")
				}),
				tree !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chip, {
					tone: "warn",
					children: t("git.tree", {
						staged: tree.staged,
						unstaged: tree.unstaged,
						untracked: tree.untracked
					})
				}) : null,
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dap-hint",
					children: t("meta.branchLevel", { branch: project.git.branch ?? "—" })
				})
			]
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RunBar, {
			t,
			project
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "dap-wb",
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dap-panel dap-viewer",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ThumbStrip, {
						t,
						project,
						selectedId: diagram?.id ?? null,
						onSelect,
						onNewDiagram
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dap-viewer__head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dap-viewer__title",
							children: [diagram?.title ?? t("status.none"), parent !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["/ ", parent.title] }) : null]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dap-viewer__tools",
							children: [diagram?.htmlPath != null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								className: "dap-btn dap-btn--ghost dap-btn--sm",
								href: ROUTES.artifact(diagram.htmlPath),
								target: "_blank",
								rel: "noreferrer",
								children: t("action.openTab")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								className: "dap-btn dap-btn--ghost dap-btn--sm",
								href: ROUTES.artifact(diagram.htmlPath),
								target: "_blank",
								rel: "noreferrer",
								children: t("action.fullscreen")
							})] }) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dap-btn dap-btn--ghost dap-btn--sm",
								onClick: onRegenerate,
								disabled: busy !== null,
								children: t("action.regenerate")
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dap-stage",
						children: [diagram?.status === "ready" && diagram.htmlPath !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dap-frame",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dap-frame__cap",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									project.git.branch ?? t("git.noRepo"),
									" · ",
									ago(diagram.generatedAt)
								] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: diagram.title })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
								className: "dap-iframe",
								title: diagram.title,
								src: ROUTES.artifact(diagram.htmlPath),
								sandbox: "allow-scripts allow-same-origin",
								onLoad: (event) => hideArtifactHeader(event.currentTarget)
							})]
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dap-frame",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dap-empty",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dap-empty__title",
										children: diagram === void 0 ? t("status.none") : t(`status.${diagram.status}`)
									}),
									diagram?.error != null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dap-empty__body",
										children: diagram.error
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dap-empty__body",
										children: t("notice.running")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dap-btn dap-btn--sm dap-btn--primary",
										onClick: onRegenerate,
										disabled: busy !== null,
										children: t("action.regenerate")
									})
								]
							})
						}), children.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dap-insets",
							children: children.map((child) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								className: child.id === diagram?.id ? "dap-inset dap-inset--on" : "dap-inset",
								onClick: () => onSelect(child.id),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, { tone: child.status === "ready" ? "ok" : child.status === "failed" ? "err" : "run" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dap-inset__name",
									children: child.title
								})]
							}, child.id))
						}) : null]
					})
				]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dap-panel",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dap-tabs",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: tab === "info" ? "dap-tab dap-tab--on" : "dap-tab",
						onClick: () => onTab("info"),
						children: t("field.status")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						className: tab === "qa" ? "dap-tab dap-tab--on" : "dap-tab",
						onClick: () => onTab("qa"),
						children: [t("qa.title"), thread.length > 0 ? ` ${thread.length}` : ""]
					})]
				}), tab === "info" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dap-insp",
					children: diagram === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dap-hint",
						children: t("status.none")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dap-field",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dap-field__label",
								children: t("field.status")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dap-chips",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chip, {
										tone: diagram.status === "ready" ? "ok" : diagram.status === "failed" ? "warn" : "default",
										children: t(`status.${diagram.status}`)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chip, {
										tone: diagram.persistence === "permanent" ? "accent" : "default",
										children: diagram.persistence === "permanent" ? t("persistence.permanent") : t("persistence.temporary")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chip, { children: ago(diagram.generatedAt) })
								]
							})]
						}),
						diagram.kind === "custom" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dap-field",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dap-field__label",
								children: t("field.prompt")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dap-box",
								children: [diagram.prompt ?? t("status.none"), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dap-box__meta",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dap-btn dap-btn--ghost dap-btn--sm",
										onClick: () => onPersistence(diagram.persistence === "permanent" ? "temporary" : "permanent"),
										disabled: busy !== null,
										children: diagram.persistence === "permanent" ? t("persistence.temporary") : t("persistence.permanent")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dap-btn dap-btn--ghost dap-btn--sm",
										onClick: onDelete,
										disabled: busy !== null,
										children: t("action.delete")
									})]
								})]
							})]
						}) : null,
						diagram.error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dap-notice dap-notice--error",
							children: diagram.error
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dap-field",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dap-field__label",
								children: t("field.branch")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dap-chips",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chip, {
									dot: true,
									children: diagram.branch ?? project.git.branch ?? t("git.noRepo")
								}), diagram.tree !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chip, { children: t("git.treeShort", {
									staged: diagram.tree.staged,
									unstaged: diagram.tree.unstaged
								}) }) : null]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dap-field",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dap-field__label",
								children: t("field.concepts")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dap-chips",
								children: diagram.conceptIds.length === 0 ? project.concepts.slice(0, 6).map((concept) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chip, { children: concept.name }, concept.id)) : diagram.conceptIds.map((id) => {
									const concept = project.concepts.find((item) => item.id === id);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chip, { children: concept?.name ?? id }, id);
								})
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dap-field",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dap-field__label",
								children: t("progress.title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TodoList, {
								t,
								todos: project.lastRun?.todos ?? [],
								status: project.lastRun?.status ?? null
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dap-field",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dap-field__label",
								children: t("usage.title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageBlock, {
								t,
								project,
								pricing
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dap-field",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dap-field__label",
								children: t("run.history")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dap-hint",
								children: project.runs.slice(-3).reverse().map((run) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
									clockText(run.startedAt),
									" · ",
									t(`run.kind.${run.kind}`),
									" ·",
									" ",
									t(`run.status.${run.status}`)
								] }, run.id))
							})]
						})
					] })
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dap-insp",
						children: [thread.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dap-hint",
							children: t("qa.empty")
						}) : null, thread.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dap-qa",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dap-msg dap-msg--me",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dap-msg__who",
									children: t("qa.me")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dap-msg__bubble",
									children: entry.question
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dap-msg",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dap-msg__who",
										children: t("qa.answer")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dap-msg__bubble",
										children: entry.answer
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dap-msg__acts",
										children: entry.applied ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chip, {
											tone: "ok",
											children: t("qa.applied")
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											className: "dap-btn dap-btn--sm",
											onClick: () => onQa(entry.id, "merge"),
											disabled: busy !== null,
											children: t("action.merge")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											className: "dap-btn dap-btn--sm",
											onClick: () => onQa(entry.id, "child"),
											disabled: busy !== null,
											children: t("action.child")
										})] })
									})
								]
							})]
						}, entry.id))]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dap-ask",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							value: question,
							placeholder: t("qa.placeholder"),
							onChange: (event) => onQuestion(event.target.value),
							disabled: busy === "ask"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "dap-btn dap-btn--sm dap-btn--primary",
							onClick: onAsk,
							disabled: busy !== null || question.trim().length === 0,
							children: busy === "ask" ? t("qa.working") : t("action.send")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dap-hint",
						style: { padding: "0 10px 10px" },
						children: t("qa.mergeHint")
					})
				] })]
			})]
		})
	] });
}
/** 图片上方的图名 tab 条：默认两张 + 自定义图（子图挂在父图后面）。 */
function ThumbStrip({ t, project, selectedId, onSelect, onNewDiagram }) {
	const diagrams = allDiagrams(project);
	const defaults = diagrams.filter((item) => item.kind !== "custom");
	const custom = diagrams.filter((item) => item.kind === "custom");
	const roots = custom.filter((item) => item.parentId === null);
	const childrenOf = (id) => custom.filter((item) => item.parentId === id);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "dap-strip",
		role: "tablist",
		"aria-label": t("page.title"),
		children: [
			defaults.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Thumb, {
				t,
				diagram: item,
				active: item.id === selectedId,
				onSelect
			}, item.id)),
			roots.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dap-strip__sep",
				"aria-hidden": "true"
			}) : null,
			roots.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Thumb, {
				t,
				diagram: item,
				active: item.id === selectedId,
				onSelect
			}), childrenOf(item.id).map((child) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Thumb, {
				t,
				diagram: child,
				active: child.id === selectedId,
				child: true,
				onSelect
			}, child.id))] }, item.id)),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				className: "dap-strip__new",
				onClick: onNewDiagram,
				title: t("action.newDiagram"),
				children: ["＋ ", t("action.newDiagram")]
			})
		]
	});
}
/**
* 内嵌查看器里去掉成品自带的页头（大标题 + 状态圆点）。
*
* 成品 HTML 顶部有一行「<项目名> · 图名」的大标题和一个 pulse-dot，而插件自己的
* 查看器标题栏已经写了图名、帧头也写了分支与时间——重复一遍只是白吃画布高度。
* 只在 iframe 里注入，点「新窗口」单独打开时仍是成品原样（那里没有外层标题）。
* 同源才改得动；被沙箱或跨域挡住就静默跳过，不影响看图。
*/
function hideArtifactHeader(frame) {
	try {
		const doc = frame.contentDocument;
		if (doc === null) return;
		if (doc.head.querySelector("style[data-embedded=\"compact\"]") !== null) return;
		const style = doc.createElement("style");
		style.dataset.embedded = "compact";
		style.textContent = ".header{display:none!important}";
		doc.head.appendChild(style);
	} catch {}
}
/**
* 一个图名 tab：只有文字，没有缩略图。
*
* 之前用 0.25 倍 iframe 做真预览，一条占 91px，把图片本身压下去；改成纯文字后
* 整条 32px，状态用一个 5px 圆点表达，临时图挂一个小标签。
*/
function Thumb({ t, diagram, active, child = false, onSelect }) {
	const tone = diagram.status === "ready" ? "ok" : diagram.status === "failed" ? "err" : "warn";
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
		className: [
			"dap-tabitem",
			active ? "dap-tabitem--on" : "",
			child ? "dap-tabitem--child" : ""
		].filter((part) => part.length > 0).join(" "),
		role: "tab",
		"aria-selected": active,
		onClick: () => onSelect(diagram.id),
		title: `${diagram.title} · ${t(`status.${diagram.status}`)}`,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, { tone }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dap-tabitem__name",
				children: diagram.title
			}),
			diagram.persistence === "temporary" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dap-tabitem__tag",
				children: t("persistence.temporaryShort")
			}) : null
		]
	});
}
function messageOf(err) {
	if (err instanceof ApiError) return err.message;
	return err instanceof Error ? err.message : String(err);
}
/** 运行中当前步骤；没有 todo 时返回 null。 */
function activeStep(project) {
	return (project.lastRun?.todos.find((item) => item.status === "in_progress"))?.content ?? null;
}
/** 顶部运行进度条：只在有 agent 在跑时出现。 */
function RunBar({ t, project }) {
	const run = project.lastRun;
	const running = isRunning(project);
	const qaRunning = project.qa.find((entry) => entry.status === "running");
	if (!running && qaRunning === void 0) return null;
	const todos = running ? run?.todos ?? [] : qaRunning?.todos ?? [];
	const current = todos.find((todo) => todo.status === "in_progress");
	const done = todos.filter((todo) => todo.status === "completed").length;
	const percent = todos.length === 0 ? 0 : Math.round(done / todos.length * 100);
	const usage = running ? run?.usage ?? null : qaRunning?.usage ?? null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "dap-runbar",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dap-spinner",
				"aria-hidden": "true"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: t("runbar.running") }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "dap-runbar__step",
				children: [t("runbar.step", { step: current?.content ?? todos[0]?.content ?? t("runbar.unknown") }), todos.length > 0 ? `（${done}/${todos.length}）` : ""]
			}),
			todos.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dap-runbar__bar",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: { width: `${percent}%` } })
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "dap-runbar__pct",
				children: [percent, "%"]
			})] }) : null,
			usage !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dap-runbar__tok",
				children: t("runbar.tokens", { n: formatTokens(usageTotalOf(usage)) })
			}) : null
		]
	});
}
/** todo 列表：✓ / spinner / ○。 */
function TodoList({ t, todos, status = null }) {
	if (todos.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
		className: "dap-hint",
		children: t("progress.none")
	});
	const shown = status === null ? todos : settleTodos(todos, status);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "dap-todos",
		children: shown.map((todo) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: todo.status === "completed" ? "dap-todo dap-todo--done" : todo.status === "in_progress" ? "dap-todo dap-todo--now" : "dap-todo",
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dap-todo__mark",
				"aria-hidden": "true",
				children: todo.status === "completed" ? "✓" : todo.status === "in_progress" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dap-spinner" }) : "○"
			}), todo.content]
		}, todo.content))
	});
}
/** 用量块：本次 / 累计 tokens，配了单价才算钱。 */
function UsageBlock({ t, project, pricing }) {
	const current = project.lastRun?.usage ?? null;
	const cost = estimateCost(current, pricing);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "dap-usage",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("usage.current") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: formatTokens(usageTotalOf(current)) }),
				cost !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("em", { children: t("usage.estimated", { cost: cost.toFixed(3) }) }) : null
			] }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("usage.total") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: formatTokens(project.usageTotal) })] }),
			current !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dap-usage__detail",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("usage.detail", {
					input: formatTokens(current.uncachedInput),
					cacheRead: formatTokens(current.cacheRead),
					output: formatTokens(current.output)
				}) })
			}) : null,
			pricing === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dap-hint",
				children: t("usage.estimateNote")
			}) : null
		]
	});
}

// src/client/panel.tsx
/** 三点连接的结构图小图标，用 currentColor 跟随侧栏配色。 */
function PanelIcon({ size = 16 }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
		width: size,
		height: size,
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 1.6,
		strokeLinecap: "round",
		strokeLinejoin: "round",
		style: { display: "block" },
		"aria-hidden": "true",
		focusable: "false",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
				d: "M3.6 6.3V5.2c0-.9.7-1.6 1.6-1.6h3",
				opacity: "0.55"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
				d: "M20.4 17.7v1.1c0 .9-.7 1.6-1.6 1.6h-3",
				opacity: "0.55"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
				cx: "7.6",
				cy: "9.4",
				r: "2.1"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
				cx: "16.4",
				cy: "7.1",
				r: "1.7"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
				cx: "12.6",
				cy: "16.6",
				r: "1.7"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M9.5 8.4l5.1-1" }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8.6 11.2l2.9 3.6" }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
				d: "M15.9 8.8l-2.2 5.9",
				opacity: "0.7"
			})
		]
	});
}

// src/client/locale.ts
/**
* 页面文案。中英双语，键集合必须完全一致（`tests/contract/locale.test.ts` 守着）。
*
* 不放在 `locale/*.json` 里：那两个文件是**包级元数据**（宿主用来显示插件名与描述），
* 页面内的即时文案走 `ctx.locale.register(ns, DICT)`。
*/
const LOCALE_NS = "dsh-archify-projects";
/** 中文（默认）。 */
const zh = {
	"panel.title": "架构建模",
	"panel.desc": "代码库概念与图册",
	"page.title": "架构建模",
	"page.subtitle": "代码库 → 概念 → 图册 · 按分支维护，工作区改动一起纳入",
	"stat.repos": "在册仓库",
	"stat.concepts": "已提取概念",
	"stat.diagrams": "图与套图",
	"stat.running": "正在生成",
	"tab.info": "图信息",
	"tab.qa": "提问",
	"action.add": "新增项目",
	"action.refresh": "刷新",
	"action.update": "更新图册",
	"action.updateAll": "全部更新",
	"action.check": "重探 Git",
	"action.openTab": "新窗口",
	"action.fullscreen": "全屏",
	"action.regenerate": "重画",
	"action.delete": "删除",
	"action.openSession": "查看会话",
	"action.cancel": "取消",
	"action.settings": "设置",
	"dialog.settings": "设置",
	"dialog.settingsSub": "只影响这个插件的分析会话，不动 DSH 里你自己的默认模型。",
	"field.model": "分析模型",
	"field.modelHint": "选项来自你在 DSH 里已经配好、当前能路由的模型。",
	"field.sessionMode": "会话形态",
	"model.followDefault": "跟随宿主默认",
	"model.followDefaultNamed": "跟随宿主默认（{model}）",
	"settings.noModels": "宿主的模型目录是空的：去 DSH 设置里配一个模型，这里才有得选。",
	"settings.unavailable": "这个宿主版本没有提供模型目录，只能跟随宿主默认。",
	"settings.providerFailed": "{list} 的模型列表取不到（网络或凭据），暂时不能选。",
	"settings.sessionSubagent": "子代理会话（不占用左侧会话列表）",
	"settings.sessionPlain": "普通会话（宿主不支持子代理会话）",
	"settings.scopeHint": "保存后对下一次运行生效",
	"action.submit": "创建并分析",
	"action.close": "关闭",
	"action.back": "返回图册",
	"action.newDiagram": "新建图",
	"action.ask": "提问",
	"action.send": "发送",
	"action.merge": "补进图里",
	"action.child": "创建子图",
	"action.save": "保存",
	"empty.title": "还没有项目",
	"empty.body": "新增一个项目：填名称和本地代码库路径，插件会先提取概念，再生成默认两张图。",
	"empty.action": "新增第一个项目",
	"dialog.addTitle": "新增项目",
	"field.name": "项目名称",
	"field.namePlaceholder": "留空则用目录名",
	"field.path": "代码库路径",
	"field.pathPlaceholder": "/home/me/projects/your-repo",
	"field.pathRequired": "请填写代码库路径",
	"dialog.newDiagram": "新建图",
	"dialog.newDiagramSub": "用自然语言描述要什么图，agent 读代码后按这个 prompt 画。",
	"field.title": "标题",
	"field.titlePlaceholder": "例如：一次更新的调用链",
	"field.prompt": "出图要求",
	"field.promptPlaceholder": "例如：画出一次「更新」从按钮到产物回收的完整调用链，标出每一步失败会怎样。",
	"field.persistence": "时效",
	"field.parent": "归属",
	"field.concepts": "概念范围",
	"field.branch": "分支",
	"field.status": "状态",
	"field.generatedAt": "生成时间",
	"field.owner": "所属",
	"field.tree": "工作区",
	"field.renderer": "图型",
	"field.pathScope": "目录范围",
	"field.rendererHint": "点一下看它展示什么、能让你掌握什么",
	"renderer.auto": "不限",
	"renderer.autoHint": "不选也行：Archify 会按你的 prompt 自行判断图型；选了只是让 agent 少猜一步，图会更稳。",
	"renderer.fit": "适合看",
	"renderer.show": "会展示",
	"renderer.grasp": "能掌握",
	"renderer.architecture": "架构图",
	"renderer.architecture.fit": "系统由什么组成、谁依赖谁",
	"renderer.architecture.show": "组件与服务、进程/网络/信任边界、外部依赖",
	"renderer.architecture.grasp": "分层与职责、关键依赖、边界外的风险",
	"renderer.workflow": "流程图",
	"renderer.workflow.fit": "一个流程怎么走、有哪些判断与审批",
	"renderer.workflow.show": "步骤、分支条件、失败与回退",
	"renderer.workflow.grasp": "主流程与异常路径、谁在什么条件下做什么",
	"renderer.sequence": "时序图",
	"renderer.sequence.fit": "一次请求在模块之间怎么往返",
	"renderer.sequence.show": "参与者、消息顺序、返回与异步",
	"renderer.sequence.grasp": "调用链、时序依赖、失败重试点",
	"renderer.dataflow": "数据流",
	"renderer.dataflow.fit": "数据从哪来、经过谁、到哪去",
	"renderer.dataflow.show": "数据源、转换、存储、消费者",
	"renderer.dataflow.grasp": "数据血缘与口径、敏感数据流向",
	"renderer.lifecycle": "状态机",
	"renderer.lifecycle.fit": "一个对象有哪些状态、怎么流转",
	"renderer.lifecycle.show": "状态、转移条件、终态",
	"renderer.lifecycle.grasp": "状态机全貌、等待与重试、非法流转",
	"scope.conceptHint": "选中概念会限制取证范围：agent 只围绕这几个概念读代码，图更聚焦。不选则自行取舍。",
	"scope.pathHint": "只让 agent 在这些目录里取证；不选则扫全仓库。",
	"persistence.permanent": "永久 · 下次更新沿用",
	"persistence.temporary": "临时 · 仅这一次",
	"persistence.temporaryShort": "临时",
	"persistence.permanentHint": "存住 prompt，下次「更新图册」自动用同一 prompt 重画。",
	"persistence.temporaryHint": "只跑这一次，不占下次更新的时间；产物仍可查看。",
	"parent.none": "独立套图",
	"parent.current": "挂在当前图下",
	"git.noRepo": "非 Git 目录",
	"git.noRepoHint": "不做分支切换，直接基于当前目录分析",
	"git.branch": "分支",
	"git.dirty": "工作区有未提交改动",
	"git.clean": "工作区干净",
	"git.detached": "分离头指针",
	"git.checkedAt": "探测于 {time}",
	"git.behind": "落后 {n}",
	"git.ahead": "领先 {n}",
	"git.inSync": "与上游同步",
	"git.tree": "暂存 {staged} · 未暂存 {unstaged} · 未跟踪 {untracked}",
	"git.treeShort": "{staged} 暂存 · {unstaged} 未暂存",
	"status.idle": "未生成",
	"status.queued": "排队中",
	"status.running": "生成中",
	"status.ready": "已就绪",
	"status.failed": "失败",
	"status.stale": "工作区有变化",
	"status.none": "—",
	"runbar.running": "生成中",
	"runbar.step": "正在：{step}",
	"runbar.tokens": "本次 {n} tokens",
	"runbar.unknown": "正在准备…",
	"progress.title": "进度（agent 的 todo）",
	"progress.none": "agent 还没写 todo",
	"usage.title": "用量",
	"usage.current": "本次",
	"usage.total": "累计",
	"usage.detail": "输入 {input} · 缓存读 {cacheRead} · 输出 {output}",
	"usage.estimated": "≈ {cost}",
	"usage.estimateNote": "按配置单价估算，不是账单",
	"usage.tokens": "{n} tokens",
	"qa.running": "agent 正在读代码回答…",
	"qa.title": "提问",
	"qa.empty": "对这张图提问；agent 只读代码与这张图来回答。",
	"qa.placeholder": "例如：路由注册失败时插件会怎样？",
	"qa.answer": "agent",
	"qa.me": "我",
	"qa.applied": "已补进图里",
	"qa.working": "agent 正在读代码回答…",
	"qa.mergeHint": "「补进图里」会把这次回答并进这张图并重画；「创建子图」会挂一张新图。",
	"concept.title": "概念",
	"run.history": "运行记录",
	"run.none": "还没有运行记录",
	"run.kind.create": "首次生成",
	"run.kind.update": "更新",
	"run.kind.regenerate": "重生成",
	"run.status.running": "运行中",
	"run.status.succeeded": "成功",
	"run.status.failed": "失败",
	"meta.repoPath": "代码库",
	"meta.createdAt": "创建于 {time}",
	"meta.generatedAt": "生成于 {time}",
	"meta.branchLevel": "按分支维护 {branch}",
	"confirm.update": "更新会先快进到上游最新提交，然后用同一 prompt 重画所有永久图。继续？",
	"confirm.delete": "删除只移除台账和产物目录，不会动你的代码库。继续？",
	"confirm.updateOk": "更新",
	"error.generic": "出错了：{message}",
	"notice.dirty": "工作区有未提交改动，已跳过自动同步，本次基于当前内容分析。",
	"notice.noGit": "这个目录不是 Git 仓库，跳过分支切换。",
	"notice.running": "Agent 正在生成图谱，完成后会自动刷新。",
	"notice.merged": "已把回答并进图里，正在重画。",
	"notice.child": "已创建子图，正在生成。",
	"notice.temporary": "这是临时图：只跑这一次，下次更新不会重画。",
	"time.now": "刚刚",
	"time.minutes": "{n} 分钟前",
	"time.hours": "{n} 小时前",
	"time.days": "{n} 天前"
};
/** English. */
const en = {
	"panel.title": "Archify",
	"panel.desc": "Concepts and diagram atlas",
	"page.title": "Architecture Studio",
	"page.subtitle": "Codebase → concepts → atlas · per branch, working tree included",
	"stat.repos": "Repositories",
	"stat.concepts": "Concepts",
	"stat.diagrams": "Diagrams & sets",
	"stat.running": "Generating",
	"tab.info": "Info",
	"tab.qa": "Ask",
	"action.add": "New project",
	"action.refresh": "Refresh",
	"action.update": "Update atlas",
	"action.updateAll": "Update all",
	"action.check": "Re-check Git",
	"action.openTab": "Open",
	"action.fullscreen": "Fullscreen",
	"action.regenerate": "Redraw",
	"action.delete": "Delete",
	"action.openSession": "Open session",
	"action.cancel": "Cancel",
	"action.settings": "Settings",
	"dialog.settings": "Settings",
	"dialog.settingsSub": "Only affects this plugin's analysis sessions; your own default model in DSH stays untouched.",
	"field.model": "Analysis model",
	"field.modelHint": "Options are the models already configured in DSH and currently routable.",
	"field.sessionMode": "Session",
	"model.followDefault": "Follow the host default",
	"model.followDefaultNamed": "Follow the host default ({model})",
	"settings.noModels": "The host catalog is empty. Configure a model in DSH settings to pick one here.",
	"settings.unavailable": "This host version exposes no model catalog; the host default is used.",
	"settings.providerFailed": "Could not list models for {list} (network or credentials).",
	"settings.sessionSubagent": "Subagent session (kept out of the sidebar list)",
	"settings.sessionPlain": "Plain session (this host lacks subagent sessions)",
	"settings.scopeHint": "Applies to the next run",
	"action.submit": "Create and analyse",
	"action.close": "Close",
	"action.back": "Back to atlas",
	"action.newDiagram": "New diagram",
	"action.ask": "Ask",
	"action.send": "Send",
	"action.merge": "Merge into diagram",
	"action.child": "Create child diagram",
	"action.save": "Save",
	"empty.title": "No projects yet",
	"empty.body": "Add a project with a local repository path. Concepts are extracted first, then the two default diagrams are generated.",
	"empty.action": "Add your first project",
	"dialog.addTitle": "New project",
	"field.name": "Project name",
	"field.namePlaceholder": "Defaults to the folder name",
	"field.path": "Repository path",
	"field.pathPlaceholder": "/home/me/projects/your-repo",
	"field.pathRequired": "Repository path is required",
	"dialog.newDiagram": "New diagram",
	"dialog.newDiagramSub": "Describe the diagram you want. The agent reads the code and draws from this prompt.",
	"field.title": "Title",
	"field.titlePlaceholder": "e.g. Update call chain",
	"field.prompt": "Prompt",
	"field.promptPlaceholder": "e.g. Draw the full call chain of an update, from the button to artifact collection, including failure modes.",
	"field.persistence": "Lifetime",
	"field.parent": "Placement",
	"field.concepts": "Concept scope",
	"field.branch": "Branch",
	"field.status": "Status",
	"field.generatedAt": "Generated",
	"field.owner": "Owner",
	"field.tree": "Working tree",
	"field.renderer": "Diagram type",
	"field.pathScope": "Directories",
	"field.rendererHint": "Click one to see what it shows and what you get",
	"renderer.auto": "Any",
	"renderer.autoHint": "Optional: Archify picks a type from your prompt on its own. Choosing one just saves the agent a guess.",
	"renderer.fit": "Best for",
	"renderer.show": "Shows",
	"renderer.grasp": "You learn",
	"renderer.architecture": "Architecture",
	"renderer.architecture.fit": "What the system is made of and who depends on whom",
	"renderer.architecture.show": "Components and services, process/network/trust boundaries, external deps",
	"renderer.architecture.grasp": "Layers and responsibilities, key dependencies, outside-boundary risks",
	"renderer.workflow": "Workflow",
	"renderer.workflow.fit": "How a process runs, which branches and approvals exist",
	"renderer.workflow.show": "Steps, branch conditions, failures and fallbacks",
	"renderer.workflow.grasp": "Main and exception paths, who does what under which condition",
	"renderer.sequence": "Sequence",
	"renderer.sequence.fit": "How one request round-trips between modules",
	"renderer.sequence.show": "Participants, message order, returns and async",
	"renderer.sequence.grasp": "Call chains, ordering dependencies, retry points",
	"renderer.dataflow": "Dataflow",
	"renderer.dataflow.fit": "Where data comes from, passes through, and ends up",
	"renderer.dataflow.show": "Sources, transforms, storage, consumers",
	"renderer.dataflow.grasp": "Lineage and definitions, sensitive-data movement",
	"renderer.lifecycle": "Lifecycle",
	"renderer.lifecycle.fit": "Which states an object has and how it transitions",
	"renderer.lifecycle.show": "States, transition conditions, terminal states",
	"renderer.lifecycle.grasp": "The state machine, waits and retries, illegal transitions",
	"scope.conceptHint": "Selected concepts narrow the evidence: the agent reads only around them, so the diagram stays focused. Optional.",
	"scope.pathHint": "Only let the agent read these directories; leave empty to scan the whole repository.",
	"persistence.permanent": "Permanent · reuse next update",
	"persistence.temporary": "Temporary · this run only",
	"persistence.temporaryShort": "TEMP",
	"persistence.permanentHint": "The prompt is kept; the next atlas update redraws it with the same prompt.",
	"persistence.temporaryHint": "Runs once, skipped on future updates; artifacts stay available.",
	"parent.none": "Own set",
	"parent.current": "Under selected diagram",
	"git.noRepo": "Not a Git repository",
	"git.noRepoHint": "No branch switching; analysis runs on the current directory",
	"git.branch": "Branch",
	"git.dirty": "Uncommitted changes",
	"git.clean": "Clean",
	"git.detached": "Detached HEAD",
	"git.checkedAt": "Checked {time}",
	"git.behind": "{n} behind",
	"git.ahead": "{n} ahead",
	"git.inSync": "Up to date",
	"git.tree": "{staged} staged · {unstaged} unstaged · {untracked} untracked",
	"git.treeShort": "{staged} staged · {unstaged} unstaged",
	"status.idle": "Not generated",
	"status.queued": "Queued",
	"status.running": "Generating",
	"status.ready": "Ready",
	"status.failed": "Failed",
	"status.stale": "Working tree changed",
	"status.none": "—",
	"runbar.running": "Generating",
	"runbar.step": "Now: {step}",
	"runbar.tokens": "{n} tokens this run",
	"runbar.unknown": "Preparing…",
	"progress.title": "Progress (agent todos)",
	"progress.none": "The agent has not written todos yet",
	"usage.title": "Usage",
	"usage.current": "This run",
	"usage.total": "Total",
	"usage.detail": "{input} input · {cacheRead} cache read · {output} output",
	"usage.estimated": "≈ {cost}",
	"usage.estimateNote": "Estimated from configured unit prices, not a bill",
	"usage.tokens": "{n} tokens",
	"qa.running": "The agent is reading code…",
	"qa.title": "Ask",
	"qa.empty": "Ask about this diagram; the agent answers from the code and this diagram only.",
	"qa.placeholder": "e.g. What happens when route registration fails?",
	"qa.answer": "agent",
	"qa.me": "me",
	"qa.applied": "Merged into diagram",
	"qa.working": "The agent is reading code…",
	"qa.mergeHint": "Merge folds the answer into this diagram and redraws it; Create child attaches a new diagram.",
	"concept.title": "Concepts",
	"run.history": "Runs",
	"run.none": "No runs yet",
	"run.kind.create": "Initial",
	"run.kind.update": "Update",
	"run.kind.regenerate": "Regenerate",
	"run.status.running": "Running",
	"run.status.succeeded": "Succeeded",
	"run.status.failed": "Failed",
	"meta.repoPath": "Repository",
	"meta.createdAt": "Created {time}",
	"meta.generatedAt": "Generated {time}",
	"meta.branchLevel": "Maintained per branch {branch}",
	"confirm.update": "Update fast-forwards to the latest upstream commit, then redraws every permanent diagram with its own prompt. Continue?",
	"confirm.delete": "Deleting removes the ledger entry and artifact folder only; your repository is untouched. Continue?",
	"confirm.updateOk": "Update",
	"error.generic": "Error: {message}",
	"notice.dirty": "Working tree has uncommitted changes; automatic sync was skipped and this run uses the current content.",
	"notice.noGit": "This directory is not a Git repository; branch switching is skipped.",
	"notice.running": "The agent is generating diagrams. This refreshes automatically.",
	"notice.merged": "Answer merged into the diagram; redrawing.",
	"notice.child": "Child diagram created; generating.",
	"notice.temporary": "Temporary diagram: runs once and is skipped on future updates.",
	"time.now": "just now",
	"time.minutes": "{n} min ago",
	"time.hours": "{n} h ago",
	"time.days": "{n} d ago"
};
/** 注册给 `ctx.locale.register` 的字典。 */
const DICT = {
	zh,
	en
};

// src/client/styles.ts
/**
* 页面样式。
*
* 两条硬规则：
*   1. **只用 DSH alias 令牌**（`--dsw-alias-*` / `--dsw-radius-*`），不写死任何色值 ——
*      宿主切深浅色时 alias 自动翻转，页面不需要第二条样式分支；
*   2. 所有类名带 `dap-` 前缀，样式以 `<style data-plugin>` 注入并在卸载时摘掉，
*      不污染宿主。
*/
const PAGE_CSS = `
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
  cursor: pointer; text-align: left; width: 100%; min-width: 0; transition: border-color .15s, box-shadow .15s;
  /* 宿主没有全局 border-box：不写死就会让 100% 宽 + 14px padding 溢出栅格列。 */
  box-sizing: border-box;
}
.dap-card:hover { border-color: var(--dsw-alias-border-l3); box-shadow: var(--dsw-shadow-lv2); }
.dap-card__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.dap-repo { display: flex; align-items: center; gap: 7px; min-width: 0; }
.dap-repo__name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dap-repo__path { font-size: 11px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: ui-monospace, monospace; }
.dap-chips { display: flex; flex-wrap: wrap; gap: 5px; }
/* 图条：等宽分栏，行宽永远等于卡片内容宽。
   旧的 1fr 1fr 会被子项的 min-content 撑宽（撑出卡片边框外），必须 minmax(0, 1fr)；
   auto-fit 让「只有一张图」时自然占满整行，不再靠 grid-column: 1 / -1 单独拉长。 */
.dap-thumbs { display: grid; grid-template-columns: repeat(auto-fit, minmax(165px, 1fr)); gap: 6px; }
.dap-thumb {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2); padding: 6px 8px;
  min-width: 0; box-sizing: border-box;
}
.dap-thumb__title { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 11px; color: var(--dsw-alias-label-secondary); min-width: 0; }
.dap-thumb__title b { flex: 1 1 auto; min-width: 0; font-weight: 550; color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dap-thumb__title .dap-thumb__count { flex: none; }
.dap-thumb__count { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.dap-card__foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11.5px; color: var(--dsw-alias-label-tertiary); min-width: 0; }
.dap-card__foot > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---------------------------------------------------------------- 工作台 */
.dap-wb { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 12px; align-items: stretch; flex: 1; min-height: 0; }
.dap-panel { border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
.dap-panel__body { overflow: auto; flex: 1; min-height: 0; }
.dap-panel__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 11px; border-bottom: 1px solid var(--dsw-alias-border-l1); font-size: 11.5px; color: var(--dsw-alias-label-tertiary); }
.dap-panel__body { padding: 7px; }

.dap-strip {
  display: flex; gap: 2px; align-items: center; padding: 4px 8px;
  overflow-x: auto; border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1); flex: none;
}
.dap-strip__sep { flex: none; width: 1px; height: 16px; background: var(--dsw-alias-border-l1); margin: 0 4px; }
.dap-tabitem {
  display: inline-flex; align-items: center; gap: 6px; flex: none; max-width: 220px;
  height: 26px; padding: 0 9px; border-radius: var(--dsw-radius-md);
  border: 1px solid transparent; background: transparent;
  color: var(--dsw-alias-label-secondary); font-size: 12px; cursor: pointer; white-space: nowrap;
}
.dap-tabitem:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dap-tabitem--on {
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  font-weight: 550; border-color: var(--dsw-alias-border-l1);
}
.dap-tabitem--child { margin-left: 10px; }
.dap-tabitem--child::before { content: "└"; color: var(--dsw-alias-label-tertiary); font-size: 10px; }
.dap-tabitem__name { overflow: hidden; text-overflow: ellipsis; }
.dap-tabitem__tag {
  font-size: 9.5px; padding: 0 4px; border-radius: 4px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-tertiary); font-weight: 400;
}
.dap-strip__new {
  flex: none; margin-left: auto; height: 26px; padding: 0 9px; border-radius: var(--dsw-radius-md);
  border: 1px dashed var(--dsw-alias-border-l2); background: transparent;
  color: var(--dsw-alias-label-tertiary); font-size: 11.5px; cursor: pointer; white-space: nowrap;
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

/* 头部图标按钮（设置齿轮）：与 dap-btn--sm 同高，窄一点 */
.dap-iconbtn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: var(--dsw-radius-md);
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.dap-iconbtn:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }

/* 设置弹窗的模型下拉：原生 select 最省事，长列表也能滚动 */
.dap-select {
  min-width: 240px; max-width: 380px; height: 28px; padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12px; outline: none; cursor: pointer;
}
.dap-select:focus { border-color: var(--dsw-alias-border-l3); }
.dap-hint--warn { color: var(--dsw-alias-state-warning-primary, var(--dsw-alias-label-tertiary)); }
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
`;
/** 把样式挂到 document；返回卸载函数（HMR / 插件停用时摘标签）。 */
function installStyles() {
	const style = document.createElement("style");
	style.dataset.plugin = "dsh-archify-projects";
	style.textContent = PAGE_CSS;
	document.head.appendChild(style);
	return () => style.remove();
}

// src/client/entry.tsx
/**
* 客户端入口。
*
* 产物里的 `exports.apply` / `exports.inject` 就是 `window.__ModuleLoader__` 要的
* Cordis 插件面；`load({ id, factory })` 的壳由 tsdown 的 banner/footer 生成
* （见 tsdown.config.ts），这里只管导出。
*
* 两个槽：
*   ① `sidebar.panellist` —— 左侧顶栏的入口图标，`id` 就是面板 id；
*   ② `main` —— 点开后的整页，`key` 与 `id` 必须一模一样。
*/
/** 面板 id：侧栏入口与主面板共用的唯一标识。 */
const PANEL_ID = "archify-projects";
/** 需要客户端服务：插槽注册表 + 文案目录。 */
const inject = ["slots", "locale"];
/** 插件入口。 */
function apply(ctx) {
	ctx.effect(() => ctx.locale.register(LOCALE_NS, DICT), "dsh-archify-projects: dictionaries");
	const t = ctx.locale.bind(LOCALE_NS);
	const Page = () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StudioPage, { t });
	ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
		name: "sidebar.panellist",
		id: PANEL_ID,
		order: 16,
		locale: LOCALE_NS,
		label: () => t("panel.title")
	}, PanelIcon));
	ctx.slots.inject("main", () => ctx.slots.register({
		name: "main",
		key: PANEL_ID,
		locale: LOCALE_NS
	}, Page));
	ctx.effect(installStyles, "dsh-archify-projects: styles");
}

exports.PANEL_ID = PANEL_ID;
exports.apply = apply;
exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map