/**
 * 依赖边界检查（dependency-cruiser）。
 *
 * 只保留四条「越界即错」的规则，外加无环。行数/体量不在这里设棘轮 ——
 * 体量不是缺陷本身，形状才是。
 */
export default {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: '循环依赖一律不许。',
      from: {},
      to: { circular: true },
    },
    {
      name: 'host-not-to-client',
      severity: 'error',
      comment: '宿主层不许依赖浏览器层。',
      from: { path: '^src/host' },
      to: { path: '^src/client' },
    },
    {
      name: 'client-not-to-host',
      severity: 'error',
      comment: '浏览器层不许依赖宿主层。',
      from: { path: '^src/client' },
      to: { path: '^src/host' },
    },
    {
      name: 'shared-stays-pure',
      severity: 'error',
      comment: 'shared 层是两边的公共纯逻辑，不许回头依赖任何一侧。',
      from: { path: '^src/shared' },
      to: { path: '^src/(host|client)' },
    },
    {
      name: 'client-no-node-builtin',
      severity: 'error',
      comment: '浏览器产物里出现 node:* 会在运行期炸。',
      from: { path: '^src/client' },
      to: { path: '^(node:|fs|path|os|child_process|crypto|url)' },
    },
  ],
  options: {
    // 不启用 git 缓存：这个仓库可能还没 init，缓存探测会直接失败
    cache: false,
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    exclude: { path: '(^|/)(dist|lib|coverage|tests|scripts)/' },
  },
}
