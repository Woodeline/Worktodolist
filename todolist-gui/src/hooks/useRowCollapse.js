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

  return { collapsed, toggleExpand };
}
