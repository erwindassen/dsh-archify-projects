# 上架到 DSH 插件市场

市场（[dsh-market](https://github.com/dsh-market/dsh-market)）本身不放列表：它的目录来自
[curated registry `awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。
所以「让别人在市场里看到这个插件」= 往那个仓库提一个 YAML 文件的 PR。

## 一次性准备

1. **发 npm 包**（推荐，装起来最快、免构建授权）：

   ```bash
   npm login                     # 需要你自己的 npm 账号
   cd dsh-archify-projects
   pnpm build                    # 或者直接 pnpm publish（prepublishOnly 会构建）
   npm publish --access public
   ```

   `prepublishOnly` 已经配好，publish 前会自动 `pnpm build`，tarball 里带 `lib/` 与
   `dist/client.js`（`pnpm pack` 实测 1.9 MB，含内嵌的 archify skill）。

2. **或者**把 `pnpm pack` 出来的 tarball 传到 GitHub Release：
   `gh release create v0.1.0 dsh-archify-projects-0.1.0.tgz`（或网页上传），
   然后把 `docs/market/guicaiyue__dsh-archify-projects.yml` 里 `tarball:` 的版本号对齐。

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
