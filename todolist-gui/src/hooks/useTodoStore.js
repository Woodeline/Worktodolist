import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import {
  applyPatch,
  completeTask,
  parseFile,
  reviveTask,
  serializeEntries,
  taskFromQuickInput,
} from '../lib/todoParser';
import {
  ensureDailyBackup,
  isFsaSupported,
  loadDirHandle,
  pickWorkspace,
  readFileText,
  saveDirHandle,
  verifyPermission,
  writeFileText,
} from '../lib/fileStore';

// 防抖窗口期内的改动只存在于内存，「点完就关」会丢——所以这个值越 小 越安全。
// 200ms 配合下方 visibilitychange/pagehide 的转后台即时刷盘（P0-1），
// 把丢失窗口从半秒压到接近零；再小会让连续编辑退化成逐键写盘。
const SAVE_DEBOUNCE_MS = 200;
const FADE_MS = 180;

function normalizeText(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

export function useTodoStore() {
  const supported = isFsaSupported();

  const [authNeeded, setAuthNeeded] = useState(false);
  const [dirReady, setDirReady] = useState(false);
  const [todoEntries, setTodoEntries] = useState([]);
  const [doneEntries, setDoneEntries] = useState([]);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [toast, setToast] = useState(null);
  const [view, setView] = useState('today');
  const [sortMode, setSortMode] = useState('manual');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [focusedId, setFocusedId] = useState(null);
  const [fadingIds, setFadingIds] = useState([]);
  const [dragId, setDragId] = useState(null);

  const dirHandleRef = useRef(null);
  const todoEntriesRef = useRef([]);
  const doneEntriesRef = useRef([]);
  const saveStatusRef = useRef('saved');
  const diskStateRef = useRef({ todo: '', done: '' });
  const snapshotRef = useRef(null);
  const saveTimerRef = useRef(null);
  const undoStackRef = useRef([]);
  const pendingCompleteRef = useRef(new Map());
  const quickAddRef = useRef(null);
  const searchRef = useRef(null);

  const setEntries = useCallback((todo, done) => {
    todoEntriesRef.current = todo;
    doneEntriesRef.current = done;
    setTodoEntries(todo);
    setDoneEntries(done);
  }, []);

  const setSyncStatus = useCallback((status) => {
    saveStatusRef.current = status;
    setSaveStatus(status);
  }, []);

  const showToast = useCallback((message, opts = {}) => {
    setToast({ key: Date.now(), message, ...opts });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  const loadFromDisk = useCallback(
    async (handle, { notify = false } = {}) => {
      const todoText = normalizeText(await readFileText(handle, 'todo.txt'));
      const doneText = normalizeText(await readFileText(handle, 'done.txt'));
      setEntries(parseFile(todoText), parseFile(doneText));
      diskStateRef.current = { todo: todoText, done: doneText };
      setSyncStatus('saved');
      if (notify) showToast('已同步外部修改');
    },
    [setEntries, setSyncStatus, showToast]
  );

  const saveNow = useCallback(async () => {
    const handle = dirHandleRef.current;
    if (!handle) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    try {
      const todoText = serializeEntries(todoEntriesRef.current);
      const doneText = serializeEntries(doneEntriesRef.current);
      const prev = diskStateRef.current;
      if (todoText !== prev.todo) await writeFileText(handle, 'todo.txt', todoText);
      if (doneText !== prev.done) await writeFileText(handle, 'done.txt', doneText);
      diskStateRef.current = { todo: todoText, done: doneText };
      setSyncStatus('saved');
      setLastSavedAt(new Date());
    } catch (err) {
      // 回滚 UI 到上次快照，并同步磁盘实际状态避免误报外部修改
      if (snapshotRef.current) {
        setEntries(snapshotRef.current.todo, snapshotRef.current.done);
      }
      setSyncStatus('saved');
      try {
        const diskTodo = normalizeText(await readFileText(handle, 'todo.txt'));
        const diskDone = normalizeText(await readFileText(handle, 'done.txt'));
        diskStateRef.current = { todo: diskTodo, done: diskDone };
      } catch {
        // 保持原 diskState
      }
      showToast(`保存失败，已回滚本地修改：${err.message || err}`);
    }
  }, [setEntries, setSyncStatus, showToast]);

  const commit = useCallback(
    (updater) => {
      if (saveStatusRef.current === 'saved') {
        snapshotRef.current = {
          todo: todoEntriesRef.current,
          done: doneEntriesRef.current,
        };
      }
      const next = updater({
        todo: todoEntriesRef.current,
        done: doneEntriesRef.current,
      });
      setEntries(next.todo, next.done);
      setSyncStatus('unsaved');
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveNow();
      }, SAVE_DEBOUNCE_MS);
    },
    [setEntries, setSyncStatus, saveNow]
  );

  const undo = useCallback(() => {
    const action = undoStackRef.current.pop();
    if (!action) return;
    if (action.kind === 'complete') {
      // 若该完成动作尚处于 fade 窗口内（数据尚未提交），直接取消定时器即可复原，
      // 否则会先把任务插回、随后又被挂起的提交删除，产生幽灵任务。
      const pendingTimer = pendingCompleteRef.current.get(action.taskId);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingCompleteRef.current.delete(action.taskId);
        setFadingIds((prev) => prev.filter((id) => id !== action.taskId));
        showToast('已撤销');
        return;
      }
      commit(({ todo, done }) => {
        // 幂等保护：任务已存在于列表（例如删除撤销后已恢复）时不重复插入，
        // 仅确保 done.txt 无残留条目。
        if (todo.some((e) => e.id === action.doneTask.id)) {
          return { todo, done: done.filter((e) => e.id !== action.doneTask.id) };
        }
        const nextTodo = [...todo];
        const insertAt = Math.min(action.todoIndex, nextTodo.length);
        nextTodo.splice(insertAt, 0, reviveTask(action.doneTask));
        const nextDone = done.filter((e) => e.id !== action.doneTask.id);
        return { todo: nextTodo, done: nextDone };
      });
    } else if (action.kind === 'delete') {
      commit(({ todo, done }) => {
        const nextTodo = [...todo];
        const insertAt = Math.min(action.todoIndex, nextTodo.length);
        nextTodo.splice(insertAt, 0, action.task);
        return { todo: nextTodo, done };
      });
    } else if (action.kind === 'add') {
      // 新增的逆操作：把该任务从 todo 中移除。
      // 边界：若任务已不在列表（已被完成 / 删除），说明该步已无法按原样撤销，直接提示并返回。
      if (!todoEntriesRef.current.some((e) => e.id === action.taskId)) {
        showToast('该操作已无法撤销');
        return;
      }
      commit(({ todo, done }) => ({
        todo: todo.filter((e) => e.id !== action.taskId),
        done,
      }));
    }
    showToast('已撤销');
  }, [commit, showToast]);

  const addTask = useCallback(
    (inputText) => {
      const today = dayjs().format('YYYY-MM-DD');
      const task = taskFromQuickInput(inputText, today);
      if (!task.title) {
        showToast('请输入任务标题');
        return null;
      }
      commit(({ todo, done }) => ({ todo: [...todo, task], done }));
      // 记录“新增”的逆操作（追加到末尾，todoIndex 便于将来复用）。
      undoStackRef.current.push({
        kind: 'add',
        taskId: task.id,
        todoIndex: todoEntriesRef.current.length,
      });
      return task;
    },
    [commit, showToast]
  );

  const toggleComplete = useCallback(
    (task) => {
      if (task.kind !== 'task') return;
      if (task.completed) {
        commit(({ todo, done }) => ({
          todo: todo.map((e) => (e.id === task.id ? reviveTask(e) : e)),
          done,
        }));
        showToast(`已取消完成：${task.title}`);
        return;
      }
      const today = dayjs().format('YYYY-MM-DD');
      const todoIndex = todoEntriesRef.current.findIndex((e) => e.id === task.id);
      if (todoIndex === -1) return;
      // 防重入：同一任务在 fade 窗口内被重复触发完成时，只保留一次提交。
      if (pendingCompleteRef.current.has(task.id)) return;
      const doneTask = completeTask(task, today);
      setFadingIds((prev) => [...prev, task.id]);
      const timer = setTimeout(() => {
        pendingCompleteRef.current.delete(task.id);
        setFadingIds((prev) => prev.filter((id) => id !== task.id));
        commit(({ todo, done }) => {
          // 若任务已被其它操作（如删除）移除，则放弃本次完成，避免产生重复/幽灵条目。
          if (!todo.some((e) => e.id === task.id)) return { todo, done };
          return { todo: todo.filter((e) => e.id !== task.id), done: [...done, doneTask] };
        });
      }, FADE_MS);
      pendingCompleteRef.current.set(task.id, timer);
      undoStackRef.current.push({ kind: 'complete', todoIndex, doneTask, taskId: task.id });
      showToast(`已完成：${task.title}`, { actionLabel: '撤销', onAction: undo });
    },
    [commit, showToast, undo]
  );

  const deleteTask = useCallback(
    (task) => {
      if (task.kind !== 'task') return;
      const todoIndex = todoEntriesRef.current.findIndex((e) => e.id === task.id);
      if (todoIndex === -1) return;
      // 若该任务正处于完成 fade 窗口内，取消挂起的提交并丢弃其撤销记录，
      // 避免“完成→删除→撤销删除→再撤销完成”时把同一任务插回两次。
      const pendingTimer = pendingCompleteRef.current.get(task.id);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingCompleteRef.current.delete(task.id);
        setFadingIds((prev) => prev.filter((id) => id !== task.id));
        undoStackRef.current = undoStackRef.current.filter(
          (a) => !(a.kind === 'complete' && a.taskId === task.id)
        );
      }
      commit(({ todo, done }) => ({
        todo: todo.filter((e) => e.id !== task.id),
        done,
      }));
      undoStackRef.current.push({ kind: 'delete', task, todoIndex });
      showToast(`已删除：${task.title}`, { actionLabel: '撤销', onAction: undo });
    },
    [commit, showToast, undo]
  );

  const updateTask = useCallback(
    (id, patch) => {
      if (patch.title !== undefined && !String(patch.title).trim()) {
        showToast('标题不能为空');
        return;
      }
      commit(({ todo, done }) => ({
        todo: todo.map((e) => (e.id === id && e.kind === 'task' ? applyPatch(e, patch) : e)),
        done,
      }));
    },
    [commit, showToast]
  );

  const reorder = useCallback(
    (fromId, targetId) => {
      commit(({ todo, done }) => {
        const from = todo.findIndex((e) => e.id === fromId);
        const to = todo.findIndex((e) => e.id === targetId);
        if (from === -1 || to === -1 || from === to) return { todo, done };
        const next = [...todo];
        const [moved] = next.splice(from, 1);
        let insertAt = next.findIndex((e) => e.id === targetId);
        if (insertAt === -1) insertAt = next.length;
        next.splice(insertAt, 0, moved);
        return { todo: next, done };
      });
    },
    [commit]
  );

  const bootWorkspace = useCallback(
    async (handle) => {
      await loadFromDisk(handle);
      setDirReady(true);
      try {
        const created = await ensureDailyBackup(handle, dayjs().format('YYYY-MM-DD'));
        if (created) showToast('已创建今日备份 backup/');
      } catch (err) {
        showToast(`每日备份失败：${err.message || err}`);
      }
    },
    [loadFromDisk, showToast]
  );

  const pickDirectory = useCallback(async () => {
    try {
      // 浏览器与 Tauri 走不同的选择器；取消时都抛 AbortError，因此下面的
      // 静默分支对两边都成立。
      const handle = await pickWorkspace();
      await saveDirHandle(handle);
      dirHandleRef.current = handle;
      setAuthNeeded(false);
      await bootWorkspace(handle);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      showToast(`打开目录失败：${err.message || err}`);
    }
  }, [bootWorkspace, showToast]);

  const reauthorize = useCallback(async () => {
    const handle = dirHandleRef.current;
    if (!handle) {
      await pickDirectory();
      return;
    }
    const granted = await verifyPermission(handle, true);
    if (granted) {
      setAuthNeeded(false);
      await bootWorkspace(handle);
    }
  }, [bootWorkspace, pickDirectory]);

  // 启动：恢复已保存的目录句柄
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    (async () => {
      try {
        const handle = await loadDirHandle();
        if (!handle || cancelled) return;
        dirHandleRef.current = handle;
        const granted = await verifyPermission(handle, false);
        if (cancelled) return;
        if (!granted) {
          setAuthNeeded(true);
          return;
        }
        await bootWorkspace(handle);
      } catch {
        // 句柄失效时回到欢迎页
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, bootWorkspace]);

  // P0-1：页面转后台（最小化 / 切走 / 关闭前的 hidden）或 pagehide 时，
  // 把未保存的改动立即刷盘，不等防抖定时器。
  // 用 visibilitychange 而不是 beforeunload：后者里做异步写不可靠（浏览器不保证
  // 等待），而 hidden 在关闭路径上先于 unload 触发，桌面与移动端行为都更稳；
  // pagehide 作为关闭路径的第二道兜底。
  // 注意：node 环境（单元测试）没有 document，必须跳过监听注册。
  useEffect(() => {
    if (!dirReady) return;
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const flush = () => {
      if (saveStatusRef.current === 'unsaved') saveNow();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [dirReady, saveNow]);

  // 窗口聚焦时检测外部修改
  useEffect(() => {
    const onFocus = async () => {
      const handle = dirHandleRef.current;
      if (!handle || !dirReady) return;
      try {
        const diskTodo = normalizeText(await readFileText(handle, 'todo.txt'));
        const diskDone = normalizeText(await readFileText(handle, 'done.txt'));
        const known = diskStateRef.current;
        if (diskTodo === known.todo && diskDone === known.done) return;
        if (saveStatusRef.current !== 'saved') {
          setConflict(true);
        } else {
          await loadFromDisk(handle, { notify: true });
        }
      } catch {
        // 读取失败暂不处理
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [dirReady, loadFromDisk]);

  const resolveConflictKeepLocal = useCallback(async () => {
    setConflict(false);
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    try {
      const handle = dirHandleRef.current;
      const todoText = serializeEntries(todoEntriesRef.current);
      const doneText = serializeEntries(doneEntriesRef.current);
      await writeFileText(handle, 'todo.txt', todoText);
      await writeFileText(handle, 'done.txt', doneText);
      diskStateRef.current = { todo: todoText, done: doneText };
      setSyncStatus('saved');
      setLastSavedAt(new Date());
      showToast('已用本地内容覆盖文件');
    } catch (err) {
      showToast(`写入失败：${err.message || err}`);
    }
  }, [setSyncStatus, showToast]);

  const resolveConflictUseDisk = useCallback(async () => {
    setConflict(false);
    await loadFromDisk(dirHandleRef.current, { notify: true });
  }, [loadFromDisk]);

  const manualReload = useCallback(async () => {
    if (saveStatusRef.current !== 'saved') {
      setConflict(true);
      return;
    }
    await loadFromDisk(dirHandleRef.current, { notify: true });
  }, [loadFromDisk]);

  const openEditor = useCallback((id) => setEditingId(id), []);
  const closeEditor = useCallback(() => setEditingId(null), []);
  const selectView = useCallback((v) => {
    setView(v);
    setFocusedId(null);
  }, []);

  const editingTask = useMemo(
    () => todoEntries.find((e) => e.id === editingId && e.kind === 'task') || null,
    [todoEntries, editingId]
  );

  return {
    supported,
    dirReady,
    authNeeded,
    todoEntries,
    doneEntries,
    saveStatus,
    lastSavedAt,
    conflict,
    toast,
    view,
    sortMode,
    search,
    editingTask,
    focusedId,
    fadingIds,
    dragId,
    quickAddRef,
    searchRef,
    // 追加：供聊天 Agent 写入会话事件日志所用的目录句柄引用（不改变任何既有字段）。
    dirHandleRef,
    addTask,
    toggleComplete,
    deleteTask,
    updateTask,
    reorder,
    undo,
    selectView,
    setSortMode,
    setSearch,
    setFocusedId,
    setDragId,
    openEditor,
    closeEditor,
    dismissToast,
    pickDirectory,
    reauthorize,
    manualReload,
    resolveConflictKeepLocal,
    resolveConflictUseDisk,
    saveNow,
  };
}
