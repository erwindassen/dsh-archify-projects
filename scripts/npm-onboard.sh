#!/usr/bin/env bash
# 一次性把 npm 发布链路打通：登录 → 发版 → 把 token 写进 GitHub Secret。
#
# 用法（在你自己的终端里跑，这样登录链接一出现你就能马上点）：
#   cd ~/Projects/dsh-archify-projects && ./scripts/npm-onboard.sh
#
# 关键：npm 的网页登录会话只有 5 分钟左右有效期。
# 通过聊天转发链接一定会过期，所以这一步必须由你在终端里完成。
set -euo pipefail

REGISTRY="https://registry.npmjs.org"
REPO="guicaiyue/dsh-archify-projects"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "== 1/4 登录 npm（浏览器会弹出授权页，请立刻点）=="
npm login --registry="$REGISTRY" --auth-type=web
WHO=$(npm whoami --registry="$REGISTRY")
echo "  已登录：$WHO"

echo "== 2/4 质量门 =="
pnpm verify

echo "== 3/4 发布到 npm =="
VERSION=$(node -p "require('./package.json').version")
if npm view "dsh-archify-projects@$VERSION" version --registry="$REGISTRY" >/dev/null 2>&1; then
  echo "  版本 $VERSION 已经发过，跳过（要再发请先 bump version）"
else
  npm publish --access public --registry="$REGISTRY"
  echo "  已发布 dsh-archify-projects@$VERSION"
fi

echo "== 4/4 把 token 写进 GitHub Secret NPM_TOKEN =="
TOKEN=$(sed -n 's#^//registry.npmjs.org/:_authToken=##p' "$HOME/.npmrc" | tail -1)
if [ -z "$TOKEN" ]; then
  echo "  没在 ~/.npmrc 里找到 token，跳过（可手动在仓库 Settings → Secrets 里加）" >&2
else
  printf '%s' "$TOKEN" | gh secret set NPM_TOKEN --repo "$REPO"
  echo "  已写入 $REPO 的 NPM_TOKEN"
fi

echo
echo "完成。之后打标签即自动发版："
echo "  npm version patch --no-git-tag-version && git commit -am 'chore: release vX.Y.Z'"
echo "  git tag vX.Y.Z && git push origin main --tags"
