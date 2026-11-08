# dsh-archify-projects 设计与开发文档

> 状态：v1 设计定稿（2026-11-06）
> 参照物：`tt-a1i/archify` 的 `integrations/deepseek-harness`（`@tt-a1i/archify-dsh`，adapter 1.0.0 / Skill 3.0.1）。
> 本插件**不是** archify-dsh 的复刻：archify-dsh 只做「塞一个 Skill 提供方」，本插件做「项目台账 + Git 感知 + Agent 编排 + 图谱产物管理」的工作台。

---

## 1. 目标与非目标

### 1.1 目标

| #   | 能力                           | 验收口径                                                                                                                                                             |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | 左侧顶栏入口                   | `sidebar.panellist` 出现条目，图标 + 标题随侧栏折叠自适应，点击后主面板切到本插件页面                                                                                |
| G2  | 新增项目                       | 填「名称 + 代码库路径」即建项目；路径必须存在且是目录                                                                                                                |
| G3  | 自动识别 Git                   | 有 `.git` 时记录 `root / branch / HEAD commit / 上游 / ahead-behind / 工作区脏否`；无 Git 时 `git.isRepo=false`，跳过分支逻辑                                        |
| G4  | 生成两张图                     | 项目结构图（`architecture`）+ 领域图（`architecture`，领域建模口径），产出独立 HTML + `candidate.json`，页面内可预览                                                 |
| G5  | 更新                           | 有 Git：`fetch → 切回记录的分支 → 快进到最新 commit → 重新分析`；无 Git：直接重新分析当前目录                                                                        |
| G6  | 打开即同步                     | 打开项目详情时后台静默探测 Git 漂移（分支变了 / 有新 commit / 工作区脏），有漂移则在卡片上给出「更新」引导                                                           |
| G7  | Agent 更新复用 DSH             | 更新走 DSH 自己的 agent（`ctx.sessionController` / `ctx.agents`），模型、会话日志、审批全部复用宿主                                                                  |
| G8  | 插件工作区                     | `$DSH_HOME/dsh-archify-projects/workspace` 目录 + 注册进 `ctx.workspaceRegistry`；每次运行的会话挂在这个 workspace 上                                                |
| G9  | 对话只有 archify、无关工具禁用 | preset `archify-projects` 只挂 fs / fs-search / shell / skill-base 五个工具插件；skill 提供方是隔离的（只有 archify）；`skill` 工具按名字守卫，非 `archify` 一律拒绝 |
| G10 | 双主题                         | 页面只用 DSH alias token，`data-ds-dark-theme` 切换后黑白背景均正常（含图表 iframe 外框、状态点、表格斑马纹）                                                        |

### 1.2 非目标（v1 明确不做）

- 不做代码库克隆（只接受已存在于本机的路径）；不做远端仓库浏览。
- 不做多图类型任意组合（固定两张：结构图 + 领域图）。
- 不做图谱 diff / 版本对比（每轮产物按时间戳目录保留，旧版可直接打开）。
- 不改 DSH 内置页面；不 append 到 `document.body`；不替换 app root。
- 不内联打包 React（客户端走宿主模块表）。

---

## 2. 关键概念

- **项目（Project）**：一条台账记录 = 名称 + 代码库绝对路径 + Git 快照 + 两份图谱产物状态。
- **运行（Run）**：一次 Agent 执行。`kind` 为 `create` / `update` / `regenerate`。每次运行会新建一个 DSH 会话，`sessionId` 记录在案，前端可「打开会话」追日志。
- **插件工作区（Plugin Workspace）**：`<DSH_HOME>/dsh-archify-projects/workspace`。所有运行产物写在这里，不进用户仓库。
- **图谱产物（Diagram）**：`{ htmlPath, specPath, generatedAt, branch, commit, status, error }`。

---

## 3. 数据模型

### 3.1 存储位置

```
$DSH_HOME/dsh-archify-projects/
  projects.json          # 台账（原子写：tmp + rename）
  workspace/             # 插件工作区（注册为 DSH workspace）
    <projectId>/
      .archify/
        architecture-<slug>-<YYYYMMDD-HHMMSS>/
          candidate.json
          <slug>.html
        domain-<slug>-<YYYYMMDD-HHMMSS>/
          candidate.json
          <slug>.html
```

### 3.2 `projects.json`

```jsonc
{
  "version": 1,
  "updatedAt": "2026-11-06T13:00:00.000Z",
  "projects": [
    {
      "id": "prj_9f2c1a", // 稳定 id，创建后不变
      "name": "cashloan-mono",
      "repoPath": "D:\\work\\cashloan-mono",
      "createdAt": "...",
      "updatedAt": "...",
      "git": {
        "isRepo": true,
        "root": "D:\\work\\cashloan-mono",
        "branch": "feature/risk-engine",
        "detached": false,
        "commit": "a1b2c3d",
        "commitFull": "a1b2c3d...",
        "commitTime": "2026-11-05T09:12:33+08:00",
        "commitSubject": "feat: add risk engine",
        "upstream": "origin/feature/risk-engine",
        "ahead": 0,
        "behind": 2,
        "dirty": true,
        "remoteUrl": "git@github.com:org/repo.git",
        "checkedAt": "...",
      },
      "diagrams": {
        "structure": {
          "status": "ready",
          "htmlPath": "...",
          "specPath": "...",
          "generatedAt": "...",
          "branch": "...",
          "commit": "...",
          "error": null,
        },
        "domain": {
          "status": "idle",
          "htmlPath": null,
          "specPath": null,
          "generatedAt": null,
          "branch": null,
          "commit": null,
          "error": null,
        },
      },
      "lastRun": {
        "id": "run_1a2b",
        "kind": "create",
        "status": "running",
        "sessionId": "sess_...",
        "startedAt": "...",
        "finishedAt": null,
        "error": null,
      },
    },
  ],
}
```

`git` 快照字段全部可空：无 Git 时 `isRepo:false` 而其余字段为 `null`。

产物状态机：`idle → queued → running → ready | failed`。

### 3.3 不变量

1. `id` 创建后不变；`repoPath` 可改（改路径视为重新探测 Git，图谱产物保留但标记 `stale:true`）。
2. 同一项目同一时刻最多一个 `queued|running` 的 Run。
3. 删除项目只删台账与项目工作区目录，**永不**碰 `repoPath` 指向的代码库。
4. 所有路径写入前 `path.resolve`，并拒绝 `repoPath` 为空串或不是目录。

