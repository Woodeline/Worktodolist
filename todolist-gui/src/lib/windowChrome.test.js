// 窗控 IPC 的命令名/参数形状是"写错也不会报错"的典型：
// capabilities 少一项、参数名从 value 写成 direction，按钮点了就是没反应。
// 这里把它们钉死，Windows 实测前先在单测里挡一层。
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./runtime.js', () => ({ invoke: vi.fn() }));

import { invoke } from './runtime.js';
import {
  RESIZE_HANDLES,
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  startResizeDragging,
  toggleMaximizeWindow,
} from './windowChrome.js';

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

describe('窗控命令', () => {
  it('最小化 / 最大化切换 / 关闭走三个 Tauri window 命令', async () => {
    await minimizeWindow();
    await toggleMaximizeWindow();
    await closeWindow();

    expect(invoke.mock.calls).toEqual([
      ['plugin:window|minimize'],
      ['plugin:window|toggle_maximize'],
      ['plugin:window|close'],
    ]);
  });

  it('最大化状态查询收成布尔值', async () => {
    invoke.mockResolvedValueOnce(true);
    await expect(isWindowMaximized()).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith('plugin:window|is_maximized');

    invoke.mockResolvedValueOnce(null);
    await expect(isWindowMaximized()).resolves.toBe(false);
  });

  it('缩放把方向包在 value 里（setter! 宏的参数名）', async () => {
    await startResizeDragging('SouthEast');
    expect(invoke).toHaveBeenCalledWith('plugin:window|start_resize_dragging', {
      value: 'SouthEast',
    });
  });
});

describe('RESIZE_HANDLES', () => {
  it('4 边 + 4 角，方向与键都不重复', () => {
    expect(RESIZE_HANDLES).toHaveLength(8);
    expect(new Set(RESIZE_HANDLES.map((h) => h.key)).size).toBe(8);
    expect(new Set(RESIZE_HANDLES.map((h) => h.direction)).size).toBe(8);
  });

  it('方向名与 tauri_runtime::ResizeDirection 的 PascalCase 一致', () => {
    expect(RESIZE_HANDLES.map((h) => h.direction).sort()).toEqual([
      'East',
      'North',
      'NorthEast',
      'NorthWest',
      'South',
      'SouthEast',
      'SouthWest',
      'West',
    ]);
  });
});
