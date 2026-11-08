# 给接手这个仓库的 agent

这个目录是 DSH 插件 `dsh-archify-projects`（左栏「架构建模」）。**先读
[`docs/HANDOVER.md`](docs/HANDOVER.md)**，再动手。本文件只写「不许踩错」的硬约束。

## 三条硬约束

1. **改了 `src/host/**`、`cordis.patch.yml`、`package.json` 的 `dsh` 段 → 必须重启 dsh。**
   只改 `src/client/**` 才走热更。重启：双击桌面 `DSH启动.bat`；新 token 在
   `~/.dsh/logs/latest-web-url.txt`，旧标签页会要求重新登录，这是设计行为。
2. **别用 `curl` 判断路由是否注册**。宿主有浏览器信任栅栏，命令行永远是 403；
   同源页面 `fetch` 才是 200。`/health` 返回 403 = 路由存在，404 = 没挂上。
3. **只用宿主 token（`--dsw-alias-*`）上色**，禁止硬编码颜色；`dist/client.js` 有
   220 KB 预算（`pnpm artifact:check`）。

## 在容器里开发（Linux 首选）

`~/Projects/dsh-docker` 的 `dsh-dev`（`127.0.0.1:3080`）已把本仓库挂成 profile 的 bundle，
不碰宿主 `~/.dsh`。改完 `src/host/**` 在容器里 `pnpm build` + `docker compose restart dsh`
即生效；绑定关系、模型凭据、验证与冒烟见 [`docs/CONTAINER.md`](docs/CONTAINER.md)。

## 提交前必须绿

```bash
pnpm verify   # build → artifact:check → typecheck → lint → format:check → deps:check → test
```

当前基线：**173 passed / 12 files**。

## 产物与数据

- 台账 `~/.dsh/dsh-archify-projects/projects.json` 是唯一真相；产物在
  `~/.dsh/dsh-archify-projects/workspace/<projectId>/.archify/…`，**不写进用户代码库**。
- `ready` 必须有 `htmlPath`；任何时刻最多一条 `runs[]` 是 `running`（宿主启动时
  `reconcileArtifacts()` 会收尸）。

## 不要碰

- `skills/archify/` 是 vendored 第三方 skill（约 7.3 MB，已从 lint/format 排除）。升级就整目录覆盖，
  别手改；它是 preset 唯一的 skill 来源，删了插件就出不了图。
- `dist/`、`lib/` 是构建产物，不进版本库。

## 代理能力边界（这是产品的一部分，不是可选项）

插件起的出图 agent 只能看见 `read/write/edit/glob/grep/skill/todo_write` + 平台 shell；
**提问会话更窄，只有 `read/glob/grep/skill/todo_write`**（`todo_write` 只写自己的计划，
不扩大能力面，但**漏了它模型就看不到这个工具、页面就没有进度**）。两类会话的 skill 都只认 `archify`。
放宽这三层（preset 工具面 / `bundledSkillDir` / `policy.ts` 的 restrict+guard）就是改变产品定位，
先跟维护者确认。
