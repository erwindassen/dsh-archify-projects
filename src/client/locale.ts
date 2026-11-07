/**
 * 页面文案。中英双语，键集合必须完全一致（`tests/contract/locale.test.ts` 守着）。
 *
 * 不放在 `locale/*.json` 里：那两个文件是**包级元数据**（宿主用来显示插件名与描述），
 * 页面内的即时文案走 `ctx.locale.register(ns, DICT)`。
 */

export const LOCALE_NS = 'dsh-archify-projects'

/** 中文（默认）。 */
const zh: Record<string, string> = {
  'panel.title': '架构建模',
  'panel.desc': '代码库概念与图册',

  'page.title': '架构建模',
  'page.subtitle': '代码库 → 概念 → 图册 · 按分支维护，工作区改动一起纳入',

  'stat.repos': '在册仓库',
  'stat.concepts': '已提取概念',
  'stat.diagrams': '图与套图',
  'stat.running': '正在生成',
  'tab.info': '图信息',
  'tab.qa': '提问',

  'action.add': '新增项目',
  'action.refresh': '刷新',
  'action.update': '更新图册',
  'action.updateAll': '全部更新',
  'action.check': '重探 Git',
  'action.openTab': '新窗口',
  'action.fullscreen': '全屏',
  'action.regenerate': '重画',
  'action.delete': '删除',
  'action.openSession': '查看会话',
  'action.cancel': '取消',
  'action.submit': '创建并分析',
  'action.close': '关闭',
  'action.back': '返回图册',
  'action.newDiagram': '新建图',
  'action.ask': '提问',
  'action.send': '发送',
  'action.merge': '补进图里',
  'action.child': '创建子图',
  'action.save': '保存',

  'empty.title': '还没有项目',
  'empty.body': '新增一个项目：填名称和本地代码库路径，插件会先提取概念，再生成默认两张图。',
  'empty.action': '新增第一个项目',

  'dialog.addTitle': '新增项目',
  'field.name': '项目名称',
  'field.namePlaceholder': '留空则用目录名',
  'field.path': '代码库路径',
  'field.pathPlaceholder': '/home/me/projects/your-repo',
  'field.pathRequired': '请填写代码库路径',

  'dialog.newDiagram': '新建图',
  'dialog.newDiagramSub': '用自然语言描述要什么图，agent 读代码后按这个 prompt 画。',
  'field.title': '标题',
  'field.titlePlaceholder': '例如：一次更新的调用链',
  'field.prompt': '出图要求',
  'field.promptPlaceholder':
    '例如：画出一次「更新」从按钮到产物回收的完整调用链，标出每一步失败会怎样。',
  'field.persistence': '时效',
  'field.parent': '归属',
  'field.concepts': '概念范围',
  'field.branch': '分支',
  'field.status': '状态',
  'field.generatedAt': '生成时间',
  'field.owner': '所属',
  'field.tree': '工作区',

  'persistence.permanent': '永久 · 下次更新沿用',
  'persistence.temporary': '临时 · 仅这一次',
  'persistence.permanentHint': '存住 prompt，下次「更新图册」自动用同一 prompt 重画。',
  'persistence.temporaryHint': '只跑这一次，不占下次更新的时间；产物仍可查看。',
  'parent.none': '独立套图',
  'parent.current': '挂在当前图下',

  'git.noRepo': '非 Git 目录',
  'git.noRepoHint': '不做分支切换，直接基于当前目录分析',
  'git.branch': '分支',
  'git.dirty': '工作区有未提交改动',
  'git.clean': '工作区干净',
  'git.detached': '分离头指针',
  'git.checkedAt': '探测于 {time}',
  'git.behind': '落后 {n}',
  'git.ahead': '领先 {n}',
  'git.inSync': '与上游同步',
  'git.tree': '暂存 {staged} · 未暂存 {unstaged} · 未跟踪 {untracked}',
  'git.treeShort': '{staged} 暂存 · {unstaged} 未暂存',

  'diagram.structure': '项目结构图',
  'diagram.domain': '领域图',
  'diagram.custom': '自定义图',
  'diagram.structureDesc': '模块、分层与依赖关系',
  'diagram.domainDesc': '限界上下文、聚合、实体与领域事件',
  'diagram.defaultSet': '默认套图',
  'diagram.customGroup': '自定义',
  'diagram.children': '子图',
  'diagram.concepts': '概念索引',
  'diagram.allConcepts': '全部 {n}',

  'status.idle': '未生成',
  'status.queued': '排队中',
  'status.running': '生成中',
  'status.ready': '已就绪',
  'status.failed': '失败',
  'status.stale': '工作区有变化',
  'status.none': '—',

  'qa.title': '提问',
  'qa.empty': '对这张图提问；agent 只读代码与这张图来回答。',
  'qa.placeholder': '例如：路由注册失败时插件会怎样？',
  'qa.answer': 'agent',
  'qa.me': '我',
  'qa.applied': '已补进图里',
  'qa.working': 'agent 正在读代码回答…',
  'qa.mergeHint': '「补进图里」会把这次回答并进这张图并重画；「创建子图」会挂一张新图。',

  'concept.title': '概念',
  'concept.none': '还没有概念表；先跑一次更新。',

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
  'meta.branchLevel': '按分支维护 {branch}',

  'confirm.update': '更新会先快进到上游最新提交，然后用同一 prompt 重画所有永久图。继续？',
  'confirm.delete': '删除只移除台账和产物目录，不会动你的代码库。继续？',
  'confirm.updateOk': '更新',
  'error.generic': '出错了：{message}',
  'notice.dirty': '工作区有未提交改动，已跳过自动同步，本次基于当前内容分析。',
  'notice.noGit': '这个目录不是 Git 仓库，跳过分支切换。',
  'notice.running': 'Agent 正在生成图谱，完成后会自动刷新。',
  'notice.merged': '已把回答并进图里，正在重画。',
  'notice.child': '已创建子图，正在生成。',
  'notice.temporary': '这是临时图：只跑这一次，下次更新不会重画。',

  'time.now': '刚刚',
  'time.minutes': '{n} 分钟前',
  'time.hours': '{n} 小时前',
  'time.days': '{n} 天前',
}

