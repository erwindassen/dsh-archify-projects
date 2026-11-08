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

## 会不会自动出现

- 合并后，`awesome-dsh-plugin.com/plugins.json` 与 npm 上的 `dsh-plugin-catalog` 索引
  会在一天内刷新，dsh-market 的 Discover 页、`plugin_market` 工具都会读到。
- 在你**自己机器**上，dsh-market 打开时会实时拉 `plugins.json`；如果拉不到，可在
  **插件 → 发现 → 索引源**里加 `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`。
- 没合并之前，dsh-market 里搜不到 —— 因为它只显示 curated 列表里的条目。
