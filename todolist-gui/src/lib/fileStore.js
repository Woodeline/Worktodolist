// 数据目录与文件读写。两种实现，一套签名：
//   * 浏览器：File System Access API（目录句柄存 IndexedDB）
//   * Tauri 壳：Rust 命令（目录由壳持有并持久化，写入是原子的）
//
// 上层（useTodoStore / eventLog）只认这套签名，不需要知道自己在哪一边跑。
// 在 Tauri 侧"句柄"是一个带 native 标记的占位对象——它只是「已选目录」的凭据，
// 真正的路径与权限在 Rust 里。

import { invoke, isTauri } from './runtime.js';

const DB_NAME = 'todolist-gui';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const DIR_KEY = 'workspace';

/** Tauri 侧的句柄占位：拿到它 = 已经选好目录。 */
function nativeHandle(path) {
  return { native: true, path: path || '' };
}

export function isFsaSupported() {
  if (isTauri()) return true;
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/**
 * 选择数据目录。
 * 浏览器：弹 FSA 目录选择器，返回可用的目录句柄。
 * Tauri：弹原生目录对话框；用户取消时抛 AbortError —— 与浏览器取消选择时的
 * 异常形状一致，因此调用方的 catch 分支不需要分叉。
 */
export async function pickWorkspace() {
  if (isTauri()) {
    const path = await invoke('ws_pick');
    if (!path) {
      const err = new Error('用户取消了选择');
      err.name = 'AbortError';
      throw err;
    }
    return nativeHandle(path);
  }
  return window.showDirectoryPicker({ mode: 'readwrite' });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = fn(store);
    tx.oncomplete = () => {
      resolve(request ? request.result : undefined);
      db.close();
    };
    tx.onerror = () => {
      reject(tx.error);
      db.close();
    };
    tx.onabort = () => {
      reject(tx.error);
      db.close();
    };
  });
}

export async function saveDirHandle(handle) {
  // Tauri 侧目录在 ws_pick 时就已落到配置目录，这里无事可做
  if (isTauri()) return;
  await withStore('readwrite', (store) => store.put(handle, DIR_KEY));
}

export async function loadDirHandle() {
  if (isTauri()) {
    const path = await invoke('ws_restore').catch(() => null);
    return path ? nativeHandle(path) : null;
  }
  try {
    return await withStore('readonly', (store) => store.get(DIR_KEY));
  } catch {
    return null;
  }
}

export async function clearDirHandle() {
  if (isTauri()) return;
  try {
    await withStore('readwrite', (store) => store.delete(DIR_KEY));
  } catch {
    // 忽略清理失败
  }
}

export async function verifyPermission(handle, request = false) {
  if (isTauri()) {
    if (!handle) return false;
    // 壳内没有"权限过期"这回事：目录可用即可写。request 参数只为签名兼容保留。
    return invoke('ws_verify').catch(() => false);
  }
  if (!handle) return false;
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (request && (await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

export async function readFileText(dirHandle, name) {
  // Rust 侧：文件不存在返回空串，与下面浏览器分支的 NotFoundError 处理等价
  if (isTauri()) return invoke('fs_read', { name });
  try {
    const fileHandle = await dirHandle.getFileHandle(name);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch (err) {
    if (err && (err.name === 'NotFoundError' || err.code === 8)) return '';
    throw err;
  }
}

// 写入语义：
//   * Tauri 侧由 Rust 保证「临时文件 + rename 覆盖」的原子写（Windows 上 Rust 的
//     fs::rename 走 MOVEFILE_REPLACE_EXISTING，可直接覆盖已有文件），写到一半
//     崩溃/断电时原文件保持完整。
//   * 浏览器侧没有自实现 tmp+rename —— File System Access API 对用户选中的目录没有
//     rename 原语（FileSystemFileHandle.move() 实际只在 OPFS 可用，自行
//     removeEntry+重建反而制造「文件短暂不存在」的窗口）。实际依赖的是 Chromium
//     createWritable() 的内部实现：写入先落在交换文件，close() 时原子提交覆盖。
//     此行为属实现细节，换非 Chromium 内核需重新核实。
export async function writeFileText(dirHandle, name, text) {
  if (isTauri()) {
    await invoke('fs_write', { name, text });
    return;
  }
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function fileExists(dirHandle, name) {
  try {
    await dirHandle.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

// 每日备份：当天首次调用时复制 todo.txt → backup/todo-YYYY-MM-DD.txt、
// notes.md → backup/notes-YYYY-MM-DD.md（notes.md 不存在或为空则跳过），
// 两个家族各自保留最近 30 份。与 Rust 侧 fs_backup 语义一致。
export async function ensureDailyBackup(dirHandle, today) {
  if (isTauri()) return invoke('fs_backup', { today });
  const backupDir = await dirHandle.getDirectoryHandle('backup', { create: true });
  let created = false;
  // 两个家族独立判断「今天是否已有」：中午新建的 notes.md 不能因为早上已经
  // 备过 todo.txt 就错过当天的唯一备份窗口（反过来同理）。
  if (!(await fileExists(backupDir, `todo-${today}.txt`))) {
    const source = await readFileText(dirHandle, 'todo.txt');
    await writeFileText(backupDir, `todo-${today}.txt`, source);
    created = true;
  }
  if (!(await fileExists(backupDir, `notes-${today}.md`))) {
    // readFileText 对不存在的文件返回空串（NotFoundError 已在函数内消化）
    const notes = await readFileText(dirHandle, 'notes.md');
    if (notes) {
      await writeFileText(backupDir, `notes-${today}.md`, notes);
      created = true;
    }
  }
  await pruneBackups(backupDir, 30);
  return created;
}

// 备份名两个家族的判定，与 Rust 侧 backup_family 逐字对齐 ——
// 光比长度会把 `todo-abcdefgh-1.txt` 也算进来，那就不是"完全不变"了。
const BACKUP_FAMILIES = [/^todo-\d{4}-\d{2}-\d{2}\.txt$/, /^notes-\d{4}-\d{2}-\d{2}\.md$/];

async function pruneBackups(backupDir, keep) {
  const families = BACKUP_FAMILIES.map(() => []);
  for await (const [name, handle] of backupDir.entries()) {
    if (handle.kind !== 'file') continue;
    const fam = BACKUP_FAMILIES.findIndex((re) => re.test(name));
    if (fam >= 0) families[fam].push(name);
  }
  // 每个家族独立保留 keep 份：两份数据各 30，不是合起来 30
  for (const names of families) {
    names.sort();
    while (names.length > keep) {
      const oldest = names.shift();
      try {
        await backupDir.removeEntry(oldest);
      } catch {
        break;
      }
    }
  }
}
