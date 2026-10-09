// 工具集清单 —— 新增一个工具的唯一登记处。
//
// 加一个工具要动的地方：① 在 src/components/tools/ 下放一个组件（自持状态，
// 可选接收 `snapshot` / `params` / `propose` / `logEvent` 这些 props）；
// ② 在下面数组里加一条；③ 算法放进 src/lib/<domain>/ 并配一个 *.test.js
// （准入门槛，见实施说明待拍板 ③）。
// 外壳只认这些字段，所以 App.jsx、ToolsPage.jsx 都不必改。
//
// 字段说明（★ = v0.1.6 新增的声明式字段）：
//   id            稳定标识，用于选中态、懒加载缓存与存档键名，不要跟着标题改
//   name/desc     工具名与一句话说明（左栏两行）
//   detail        工作区标题下方那段较长的解释
//   tags          分类标签，形态是"标签"不是按钮
//   icon          Icon.jsx 里的图标名
//   load          () => import(...)，工具多了以后不会一次全塞进首屏
//   ★ group       左栏分组（tags 只展示，不能筛不能分）
//   ★ layout      版式：instant / inspector / workbench（外壳据此选主体排布）
//   ★ capabilities { net, writes, files } —— 外壳据此渲染风险徽标，并作为白名单：
//                   writes 未授权 = 拿不到落盘确认通道的入口（默认全部 false）
//   ★ keywords    自然语言触达用的别名（条目 9 的 tool.open 靠它匹配）
//   ★ stateVersion 存档版本与迁移（键名 todolist.tool.<id>.v<version>）
//   ★ beta/hidden 半成品不污染主清单
//
// 硬原则：registry **只描述"是什么"，绝不描述"怎么渲染"**。一旦出现
// `render: () => …` 之类的字段，外壳就开始认识具体工具，这套解耦就白做了。
//
// 范围收紧（2026-10-07）：已按需求移除 T1 纯计算（单位换算 / 进制转换 / 日期差 /
// 校验码）、T2 本地文件（文本统计 / 文本对比 / 事件日志）、T4 联网自检，
// 以及「文本与编码」分组。现仅保留 RTI 与待办域（周报 / 批量优先级 / 统计）。
// 由此 capabilities 里已无 net / files 消费者，但字段与校验保持不变 ——
// 三态是外壳契约的一部分，将来重新加回同类工具时无需改骨架。
export const TOOLS = [
  {
    id: 'rti',
    name: 'RTI 耐热指数',
    desc: '由老化试验数据推算 t₅₀ / RTI / 活化能',
    detail:
      '按 IEC 60216-1 终点时间法求各温度的 t₅₀，再做 Arrhenius 回归外推 RTI 与 95% 置信区间。数据与配置只存在本机浏览器里，不写 todo.txt。',
    tags: ['IEC 60216', 'Arrhenius', '回归'],
    icon: 'thermometer',
    load: () => import('./RtiTool.jsx'),
    group: 'engineering',
    layout: 'inspector',
    capabilities: { net: false, writes: false, files: false },
    keywords: ['耐热指数', '耐热', 'rti', '活化能', '寿命推算', 'arrhenius', '老化'],
    stateVersion: 1,
  },

  /* --- T3 待办域：读只读投影；要写的一律走 propose 确认通道 --- */
  {
    id: 'weekly',
    name: '周报导出',
    desc: '把本周完成 / 下周待办汇总成可粘贴的 Markdown',
    detail:
      '按周（周一起算）汇总 done.txt 与 todo.txt：本周完成、下周待办、分类与项目分布、每日完成数，生成一份可直接粘贴的 Markdown 周报。只读，不写任何文件。',
    tags: ['周报', 'Markdown', '只读'],
    icon: 'upload',
    load: () => import('./WeeklyTool.jsx'),
    group: 'todo',
    layout: 'workbench',
    capabilities: { net: false, writes: false, files: false },
    keywords: ['周报', '周报导出', '本周', '上周', '导出', 'markdown', '汇报', 'weekly'],
    stateVersion: 1,
  },
  {
    id: 'bulkprio',
    name: '批量优先级',
    desc: '先筛后选，一次给一批任务改优先级 / 日期 / 标签',
    detail:
      '按关键字、@分类、+项目、优先级、是否逾期筛选任务并批量勾选，然后生成一份批量提议 —— 确认之后才由外壳统一落盘。本工具自己不改 todo.txt。',
    tags: ['批量', '优先级', '筛选'],
    icon: 'flag',
    load: () => import('./BulkPrioTool.jsx'),
    group: 'todo',
    layout: 'inspector',
    // 唯一被授权写 todo.txt 的工具。授权靠这一行，不是靠组件里的判断。
    capabilities: { net: false, writes: true, files: false },
    keywords: ['批量', '批量优先级', '批量改', '优先级', '筛选', '批处理', 'bulk', 'priority'],
    stateVersion: 1,
  },
  {
    id: 'stats',
    name: '统计',
    desc: '优先级 / 分类 / 项目 / 截止日分布与 14 天趋势',
    detail:
      '把当前任务折算成优先级、截止日、分类与项目分布，以及最近 14 天完成趋势。纯 CSS 条形图，颜色走 --ramp-* 顺序色阶，只读，不写任何文件。',
    tags: ['统计', '分布', '趋势'],
    icon: 'chart',
    load: () => import('./StatsTool.jsx'),
    group: 'todo',
    layout: 'workbench',
    capabilities: { net: false, writes: false, files: false },
    keywords: ['统计', '分布', '趋势', '直方图', '优先级分布', '完成趋势', 'chart', 'stats'],
    stateVersion: 1,
  },
];

/* ---------------------------------------------------------------------------
   分组：左栏的折叠单位
   ---------------------------------------------------------------------------
   刻意只有一层。工具多了用「搜索 + 分组折叠」解决，**不做三级导航** ——
   层级只会让人迷路（实施说明条目 14 的硬约束）。
--------------------------------------------------------------------------- */
export const GROUPS = [
  { id: 'engineering', label: '工程计算' },
  { id: 'todo', label: '待办数据' },
];

export const GROUP_LABELS = Object.fromEntries(GROUPS.map((g) => [g.id, g.label]));

export function findTool(id) {
  return TOOLS.find((t) => t.id === id) || null;
}

/** 主清单：hidden 的不出现（beta 仍出现，但会带 beta 徽标）。 */
export function visibleTools() {
  return TOOLS.filter((t) => !t.hidden);
}

/**
 * 风险徽标：由 capabilities 驱动，把"危险度"做成界面上看得见的事实。
 *
 * 这让"数据主权优先于查询能力"从一句口号变成用户每打开一个工具都能确认的事实 ——
 * 也是这套工具集区别于"AI 工具箱"的地方。
 * @returns {Array<{label:string, tone:'quiet'|'warn'|'danger'}>}
 */
export function riskBadges(tool) {
  const c = (tool && tool.capabilities) || {};
  const out = [];
  if (c.net) out.push({ label: '会联网', tone: 'danger' });
  if (c.writes) out.push({ label: '会写入 todo.txt', tone: 'warn' });
  else out.push({ label: '只读', tone: 'quiet' });
  if (c.files) out.push({ label: '可读本地文件', tone: 'warn' });
  if (!c.net) out.push({ label: '不联网', tone: 'quiet' });
  return out;
}

/** 该工具是否获得写 todo.txt 的授权（默认 false → 白名单逐个开）。 */
export function canWrite(tool) {
  return Boolean(tool && tool.capabilities && tool.capabilities.writes);
}
