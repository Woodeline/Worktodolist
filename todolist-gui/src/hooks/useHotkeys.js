import { useEffect } from 'react';

// 全局快捷键：n 新增 / 搜索 / 空格 完成 / e 编辑 / Esc 关闭 / Ctrl+Z 撤销
// enabled=false 时整体禁用（对话页签下由 ChatPanel 自行处理快捷键，避免冲突）。
export default function useHotkeys({ onNew, onSearch, onEscape, onToggle, onEdit, onUndo, enabled = true }) {
  useEffect(() => {
    if (!enabled) return undefined;
    const isTypingTarget = (el) =>
      el &&
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

    const handler = (e) => {
      if (e.key === 'Escape') {
        onEscape();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        onUndo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === 'n') {
        e.preventDefault();
        onNew();
      } else if (e.key === '/') {
        e.preventDefault();
        onSearch();
      } else if (e.key === ' ') {
        e.preventDefault();
        onToggle();
      } else if (e.key === 'e') {
        e.preventDefault();
        onEdit();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onNew, onSearch, onEscape, onToggle, onEdit, onUndo, enabled]);
}
