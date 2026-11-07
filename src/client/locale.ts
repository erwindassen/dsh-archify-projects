/**
 * 页面文案。中英双语，键集合必须完全一致（`tests/unit/locale.test.ts` 守着）。
 *
 * 不放在 `locale/*.json` 里：那两个文件是**包级元数据**（宿主用来显示插件名与描述），
 * 页面内的即时文案走 `ctx.locale.register(ns, DICT)`。
 */

export const LOCALE_NS = 'dsh-archify-projects'

/** 中文（默认）。 */
const zh: Record<string, string> = {
  'panel.title': '架构建模',
  'panel.desc': '代码库结构图与领域图',

  'page.title': '架构建模',
  'page.subtitle': '代码库 → 项目结构图 / 领域图',

  'action.add': '新增项目',
  'action.refresh': '刷新',
  'action.update': '更新',
  'action.check': '重探 Git',
  'action.preview': '预览',
  'action.openTab': '新窗口打开',
  'action.regenerate': '重新生成',
  'action.delete': '删除',
  'action.openSession': '查看会话',
  'action.cancel': '取消',
  'action.submit': '创建并分析',
  'action.close': '关闭',

  'empty.title': '还没有项目',
  'empty.body': '新增一个项目：填名称和本地代码库路径，插件会自动识别 Git 并生成两张图谱。',
  'empty.action': '新增第一个项目',

  'dialog.addTitle': '新增项目',
  'field.name': '项目名称',
  'field.namePlaceholder': '留空则用目录名',
  'field.path': '代码库路径',
  'field.pathPlaceholder': 'D:\\work\\your-repo',
  'field.pathRequired': '请填写代码库路径',

  'git.noRepo': '非 Git 目录',
  'git.noRepoHint': '不做分支切换，直接基于当前目录分析',
  'git.branch': '分支',
  'git.commit': '提交',
  'git.upstream': '上游',
  'git.dirty': '工作区有未提交改动',
  'git.clean': '工作区干净',
  'git.detached': '分离头指针',
  'git.checkedAt': '探测于 {time}',
  'git.behind': '落后 {n}',
  'git.ahead': '领先 {n}',
  'git.inSync': '与上游同步',

  'diagram.structure': '项目结构图',
  'diagram.domain': '领域图',
  'diagram.structureDesc': '模块、分层与依赖关系',
  'diagram.domainDesc': '限界上下文、聚合、实体与领域事件',

  'status.idle': '未生成',
  'status.queued': '排队中',
  'status.running': '生成中',
  'status.ready': '已就绪',
  'status.failed': '失败',
  'status.stale': '有新提交，建议更新',
  'status.none': '—',

  'run.history': '运行记录',
  'run.none': '还没有运行记录',
  'run.kind.create': '首次生成',
  'run.kind.update': '更新',
  'run.kind.regenerate': '重生成',
  'run.status.running': '运行中',
  'run.status.succeeded': '成功',
  'run.status.failed': '失败',

  'meta.repoPath': '代码库',
  'meta.createdAt': '创建于 {time}',
  'meta.generatedAt': '生成于 {time}',
  'meta.basedOn': '基于 {commit}',

  'confirm.update': '更新会把仓库切回记录的分支并快进到最新提交，然后重新分析。继续？',
  'confirm.delete': '删除只移除台账和产物目录，不会动你的代码库。继续？',
  'confirm.updateOk': '更新',
  'error.generic': '出错了：{message}',
  'notice.dirty': '工作区有未提交改动，已跳过自动同步，本次基于当前内容分析。',
  'notice.noGit': '这个目录不是 Git 仓库，跳过分支切换。',
  'notice.running': 'Agent 正在生成图谱，完成后会自动刷新。',

  'time.now': '刚刚',
  'time.minutes': '{n} 分钟前',
  'time.hours': '{n} 小时前',
  'time.days': '{n} 天前',
}

/** English. */
const en: Record<string, string> = {
  'panel.title': 'Archify',
  'panel.desc': 'Repository structure and domain maps',

  'page.title': 'Architecture Studio',
  'page.subtitle': 'Codebase → structure map / domain map',

  'action.add': 'New project',
  'action.refresh': 'Refresh',
  'action.update': 'Update',
  'action.check': 'Re-check Git',
  'action.preview': 'Preview',
  'action.openTab': 'Open in new tab',
  'action.regenerate': 'Regenerate',
  'action.delete': 'Delete',
  'action.openSession': 'Open session',
  'action.cancel': 'Cancel',
  'action.submit': 'Create and analyse',
  'action.close': 'Close',

  'empty.title': 'No projects yet',
  'empty.body':
    'Add a project with a local repository path. Git is detected automatically and two diagrams are generated.',
  'empty.action': 'Add your first project',

  'dialog.addTitle': 'New project',
  'field.name': 'Project name',
  'field.namePlaceholder': 'Defaults to the folder name',
  'field.path': 'Repository path',
  'field.pathPlaceholder': 'D:\\work\\your-repo',
  'field.pathRequired': 'Repository path is required',

  'git.noRepo': 'Not a Git repository',
  'git.noRepoHint': 'No branch switching; analysis runs on the current directory',
  'git.branch': 'Branch',
  'git.commit': 'Commit',
  'git.upstream': 'Upstream',
  'git.dirty': 'Uncommitted changes',
  'git.clean': 'Clean',
  'git.detached': 'Detached HEAD',
  'git.checkedAt': 'Checked {time}',
  'git.behind': '{n} behind',
  'git.ahead': '{n} ahead',
  'git.inSync': 'Up to date',

  'diagram.structure': 'Structure map',
  'diagram.domain': 'Domain map',
  'diagram.structureDesc': 'Modules, layers and dependencies',
  'diagram.domainDesc': 'Bounded contexts, aggregates, entities and domain events',

  'status.idle': 'Not generated',
  'status.queued': 'Queued',
  'status.running': 'Generating',
  'status.ready': 'Ready',
  'status.failed': 'Failed',
  'status.stale': 'Newer commit available',
  'status.none': '—',

  'run.history': 'Runs',
  'run.none': 'No runs yet',
  'run.kind.create': 'Initial',
  'run.kind.update': 'Update',
  'run.kind.regenerate': 'Regenerate',
  'run.status.running': 'Running',
  'run.status.succeeded': 'Succeeded',
  'run.status.failed': 'Failed',

  'meta.repoPath': 'Repository',
  'meta.createdAt': 'Created {time}',
  'meta.generatedAt': 'Generated {time}',
  'meta.basedOn': 'Based on {commit}',

  'confirm.update':
    'Update switches the repo back to the recorded branch, fast-forwards it, then re-analyses. Continue?',
  'confirm.delete':
    'Deleting removes the ledger entry and artifact folder only; your repository is untouched. Continue?',
  'confirm.updateOk': 'Update',
  'error.generic': 'Error: {message}',
  'notice.dirty':
    'Working tree has uncommitted changes; automatic sync was skipped and this run uses the current content.',
  'notice.noGit': 'This directory is not a Git repository; branch switching is skipped.',
  'notice.running': 'The agent is generating diagrams. This refreshes automatically.',

  'time.now': 'just now',
  'time.minutes': '{n} min ago',
  'time.hours': '{n} h ago',
  'time.days': '{n} d ago',
}

/** 注册给 `ctx.locale.register` 的字典。 */
export const DICT: Record<'zh' | 'en', Record<string, string>> = { zh, en }

/** 文案键（供类型与测试使用）。 */
export type MessageKey = keyof typeof zh