/** English. */
const en: Record<string, string> = {
  'panel.title': 'Archify',
  'panel.desc': 'Concepts and diagram atlas',

  'page.title': 'Architecture Studio',
  'page.subtitle': 'Codebase → concepts → atlas · per branch, working tree included',

  'stat.repos': 'Repositories',
  'stat.concepts': 'Concepts',
  'stat.diagrams': 'Diagrams & sets',
  'stat.running': 'Generating',
  'tab.info': 'Info',
  'tab.qa': 'Ask',

  'action.add': 'New project',
  'action.refresh': 'Refresh',
  'action.update': 'Update atlas',
  'action.updateAll': 'Update all',
  'action.check': 'Re-check Git',
  'action.openTab': 'Open',
  'action.fullscreen': 'Fullscreen',
  'action.regenerate': 'Redraw',
  'action.delete': 'Delete',
  'action.openSession': 'Open session',
  'action.cancel': 'Cancel',
  'action.submit': 'Create and analyse',
  'action.close': 'Close',
  'action.back': 'Back to atlas',
  'action.newDiagram': 'New diagram',
  'action.ask': 'Ask',
  'action.send': 'Send',
  'action.merge': 'Merge into diagram',
  'action.child': 'Create child diagram',
  'action.save': 'Save',

  'empty.title': 'No projects yet',
  'empty.body':
    'Add a project with a local repository path. Concepts are extracted first, then the two default diagrams are generated.',
  'empty.action': 'Add your first project',

  'dialog.addTitle': 'New project',
  'field.name': 'Project name',
  'field.namePlaceholder': 'Defaults to the folder name',
  'field.path': 'Repository path',
  'field.pathPlaceholder': '/home/me/projects/your-repo',
  'field.pathRequired': 'Repository path is required',

  'dialog.newDiagram': 'New diagram',
  'dialog.newDiagramSub':
    'Describe the diagram you want. The agent reads the code and draws from this prompt.',
  'field.title': 'Title',
  'field.titlePlaceholder': 'e.g. Update call chain',
  'field.prompt': 'Prompt',
  'field.promptPlaceholder':
    'e.g. Draw the full call chain of an update, from the button to artifact collection, including failure modes.',
  'field.persistence': 'Lifetime',
  'field.parent': 'Placement',
  'field.concepts': 'Concept scope',
  'field.branch': 'Branch',
  'field.status': 'Status',
  'field.generatedAt': 'Generated',
  'field.owner': 'Owner',
  'field.tree': 'Working tree',

  'persistence.permanent': 'Permanent · reuse next update',
  'persistence.temporary': 'Temporary · this run only',
  'persistence.permanentHint':
    'The prompt is kept; the next atlas update redraws it with the same prompt.',
  'persistence.temporaryHint': 'Runs once, skipped on future updates; artifacts stay available.',
  'parent.none': 'Own set',
  'parent.current': 'Under selected diagram',

  'git.noRepo': 'Not a Git repository',
  'git.noRepoHint': 'No branch switching; analysis runs on the current directory',
  'git.branch': 'Branch',
  'git.dirty': 'Uncommitted changes',
  'git.clean': 'Clean',
  'git.detached': 'Detached HEAD',
  'git.checkedAt': 'Checked {time}',
  'git.behind': '{n} behind',
  'git.ahead': '{n} ahead',
  'git.inSync': 'Up to date',
  'git.tree': '{staged} staged · {unstaged} unstaged · {untracked} untracked',
  'git.treeShort': '{staged} staged · {unstaged} unstaged',

  'diagram.structure': 'Structure map',
  'diagram.domain': 'Domain map',
  'diagram.custom': 'Custom diagram',
  'diagram.structureDesc': 'Modules, layers and dependencies',
  'diagram.domainDesc': 'Bounded contexts, aggregates, entities and domain events',
  'diagram.defaultSet': 'Default set',
  'diagram.customGroup': 'Custom',
  'diagram.children': 'Children',
  'diagram.concepts': 'Concepts',
  'diagram.allConcepts': 'All {n}',

  'status.idle': 'Not generated',
  'status.queued': 'Queued',
  'status.running': 'Generating',
  'status.ready': 'Ready',
  'status.failed': 'Failed',
  'status.stale': 'Working tree changed',
  'status.none': '—',

  'qa.title': 'Ask',
  'qa.empty': 'Ask about this diagram; the agent answers from the code and this diagram only.',
  'qa.placeholder': 'e.g. What happens when route registration fails?',
  'qa.answer': 'agent',
  'qa.me': 'me',
  'qa.applied': 'Merged into diagram',
  'qa.working': 'The agent is reading code…',
  'qa.mergeHint':
    'Merge folds the answer into this diagram and redraws it; Create child attaches a new diagram.',

  'concept.title': 'Concepts',
  'concept.none': 'No concepts yet; run an update first.',

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
  'meta.branchLevel': 'Maintained per branch {branch}',

  'confirm.update':
    'Update fast-forwards to the latest upstream commit, then redraws every permanent diagram with its own prompt. Continue?',
  'confirm.delete':
    'Deleting removes the ledger entry and artifact folder only; your repository is untouched. Continue?',
  'confirm.updateOk': 'Update',
  'error.generic': 'Error: {message}',
  'notice.dirty':
    'Working tree has uncommitted changes; automatic sync was skipped and this run uses the current content.',
  'notice.noGit': 'This directory is not a Git repository; branch switching is skipped.',
  'notice.running': 'The agent is generating diagrams. This refreshes automatically.',
  'notice.merged': 'Answer merged into the diagram; redrawing.',
  'notice.child': 'Child diagram created; generating.',
  'notice.temporary': 'Temporary diagram: runs once and is skipped on future updates.',

  'time.now': 'just now',
  'time.minutes': '{n} min ago',
  'time.hours': '{n} h ago',
  'time.days': '{n} d ago',
}

/** 注册给 `ctx.locale.register` 的字典。 */
export const DICT: Record<'zh' | 'en', Record<string, string>> = { zh, en }

/** 文案键（供类型与测试使用）。 */
export type MessageKey = keyof typeof zh