---

## 4. 架构分层

```
src/
  shared/                 # 纯函数与类型，零 IO，host 与 client 同时 import
    types.ts              # Project / Diagram / GitSnapshot / Run 类型与默认值
    protocol.ts           # HTTP 路由约定 + 请求/响应类型 + 错误码
    prompt.ts             # Agent 提示词模板构建（纯函数，可单测）
    format.ts             # 展示用格式化（相对时间、commit 短写、ahead/behind 文案）
  host/                   # Node 侧，tsc → lib/host/
    index.ts              # apply(ctx, config)：挂路由、工作区、preset 依赖检查
    config.ts             # Config schema（schemastery）
    store.ts              # projects.json 读写 + 原子写 + 串行化
    git.ts                # execFile 调 git：probe / fetch / checkout / ff-merge
    workspace.ts          # 插件工作区目录创建 + workspaceRegistry 注册
    runner.ts             # 起 agent 会话、驱动、状态回写（唯一碰 sessionController 的地方）
    routes.ts             # ctx.webServer.register 路由表
    http.ts               # 请求解析、响应封装、fence（CSRF/origin）
    preset.ts             # preset 侧安全插件：skill 提供方隔离 + 工具限制 + skill 名守卫
  client/                 # 浏览器侧，tsdown → dist/client.js
    entry.ts              # 模块工厂壳入口（inject + apply）
    panel.ts              # sidebar.panellist 图标
    page.ts               # main 全页
    components/           # ProjectList / ProjectDetail / AddProjectDialog / DiagramCard / GitBadge / Status
    styles.ts             # CSS 文本（全部用 --dsw-* token）
    api.ts                # fetch 封装
    locale.ts             # 中英文案
```

**依赖方向铁律**（dependency-cruiser 守）：
`shared ← host`、`shared ← client`、`host ✗→ client`、`client ✗→ host`、`client ✗→ node:*`、`host ✗→ 浏览器全局`、无环。

---

## 5. 宿主 API 契约

### 5.1 插件外壳

```yaml
# cordis.patch.yml（本插件的 bundle patch）
- insert:
    - id: dsh-archify-projects
      name: dsh-archify-projects
```

`package.json` 关键字段：

```jsonc
{
  "type": "module",
  "main": "lib/host/index.js",
  "exports": {
    ".": "./lib/host/index.js",
    "./client": "./dist/client.js",
    "./preset": "./lib/host/preset.js",
    "./locale/*.json": "./locale/*.json",
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-ui-sidebar",
      ],
    },
  },
}
```

### 5.2 用到的宿主服务

| 服务                                                    | 用途                         | 备注                        |
| ------------------------------------------------------- | ---------------------------- | --------------------------- |
| `ctx.webServer.register({kind:'exact', path, handler})` | 插件 HTTP 路由               | 与 word-learn 同套路        |
| `ctx.workspaceRegistry.create(path, title?)`            | 注册插件工作区               | 幂等：先 `list()` 找同 path |
| `ctx.sessionController`（或 `ctx.agents` + setup）      | 起会话 + prompt              | 见 5.4                      |
| `ctx.skills.registerProvider(...)`                      | preset 内的隔离 skill 提供方 | 见 5.5                      |
| `ctx.tools.restrict / guard`                            | 工具白名单 + skill 名守卫    | 见 5.5                      |
| `ctx.logger`                                            | 诊断日志                     | 不抛                        |

### 5.3 HTTP 路由

前缀 `/dsh-archify-projects/`。所有写操作要求 `POST` + JSON。

| 方法   | 路径                          | 说明                                                            |
| ------ | ----------------------------- | --------------------------------------------------------------- |
| GET    | `/health`                     | 版本、工作区路径、是否具备 git                                  |
| GET    | `/projects`                   | 台账全量                                                        |
| POST   | `/projects`                   | `{name, repoPath}` → 探测 Git + 建目录 + 入账 + 触发 create run |
| PATCH  | `/projects/:id`               | 改名 / 改路径（改路径会重新探测 Git）                           |
| DELETE | `/projects/:id`               | 删台账与项目目录                                                |
| POST   | `/projects/:id/check`         | 重新探测 Git（不触发 agent）                                    |
| POST   | `/projects/:id/update`        | Git 同步 + 触发 update run                                      |
| POST   | `/projects/:id/diagram/:kind` | `kind=structure                                                 | domain`，重新生成单张图 |
| GET    | `/projects/:id/runs`          | 运行历史                                                        |
| GET    | `/artifact/:projectId/*`      | 读产物（限定在项目工作区内，防穿越）                            |
| GET    | `/models`?                    | 不需要                                                          |

响应统一 `{ok:true, value}` / `{ok:false, error:{code,message}}`。

**fence**：校验 `sec-fetch-site`（同源/同站之外 403）、`Origin`/`Host` 一致、方法白名单、路径穿越（解析后必须仍在项目目录内）。

### 5.4 Agent 编排（runner）

一次 Run：

1. 生成 `runId`，把 `diagram.status` 置 `running`，落盘。
2. 确保插件工作区存在（`workspace.ts`）。
3. 起会话：
   - 首选 `ctx.sessionController.create({ workspaceId, agentPreset: 'archify-projects' })`（若该服务存在）；
   - 回退 `ctx.agents.create({ sessionId, agentOptions, setup })`，在 `setup(agentCtx)` 里做与 preset 等价的限制（restrict + skill provider + guard）。
     —— 两条路共享同一份 `preset.ts` 限制函数，避免不一致。
4. `prompt`：写入结构化提示词（`shared/prompt.ts`），`mode:'queue'`。
5. 监听该会话的结束：`agent.whenIdle()`；或轮询会话状态。结束后读产出的 `candidate.json` / `html` 路径，回写台账。
6. 失败：`diagram.status='failed'` + `error`，保留 `sessionId` 供人看日志。

产物路径发现：提示词里**强制**要求 agent 在最后回复里输出两行机器可读标记：

```
ARCHIFY_ARTIFACT structure <绝对路径>
ARCHIFY_ARTIFACT domain <绝对路径>
```

runner 解析会话最后一条 assistant 文本（或直接按约定目录 glob 最新 `.archify/*/` 目录兜底）。

### 5.5 preset：只有 archify、无关工具禁用

