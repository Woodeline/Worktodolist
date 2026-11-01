// Windows 自绘窗控的 IPC 面。
//
// 命令名与参数形状来自 Tauri core 的 window 插件（plugin.rs 的 setter! 宏）：
// 无参命令直接用当前窗口，start_resize_dragging 收 `{ value: ResizeDirection }`。
// capabilities/default.json 里逐项开了 allow，缺一项会在调用时静默失败。
import { invoke } from './runtime.js';

const CMD = {
  minimize: 'plugin:window|minimize',
  toggleMaximize: 'plugin:window|toggle_maximize',
  close: 'plugin:window|close',
  isMaximized: 'plugin:window|is_maximized',
  startResizeDragging: 'plugin:window|start_resize_dragging',
};

export function minimizeWindow() {
  return invoke(CMD.minimize);
}

export function toggleMaximizeWindow() {
  return invoke(CMD.toggleMaximize);
}

export function closeWindow() {
  return invoke(CMD.close);
}

export function isWindowMaximized() {
  return invoke(CMD.isMaximized).then(Boolean);
}

export function startResizeDragging(direction) {
  return invoke(CMD.startResizeDragging, { value: direction });
}

// 去边框后系统只剩「上边缘」一处可拖拽缩放（tao 的 undecorated + shadow 行为），
// 其余三边与四角必须由前端画命中区，再转成系统级 resize drag。
export const RESIZE_HANDLES = Object.freeze([
  { key: 'n', direction: 'North' },
  { key: 's', direction: 'South' },
  { key: 'w', direction: 'West' },
  { key: 'e', direction: 'East' },
  { key: 'nw', direction: 'NorthWest' },
  { key: 'ne', direction: 'NorthEast' },
  { key: 'sw', direction: 'SouthWest' },
  { key: 'se', direction: 'SouthEast' },
]);
