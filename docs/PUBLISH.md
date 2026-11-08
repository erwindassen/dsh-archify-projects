# 发布到 npm（首次 + 之后自动）

> 仓库自带的 `~/.npmrc` 指向 `registry.npmmirror.com`（国内镜像）。**镜像是只读的，发不了包。**
> 下面每条命令都显式带 `--registry=https://registry.npmjs.org`，别省。

## 0. 前置

- npm 账号：<https://www.npmjs.com/signup>（用户名、邮箱、密码）
- **邮箱必须验证**，否则 `npm publish` 会 403
- 建议开 2FA（App 或安全密钥）；npm 会对发布要求 OTP
- 包名 `dsh-archify-projects` 在 npm 上**当前未被占用**（查过 registry，404）

## 1. 本机登录

```bash
npm login --registry=https://registry.npmjs.org
# 浏览器会弹一次授权页；或用 npm login --auth-type=legacy 走用户名/邮箱/密码
npm whoami --registry=https://registry.npmjs.org    # 应该打印你的用户名
```

登录成功后 `~/.npmrc` 会多出一行 `//registry.npmjs.org/:_authToken=npm_xxx`。
**这一行就是要放进 GitHub Secret 的值。**

## 2. 首次发布

```bash
cd dsh-archify-projects
pnpm verify                                   # 必须是绿的
npm publish --access public --registry=https://registry.npmjs.org
```

`prepublishOnly` 会自动 `pnpm build`，所以发出去的包里有 `lib/` 与 `dist/client.js`。
发完自检：

```bash
npm view dsh-archify-projects version --registry=https://registry.npmjs.org
npm view dsh-archify-projects dist.tarball --registry=https://registry.npmjs.org
```

## 3. 之后交给 CI 自动发

1. GitHub 仓库 → **Settings → Secrets and variables → Actions → New repository secret**
2. Name: `NPM_TOKEN`；Secret: 上面那行 `npm_xxx` 的 token 值（不含 `//registry.npmjs.org/:_authToken=` 前缀）
3. 之后打标签即自动发：

   ```bash
   npm version patch --no-git-tag-version
   git commit -am "chore: release v0.1.1"
   git tag v0.1.1 && git push origin main --tags
   ```

   `.github/workflows/release.yml` 会先建 GitHub Release（始终），再因为 `NPM_TOKEN`
   存在而跑 `npm publish`。没配 secret 时这一步跳过，其它照常。

## 4. 版本号与 tag 的关系

- `package.json` 的 `version` 是唯一真相；
- 标签必须是 `v<version>`，否则 release workflow 直接失败；
- npm 不允许覆盖已发布版本：改代码后必须 bump version 才能再发。

## 5. 常见错误

| 报错                                                            | 原因          | 处理                                           |
| --------------------------------------------------------------- | ------------- | ---------------------------------------------- |
| `403 You must verify your email`                                | 邮箱没验证    | 去 npm 邮箱点验证链接                          |
| `403 You cannot publish over the previously published versions` | 版本号没 bump | 改 `version` 再发                              |
| `EOTP` / 要求一次性密码                                         | 账号开了 2FA  | 命令后加 `--otp=123456`                        |
| `404 Not Found - PUT ...`                                       | 打到了镜像源  | 显式加 `--registry=https://registry.npmjs.org` |
| `402 Payment Required`                                          | 想发私有包    | 公开包必须 `--access public`                   |