```yaml
- id: preset-archify-projects
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: archify-projects
    name: Archify 图谱
    description: 只用于代码库架构/领域建模出图，工具与 skill 均受限
    plugins:
      - id: persona
        name: '@deepseek-ai/dsh-persona'
        config:
          prefix: 你是架构建模助手……
      - id: tool-fs
        name: '@deepseek-ai/dsh-tool-fs'
      - id: tool-fs-search
        name: '@deepseek-ai/dsh-tool-fs-search'
      - id: tool-bash
        name: '@deepseek-ai/dsh-tool-bash'
        disabled: !!js process.platform === 'win32'
      - id: tool-pwsh
        name: '@deepseek-ai/dsh-tool-pwsh'
        disabled: !!js process.platform !== 'win32'
      - id: tool-skill
        name: '@deepseek-ai/dsh-tool-skill'
      - id: archify-sandbox
        name: dsh-archify-projects/preset
```

`lib/host/preset.js` 的 `apply(ctx)`：

1. 解析 archify skill 目录：按序探测
   `require.resolve('@tt-a1i/archify-dsh/package.json')` → 同目录 `skills/archify`；
   仓库内自带 `skills/archify` 兜底。找不到则 `ctx.logger.warn` 并退化为「不给 skill 工具」。
2. `ctx.skills.registerProvider(...)`：名字 `archify-projects`，rank 600，`list()` 只返回 archify 一个条目，`get('archify')` 读 SKILL.md 正文。
3. `ctx.tools.restrict({ allow: [...] })`，`allow` 按平台计算：
   `['read','write','edit','glob','grep','skill'] + (win32 ? 'pwsh' : 'bash')`。
   名字不存在会抛 → 用 try/catch 包住并降级到 guard，日志记录降级原因（不静默）。
4. `ctx.tools.guard(exec)`：
   - `exec.name === 'skill'` 且 `exec.arguments.name !== 'archify'` → 返回拒绝理由。
   - `exec.name` 不在白名单 → 返回拒绝理由（restrict 失效时的兜底）。

> 这是「无关工具禁用」的双保险：restrict 管**模型可见的工具表**，guard 管**实际执行**。

### 5.6 复用 archify 的硬约束

- archify 的 `bin/archify.mjs` 用 `node <skill>/bin/archify.mjs finalize ...` 调用。插件不认识它的内部实现，只通过提示词约束：
  - 工作目录 = 项目工作区目录（`.archify/` 落在这里）；
  - `--repo-root` 传代码库绝对路径（让 archify 读真实源码取证）；
  - 两张图分别 `architecture`，`meta.quality_profile="showcase"`。
- Skill 版本漂移不阻塞：只要 SKILL.md 存在就按当前内容执行。

---

## 6. Git 策略

全部经 `execFile('git', args, {cwd, timeout, windowsHide:true})`，不拼 shell 字符串。

| 动作   | 命令                                                                                                                                                      | 失败处理                                                                                                                       |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 探测   | `rev-parse --show-toplevel`、`rev-parse --abbrev-ref HEAD`、`rev-parse HEAD`、`log -1 --format=%cI                                                        | %s`、`rev-parse --abbrev-ref @{u}`、`rev-list --left-right --count @{u}...HEAD`、`status --porcelain`、`remote get-url origin` | 任一失败 → 该字段 `null`；`--show-toplevel` 失败即 `isRepo:false` |
| 同步   | `fetch --all --prune`（有 origin 时）→ `rev-parse --verify <branch>` → `checkout <branch>`（若 detached，`checkout -B <branch>`）→ `merge --ff-only @{u}` | 工作区脏且需要切换 → 不硬来，回 `{skipped:true, reason:'dirty'}` 并在 UI 明示                                                  |
| 当前点 | 同步后重新 probe                                                                                                                                          | —                                                                                                                              |

**安全**：仓库路径来自用户配置，`checkout` 只操作该仓库；不 `reset --hard`、不 `clean`、不 `stash`。分支名作为独立 argv 传入（不做字符串拼接）。

---

## 7. 前端设计

### 7.1 设计系统（`design_recommend` 结论 + 本插件裁剪）

| 维度 | 取值                                                            | 理由                                                                   |
| ---- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 气质 | 开发者工具 / 控制台，克制、精确、密度中等                       | DSH 是工具型宿主，页面必须像它的一部分                                 |
| 风格 | Modern Dark 的克制版 + Swiss 排版                               | 推荐里的「cinematic/glassmorphism/haptic」是移动端语境，桌面宿主里不做 |
| 字体 | 正文/标题继承宿主 `--dsw-font-family`；路径、commit、分支用等宽 | 不引入 Web 字体（离线可用、与宿主一致）                                |
| 主色 | 宿主 `--dsw-alias-brand-primary`                                | 不抢 DSH 品牌色                                                        |
| 强调 | 成功态复用 `--dsw-alias-state-success-primary`                  | 图谱「已就绪」用宿主绿                                                 |
| 圆角 | 8 / 12（卡片 12）                                               | 宿主 radius 令牌偏小，16 在桌面控制台里过大                            |
| 间距 | 4 / 8 / 16 / 24 / 32                                            | design_recommend 的 `--space-*` 刻度                                   |
| 动效 | 150–200ms，`power1.inOut`；只用 opacity/transform               | Motion 旋钮 3/10                                                       |
| 密度 | 标准（6/10）                                                    | 列表行高 40，卡片内边距 16                                             |

### 7.2 token 映射表（**禁止硬编码颜色**）

| 语义          | token                                             |
| ------------- | ------------------------------------------------- |
| 页面底        | `--dsw-alias-bg-base`                             |
| 卡片/分区     | `--dsw-alias-bg-layer-1`                          |
| 内嵌/浮层     | `--dsw-alias-bg-layer-2`                          |
| 主文字        | `--dsw-alias-label-primary`                       |
| 次文字        | `--dsw-alias-label-secondary`                     |
| 弱化文字      | `--dsw-alias-label-tertiary`                      |
| 分割线        | `--dsw-alias-border-l1` / `--dsw-alias-border-l2` |
| 控件边框      | `--dsw-alias-border-l3` / `--dsw-alias-border-l4` |
| 悬停底        | `--dsw-alias-interactive-bg-hover`                |
| 品牌/主按钮   | `--dsw-alias-brand-primary`                       |
| 成功/就绪     | `--dsw-alias-state-success-primary`               |
| 告警/脏工作区 | `--dsw-alias-state-warn-primary`                  |
| 失败          | `--dsw-alias-state-error-primary`                 |
| 空闲          | `--dsw-alias-state-idle-primary`                  |
| 代码块        | `--dsw-alias-markdown-code-block`                 |

