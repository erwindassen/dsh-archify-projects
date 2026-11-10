# 上架到 DSH 插件市场

市场（[dsh-market](https://github.com/dsh-market/dsh-market)）本身不放列表：它的目录来自
[curated registry `awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。
所以「让别人在市场里看到这个插件」= 往那个仓库提一个 YAML 文件的 PR。

## 一次性准备

1. **发一个版本**（Release 由 GitHub Actions 自动建，不用手工上传）：

   ```bash
   # 改版本号（或 npm version patch --no-git-tag-version）
   vim package.json          # version: 0.1.0 -> 0.1.1
   git commit -am "chore: release v0.1.1"
   git tag v0.1.1
   git push origin main --tags
   ```

   `.github/workflows/release.yml` 会在标签推送后：跑 `pnpm verify` → `pnpm pack`
   → 建 Release（自动生成 release notes）→ 挂三类资产：
   - `dsh-archify-projects-<version>.tgz`（带版本号）
   - `dsh-archify-projects.tgz`（**稳定别名**，市场条目指向它，发版不用改 YAML）
   - `SHA256SUMS.txt`

   标签与 `package.json` 的 version 不一致时任务直接失败，不会发出错版。

2. **npm 也可以自动发**：仓库 Settings → Secrets 里加 `NPM_TOKEN`，workflow 会多跑一步
   `npm publish --access public`；没配这个 secret 就跳过，不会变红。

   首次发布（本机，注意绕开镜像源）：

   ```bash
   npm login --registry=https://registry.npmjs.org
   npm publish --access public --registry=https://registry.npmjs.org
   ```

   然后把 `~/.npmrc` 里 `//registry.npmjs.org/:_authToken=...` 那一行（登录后会有）
   填进仓库的 **Settings → Secrets and variables → Actions → `NPM_TOKEN`**。
   详见 [`docs/PUBLISH.md`](../PUBLISH.md)。

3. 给仓库加 GitHub topic **`dsh-plugin`**（设置页 Topics，评审要求）。

## 提 PR

把本目录里的 `guicaiyue__dsh-archify-projects.yml` 放到那个仓库的
`data/plugins/` 下（文件名必须 `<owner>__<repo>.yml`），提一个只加这一个文件的 PR：

```bash
git clone https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
cd awesome-dsh-plugin
cp /path/to/dsh-archify-projects/docs/market/guicaiyue__dsh-archify-projects.yml data/plugins/
git checkout -b add-dsh-archify-projects
git add data/plugins/guicaiyue__dsh-archify-projects.yml
git commit -m "Add guicaiyue/dsh-archify-projects"
git push origin add-dsh-archify-projects
```

**不要手改 README**：两份 README 由 `data/plugins/*.yml` 生成，合并后 CI 自动重生成。

## 以后更新条目（已经在列表里了）

条目首次合并后（本插件是 PR #13318），**再改只动自己那一个 yml**：

```bash
# 1. 本地改 docs/market/guicaiyue__dsh-archify-projects.yml
# 2. 从上游最新 main 拉一个分支，只改 data/plugins/ 下自己那一条
gh repo clone guicaiyue/awesome-dsh-plugin /tmp/mk/repo
cd /tmp/mk/repo && git remote add upstream https://github.com/awesome-dsh-plugin/awesome-dsh-plugin.git
git fetch upstream main && git checkout -B update-entry upstream/main
# 把本地 yml 的内容按「只改自己那条」的粒度写进去
git commit -am "Refresh guicaiyue/dsh-archify-projects description (vX.Y.Z)"
git push -u origin update-entry && gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --base main --head guicaiyue:update-entry
```

规矩（`contributing.md`）：

- **一个文件就是全部投稿**，README 别手改，合并后 CI 重生成；
- **不要碰别人的条目** —— gate 会把「这个 PR 改了哪些既有条目」列出来给评审看；
- 描述必须**属实**：里面提到的数字、命令、API 都会被对着代码核；
- `category` 选最贴近的即可，评审会直接改，不会因此打回；
- 手写 `npm:` 键会被校验拒绝，映射由 nightly 从 registry 自动采集。

参考：更新 v0.2.0 描述的那次 PR
[#13762](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/13762)
（只改 en/zh 两行，`check` 与 `Submission gate` 全绿）。

## npm 版本号与下载量：不要加字段

市场卡片上的「npm 版本 / 下载量」**不是条目字段**。`awesome-dsh-plugin` 的校验会拒绝
手写的 `npm:` 键（见其 contributing.md「npm package」一节），映射由 nightly 的
`scripts/probe-npm.mjs` 自动采集：

1. 从仓库 `package.json` 读包名；
2. 去 registry 查这个包；
3. **要求该包的 `repository` 字段指回同一个 GitHub 仓库**（防抢注）。

所以只要满足这三条，下一次 nightly（`build-site.yml`，每天 `02:23 UTC` ≈ 北京 10:23）
就会自动补上版本号，随后 `probe-downloads` 补下载量：

- 条目已在 README（PR 合并）✅
- 仓库 `package.json` 的 `name` = `dsh-archify-projects` ✅
- npm 包的 `repository` = `git+https://github.com/guicaiyue/dsh-archify-projects.git` ✅

## 会不会自动出现

- 合并后，`awesome-dsh-plugin.com/plugins.json` 与 npm 上的 `dsh-plugin-catalog` 索引
  会在一天内刷新，dsh-market 的 Discover 页、`plugin_market` 工具都会读到。
- 在你**自己机器**上，dsh-market 打开时会实时拉 `plugins.json`；如果拉不到，可在
  **插件 → 发现 → 索引源**里加 `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`。
- 没合并之前，dsh-market 里搜不到 —— 因为它只显示 curated 列表里的条目。

## 市场详情页的截图：仓库根 `screenshots.json`

市场详情页那块 AppStore 式截图**不从条目 YAML 来，也不从 README 抽**——它是
`awesome-dsh-plugin` 的 `probe-screenshots.mjs` 读**插件自己仓库**里、`package.json`
旁边的 `screenshots.json`（1–8 条**相对路径**，按仓库 HEAD 解析成 raw 绝对地址）：

```json
[
  "docs/verify/shot-atlas.png",
  "docs/verify/shot-workbench.png",
  "docs/verify/shot-qa.png",
  "docs/verify/shot-dialog.png"
]
```

几条硬规矩（都写在它的 `contributing.md` 里）：

- **改截图只推自己的仓库**，不用再提 PR、不用等维护者，下一个 nightly 自动生效；
- 相对路径优先（改名会立刻在自己仓库里暴露）；绝对 URL 只收 GitHub 托管
  （`raw.githubusercontent.com` 等），第三方图床直接被拒；
- 上限 8 张，404 的会被静默丢掉；不声明时该字段整个不出现，详情页就没有截图画廊
  （README 正文照常在详情页底部渲染，那是另一条 `probe-readmes` 路径）；
- 老的 `data/screenshots.json`（键是条目 URL）只是前 `screenshots.json` 时代的回退，
  别往里加新键。本插件当初就是没声明这个文件，所以市场里一直看不到图。
