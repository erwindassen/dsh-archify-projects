# 交接文档 · dsh-archify-projects

> 面向接手的 agent。读完这一份就能改代码、跑验证、装/卸插件、看懂当初为什么这么写。
> 面向使用者的上手说明在 [README](../README.md)，设计取舍在 [DESIGN.md](./DESIGN.md)。

最后更新：2026-11-07（v0.1.0，功能完备、已在真机跑通）

---

## 0. 一句话

DSH 的左栏插件「架构建模」：把一个代码库登记进台账，用**受限 agent**（skill 只有 archify）
生成**项目结构图**和**领域图**两张可交互 HTML，支持按 Git 分支/commit 更新，页面内嵌 iframe 直接看。

宿主侧 Node 代码 + 浏览器侧单 bundle，不是静态插件：台账落盘、Git 探测、agent 编排、产物回收、
路由与鉴权全在进程里跑。

---

## 1. 现在什么状态

| 方面   | 状态                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能   | 新增/删除项目、Git 探测（分支/commit/上游/脏）、首次生成、更新（切分支+快进+重跑）、重新生成单图、运行记录、深/浅色、非 Git 目录、iframe 内嵌预览、新窗口打开 |
| 测试   | 154 个用例 / 12 个文件，`vitest` 全绿（约 2 s）                                                                                                               |
| 静态门 | `tsc`（两份 tsconfig）、`eslint`、`prettier --check`、`dependency-cruiser`、`artifact:check`（51.5 KB / 220 KB 预算）全绿                                     |
| 真机   | 在 `127.0.0.1:3080` 的真实宿主里跑通过「Git 项目」与「非 Git 目录」两条路径，深浅色都验过；截图见 [`docs/verify/`](./verify)                                  |
| 产物   | `~/.dsh/dsh-archify-projects/` 下 1 个项目（`dsh-word-learn`），两张图 ready                                                                                  |
| 版本库 | 本地 `git init` 完成，**还没有远端仓库**（见 §9）                                                                                                             |

**没有半成品功能**。已知未做的都在 §8，属于可选增强，不是缺陷。

---

## 2. 五分钟跑起来

```bash
cd ~/Projects/dsh-archify-projects    # Windows 检出在 D:/projects/blog/dsh-plugins/dsh-archify-projects
pnpm install
pnpm verify        # build → artifact:check → typecheck/lint/format/deps → test
```

> **在 Linux 上开发／验证，优先用容器**：`~/Projects/dsh-docker` 的 `dsh-dev`
> （`127.0.0.1:3080`）已经把本仓库挂成 profile 的 bundle，改源码不用碰宿主 `~/.dsh`。
> 绑定关系、日常循环、模型凭据、冒烟步骤都写在 [CONTAINER.md](./CONTAINER.md)。
> 下面这段是「装进本机 DSH」的通用流程，容器已经替你做过。

装进 DSH（已在 `~/.dsh/profiles/web` 里做好，`link:` 形式）：

```jsonc
// ~/.dsh/profiles/web/package.json
"dependencies": { "dsh-archify-projects": "link:/home/xirizhi/Projects/dsh-archify-projects" },
"dsh": { "profile": { "bundles": [ /* ... 其它 ... */, "dsh-archify-projects" ] } }
```

**改了哪一层，决定要不要重启**：

