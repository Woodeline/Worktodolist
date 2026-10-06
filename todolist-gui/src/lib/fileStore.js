// File System Access API 封装：目录句柄持久化（IndexedDB）、读写、每日备份

const DB_NAME = 'todolist-gui';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const DIR_KEY = 'workspace';

export function isFsaSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
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
  await withStore('readwrite', (store) => store.put(handle, DIR_KEY));
}

export async function loadDirHandle() {
  try {
    return await withStore('readonly', (store) => store.get(DIR_KEY));
  } catch {
    return null;
  }
}

export async function clearDirHandle() {
  try {
    await withStore('readwrite', (store) => store.delete(DIR_KEY));
  } catch {
    // 忽略清理失败
  }
}

export async function verifyPermission(handle, request = false) {
  if (!handle) return false;
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (request && (await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

export async function readFileText(dirHandle, name) {
  try {
    const fileHandle = await dirHandle.getFileHandle(name);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch (err) {
    if (err && (err.name === 'NotFoundError' || err.code === 8)) return '';
    throw err;
  }
}

// 写入语义（口径修正 2026-10-06）：没有自实现 tmp+rename——File System Access API
// 对用户选中的目录没有 rename 原语（FileSystemFileHandle.move() 实际只在 OPFS 可用，
// 自行 removeEntry+重建反而制造「文件短暂不存在」的窗口）。实际依赖的是 Chromium
// createWritable() 的内部实现：写入先落在交换文件，close() 时原子提交覆盖——
// 写到一半崩溃/断电时原文件保持完整，效果等同 tmp+rename。此行为属实现细节，
// 若未来换非 Chromium 内核需重新核实。
export async function writeFileText(dirHandle, name, text) {
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

// 每日备份：当天首次调用时复制 todo.txt → backup/todo-YYYY-MM-DD.txt，保留最近 30 份
export async function ensureDailyBackup(dirHandle, today) {
  const backupDir = await dirHandle.getDirectoryHandle('backup', { create: true });
  const targetName = `todo-${today}.txt`;
  if (await fileExists(backupDir, targetName)) return false;
  const source = await readFileText(dirHandle, 'todo.txt');
  await writeFileText(backupDir, targetName, source);
  await pruneBackups(backupDir, 30);
  return true;
}

async function pruneBackups(backupDir, keep) {
  const names = [];
  for await (const [name, handle] of backupDir.entries()) {
    if (handle.kind === 'file' && /^todo-\d{4}-\d{2}-\d{2}\.txt$/.test(name)) {
      names.push(name);
    }
  }
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
