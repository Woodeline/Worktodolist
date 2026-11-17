// Esc 的逐层退出顺序（2026-11-17）。
//
// 越靠近用户的浮层越先关：编辑浮窗 / 日期弹层 / 右键菜单 / 日历浮层 / 设置页 /
// 工具工作态各自在自己的那一层消费 Esc（多数还会 stopPropagation），到不了这里。
// 这里只排列表页最外层剩下的几层，退无可退才隐藏到托盘。
//
// 冲突弹窗是阻塞层：它把两份数据摆在一起等用户选，此时藏窗会让「文件被外部改了」
// 这件事从眼前消失，所以 Esc 在它上面不做事。
export function resolveEscape({ editing, conflict, searchOpen, search, focusedId }) {
  if (editing) return 'close-editor';
  if (conflict) return 'stay';
  if (searchOpen || search) return 'close-search';
  if (focusedId) return 'clear-selection';
  return 'hide-to-tray';
}
