// 应用菜单的两级结构：一级只列分组，具体动作全部收进二级。
//
// 旧菜单一次摊开 27 项（动作 + 6 个分组标题 + 分隔线），窄窗口要滚动才能找。
// 现在一级固定 7 个分组 + 一个「设置…」直入口；二级沿用 ContextMenu 已有的
// sub 机制渲染（悬停 / 点击 / → 展开，← 回上层，Esc 关闭），不另造一套菜单。
//
// 纯函数：不碰 React / DOM，只把外壳状态与回调摊成菜单数据，方便单测
// 「每个原有动作都还逐级可达」。
export const APP_MENU_GROUP_LABELS = [
  '任务', '页面', '列表视图', '显示模式', '排序', '外观', '窗口与数据',
];

// 与侧栏五个入口同口径（2026-11-15）：收集箱条目已取消，「已完成」更名「日志」。
export const LIST_VIEW_ITEMS = [
  ['today', '今日'],
  ['upcoming', '即将到期'],
  ['all', '全部'],
  ['done', '日志'],
];

/**
 * @param {object} p
 * @param {string} p.tab                 当前页签 'list' | 'tools'
 * @param {string} p.listMode            当前显示模式 'list' | 'calendar'
 * @param {boolean} p.alwaysOnTop       窗口置顶态
 * @param {Array<[string,string]>} p.tabs 页签 [id, label]，顺序即 Ctrl+1/2
 * @param {Array} p.themeItems          主题三档（与主题按钮右键共用）
 * @param {object} p.store              useTodoStore 的只读子集 + 动作
 * @param {object} p.on                 外壳回调
 * @param {boolean} p.showListMode      是否接了显示模式切换（静态舞台没有）
 */
export function buildAppMenuItems({
  tab,
  listMode,
  alwaysOnTop,
  tabs,
  themeItems,
  store,
  on,
  showListMode = true,
}) {
  const item = (label, onClick, extra = {}) => ({ type: 'item', label, onClick, ...extra });
  const sub = (label, items) => ({ type: 'sub', label, items });
  const safe = (fn) => () => { if (typeof fn === 'function') fn(); };

  const groups = [
    sub('任务', [
      item('新建任务', () => on.focusAfterSwitch && on.focusAfterSwitch(store.quickAddRef), { accel: 'N' }),
      // 搜索框平时不挂载（页眉只留一枚放大镜），所以这里走「打开搜索」而不是聚焦：
      // 先切回列表页，再让页眉长出输入框并聚焦。
      item('搜索', () => {
        if (on.changeTab) on.changeTab('list');
        if (on.openSearch) on.openSearch();
      }, { accel: '/' }),
      item('撤销上一步', safe(store.undo), { accel: 'Ctrl+Z' }),
    ]),
    sub('页面', tabs.map(([id, label], i) =>
      item(label, safe(on.changeTab && (() => on.changeTab(id))), {
        accel: `Ctrl+${i + 1}`,
        checked: tab === id,
      })
    )),
    sub('列表视图', LIST_VIEW_ITEMS.map(([v, label]) =>
      item(label, () => {
        if (on.changeTab) on.changeTab('list');
        store.selectView(v);
      }, { checked: tab === 'list' && store.view === v })
    )),
    ...(showListMode
      ? [sub('显示模式', [
          item('列表（按行）', () => {
            if (on.changeTab) on.changeTab('list');
            on.pickListMode('list');
          }, { checked: tab === 'list' && listMode === 'list' }),
          item('日历（按日期）', () => {
            if (on.changeTab) on.changeTab('list');
            on.pickListMode('calendar');
          }, { checked: tab === 'list' && listMode === 'calendar' }),
        ])]
      : []),
    sub('排序', [
      item('手动（文件行序）', () => {
        if (on.changeTab) on.changeTab('list');
        store.setSortMode('manual');
      }, { checked: tab === 'list' && store.sortMode === 'manual' }),
      item('自动（优先级 / 日期）', () => {
        if (on.changeTab) on.changeTab('list');
        store.setSortMode('auto');
      }, { checked: tab === 'list' && store.sortMode === 'auto' }),
    ]),
    sub('外观', themeItems),
    sub('窗口与数据', [
      item(alwaysOnTop ? '取消窗口置顶' : '窗口置顶', safe(on.toggleTop), {
        checked: Boolean(alwaysOnTop),
      }),
      item('重新载入文件', safe(store.manualReload)),
      item('切换数据目录…', safe(store.pickDirectory)),
    ]),
  ];

  return [
    ...groups,
    { type: 'sep' },
    item('设置…', safe(on.openSettings), { accel: 'Ctrl+,' }),
  ];
}