| 改动位置                                                      | 生效方式                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/client/**`、`dist/`、`locale/`                           | 热更（`dsh-client-hmr` 轮询重建产物，约 0.5 s 后 remount），刷新页面即可 |
| `src/host/**`、`cordis.patch.yml`、`package.json` 的 `dsh` 段 | **必须重启 dsh**（ESM 模块缓存按进程存活）                               |
| `skills/archify/**`                                           | 下次新建 agent 会话时生效，不用重启                                      |

重启方式：双击桌面 **`DSH启动.bat`**（它是「停旧 + 起新」的一体入口，内部走 `~/dsh-tools/dsh-web.ps1`）。
`~/.dsh/logs/latest-web-url.txt` 会存带 `?token=` 的登录链接——**每次重启 token 都会变**，旧标签页会提示
`dsh web authentication required`，重开这个 URL 即可。

> ⚠️ 用 WMI/计划任务自动拉起 dsh 试过两次，都只成功到「停掉旧进程」，「起新的」这一步不落地
> （桌面 bat 依赖交互式窗口）。自动重启脚本见 `~/Documents/deepseek-harness/default-workspace/restart-helper.ps1`，
> 它能把带 token 的 URL 抓进 `latest-web-url.txt`，但**起服务仍建议人工点 bat 确认**。

---

## 3. 架构：一次「更新」发生了什么

```
页面按钮
  └─ POST /dsh-archify-projects/projects/:id/update          src/host/routes.ts
       ├─ git.ts        切回记录的分支 → fetch → FF 到最新 → 重新探测快照
       ├─ store.ts      台账里记一条 run(running)，两张图置 queued
       └─ runner.ts     起受限会话
            ├─ sessions.create({ presetId: 'archify-projects' })
            ├─ policy.ts   agent.ctx 上装 tools.restrict(allow) + tools.guard(fn)
            ├─ prompt.ts   拼 prompt（代码库路径、分支/commit、上次产物、产物标记约定）
            ├─ 投 prompt → whenIdle（或 runTimeoutMs 超时）
            ├─ 收尾：读 assistant 文本里的产物标记 → 否则扫 <项目目录>/.archify/ 兜底
            └─ store.patch   两张图 ready/failed + 运行记录收尾
  └─ 页面每 2 s 轮询 GET /projects，看到 ready 就把 iframe src 换成产物 URL
```

产物一律写在**插件自己的工作区**，不污染代码库：

```
~/.dsh/dsh-archify-projects/
├── projects.json                     台账（唯一真相）
└── workspace/<projectId>/
    └── .archify/<kind>-<slug>-<stamp>/   candidate.json + 成品 *.html + finalize-summary.json
```

台账不变量（改代码时别破坏）：

1. `diagrams[kind].status ∈ {idle, queued, running, ready, failed}`；`ready` 必须有 `htmlPath`。
2. 任何时刻最多一条 `runs[]` 是 `running`；宿主启动时由 `reconcileArtifacts()` 收尸。
3. 产物路径一律**相对** `workspaceRoot`，路由按它拼 URL 并做越界校验（`..` 直接 403）。
4. 删除项目要连工作区目录一起删；台账是唯一索引，磁盘上没有台账之外的有效产物。

---

## 4. HTTP 契约（前缀 `/dsh-archify-projects`）

| 方法   | 路径                          | 用途                                                         |
| ------ | ----------------------------- | ------------------------------------------------------------ |
| GET    | `/health`                     | 存活 + `presetId` / 版本，排查「插件到底挂上没」             |
| GET    | `/projects`                   | 台账全量（页面轮询这个）                                     |
| POST   | `/projects`                   | 新增项目（`{ repoPath, name? }`，自动探测 Git 并起首次生成） |
| GET    | `/projects/:id`               | 单项目                                                       |
| PATCH  | `/projects/:id`               | 改名字等                                                     |
| DELETE | `/projects/:id`               | 删项目 + 工作区                                              |
| POST   | `/projects/:id/check`         | 重探 Git                                                     |
| POST   | `/projects/:id/update`        | 更新（切分支 + 快进 + 重跑两张图）                           |
| POST   | `/projects/:id/diagram/:kind` | 重新生成单张图（`structure` / `domain`）                     |
| GET    | `/projects/:id/runs`          | 运行记录                                                     |
| GET    | `/artifact/<相对路径>`        | 产物 HTML（iframe 与「新窗口打开」都走这里）                 |

错误统一 `{ code, message }`，`code ∈ {bad-request, forbidden, not-found, conflict, internal, path-invalid, …}`
（见 `src/shared/protocol.ts`）。**页面按 code 决定文案，不解析 message**，别在文案里做逻辑。

### 鉴权：curl 拿 403 是正常的

路由挂在宿主 webServer 上，前面有宿主的浏览器信任栅栏 `connection.requestRejection(req)`：

- 命令行 `curl` → **403**（untrusted authority）；
- 同源页面里的 `fetch` → 200。

所以「用 curl 验证接口」永远 403，不是 bug，也不是路由没注册。判断路由在不在看 `/health`：
403 说明**路由存在但被栅栏拦了**，404 才是真没挂上。

---

## 5. agent 只能用 archify，无关工具进不来（三层）

| 层       | 机制                                                                                                  | 效果                                             |
| -------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| preset   | `cordis.patch.yml` 里私有 preset `archify-projects`，只挂 fs / fs-search / shell / skill              | 工具面天生就这么大                               |
| skill 源 | preset 私有的 `dsh-skill-filesystem`：`includeDefaultRoots: false` + `bundledSkillDir` 指向 `skills/` | agent 的 skill 列表里只有 `archify`              |
| 运行期   | `policy.ts`：`tools.restrict({ allow })` + `tools.guard(fn)`                                          | 即使在名单外被调用也被拒；`skill` 只认 `archify` |

两种会话，白名单不同：

| 会话        | 工具面                                              | 用途                                       |
| ----------- | --------------------------------------------------- | ------------------------------------------ |
| 出图（run） | `read, write, edit, glob, grep, skill` + 平台 shell | 读代码、写产物、跑 archify finalize        |
| 提问（ask） | **只有 `read, glob, grep, skill`**                  | 回答对图的细节提问；没有 shell、没有写工具 |

联网、子 agent、workflow、todo 这些工具**压根不可见**，调用即 `UNKNOWN_TOOL`。
两类会话的 `skill` 都只认 `archify`。

`tools.restrict` 必须装在 `agent.ctx` 上（根 ctx 直接抛 `requires a scoped context`），
所以它写在 `runner.ts` 建会话之后、第一条 prompt 之前，只影响本插件起的会话。

**archify skill 是 vendored 的**（`skills/archify/`，约 7.3 MB，来自
`@tt-a1i/archify-dsh@1.0.0` 的 tarball）。曾经指向 profile 里的那个包，结果用户一卸载原插件，
建会话就 `Cannot find module '@tt-a1i/archify-dsh/package.json'`，图一张都出不来。
现在靠 `createRequire(baseUrl).resolve('dsh-archify-projects/package.json')` 定位自己，自足。
（因此 `package.json` 的 `exports` 里必须有 `"./package.json": "./package.json"`，别删。）

---

## 6. 前端

- 单 bundle：`tsdown` 把 `src/client/**` 打成 `dist/client.js`（外部化 react），预算 220 KB。
- 主题：**只用宿主 token**（`--dsw-alias-*`），深浅色自动跟随，禁止硬编码颜色。
- 结构：`page.tsx`（状态与轮询）/ `components.tsx`（展示）/ `styles.ts`（一把 CSS）/ `locale.ts`（中英文案）/ `api.ts`（fetch 封装）。
- iframe：`sandbox="allow-scripts allow-same-origin"`，高度 `clamp(420px, 58vh, 760px)`。

三个真机才暴露的坑，改前端前先读：

1. **卡片和 iframe 都要 `flex:none`**。父链是 `dap-page(flex) → dap-body(grid) → dap-col(flex, overflow:auto) → dap-card(flex column)`；
   只锁 iframe，卡片本身仍会被压成 ~90 px，再用 `overflow:hidden` 把图裁成一条工具栏。
2. **时钟按本地时区格式化**（`clockText()`）。早期 `startedAt.slice(11,19)` 切的是 UTC，东八区显示成 05:51。
3. **`isRunning()` 有 25 分钟兜底**（`isRunAlive` / `hasStaleRun`）。宿主被 kill 时 `running` 会留在台账里，
   没有兜底页面就永久「生成中」且按钮全禁用。

---

## 7. 质量门与怎么加测试

```bash
pnpm typecheck      # tsc --noEmit + tsc -p tsconfig.host.json
pnpm lint           # eslint（skills/ 已排除）
pnpm format:check   # prettier（skills/、lib、dist、coverage 已排除）
pnpm deps:check     # dependency-cruiser：禁环、禁 client→host 反向依赖
pnpm test           # vitest + coverage
pnpm artifact:check # dist/client.js 体积与外部化
pnpm verify         # 以上全部 + build
```

当前基线：**154 passed / 12 files**，`coverage` 目录不进版本库。

测试布局（改哪儿补哪儿）：

| 目录                               | 覆盖                                                             |
| ---------------------------------- | ---------------------------------------------------------------- |
| `tests/unit/shared.test.ts`        | 纯函数：格式化、`isRunning`/`isStale`、prompt 拼接、产物标记解析 |
| `tests/unit/runner.test.ts`        | 产物发现、运行历史、超时、**开库收尸**（`reconcileArtifacts`）   |
| `tests/unit/routes.test.ts`        | 路由表：正常路径 + 400/403/404 + 越界路径                        |
| `tests/unit/git.test.ts`           | Git 探测：非仓库、分离头、无上游、脏工作区                       |
| `tests/unit/store.test.ts`         | 台账读写、串行化、损坏文件兜底                                   |
| `tests/unit/policy.test.ts`        | 白名单与守卫（非 archify skill 必须被拒）                        |
| `tests/unit/components.test.ts`    | 客户端纯函数（`clockText`）                                      |
| `tests/contract/locale.test.ts`    | 中英文案 key 对齐（漏 key 会真机显示英文）                       |
| `tests/integration/runner.test.ts` | 桩 ctx 走通一次 run（含 preset 限制调用断言）                    |

一条硬规矩：**修 bug 先写会红的用例**。上面三个真机坑里，坑 2、坑 3 都已经钉进单测。

---

## 8. 已知问题与可选增强（都非阻塞）

1. **并发**：一次点击只能跑一个项目；`update` 正在跑时再点会被拒（返回 `conflict`）。多项目排队没有做。
2. **运行收尸的边界**：`reconcileArtifacts` 只在**宿主启动**时跑。如果进程活着但 agent 卡死（没超时也没结束），
   前端只能靠 25 分钟兜底解锁，台账里的 `running` 仍要等下次启动才被清。
3. **`archify` 产物目录名靠猜**：`discoverArtifacts` 按目录名前缀（`structure-` / `architecture-` / `domain-`）
   归类，没有就按「新目录优先」补位。archify 换命名就要改 `kindOfDirName()`。
4. **没有远端仓库**：`git init` 已做，`origin` 未建（见 §9）。
5. **没有 i18n 之外的 l10n**：目前只有 zh-CN / en 两份文案。
6. **`skills/archify` 升级**：覆盖目录即可（`npm pack @tt-a1i/archify-dsh` 解包），无需改代码；
   依赖它的只有 `archify-skill.ts` 的路径探测与 prompt 里约定的产物标记。

---

## 9. 版本库

公开仓库已就绪：<https://github.com/guicaiyue/dsh-archify-projects>（`main`，168 个文件）。

```bash
cd D:/projects/blog/dsh-plugins/dsh-archify-projects
git remote -v            # origin git@github.com:guicaiyue/dsh-archify-projects.git
git push                 # 已 set-upstream，直接推
```

提交习惯：一个功能/一次修复一个 commit，中文 subject（`feat:` / `fix:` / `docs:`），
正文写清「为什么这么改」，别写「update file」。

> 建仓库这一步 agent 做不了：本机只有 SSH key（能推不能建），没有 `gh` CLI、没有 PAT、
> `git credential` 里也没有存货。远端仓库必须先由账号持有人在 GitHub 上建好。
> `.gitignore` 忽略 `node_modules/ lib/ dist/ coverage/`；`skills/archify/` 是**刻意提交**的，
> 不跟着仓库走克隆下来就跑不起来。

---

## 10. 文件索引（改东西先看这里）

| 文件                        | 行数   | 职责 / 什么时候动它                                                                                       |
| --------------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| `src/host/index.ts`         | 114    | 插件入口：注册路由（`ctx.inject(['webServer'], …)`）、启动对账、装卡片。**改挂载方式看这里**              |
| `src/host/routes.ts`        | 457    | 路由分发与每个 handler。加接口从这里加，路径表在 `shared/protocol.ts`                                     |
| `src/host/runner.ts`        | 633    | agent 编排、产物回收（`discoverArtifacts`）、超时、开库对账（`reconcileArtifacts`）。**最复杂的一个文件** |
| `src/host/store.ts`         | 232    | 台账读写、串行化、损坏兜底                                                                                |
| `src/host/git.ts`           | 210    | Git 探测、切分支/快进。非 Git 目录走空快照                                                                |
| `src/host/policy.ts`        | 135    | 工具白名单 + 守卫。放宽/收紧 agent 能力只改这里                                                           |
| `src/host/config.ts`        | 107    | 配置项与默认值（`dataDir` / `presetId` / `archifySkillDir` / `runTimeoutMs` / `keepRuns`）                |
| `src/host/context.ts`       | 211    | 宿主服务的**防御式**包装。`ctx.get()` 与 `ctx.<svc>` 都可能抛，必须 try/catch                             |
| `src/host/http.ts`          | 195    | 响应封装 + 浏览器信任栅栏                                                                                 |
| `src/host/workspace.ts`     | 85     | 工作区目录与 agent 工作目录                                                                               |
| `src/host/archify-skill.ts` | 123    | 定位 archify skill（vendored 优先，其次配置项）                                                           |
| `src/shared/*.ts`           | 619    | 纯逻辑：类型与不变量、prompt、协议/路由常量、格式化。**无副作用，随便测**                                 |
| `src/client/*`              | 1570   | 页面、组件、样式、文案、fetch                                                                             |
| `cordis.patch.yml`          | 57     | 挂插件 + 声明受限 preset。**改 preset 要重启**                                                            |
| `docs/DESIGN.md`            | 498    | 设计取舍、数据模型、里程碑与验证记录                                                                      |
| `docs/CONTAINER.md`         | —      | dsh-dev 容器里的绑定关系、日常循环、模型凭据与冒烟步骤                                                    |
| `skills/archify/`           | 7.3 MB | vendored 的 archify skill（第三方，勿手改）                                                               |

---

## 11. 接手第一步建议

1. `pnpm install && pnpm verify` —— 先确认基线是绿的。
2. 打开 `http://127.0.0.1:3080/`（token 见 `~/.dsh/logs/latest-web-url.txt`），点左栏「架构建模」，
   对 `dsh-word-learn` 点一次「重新生成」——用一张图确认「路由 → 会话 → 产物 → iframe」整条链在你手里是通的。
3. 读 `docs/DESIGN.md` 的 §3（数据模型）/ §5.4（runner）/ §7（前端）。
4. 想改行为，先在 `tests/unit/` 里写一条会红的用例再动手。

---

## 12. v0.3 变更：从「两张图」到「图册」

> 本节描述当前（2026-11-08）的模型；§1–§11 里仍按 v0.1 写的口径以本节为准。

### 12.1 版本口径

- **分支级，不是 commit 级**：`DiagramState` 记录 `branch` + `tree`（暂存/未暂存/未跟踪计数），
  `isStale` 只看「分支变了 / 工作区变了」，不看新 commit。
- `git status --porcelain` 由 `parseTree()` 解析成三个计数（`src/host/git.ts`）；
  **暂存区内容也算代码证据**，提示词里明确写「以工作区当前内容为准」。

### 12.2 数据模型（`src/shared/types.ts`，`LEDGER_VERSION = 2`）

```ts
Project {
  git: GitSnapshot            // + tree: { staged, unstaged, untracked }
  diagrams: { structure, domain }   // 默认两张，id 固定为 structure / domain
  custom: DiagramState[]      // 任意自定义图，id = dgm_xxx
  concepts: Concept[]         // 项目级概念表（id/name/summary/evidence/tags）
  qa: QaEntry[]               // 对图的提问记录（diagramId/question/answer/applied）
  runs / lastRun              // + diagramIds
}
DiagramState {
  id, kind: structure|domain|custom, title, prompt,
  persistence: permanent|temporary, parentId, setId, conceptIds,
  status, htmlPath, specPath, generatedAt, branch, tree, error
}
```

- `permanent`：prompt 存台账，`更新图册` 时自动用同一 prompt 重画；
- `temporary`：只跑这一次，`更新图册` 时不选它（产物仍可看）；
- `parentId` 构成父子图；`setId` 相同 = 一套图（大图 + 细节小图）；
- 概念是项目级，图只引用 `conceptIds` 子集。

迁移在 `store.normalize`：v1 的 `diagrams.structure/domain` 对象直接读成两张永久图，
其余字段（prompt/parent/set/concepts）补默认值；旧台账不需要手工改。

### 12.3 接口新增

| 方法         | 路径                                           | 用途                                                                          |
| ------------ | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| POST         | `/projects/:id/diagrams`                       | 新建自定义图（`{title, prompt, persistence?, parentId?, conceptIds?, run?}`） |
| PATCH/DELETE | `/projects/:id/diagrams/:diagramId`            | 改标题/prompt/时效/概念；删图（连带子图与 qa）                                |
| POST         | `/projects/:id/diagrams/:diagramId/regenerate` | 重画单张（默认图与自定义图同一入口）                                          |
| POST         | `/projects/:id/diagrams/:diagramId/ask`        | 只读提问，回答落 `qa[]`                                                       |
| POST         | `/projects/:id/qa/:qaId/merge`                 | 把回答并进图（prompt 追加「用户追问补充」后重画）                             |
| POST         | `/projects/:id/qa/:qaId/child`                 | 以回答为 prompt 建子图                                                        |

`/projects/:id/diagram/:kind` 保留为兼容入口。

### 12.4 提示词与上下文（`src/shared/prompt.ts`）

- `buildRunPrompt`：环境事实（分支 + 工作区计数）→ 概念表契约（写 `concepts.json`）→
  每张图的建模口径/自定义 prompt → archify 调用方式（目录名以图 id 开头）→
  `ARCHIFY_ARTIFACT <id> <path>` 回报标记。
- `buildAskPrompt`：只给「这张图的 prompt + candidate.json 截断 + 绑定的概念及证据文件 +
  代码库根目录」，要求先结论后依据、查不到就说没有、最后给「建议补进图里的节点/关系」。
- 问答会话的工具面由 `policy.readonlyToolNames()` 收口为 `read/glob/grep/skill`。

### 12.5 页面

三栏工作台（`src/client/page.tsx`）：左「图册树」（默认套图 / 自定义 / 子图 / 概念索引）、
中「查看器」（iframe + 子图缩略条）、右「检查器」（图信息 / 提问）。
总览是项目卡片墙（分支、工作区计数、概念数、过期提示）。样式仍只用 DSH token，
单 bundle 81.6 KB（预算 220 KB）。