深色切换由宿主在 `<html data-ds-dark-theme>` 上做，alias token 自动翻转，因此**页面不需要任何 `@media (prefers-color-scheme)` 分支**。

### 7.3 页面结构

```
┌ 顶栏（页内） ─────────────────────────────────────────────┐
│ 架构建模      [刷新] [新增项目 +]                          │
├ 左列（320px） ───┬ 右列（详情） ──────────────────────────┤
│ ▸ 项目卡片 列表   │ 项目名 · 路径 · [打开会话] [更新]        │
│   名称            │ Git 条：分支 / commit / 上游 / ahead-behind / 脏 │
│   分支 · commit   │ ┌ 项目结构图 ─────────────────────────┐ │
│   两图状态点       │ │ 状态 · 生成时间 · 当时 commit        │ │
│                   │ │ [预览] [新窗口打开] [重新生成]        │ │
│                   │ └─────────────────────────────────────┘ │
│                   │ ┌ 领域图 ─────────────────────────────┐ │
│                   │ └─────────────────────────────────────┘ │
│                   │ 运行记录（最近 5 条）                    │
└───────────────────┴────────────────────────────────────────┘
```

空状态：左列无项目时整页居中给「还没有项目 · 新增项目」引导（UX 规范：Empty States 必须给行动点）。

预览：`<iframe src="/dsh-archify-projects/artifact/<id>/.archify/.../x.html">`，`sandbox="allow-scripts allow-same-origin"`，高度 480，可「新窗口打开」。

### 7.4 交互与状态

| 场景     | 表现                                                                                         |
| -------- | -------------------------------------------------------------------------------------------- |
| 新增项目 | 对话框：名称（可空 → 用目录名）+ 路径（必填，失焦即时校验）→ 提交后卡片进入「探测 Git…」骨架 |
| 路径非法 | 输入框下红字 + 提交按钮禁用（不是提交后弹错）                                                |
| 无 Git   | Git 条显示「非 Git 目录 · 基于当前目录分析」，不显示分支控件                                 |
| 运行中   | 卡片状态点脉冲（`opacity` 1→0.4，1.4s），详情页显示「Agent 运行中…」+ 会话链接               |
| 完成     | 状态点变绿，显示生成时间与**生成时的 commit**；若当前 commit 与之不同，标注「有更新可用」    |
| 失败     | 红点 + 错误摘要 + 「查看会话」                                                               |
| 更新     | 二次确认（会切分支/快进）→ 进度条文字（拉取 → 切换 → 分析）                                  |

### 7.5 无障碍与鲁棒性

- 所有图标按钮有 `aria-label`；列表项是 `<button>` 而非可点 `div`（UX 规范：Compact Control Semantics）。
- 焦点环用 `--dsw-alias-brand-primary`，不用 `outline:none`。
- 文字对比度 ≥ 4.5:1（全部走 alias token，宿主已保证）。
- 长路径、长分支名用 `text-overflow: ellipsis` + `title` 全文，不撑破布局（UX 规范：Text Reflow）。
- 动效尊重 `prefers-reduced-motion`。

---

## 8. 质量门

