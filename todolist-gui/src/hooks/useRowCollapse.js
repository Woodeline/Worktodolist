// 列表里「哪些父项被收起」的共享状态。
//
// 抽成 hook 而不是放在 MainList 内部：键盘导航（↑↓）和顶栏「共 N 项」
// 必须与实际渲染出来的行读同一份，否则收起父项后 ↑↓ 会选中一个 DOM 里
// 根本不存在的行，选中态与光标一起丢。
//
// 键用 stableId（写进 todo.txt、永不变），不用每次解析现算的运行时 id。
import { useCallback, useState } from 'react';

export function useRowCollapse() {
  const [collapsed, setCollapsed] = useState(() => new Set());

  const toggleExpand = useCallback((key) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // 「一键展开 / 收起全部」只替换本屏这些父项的键，别把用户在别的视图里
  // 收好的行一起翻掉 —— 收起态是全局一份，动作却只针对眼前这一屏。
  const setAllCollapsed = useCallback((keys, value) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (value) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }, []);

  return { collapsed, toggleExpand, setAllCollapsed };
}
