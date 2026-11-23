// 侧栏分组名：分类（@）/ 标签（+）的显示名。
//
// 这是外观偏好，不是数据：改的是侧栏标题，不动 todo.txt 里的 @ / + 写法，
// 也不进备份。与主题、密度、列表配色同一套本机配置（configStore，一个键）。
import { useCallback, useEffect, useState } from 'react';
import { createConfigStore } from './configStore.js';

export const GROUP_KINDS = ['contexts', 'projects'];
export const GROUP_DEFAULT_LABELS = Object.freeze({ contexts: '分类', projects: '标签' });

/** 侧栏宽 176px：组名超过 8 个字符会把计数挤出去，输入与存储都按这个上限收。 */
export const GROUP_LABEL_MAX = 8;

/**
 * 归一一个组名：去首尾空白、把连续空白压成一个空格、空值回默认。
 * 超长按码点截断（不用 slice，避免把 emoji 的代理对切一半）。
 */
export function cleanGroupLabel(value, fallback) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!text) return fallback;
  return Array.from(text).slice(0, GROUP_LABEL_MAX).join('');
}

/** 把落盘的半截对象补成两枚完整组名。 */
export function normalizeGroupLabels(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    contexts: cleanGroupLabel(src.contexts, GROUP_DEFAULT_LABELS.contexts),
    projects: cleanGroupLabel(src.projects, GROUP_DEFAULT_LABELS.projects),
  };
}

const labelsPrefs = createConfigStore({
  key: 'worktodolist.sidebar-groups',
  defaults: GROUP_DEFAULT_LABELS,
  normalize: normalizeGroupLabels,
});

const listeners = new Set();

function notify(next) {
  for (const fn of [...listeners]) {
    try {
      fn(next);
    } catch {
      // 单个订阅者出错不影响其它订阅者
    }
  }
}

/** 当前两枚组名（没配过 = 默认 分类 / 标签）。 */
export function loadGroupLabels() {
  return labelsPrefs.loadOr();
}

/** 改一枚组名，另一枚保持不变；返回归一后的完整对象。 */
export function setGroupLabel(kind, value) {
  if (!GROUP_KINDS.includes(kind)) return loadGroupLabels();
  const next = normalizeGroupLabels({ ...loadGroupLabels(), [kind]: value });
  labelsPrefs.save(next);
  notify(next);
  return next;
}

/** 组名变化。返回取消订阅函数。 */
export function subscribeGroupLabels(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 侧栏 / 设置页共用：当前组名 + 改一枚。 */
export function useGroupLabels() {
  const [labels, setLocal] = useState(loadGroupLabels);
  useEffect(() => subscribeGroupLabels(() => setLocal(loadGroupLabels())), []);
  const rename = useCallback((kind, value) => setGroupLabel(kind, value), []);
  return { labels, rename };
}