| 门       | 命令                                            | 判据                                                                                                              |
| -------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 类型     | `pnpm typecheck`                                | `tsc --noEmit` + `tsc -p tsconfig.host.json --noEmit` 0 错                                                        |
| 静态检测 | `pnpm lint`                                     | ESLint flat config（正确性 + 边界），0 error                                                                      |
| 格式     | `pnpm format:check`                             | Prettier                                                                                                          |
| 依赖边界 | `pnpm deps:check`                               | dependency-cruiser：无环 + 分层方向                                                                               |
| 单测     | `pnpm test:unit`                                | vitest node：store / git 解析 / prompt / format / routes                                                          |
| 组件测试 | `pnpm test:component`                           | vitest + jsdom + RTL：真实渲染 `dist/client.js` 产物，覆盖列表/详情/对话框/空状态/**深浅色 token 使用断言**       |
| 产物检查 | `pnpm artifact:check`                           | `dist/client.js` 是**单个** `__ModuleLoader__.load` 壳、无顶层 import/export、只外置 baseline 11 个模块、体积预算 |
| 构建     | `pnpm build`                                    | tsdown + tsc 全绿                                                                                                 |
| 前端验证 | 装进 profile → 重启 dsh → 浏览器（bsk）打开 GUI | 侧栏入口可见、页面渲染、**切深浅色各截一张图**、新增项目走通                                                      |

覆盖率门槛：`lib/host/**` 行 ≥ 70、分支 ≥ 62、函数 ≥ 78；`store.ts`/`git.ts`/`prompt.ts` 单独 ≥ 90。

---

## 9. 里程碑

| M   | 内容                                                                  | 完成判据                                      | 状态 |
| --- | --------------------------------------------------------------------- | --------------------------------------------- | ---- |
| M1  | 设计文档 + 骨架（package.json / tsconfig / eslint / vitest / tsdown） | `pnpm install` 通过，`pnpm lint` 空跑通过     | ✅   |
| M2  | `shared/` 纯逻辑 + 单测                                               | 提示词/格式化/协议单测绿                      | ✅   |
| M3  | `host/` 台账 + Git + 路由（不含 agent）                               | 集成测试用桩 ctx 走通 CRUD + 探测             | ✅   |
| M4  | `host/` runner + `preset.js` 限制                                     | 桩 agent 走通一次 run，断言 prompt 与限制调用 | ✅   |
| M5  | `client/` 页面 + 组件测试                                             | 组件测试绿，产物检查绿                        | ✅   |
| M6  | 装进 profile，前端真机验证（深浅色）                                  | 截图 + 交互走通                               | ✅   |
| M7  | README / 文档收尾                                                     | —                                             | ✅   |

### 9.1 真机验证记录（2026-11-07）

两种主题、两条路径都在真实宿主里跑通过，截图存在 `docs/verify/`：

| 场景                          | 结果                                                                 | 证据                                               |
| ----------------------------- | -------------------------------------------------------------------- | -------------------------------------------------- |
| 深色主题整页                  | 列表 / Git 卡 / 两张图 / 运行记录全部正常                            | `docs/verify/panel-dark.png`                       |
| 浅色主题整页                  | 同上，token 全部跟随宿主，无硬编码颜色漏出                           | `docs/verify/panel-light.png`、`panel-light-2.png` |
| Git 项目首次生成              | 结构图 + 领域图双 ready，iframe 正常渲染                             | `docs/verify/panel-dark.png`                       |
| 非 Git 目录（`isRepo:false`） | 跳过分支切换，直接按当前目录分析，双 ready                           | 见 §6 Git 策略                                     |
| 更新（切分支 + 快进 + 重跑）  | 确认弹窗 → 运行启动 → 结果落台账                                     | `docs/verify/runs-after-restart.png`               |
| 宿主被 kill 后重开            | 悬挂的 `running` 被标 failed「宿主重启，本次运行中断」，按钮恢复可点 | `docs/verify/runs-after-restart.png`               |
| 图表 iframe 高度              | `flex:none` + `clamp(420px,58vh,760px)`，不再被压成一条工具栏        | 同上                                               |

真机验证抓出来的三个坑（都应写进回归）：

1. **`.dap-diagram` 卡片本身也是 flex item**，只给 iframe 设 `flex:none` 不够，父卡片还会被祖先列压扁、再用 `overflow:hidden` 把图裁掉。
2. **运行记录的时钟**：`run.startedAt.slice(11, 19)` 切的是 UTC，东八区显示成 05:51。改成按本地时区格式化（`clockText`）。
3. **宿主重启会留下永久 `running`**：进程被 kill 时没人写 `finishedAt`，页面据此永远「生成中」且按钮全禁用。开库对账现在会收尸（`reconcileArtifacts`），前端 `isRunning` 另有 25 分钟兜底。

---

## 10. 风险与对策

| 风险                                         | 对策                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| 宿主 API 版本差异（sessionController 有/无） | runner 双路：`sessionController` 优先，`agents.create` 回退；启动时探测并记日志       |
| `tools.restrict` 名字校验抛错                | try/catch 降级到 guard，日志记录；不允许静默                                          |
| archify skill 目录找不到                     | preset 里不挂 skill 工具 + 提示词改为「直接写 candidate.json」的降级路径；UI 明示降级 |
| Agent 产不出约定标记                         | 产物发现走「标记优先 + `.archify/` 最新目录兜底」                                     |
| 用户仓库工作区脏                             | 不自动 stash/reset；只 `--ff-only`，失败即报「需要手动处理」                          |
| 产物路径穿越                                 | `/artifact/` 路由把 `resolve` 后的路径与项目目录做前缀校验                            |
| 前端 CSS 污染宿主                            | 全部类名加 `dap-` 前缀 + 样式用 `<style>` 标签在 `apply` 里注入、`ctx.effect` 卸载    |

---

## 11. 目录结构（落地版）

```
dsh-archify-projects/
  package.json
  tsconfig.json           tsconfig.host.json   tsconfig.eslint.json
  tsdown.config.ts        vitest.config.ts     eslint.config.js
  cordis.patch.yml        icon.svg             README.md
  locale/{zh-CN,en}.json
  docs/DESIGN.md
  src/shared/…  src/host/…  src/client/…
  tests/{unit,features,contract,component,integration,support}/
  scripts/check-artifact.mjs
```

---

## 12. v0.2 设计方向（草案，2026-11-07）

**判断**：插件要做的不是「再多画一种图」，而是 DSH 里的**代码库架构地图册**——
每个在册仓库有一张跟随 Git 演进的结构图 / 领域图，随时打开、随时更新，并且一眼能看出
「这张图对应哪个 commit、过期了没有、这次更新改了什么」。它同时是给人看的总览、
给 agent 复用的上下文，以及评审变更时的底图。

**v0.1 的缺口**（现在的「列表 + iframe」回答不了）：

1. 哪个仓库过期了、落后几个提交、多久没更新？——只能逐个点开看。
2. 这张图是哪次运行、哪个 commit 生成的？更早的版本还能不能打开？——台账有 `runs[]`，
   但没有「运行 → 产物」的索引，历史图只能去磁盘上翻。
3. 生成是黑盒：20 分钟里 agent 在读什么、卡在哪一步？——只有「运行中」和一个会话链接。
4. 图和代码的漂移只能靠人记住。

**v0.2 范围**（按优先级）：

| #   | 能力                                                                            | 数据影响                                                        |
| --- | ------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | 总览 Atlas：卡片墙 + 新鲜度（branch/commit/落后/脏/上次更新）+ 批量更新         | 无（`GET /projects` 已够，前端算漂移）                          |
| 2   | 项目工作区：结构/领域切换、全屏、版本时间线、运行历史并入右栏                   | `runs[]` 需要补产物路径（新增可空字段 `artifacts`，旧台账兼容） |
| 3   | 生成过程可见：轮询 `runs[].status` 升级为步骤条（探测 → 阅读 → 出图），可开会话 | 先复用现有 run 状态；步骤流需要 runner 暴露会话事件（后续）     |
| 4   | 漂移提示：图谱 commit ≠ 当前 HEAD → 卡片/详情一键更新                           | 无（`diagram.commit` 已有）                                     |
| 5   | 导出：HTML / PNG、复制产物链接                                                  | 无（复用 `/artifact/` 路由）                                    |

**非目标（仍然不做）**：克隆仓库、任意图类型组合、跨仓库依赖图、图 diff（版本时间线可切换即止）。

**落点不变**：宿主 `--dsw-alias-*` token 上色、单 bundle（220 KB 预算）、iframe 预览、
台账 `projects.json` 唯一真相、产物不写进用户仓库。

**原型**：`docs/design/workbench-v02.html`（OpenDesign 项目 `archify-workbench-v02` 的
`index.html` 快照），截图 `docs/design/v02-*.png`。浅色 / 深色两套视觉，交互：
卡片进详情、结构/领域切换、原型底栏切屏与切主题。

**落地顺序**（待维护者确认后开工）：页面拆两屏（overview / detail）→ `RunRecord` 补
`artifacts` 并回填历史 → 版本时间线 → 生成步骤条 → 导出。

---

## 13. v0.3 图册模型（2026-11-07，按需求收敛）

**一句话**：从「一个仓库两张固定图」升级成「一个仓库一册图」——先提取**概念**，
再用自然语言 prompt 让 agent 按概念出图；图有**临时/永久**两种时效、可以**父子嵌套**
和**大图配小图**，还能对着一张图**追问并自动补细节**。

原型：`docs/design/workbench-v03.html`（OpenDesign 项目 `archify-workbench-v03`），
截图 `docs/design/v03-*.png`。

### 13.1 版本口径：分支级，不是 commit 级

这是和 v0.1/v0.2 最大的区别，**台账里不再用 commit 标识「这一版图」**：

| 维度       | v0.2                    | v0.3                                               |
| ---------- | ----------------------- | -------------------------------------------------- |
| 版本键     | `branch + commit`       | `branch`（+ 工作区状态）                           |
| 工作区改动 | 只标记 dirty            | **纳入分析**：暂存区（staged）和未暂存都算代码证据 |
| 产物归属   | 一次运行对应一个 commit | 一次运行对应「某分支当时的代码（含工作区）」       |
| 展示       | 显示生成时的 commit     | 显示 `分支 · 含工作区改动 · 生成时间`              |

理由：开发中真正想看的是「我现在这份代码长什么样」，而不是某个历史 commit 的冻结快照。
`headCommit` 仍可作为**内部溯源**（日志、排障）记录，但不进版本键、不进 UI 主文案。

因此「过期」的判定从「commit 变了」改成：

- 分支变了（`git.branch !== diagram.branch`）；
- 或工作区状态变了（`dirty` 标志或 staged/unstaged 计数与生成时不同）；
- 或距上次生成超过阈值（提示但不强制）。

### 13.2 概念（Concept）：图的第一等公民

概念是从代码里提取的、可复用的架构单元，**属于项目**而不是属于某张图：

```jsonc
// 项目级概念表（存 workspace/<projectId>/concepts.json）
{
  "version": 1,
  "concepts": [
    {
      "id": "cpt_ledger",
      "name": "项目台账",
      "summary": "projects.json 是唯一真相，产物路径相对 workspace 存储",
      "evidence": ["src/host/store.ts", "src/host/config.ts"], // 来源文件，供追问时定位
      "tags": ["data", "invariant"],
      "branch": "main",
      "updatedAt": "...",
    },
  ],
}
```

- 概念在**首次生成**时提取（约 15–25 个），之后每次更新增量维护（新增/合并/废弃）。
- 图只引用**概念子集**（`conceptIds`），所以「补充细节」= 往图里加概念，
  「创建子图」= 用其中一两个概念单独立一张图。
- 概念跨图复用：同一份概念既能进结构图，也能进自定义图，不用重复提取。

### 13.3 图（Diagram）与套图（Set）

```jsonc
{
  "id": "dgm_host_modules",
  "projectId": "prj_...",
  "title": "src/host 模块结构",
  "kind": "structure" | "domain" | "custom",
  "prompt": "画出 src/host 的模块结构，标出 routes → runner 的调用关系",  // 永久图必填
  "persistence": "permanent" | "temporary",     // ★ 时效
  "parentId": "dgm_structure",                  // 可选：挂在哪张图下（父子）
  "setId": "set_structure",                     // 可选：属于哪套图（大图配小图）
  "conceptIds": ["cpt_route", "cpt_runner", "..."],
  "branch": "main",
  "generatedAt": "...",
  "htmlPath": ".archify/main/structure-.../x.html",   // 相对 workspaceRoot
  "status": "idle" | "queued" | "running" | "ready" | "failed",
  "error": null
}
```

**时效（这是需求里最核心的新概念）**：

| 时效                | 行为                                                                          | 存哪                                                    |
| ------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| `permanent`（永久） | prompt **存进台账**；下次「更新图册」自动用同一 prompt 重画；出现在侧栏图册里 | `projects.json` 的 `diagrams[]`                         |
| `temporary`（临时） | 只跑这一次，产物留在磁盘但**不进下次更新计划**；prompt 不存（或存了也不复用） | 台账里可留一条 `temporary` 记录用于本次展示，更新时清理 |

「任何图或套图都能临时/永久」→ 时效字段放在**图**上，套图的时效由其成员推导：
一套图里只要有一张永久，这套图就会在下次更新时被重建（其余临时成员按需重画）。

**套图**：`setId` 相同的图构成一套，约定「一张大图 + N 张细节小图」：

```
set_structure
├── 大图  src/host 模块结构（永久）
├── 小图  routes 内部（永久）
├── 小图  runner 生命周期（永久）
└── 小图  台账读写（临时）
```

UI 上大图铺满查看器，小图在下方缩略图条里点选切换；父图上的「+ 子图」直接用选中的
概念开一张新图并挂上 `parentId`。

### 13.4 追问与自动补细节

每张图有独立的问答线程（`qa[]`），问题走**同一个受限 agent**，但 prompt 带三样上下文：

1. 这张图的 prompt 与概念子集；
2. 图产物的 `candidate.json`（已有哪些节点/边）；
3. 概念的 `evidence` 文件路径（让 agent 能真的去读代码回答，而不是编）。

回答下面给两个动作，正好对应需求里的两种「补充」：

- **补进图里**：把新概念/新节点合并进当前图 → 产生该图的新版本（旧版本按时间戳保留）；
- **创建子图**：以这次回答为 prompt 开一张子图（`parentId` = 当前图，默认永久）。

> 注意：问答本身不消耗「更新」额度，但要防止滥用——同一张图并发提问超过 1 个时排队。

### 13.5 数据落盘

```
$DSH_HOME/dsh-archify-projects/
  projects.json                       # 台账：projects[] + 每个项目的 diagrams[]
  workspace/<projectId>/
    concepts.json                     # 项目级概念表
    .archify/<branch-slug>/<diagramId>-<stamp>/
      candidate.json                  # 图的结构化描述（节点/边/分组）
      <slug>.html                     # 成品
      qa.jsonl                        # 该图的问答记录
```

**不变量更新**：

1. `ready` 必须有 `htmlPath`；`temporary` 图不参与下次更新计划。
2. 任何时刻最多一条 `runs[]` 是 `running`。
3. `parentId` 必须指向同项目存在的图；`setId` 成员必须同项目、同 branch。
4. 删除项目要连概念表与整棵子图一起删。
5. 概念被删除前，先摘掉引用它的图（或标 `concept-missing` 让用户决定）。

### 13.6 页面结构调整（v0.3 原型）

| 区域       | v0.2                    | v0.3                                                                                                                                    |
| ---------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 总览       | 项目卡片墙              | 卡片墙 + 概念数 + 图/套图数 + 「工作区有改动」统计                                                                                      |
| 工作区布局 | 左列表 + 右详情（单列） | **三栏**：左「图册树」（默认套图 / 自定义 / 当前图的小图 / 概念索引）、中「查看器」（大图 + 小图缩略条）、右「检查器」（图信息 / 提问） |
| 版本       | 时间线（按 commit）     | 分支选择 + 工作区状态条（不再列 commit）                                                                                                |
| 新建图     | 无                      | 对话框：prompt + 时效（永久/临时）+ 归属（独立套图/挂父图）+ 概念范围                                                                   |
| 提问       | 无                      | 右栏「提问」页签：线程 + 「补进图里」/「创建子图」                                                                                      |

### 13.7 落地顺序

1. **数据模型**：`Diagram` 加 `prompt/persistence/parentId/setId/conceptIds/branch`，
   `RunRecord` 加 `artifacts`；`concepts.json` 与迁移（旧台账只有两张图 → 升级成
   `permanent` + `kind` 对应）。
2. **分支级 Git**：`git.ts` 补 `staged/unstaged` 计数；更新判定改为分支+工作区。
3. **更新编排**：`update` 跑「默认两张永久图 + 所有 `permanent` 自定义图」，
   临时图不跑；每张图一个产物目录。
4. **概念提取**：prompt 里加「先输出概念清单再画图」，落 `concepts.json`。
5. **问答**：`POST /diagrams/:id/ask`，复用受限 agent，回答落 `qa.jsonl`，
   两个动作各对应一个路由（merge / create-child）。
6. **前端**：三栏工作区 + 新建图对话框 + 问答页签（原型已定稿）。

---

## 14. v0.4：布局收敛、进度（todo）与用量（2026-11-08）

原型：`docs/design/workbench-v04.html`（OpenDesign 项目 `archify-workbench-v04`），
截图 `docs/design/v04-*.png`。

### 14.1 右栏必须有高度限制（bug 修复）

实测问题：一条长回答会把右栏撑得比页面还高，左/中两栏被拉成空白，整页跟着滚动
（2026-11-08 的真机截图）。根因是三栏网格 `align-items: start` + 右栏内容自然撑高。

约定改成**工作台整屏、三栏各自滚动**：

- `#screen-wb` 是 `height:100%; display:flex; flex-direction:column`，页面主体不再整体滚动；
- 三栏 `align-items: stretch`，每个 panel `min-height:0; display:flex; flex-direction:column`；
- 面板内部（图册树 / 查看器 stage / 检查器 insp-body）各自 `overflow:auto`；
- 提问输入框 `position:sticky; bottom:0`，并给滚动体留底部 padding，避免最后一行被输入框盖住；
- 结果：提问线程再长，页面高度不变，左图和中图不动，只有右栏内部滚动。

### 14.2 所有 agent 会话都要有 todo（进度可见）

- 两个 preset（出图 `archify-projects`、问答 `archify-projects-ask`）都挂
  `@deepseek-ai/dsh-tool-todo`，配置 `allowParallelInProgress: false`（该字段必填）。
- 提示词第一条硬约束：**开始前先建 4–7 步的 todo**，每完成一步就更新；最后一步固定是
  「回报产物标记」。
- runner 在运行期间读会话的 `todos` projection（宿主已有），把快照写进
  `RunRecord.todos: {content,status}[]`；会话里没有 todo 时留空，页面不显示进度条。
- 页面：
  - 顶部 `runbar`：`生成中 · 正在：<当前 in_progress 步骤>（5/7）` + 进度条 + 百分比 + 本次 tokens + 会话链接；
  - 检查器「进度」：完整 todo 列表（✓ / spinner / ○）；
  - 总览卡片运行中显示当前步骤（`正在：…`），代替只转圈的焦虑感。

### 14.3 项目 token 消耗

- 宿主自带 `dsh-token-meter`，`tokenUsage` projection 给出
  `uncachedInputTokens / outputTokens / cacheReadTokens / cacheWriteTokens`。
- runner 每次运行结束时把这份快照写进 `RunRecord.usage`；项目累计 = `runs[].usage` 求和
  （保留最近 `keepRuns` 条，累计值单独冗余在 `Project.usageTotal`，避免裁剪后失真）。
- 显示位置：
  - 工作台 gitbar 一枚 chip：`18.4k tokens · ≈ ¥0.09`（本次）；
  - 检查器「用量」：本次 / 累计 tokens + 输入/缓存/输出明细 + **估算**费用；
  - 总览卡片页脚：`main · 2 小时前 · 3 组图 · 18.4k tokens`。
- 费用是估算：单价来自配置 `pricing`（默认按 `deepseek-v4.1-flash` 的输入/输出价），
  文案必须带「≈ / 估」，不假装是账单。

### 14.4 数据模型增量

```ts
RunRecord {
  ...existing,
  todos: { content: string; status: 'pending' | 'in_progress' | 'completed' }[]
  usage: { uncachedInput: number; output: number; cacheRead: number; cacheWrite: number } | null
}
Project {
  ...existing,
  usageTotal: number   // 历史累计 tokens（不随 runs 裁剪丢失）
}
```

`GET /projects` 已经返回整条项目，页面不需要新接口。

### 14.5 实现顺序

1. `cordis.patch.yml`：两个 preset 加 `tool-todo`（ask 也加，问答同样能建计划）；
2. prompt：首条硬约束 + 出图分步模板（概念 → structure → finalize → domain → finalize → messages）；
3. runner：运行中读 `todos` projection（节流写台账），结束时读 `tokenUsage` 写 `usage` / `usageTotal`；
4. 页面：整屏三栏 + 右栏独立滚动 + runbar + 进度 / 用量区块；
5. 测试：todo 投影解析、用量累加、长 QA 不影响布局（组件测试可用长文本断言容器高度）。

---

## 15. v0.5：新建图弹窗——把 archify 的图型做成可解释的 tag（2026-11-08）

原型：`docs/design/workbench-v05.html`（OpenDesign 项目 `archify-workbench-v05`），
截图 `docs/design/v05-dialog-*.png`。

### 15.1 为什么要有图型 tag

用户往往不知道 archify 能画什么，只知道「我想看某个东西」。弹窗里把 archify 的 5 个
type 做成 tag，点一下告诉用户：**这张图适合看什么、会展示代码库的哪些信息、能让你掌握什么**。
选不选都可以 —— 不选就是「不限，由 agent 判断」；选了只是让 agent 少猜一步、图更稳。

| tag    | archify type   | 适合看                           | 会展示                                   | 能掌握                                 |
| ------ | -------------- | -------------------------------- | ---------------------------------------- | -------------------------------------- |
| 架构图 | `architecture` | 系统由什么组成、谁依赖谁         | 组件与服务、进程/网络/信任边界、外部依赖 | 分层与职责、关键依赖、边界外的风险     |
| 流程图 | `workflow`     | 一个流程怎么走、有哪些判断与审批 | 步骤、分支条件、失败与回退               | 主流程与异常路径、谁在什么条件下做什么 |
| 时序图 | `sequence`     | 一次请求在模块之间怎么往返       | 参与者、消息顺序、返回与异步             | 调用链、时序依赖、失败重试点           |
| 数据流 | `dataflow`     | 数据从哪来、经过谁、到哪去       | 数据源、转换、存储、消费者               | 数据血缘与口径、敏感数据流向           |
| 状态机 | `lifecycle`    | 一个对象有哪些状态、怎么流转     | 状态、转移条件、终态                     | 状态机全貌、等待与重试、非法流转       |

### 15.2 弹窗结构

1. **图型（可选）**：`不限（agent 判断）` + 5 个 tag；单选、可取消。
2. **说明卡**：选中后展示「适合看 / 会展示 / 能掌握」三行；prompt 占位符同步变成
   「已选时序图：prompt 可以只写关注点…」。
3. **Prompt**：自然语言，必填。
4. **概念范围**：从项目概念表勾选；只围绕这些概念取证，图更聚焦。
5. **目录范围**（新增，可选）：`src/host` / `src/client` / `src/shared` 这类目录 chip；
   只让 agent 在这些目录里取证，不选则扫全仓库。
6. **时效 / 归属**：沿用 v0.3 的永久/临时、独立套图/挂父图。

图型、概念、目录全部可选；三者都是「选得更准，图更好」，不是必填项。

### 15.3 数据模型增量

```ts
type ArchifyType = 'architecture' | 'workflow' | 'sequence' | 'dataflow' | 'lifecycle'

DiagramState {
  ...existing,
  /** 用户选的 archify 渲染器；null = 由 agent 判断。 */
  renderer: ArchifyType | null
  /** 限定取证的目录（相对仓库根）；空数组 = 全仓库。 */
  pathScope: readonly string[]
}
```

- `CreateDiagramRequest` / `PatchDiagramRequest` 加 `renderer`、`pathScope`；
- 提示词：选了 renderer 就写死「渲染器必须用 `<type>`」；没选则写「按 prompt 选择 type」；
  有 pathScope 就写「只在这些目录里取证，别读别的」；
- 默认两张图：`structure` → `architecture`，`domain` → `architecture`（建模口径不同），
  `renderer` 固定，不进弹窗。

### 15.4 实现顺序

1. types/protocol/store：加 `renderer`、`pathScope`（旧台账补 null / []）；
2. prompt：渲染器与目录范围的硬约束；
3. 弹窗：图型 tag + 说明卡 + 目录 chip；
4. 测试：图型序列化/迁移、prompt 含 renderer/pathScope、弹窗选择联动。

---

## 16. v0.6：删掉左栏，图选择变成图片上方的缩略图条（2026-11-08）

原型：`docs/design/workbench-v06.html`（OpenDesign 项目 `archify-workbench-v06`），
截图 `docs/design/v06-prototype.png`；真机截图 `docs/verify/v06-*.png`。

### 16.1 评估结论：可行

用户的判断成立：左栏的列表在真实使用里几乎不看，但它占掉 218px，把图片挤成
「能看但不够看」的宽度；而同一条信息（有哪些图、哪张选中）完全可以压在图片上方
一条 91px 的缩略图条里。改动后工作区从三栏变两栏：

| 项                                    | 改前                                 | 改后                            |
| ------------------------------------- | ------------------------------------ | ------------------------------- |
| 列结构                                | 图册树 218px + 查看器 + 检查器 320px | 查看器 + 检查器 320px           |
| 查看器宽度（1440 窗口、DSH 侧栏 220） | ≈ 566px                              | **784px**（+218）               |
| 图选择                                | 左栏纵向列表                         | 图片上方横向缩略图条（滚动）    |
| 新建图                                | 顶部按钮 + 左栏按钮                  | 缩略图条末尾的虚线「＋ 新建图」 |
| 页面高度                              | 900                                  | 900（不因内容变高）             |

### 16.2 两个需要决策的点，已按这个做

1. **缩略图用真预览还是占位**：用真预览（把 artifact HTML 用 `scale(0.25)` 塞进
   132×74 的卡片），ready 的图才有；`idle/queued/running/failed` 显示状态文字。
   代价是每个 ready 图多一个 iframe —— 本地静态 SVG，实测 4 张缩略图加载正常；
   超过 ~10 张时横向滚动，iframe 用 `loading="lazy"`。
2. **图自带的工具栏**：archify 成品顶部有「浅色/经典/演示/导出」一排按钮，缩到
   0.25 倍仍然抢眼且点不到；同源注入一段 `<style>` 把 `.toolbar / .diagram-nav /
