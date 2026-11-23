// fileStore 的 **Tauri 分支** 回归测试（R-14）。
//
// 为什么必须单独一个文件：`vi.mock('./runtime.js')` 会被提升到文件顶部，
// 一旦和 `fileStore.test.js`（浏览器分支）放在同一个文件里，那 6 条
// ensureDailyBackup 用例会被一起拖进「isTauri() === true」的世界里 ——
// 它们全靠 isTauri() 返 false 才走得通。所以这里独立成文件。
//
// 这一组锁的是「IPC 契约的形状」：Rust 侧的参数名写错一个字母，
// 前端不会有任何编译期报错，只会在运行时静默失败 —— 只能靠这里钉死。
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./runtime.js', () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}));

import { invoke } from './runtime.js';
import {
  ensureDailyBackup,
  loadDirHandle,
  pickWorkspace,
  readFileText,
  readSessionText,
  saveDirHandle,
  verifyPermission,
  workspaceUsage,
  writeFileText,
  writeSessionText,
} from './fileStore.js';

const DAY = '2026-10-24';
const inv = () => vi.mocked(invoke);

beforeEach(() => {
  inv().mockReset();
});

describe('fileStore（Tauri 分支）', () => {
  it('T1 writeFileText 调 fs_write，参数名必须是 name / text', async () => {
    inv().mockResolvedValueOnce(undefined);
    await writeFileText({ native: true, path: '/data' }, 'todo.txt', '任务A\n');
    expect(inv()).toHaveBeenCalledTimes(1);
    expect(inv()).toHaveBeenCalledWith('fs_write', { name: 'todo.txt', text: '任务A\n' });
  });

  it('T2 writeFileText 的 IPC 失败必须上抛（不许吞成"写入成功"）', async () => {
    const boom = new Error('磁盘只读');
    inv().mockRejectedValueOnce(boom);
    await expect(writeFileText({ native: true, path: '/data' }, 'todo.txt', 'x')).rejects.toThrow(
      '磁盘只读'
    );
  });

  it('T3 readFileText 调 fs_read；Rust 侧"文件不存在"已返回空串，JS 侧不再二次兜底', async () => {
    inv().mockResolvedValueOnce('任务A\n');
    await expect(readFileText({ native: true, path: '/data' }, 'todo.txt')).resolves.toBe('任务A\n');
    expect(inv()).toHaveBeenCalledWith('fs_read', { name: 'todo.txt' });

    inv().mockResolvedValueOnce('');
    await expect(readFileText({ native: true, path: '/data' }, 'notes.md')).resolves.toBe('');
  });

  it('T4 readFileText 的读错误上抛（编码错 / 权限错都不能被读成空文件）', async () => {
    // 读成空串的后果是：下一次保存把整份清单抹掉。所以 Tauri 分支不吞任何错误。
    inv().mockRejectedValueOnce(new Error('不是有效的 UTF-8'));
    await expect(readFileText({ native: true, path: '/data' }, 'todo.txt')).rejects.toThrow(
      '不是有效的 UTF-8'
    );
  });

  it('T5 ensureDailyBackup 在壳内直接调 fs_backup，不碰 File System Access', async () => {
    // 不定义 globalThis.window：浏览器分支若被误走会立刻抛错，这条用例就是探针。
    inv().mockResolvedValueOnce(true);
    await expect(ensureDailyBackup({ native: true, path: '/data' }, DAY)).resolves.toBe(true);
    expect(inv()).toHaveBeenCalledWith('fs_backup', { today: DAY });
  });

  it('T6 pickWorkspace：用户取消 → AbortError；选中 → native 占位句柄', async () => {
    inv().mockResolvedValueOnce('');
    await expect(pickWorkspace()).rejects.toMatchObject({ name: 'AbortError' });

    inv().mockResolvedValueOnce('/data');
    await expect(pickWorkspace()).resolves.toEqual({ native: true, path: '/data' });
  });

  it('T7 目录句柄在壳内是壳的凭据：saveDirHandle 不落 IndexedDB，loadDirHandle 走 ws_restore', async () => {
    // Tauri 侧目录由 Rust 持久化；saveDirHandle 无事可做，绝不能去开 IndexedDB。
    await saveDirHandle({ native: true, path: '/data' });
    expect(inv()).not.toHaveBeenCalled();

    inv().mockResolvedValueOnce('/data');
    await expect(loadDirHandle()).resolves.toEqual({ native: true, path: '/data' });

    inv().mockResolvedValueOnce(false);
    await expect(verifyPermission({ native: true, path: '/data' })).resolves.toBe(false);
  });

  it('T8 会话日志走 .worktodolist 的专用命令：月份与正文参数名必须一致', async () => {
    inv().mockResolvedValueOnce('{"seq":1}\n');
    await expect(readSessionText({ native: true, path: '/data' }, '2026-11')).resolves.toBe('{"seq":1}\n');
    expect(inv()).toHaveBeenCalledWith('fs_read_session', { month: '2026-11' });

    inv().mockResolvedValueOnce(undefined);
    await writeSessionText({ native: true, path: '/data' }, '2026-11', '{"seq":2}\n');
    expect(inv()).toHaveBeenCalledWith('fs_write_session', { month: '2026-11', text: '{"seq":2}\n' });
  });

  it('T9 运行态占用读数走 fs_usage', async () => {
    const usage = { backup_files: 22, backup_bytes: 86016, session_files: 10, session_bytes: 45056, log_bytes: 0, total_bytes: 131072 };
    inv().mockResolvedValueOnce(usage);
    await expect(workspaceUsage({ native: true, path: '/data' })).resolves.toEqual(usage);
    expect(inv()).toHaveBeenCalledWith('fs_usage');
  });
});
