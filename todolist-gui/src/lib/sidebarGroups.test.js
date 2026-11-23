// 侧栏分组名契约：默认 / 归一 / 落盘 / 订阅；只改显示名，不碰数据。
import { afterEach, describe, expect, it } from 'vitest';
import {
  GROUP_DEFAULT_LABELS,
  GROUP_LABEL_MAX,
  cleanGroupLabel,
  loadGroupLabels,
  normalizeGroupLabels,
  setGroupLabel,
  subscribeGroupLabels,
} from './sidebarGroups.js';

function mockStorage(initial = {}) {
  const mem = new Map(Object.entries(initial));
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
    removeItem: (k) => mem.delete(k),
  };
  return mem;
}

afterEach(() => {
  delete globalThis.localStorage;
});

describe('侧栏分组名：默认与归一', () => {
  it('没落盘时给 分类 / 标签', () => {
    expect(loadGroupLabels()).toEqual(GROUP_DEFAULT_LABELS);
  });

  it('去首尾空白、压缩连续空白、空值回默认', () => {
    expect(cleanGroupLabel('  团队  ', '标签')).toBe('团队');
    expect(cleanGroupLabel('团队   小组', '标签')).toBe('团队 小组');
    expect(cleanGroupLabel('   ', '标签')).toBe('标签');
    expect(cleanGroupLabel('', '分类')).toBe('分类');
    expect(cleanGroupLabel(null, '分类')).toBe('分类');
    expect(cleanGroupLabel(42, '分类')).toBe('分类');
  });

  it('超长按 8 个字符截断（emoji 不被切成半个）', () => {
    expect(cleanGroupLabel('一二三四五六七八九十', '分类')).toBe('一二三四五六七八');
    expect(Array.from(cleanGroupLabel('👥👥👥👥👥👥👥👥👥', '团队')).length).toBe(GROUP_LABEL_MAX);
  });

  it('半截配置补默认，不把另一枚丢掉', () => {
    expect(normalizeGroupLabels({ projects: '团队' })).toEqual({ contexts: '分类', projects: '团队' });
    expect(normalizeGroupLabels({ contexts: '领域' })).toEqual({ contexts: '领域', projects: '标签' });
    expect(normalizeGroupLabels(null)).toEqual(GROUP_DEFAULT_LABELS);
    expect(normalizeGroupLabels(['团队'])).toEqual(GROUP_DEFAULT_LABELS);
  });
});

describe('侧栏分组名：落盘与订阅', () => {
  it('改一枚组名落盘，另一枚保持默认', () => {
    const mem = mockStorage();
    const seen = [];
    const off = subscribeGroupLabels((v) => seen.push(v));
    try {
      setGroupLabel('projects', '团队');
      expect(loadGroupLabels()).toEqual({ contexts: '分类', projects: '团队' });
      expect(JSON.parse(mem.get('worktodolist.sidebar-groups'))).toEqual({ contexts: '分类', projects: '团队' });
      expect(seen).toEqual([{ contexts: '分类', projects: '团队' }]);
    } finally {
      off();
    }
  });

  it('落盘值同样走归一：空串回默认、超长截断', () => {
    mockStorage({ 'worktodolist.sidebar-groups': JSON.stringify({ contexts: '', projects: '一二三四五六七八九十' }) });
    expect(loadGroupLabels()).toEqual({ contexts: '分类', projects: '一二三四五六七八' });
  });

  it('脏 JSON / 非法 kind 不炸也不改另一枚', () => {
    mockStorage({ 'worktodolist.sidebar-groups': '{oops' });
    expect(loadGroupLabels()).toEqual(GROUP_DEFAULT_LABELS);
    setGroupLabel('projects', '团队');
    expect(setGroupLabel('nope', '领域')).toEqual({ contexts: '分类', projects: '团队' });
  });
});