.focus-chip / .archify-toast` 隐藏（`hideArtifactChrome`），跨域或被拦就跳过。

### 16.3 父子图与套图怎么放

- 父图（`parentId === null`）排在默认两张之后；子图紧跟父图，带 `└` 缩进标记与
  左移 12px，视觉上仍是从属关系。
- 套图（`setId`）不再单独分组——缩略图条按「默认 → 自定义根 → 子图」排，
  组间用一条竖分隔线；同屏可见，不需要展开/折叠。
- 临时图在缩略图右上角挂「临时」小标签，永久图不挂（默认即永久）。

### 16.4 概念索引：删除

左栏底部的「概念索引」删掉了。理由：成品图里已经带概念/节点信息，左栏这份重复；
概念仍然存在于台账与弹窗的「概念范围」里，不影响功能。

### 16.5 实现

- `page.tsx`：删掉 `.dap-rail*` 面板与 `RailItem`，新增 `ThumbStrip` + `Thumb` +
  `hideArtifactChrome`；顶部 header 不再放「新建图」。
- `styles.ts`：`.dap-wb` 两列；`.dap-strip` / `.dap-thumbcard*` / `.dap-strip__new`；
  删掉 `.dap-rail*` 全部样式。
- 窄屏（<1180）检查器下沉一整行（`max-height:420px`）。
