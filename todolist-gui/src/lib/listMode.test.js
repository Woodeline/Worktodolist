// 列表显示模式的契约测试。
//
// 这一层的失效方式也是「不报错的错」：模式存成了第三个值，界面两边都判成
// 「不是 calendar」于是永远回列表；或者写了盘但读点没跟着变，切了模式界面不动。
// 所以锁三件事：值域只有两个、脏值回落、落盘后读点立刻跟着变。
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LIST_MODES,
  loadListMode,
  normalizeListMode,
  saveListMode,
} from './listMode.js';

const KEY = 'worktodolist.list-mode.v1';

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

describe('normalizeListMode', () => {
  it('只认 list / calendar，其余全回落 list', () => {
    expect(normalizeListMode('calendar')).toBe('calendar');
    expect(normalizeListMode('list')).toBe('list');
    for (const dirty of [undefined, null, '', 'CALENDAR', 'week', 0, {}, ['calendar']]) {
      expect(normalizeListMode(dirty)).toBe('list');
    }
  });

  it('LIST_MODES 与归一化后的值域严格一致', () => {
    expect(new Set(LIST_MODES.map(normalizeListMode))).toEqual(new Set(LIST_MODES));
    expect(new Set(LIST_MODES)).toEqual(new Set(['list', 'calendar']));
  });
});

describe('loadListMode / saveListMode', () => {
  beforeEach(() => {
    globalThis.localStorage = makeStorage();
  });

  it('没落过盘就是 list（默认不产生副作用）', () => {
    expect(loadListMode()).toBe('list');
  });

  it('落盘 calendar 后读得回来', () => {
    expect(saveListMode('calendar')).toBe(true);
    expect(loadListMode()).toBe('calendar');
  });

  it('手改 localStorage 写成脏值时静默回落 list，界面不会拿到第三种模式', () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify({ mode: 'kanban' }));
    expect(loadListMode()).toBe('list');
    globalThis.localStorage.setItem(KEY, '{ 不是 JSON');
    expect(loadListMode()).toBe('list');
  });

  it('save 走同一个归一化：传脏值不会把坏值写进本机', () => {
    saveListMode('kanban');
    expect(JSON.parse(globalThis.localStorage.getItem(KEY))).toEqual({ mode: 'list' });
    expect(loadListMode()).toBe('list');
  });

  it('本机配置不可用时读回落 list、写返回 false，不抛异常', () => {
    globalThis.localStorage = undefined;
    expect(loadListMode()).toBe('list');
    expect(saveListMode('calendar')).toBe(false);
  });
});
