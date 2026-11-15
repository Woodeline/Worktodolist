import { describe, expect, it, vi } from 'vitest';
import { buildAppMenuItems, APP_MENU_GROUP_LABELS } from './appMenu.js';

function setup(overrides = {}) {
  const {
    showListMode = true, tab = 'list', view = 'today',
    sortMode = 'manual', listMode = 'list', alwaysOnTop = false,
  } = overrides;
  const store = {
    view,
    sortMode,
    quickAddRef: { current: null },
    searchRef: { current: null },
    undo: vi.fn(),
    manualReload: vi.fn(),
    pickDirectory: vi.fn(),
    selectView: vi.fn(),
    setSortMode: vi.fn(),
  };
  const on = {
    focusAfterSwitch: vi.fn(),
    changeTab: vi.fn(),
    pickListMode: vi.fn(),
    toggleTop: vi.fn(),
    openSettings: vi.fn(),
  };
  const themeItems = ['浅色', '深色', '跟随系统'].map((label) => ({
    type: 'item', label, checked: false, onClick: vi.fn(),
  }));
  const items = buildAppMenuItems({
    tab, listMode, alwaysOnTop,
    tabs: [['list', '列表'], ['tools', '工具']],
    themeItems, store, on, showListMode,
  });
  return { items, store, on, themeItems };
}

const groups = (items) => items.filter((it) => it.type === 'sub');
const leaves = (items) => groups(items).flatMap((g) => g.items);
const topItems = (items) => items.filter((it) => it.type === 'item');

describe('应用菜单两级结构', () => {
  it('一级只列分组，外加一个「设置…」直入口，不再有平铺的分组标题', () => {
    const { items } = setup();
    expect(groups(items).map((g) => g.label)).toEqual(APP_MENU_GROUP_LABELS);
    expect(topItems(items).map((it) => it.label)).toEqual(['设置…']);
    expect(items.some((it) => it.type === 'header')).toBe(false);
  });

  it('一次只看见 8 项以内；具体动作收在二级', () => {
    const { items } = setup();
    // 分隔符不算「条目」：一级是 7 个分组 + 1 个设置直入口。
    expect(items.filter((it) => it.type !== 'sep').length).toBeLessThanOrEqual(8);
    expect(leaves(items).length).toBeGreaterThanOrEqual(15);
  });

  it('原有动作一条不少，全部可逐级访问', () => {
    const { items } = setup();
    const labels = [
      ...leaves(items).map((it) => it.label),
      ...topItems(items).map((it) => it.label),
    ];
    for (const label of [
      '新建任务', '搜索', '撤销上一步',
      '列表', '工具',
      '今日', '即将到期', '全部', '日志',
      '列表（按行）', '日历（按日期）',
      '手动（文件行序）', '自动（优先级 / 日期）',
      '浅色', '深色', '跟随系统',
      '窗口置顶', '重新载入文件', '切换数据目录…',
      '设置…',
    ]) {
      expect(labels).toContain(label);
    }
  });

  it('每个二级项都是可执行的 item，都带 onClick', () => {
    const { items } = setup();
    for (const g of groups(items)) {
      expect(g.items.length).toBeGreaterThan(0);
      for (const it of g.items) {
        expect(it.type).toBe('item');
        expect(typeof it.onClick).toBe('function');
      }
    }
  });

  it('没接显示模式切换时（静态舞台）不生成「显示模式」分组', () => {
    const { items } = setup({ showListMode: false });
    expect(groups(items).map((g) => g.label)).not.toContain('显示模式');
    expect(topItems(items).map((it) => it.label)).toEqual(['设置…']);
  });

  it('checked 跟随当前页签 / 视图 / 排序 / 显示模式', () => {
    const { items } = setup({ tab: 'list', view: 'all', sortMode: 'auto', listMode: 'calendar' });
    const find = (label) => leaves(items).find((it) => it.label === label);
    expect(find('列表').checked).toBe(true);
    expect(find('工具').checked).toBe(false);
    expect(find('全部').checked).toBe(true);
    expect(find('自动（优先级 / 日期）').checked).toBe(true);
    expect(find('日历（按日期）').checked).toBe(true);
  });

  it('点二级项真的执行原动作', () => {
    const { items, store, on } = setup();
    const run = (label) => leaves(items).find((it) => it.label === label).onClick();

    run('新建任务');
    expect(on.focusAfterSwitch).toHaveBeenCalledWith(store.quickAddRef);
    run('全部');
    expect(on.changeTab).toHaveBeenCalledWith('list');
    expect(store.selectView).toHaveBeenCalledWith('all');
    run('自动（优先级 / 日期）');
    expect(store.setSortMode).toHaveBeenCalledWith('auto');
    run('日历（按日期）');
    expect(on.pickListMode).toHaveBeenCalledWith('calendar');
    run('重新载入文件');
    expect(store.manualReload).toHaveBeenCalled();
    run('撤销上一步');
    expect(store.undo).toHaveBeenCalled();
    run('窗口置顶');
    expect(on.toggleTop).toHaveBeenCalled();
    topItems(items)[0].onClick();
    expect(on.openSettings).toHaveBeenCalled();
  });

  it('窗口置顶态改变二级项的标签与 checked', () => {
    const { items } = setup({ alwaysOnTop: true });
    const win = groups(items).find((g) => g.label === '窗口与数据');
    expect(win.items[0].label).toBe('取消窗口置顶');
    expect(win.items[0].checked).toBe(true);
  });
});
