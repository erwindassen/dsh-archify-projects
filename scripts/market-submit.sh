#!/usr/bin/env bash
# 把本插件上架到 DSH 插件市场（awesome-dsh-plugin）。
#
# 前置：gh 已授权（`gh auth login`，或 `gh auth login --with-token` 走 PAT），
# 且 token 有 repo 权限（够改自己仓库的 topics、fork 公共仓库、开 PR）。
#
# 做三件事，全部幂等：
#   1. 给本仓库加 GitHub topic dsh-plugin（评审硬性要求）
#   2. fork awesome-dsh-plugin/awesome-dsh-plugin
#   3. 在 fork 里加 data/plugins/<owner>__<repo>.yml，推分支并开 PR
set -euo pipefail

OWNER_REPO="guicaiyue/dsh-archify-projects"
UPSTREAM="awesome-dsh-plugin/awesome-dsh-plugin"
ENTRY_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/docs/market/guicaiyue__dsh-archify-projects.yml"
ENTRY_NAME="$(basename "$ENTRY_SRC")"
BRANCH="add-dsh-archify-projects"
WORKDIR="$(mktemp -d)"

command -v gh >/dev/null || { echo "需要 GitHub CLI（gh）" >&2; exit 1; }

# 两种授权方式都支持：
#   1) gh 里存好的凭据（gh auth login / --with-token，经典 token 需要 repo + read:org）
#   2) 直接给环境变量，绕开 gh 的 scope 校验（token 只需要 repo）
if [ -n "${GH_TOKEN:-}" ] || [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "使用环境变量里的 token（GH_TOKEN / GITHUB_TOKEN）"
elif gh auth status >/dev/null 2>&1; then
  echo "使用 gh 已保存的凭据"
else
  echo "先授权，二选一：" >&2
  echo "  echo 'ghp_xxx' | gh auth login --with-token      # token 需勾 repo + read:org" >&2
  echo "  export GH_TOKEN=ghp_xxx                         # 只需要 repo，绕过 scope 校验" >&2
  exit 1
fi
[ -f "$ENTRY_SRC" ] || { echo "找不到条目文件：$ENTRY_SRC" >&2; exit 1; }

echo "== 1/3 加 topic dsh-plugin =="
gh repo edit "$OWNER_REPO" --add-topic dsh-plugin
gh api "repos/$OWNER_REPO/topics" --jq '.names | join(",")' | sed 's/^/  topics: /'

echo "== 2/3 fork $UPSTREAM =="
gh repo fork "$UPSTREAM" --clone=false 2>&1 | tail -2 || true
ME="$(gh api user --jq .login)"
FORK="$ME/awesome-dsh-plugin"

echo "== 3/3 提 PR =="
gh repo clone "$FORK" "$WORKDIR/repo" -- --depth 1 >/dev/null
cd "$WORKDIR/repo"
git remote add upstream "https://github.com/$UPSTREAM.git" 2>/dev/null || true
git fetch upstream main --depth 1 >/dev/null 2>&1 || true
git checkout -B "$BRANCH" >/dev/null 2>&1 || true
mkdir -p data/plugins
cp "$ENTRY_SRC" "data/plugins/$ENTRY_NAME"
git add "data/plugins/$ENTRY_NAME"
if git diff --cached --quiet; then
  echo "  条目已存在且内容一致，跳过提交"
else
  git -c user.name="$(git config user.name || echo "$ME")" \
      -c user.email="$(git config user.email || echo "$ME@users.noreply.github.com")" \
      commit -m "Add $OWNER_REPO"
  git push -u origin "$BRANCH" --force-with-lease
fi
gh pr create --repo "$UPSTREAM" --base main --head "$ME:$BRANCH" \
  --title "Add $OWNER_REPO" \
  --body-file - <<'BODY'
Adds `guicaiyue/dsh-archify-projects` — an architecture map workbench for DeepSeek Harness: register local repositories, let a restricted agent read the code with the bundled archify skill, and keep branch-level structure and domain diagrams. Supports concept extraction, temporary/permanent custom diagrams, and read-only Q&A per diagram.

- Declares `dsh.bundle.patch` (`cordis.patch.yml`) and installs with `dsh plugin add`.
- Publishes a prebuilt tarball at https://github.com/guicaiyue/dsh-archify-projects/releases/latest/download/dsh-archify-projects.tgz (also on npm after the first `npm publish`).
- Repo has the `dsh-plugin` topic.
BODY

echo
echo "完成：$WORKDIR/repo（PR 链接见上）"
