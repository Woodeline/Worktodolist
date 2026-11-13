import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import {
  applyPatch,
  collectStableIds,
  completeTask,
  newStableId,
  newTaskId,
  parseFile,
  reviveTask,
  serializeEntries,
  taskFromQuickInput,
} from '../lib/todoParser';
import { nextOccurrence } from '../lib/recurrence';
import { NOTES_FILE, parseNotes, writeNote } from '../lib/notes';
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
// 行内「闪光」时长：重复任务新生行的高亮交接 / 新建行的入场动画。
// 与 index.css 的 --dur-flash / --dur-3 是同一次动作的两半：定时器负责
// 「什么时候收回类名」，CSS 负责「这段时间里看得见什么」。
const SPAWN_FLASH_MS = 700;
const ENTER_MS = 220;
// toast 自动消失：普通提示 3.4s（与工具页 toast 同一口径，TOAST_MS）；
// 带「撤销」的留到 6s —— 撤销是低频高价值动作，值得多给一倍的阅读时间。
// durationMs 可覆盖（将来若有需要常驻的提示）。
const TOAST_MS = 3400;
const TOAST_ACTION_MS = 6000;

function normalizeText(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

// 撤销「完成」时，重复规则顺手生成的下一次实例要一起撤掉 —— 它不属于用户做过的动作。
function dropSpawned(todo, action) {
  return action.spawnedId ? todo.filter((e) => e.id !== action.spawnedId) : todo;
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
  // 行级高亮：重复任务「下一次」的新生行（交接提示）、刚添加的任务（入场）。
  // 都是纯 UI 状态 —— 不进 todo.txt、不落盘，类名到期自动收回。
  const [spawnedIds, setSpawnedIds] = useState([]);
  const [enteringIds, setEnteringIds] = useState([]);
  // 拖拽落点：{ id, after } —— 松手前画在哪条行的前缘 / 后缘。
  const [dropInfo, setDropInfo] = useState(null);
  const [dragId, setDragId] = useState(null);
  // 有备注的任务 id 集合。列表只要知道「有没有」，所以存 Set 而不是整份 Map：
  // 正文按需从 notesRef 里取，不必为了渲染把别人的备注也放进 state。
  const [noteIds, setNoteIds] = useState(() => new Set());

  const dirHandleRef = useRef(null);
  const todoEntriesRef = useRef([]);
  const doneEntriesRef = useRef([]);
  const saveStatusRef = useRef('saved');
  const diskStateRef = useRef({ todo: '', done: '' });
  const snapshotRef = useRef(null);
  const saveTimerRef = useRef(null);
  const toastTimerRef = useRef(null);
  const undoStackRef = useRef([]);
  const pendingCompleteRef = useRef(new Map());
  const pendingDeleteRef = useRef(new Map());
  const flashTimersRef = useRef(new Map());
  const notesRef = useRef(new Map());
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
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast({ key: Date.now(), message, ...opts });
    // 自动消失：没有它，「已取消完成：xxx」会一直挂在右下角，
    // 直到下一条 toast 把它挤掉——用户只能手动去点那个小叉。
    const duration = opts.durationMs ?? (opts.actionLabel ? TOAST_ACTION_MS : TOAST_MS);
    if (duration > 0) {
      toastTimerRef.current = setTimeout(() => {
        toastTimerRef.current = null;
        setToast(null);
      }, duration);
    }
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast(null);
  }, []);

  // 行级高亮闪烁：给一个 id 挂上类名，ms 后收回。
  // 同一个 id 只保留一个定时器 —— 连续两次操作同一行时，后到的覆盖前一个，
  // 不会出现「第一个定时器先把类名收掉、第二个还在跑」的错位。
  const flashId = useCallback((setter, id, ms) => {
    setter((prev) => (prev.includes(id) ? prev : [...prev, id]));
    const old = flashTimersRef.current.get(id);
    if (old) clearTimeout(old);
    const timer = setTimeout(() => {
      flashTimersRef.current.delete(id);
      setter((prev) => prev.filter((x) => x !== id));
    }, ms);
    flashTimersRef.current.set(id, timer);
  }, []);

  // 备注：notes.md 全量解析进内存。它和 todo.txt 一样是一整份纯文本，
  // 量级小到没必要按需加载；但只有 id 集合进 state（见 noteIds 的注释）。
  const refreshNotes = useCallback((text) => {
    const map = parseNotes(text);
    notesRef.current = map;
    setNoteIds(new Set(map.keys()));
  }, []);

  const loadFromDisk = useCallback(
    async (handle, { notify = false } = {}) => {
      const todoText = normalizeText(await readFileText(handle, 'todo.txt'));
      const doneText = normalizeText(await readFileText(handle, 'done.txt'));
      setEntries(parseFile(todoText), parseFile(doneText));
      // 备注文件可能根本不存在（还没写过备注）—— readFileText 返回空串，解析出空 Map
      refreshNotes(await readFileText(handle, NOTES_FILE));
      diskStateRef.current = { todo: todoText, done: doneText };
      setSyncStatus('saved');
      if (notify) showToast('已同步外部修改');
    },
    [refreshNotes, setEntries, setSyncStatus, showToast]
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
          return { todo: dropSpawned(todo, action), done: done.filter((e) => e.id !== action.doneTask.id) };
        }
        const nextTodo = [...dropSpawned(todo, action)];
        const insertAt = Math.min(action.todoIndex, nextTodo.length);
        nextTodo.splice(insertAt, 0, reviveTask(action.doneTask));
        const nextDone = done.filter((e) => e.id !== action.doneTask.id);
        return { todo: nextTodo, done: nextDone };
      });
    } else if (action.kind === 'delete') {
      // 删除也可能还在 fade 窗口内（数据尚未提交）：取消定时器即复原，
      // 否则会先把任务插回、随后又被挂起的提交删掉，行凭空消失。
      const pendingTimer = pendingDeleteRef.current.get(action.task.id);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingDeleteRef.current.delete(action.task.id);
        setFadingIds((prev) => prev.filter((id) => id !== action.task.id));
        showToast('已撤销');
        return;
      }
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
      const draft = taskFromQuickInput(inputText, today);
      if (!draft.title) {
        showToast('请输入任务标题');
        return null;
      }
      // 稳定 ID 在**提交时**分配而不是在 taskFromQuickInput 里：
      // 它需要"当前所有已占用的 ID"这个全库视角，而那个函数是纯的、看不见仓库。
      // 拿不到唯一 ID 时宁可不写 —— 没 ID 将来还能补，写重了会指错人。
      let created = draft;
      commit(({ todo, done }) => {
        const sid = newStableId(collectStableIds([...todo, ...done]));
        created = sid ? applyPatch(draft, { stableId: sid }) : draft;
        return { todo: [...todo, created], done };
      });
      // 记录“新增”的逆操作（追加到末尾，todoIndex 便于将来复用）。
      undoStackRef.current.push({
        kind: 'add',
        taskId: created.id,
        todoIndex: todoEntriesRef.current.length,
      });
      // 入场闪光：新行高亮一下再收回 —— 「添加」这个动作要有回响，
      // 否则任务只是静默地出现在列表某一处，视线得自己去找。
      flashId(setEnteringIds, created.id, ENTER_MS);
      return created;
    },
    [commit, flashId, showToast]
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
      // 同理，正在删除退场窗口内的任务不接受完成 —— 两条退场动效会互相打架
      // （完成要插进 done、删除要移出 todo），撤销栈还会多出一条谁也想不起来的记录。
      if (pendingDeleteRef.current.has(task.id)) return;
      const doneTask = completeTask(task, today);
      // 重复规则：下一次的字段先算好（纯计算，所以能立刻预告给用户），
      // 但**生成放在下面的提交里** —— fade 窗口内撤销时它还没出生，不会留下幽灵任务。
      const next = nextOccurrence(task, today);
      // 撤销记录先入栈、生成后回填 spawnedId：撤销必须连带删掉下一次实例，
      // 否则「撤销完成」会留下一条凭空多出来的任务。
      const record = { kind: 'complete', todoIndex, doneTask, taskId: task.id, spawnedId: null };
      setFadingIds((prev) => [...prev, task.id]);
      const timer = setTimeout(() => {
        pendingCompleteRef.current.delete(task.id);
        setFadingIds((prev) => prev.filter((id) => id !== task.id));
        commit(({ todo, done }) => {
          // 若任务已被其它操作（如删除）移除，则放弃本次完成，避免产生重复/幽灵条目。
          if (!todo.some((e) => e.id === task.id)) return { todo, done };
          const nextTodo = todo.filter((e) => e.id !== task.id);
          if (next) {
            const taken = collectStableIds([...nextTodo, ...done]);
            // 下一次是**另一条任务**：换个新的运行时 ID（否则两行同 id，React key 与拖拽都会乱），
            // stableId 也重新分配（继承会让引用它的人指不准）。parentId 则在 next 里原样保留。
            const spawned = applyPatch(
              { ...task, ...next, id: newTaskId(`${task.id}|${next.dueDate}`) },
              { stableId: newStableId(taken) }
            );
            // 插回原位置而不是追加到末尾：重复任务应该在它原来待的地方重新长出来。
            nextTodo.splice(Math.min(todoIndex, nextTodo.length), 0, spawned);
            record.spawnedId = spawned.id;
            // 交接高亮：新行和刚完成的那一行动画上是同一条事的延续 ——
            // 没有这层高亮，用户看到的是「旧行消失 + 凭空多出一条新任务」。
            flashId(setSpawnedIds, spawned.id, SPAWN_FLASH_MS);
          }
          return { todo: nextTodo, done: [...done, doneTask] };
        });
      }, FADE_MS);
      pendingCompleteRef.current.set(task.id, timer);
      undoStackRef.current.push(record);
      showToast(
        next ? `已完成：${task.title} · 下次 ${next.dueDate}` : `已完成：${task.title}`,
        { actionLabel: '撤销', onAction: undo }
      );
    },
    [commit, flashId, showToast, undo]
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
      // 删除与完成共用同一条退场动效（淡出 + 高度折叠）：行先体面地退场，
      // 数据在 FADE_MS 后落。防重入：同一任务在删除窗口内被重复触发只算一次。
      if (pendingDeleteRef.current.has(task.id)) return;
      setFadingIds((prev) => (prev.includes(task.id) ? prev : [...prev, task.id]));
      const delTimer = setTimeout(() => {
        pendingDeleteRef.current.delete(task.id);
        setFadingIds((prev) => prev.filter((id) => id !== task.id));
        commit(({ todo, done }) => {
          // 任务可能已在窗口期内被别的操作处理过 —— 不在列表里就放弃本次提交。
          if (!todo.some((e) => e.id === task.id)) return { todo, done };
          return { todo: todo.filter((e) => e.id !== task.id), done };
        });
      }, FADE_MS);
      pendingDeleteRef.current.set(task.id, delTimer);
      undoStackRef.current.push({ kind: 'delete', task, todoIndex });
      // 删父**不带走**子任务：它们各自是独立的一行，父没了就降级为顶层任务。
      // 连带删除更符合提醒事项的手感，但在这里意味着替用户删掉他没点过的行 ——
      // 而纯文本清单的底线是"不让人意外地丢数据"。降级后它们仍然可见、可撤销感更差，
      // 所以把这件事说清楚，交给用户自己决定要不要再删。
      const kids = task.stableId
        ? todoEntriesRef.current.filter(
            (e) => e.kind === 'task' && e.parentId === task.stableId
          ).length
        : 0;
      showToast(
        kids > 0 ? `已删除：${task.title}（${kids} 个子任务已变为独立任务）` : `已删除：${task.title}`,
        { actionLabel: '撤销', onAction: undo }
      );
    },
    [commit, showToast, undo]
  );

  // 在一条任务下面加子任务。
  //
  // 父任务可能还没有 stableId（老任务从未被编辑过）—— **这时候当场给它补一个**。
  // 这就是"用到才补"的场合：为了一个可能永远不会来的子任务去提前改写整份文件不值得，
  // 但真到要用的时候，补一个 ID 是必须的（否则子任务挂不上去）。
  const addSubtask = useCallback(
    (parentTaskId, text) => {
      const today = dayjs().format('YYYY-MM-DD');
      const draft = taskFromQuickInput(text, today);
      if (!draft.title) {
        showToast('请输入子任务标题');
        return null;
      }
      let created = null;
      commit(({ todo, done }) => {
        const taken = collectStableIds([...todo, ...done]);
        const idx = todo.findIndex((e) => e.id === parentTaskId);
        if (idx === -1) return { todo, done };
        let parent = todo[idx];
        if (!parent.stableId) {
          const pid = newStableId(taken);
          if (!pid) return { todo, done };
          taken.add(pid);
          parent = applyPatch(parent, { stableId: pid });
        }
        created = applyPatch(draft, {
          stableId: newStableId(taken),
          parentId: parent.stableId,
        });
        const next = [...todo];
        next[idx] = parent;
        return { todo: [...next, created], done };
      });
      if (!created) {
        showToast('没能创建子任务');
        return null;
      }
      showToast(`已添加子任务：${created.title}`);
      return created;
    },
    [commit, showToast]
  );

  const updateTask = useCallback(
    (id, patch) => {
      if (patch.title !== undefined && !String(patch.title).trim()) {
        showToast('标题不能为空');
        return;
      }
      commit(({ todo, done }) => {
        const taken = collectStableIds([...todo, ...done]);
        return {
          todo: todo.map((e) => {
            if (e.id !== id || e.kind !== 'task') return e;
            // 编辑老任务时顺手给它补一个 ID —— **渐进**补齐，不为埋 ID 去改写整个文件：
            // 一份几百行的 todo.txt 一次性全部变样，git 会记下一次谁也看不懂的大 diff。
            const nextPatch =
              e.stableId || patch.stableId !== undefined
                ? patch
                : { ...patch, stableId: newStableId(taken) };
            if (nextPatch.stableId) taken.add(nextPatch.stableId);
            return applyPatch(e, nextPatch);
          }),
          done,
        };
      });
    },
    [commit, showToast]
  );

  /** 读某条任务的备注正文（没有则空串）。备注挂在 stableId 上，不是运行时 id。 */
  const getNote = useCallback(
    (stableId) => (stableId ? notesRef.current.get(stableId) || '' : ''),
    []
  );

  const saveNote = useCallback(
    async (taskId, body) => {
      const handle = dirHandleRef.current;
      if (!handle) return false;
      const found = todoEntriesRef.current.find((e) => e.id === taskId);
      if (!found) return false;
      let sid = found.stableId;
      // 没有 ID 的老任务：先补一个再挂备注 —— 备注靠 id 认人，没有 id 就挂不住。
      if (!sid) {
        commit(({ todo, done }) => {
          const taken = collectStableIds([...todo, ...done]);
          const pid = newStableId(taken);
          if (!pid) return { todo, done };
          sid = pid;
          return {
            todo: todo.map((e) => (e.id === taskId ? applyPatch(e, { stableId: pid }) : e)),
            done,
          };
        });
        if (!sid) {
          showToast('没能给这条任务分配 ID，备注没保存');
          return false;
        }
      }
      try {
        // 读·改·写：拿磁盘上的最新内容合并，而不是拿内存里的旧文本覆盖 ——
        // 用户可能正用别的编辑器改着 notes.md，整文件覆盖会吃掉他的改动。
        const latest = await readFileText(handle, NOTES_FILE);
        const next = writeNote(latest, sid, body);
        await writeFileText(handle, NOTES_FILE, next);
        refreshNotes(next);
        return true;
      } catch (err) {
        showToast(`备注保存失败：${err.message || err}`);
        return false;
      }
    },
    [commit, refreshNotes, showToast]
  );

  const reorder = useCallback(
    (fromId, targetId, { after = false } = {}) => {
      commit(({ todo, done }) => {
        const from = todo.findIndex((e) => e.id === fromId);
        const to = todo.findIndex((e) => e.id === targetId);
        if (from === -1 || to === -1 || from === to) return { todo, done };
        const next = [...todo];
        const [moved] = next.splice(from, 1);
        let insertAt = next.findIndex((e) => e.id === targetId);
        if (insertAt === -1) insertAt = next.length;
        // after = 落点画在目标行后缘：插到它后面；默认（前缘）行为不变。
        else if (after) insertAt += 1;
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
    spawnedIds,
    enteringIds,
    dropInfo,
    dragId,
    noteIds,
    quickAddRef,
    searchRef,
    // 追加：供聊天 Agent 写入会话事件日志所用的目录句柄引用（不改变任何既有字段）。
    dirHandleRef,
    addTask,
    addSubtask,
    toggleComplete,
    deleteTask,
    updateTask,
    reorder,
    undo,
    getNote,
    saveNote,
    selectView,
    setSortMode,
    setSearch,
    setFocusedId,
    setDragId,
    setDropInfo,
    openEditor,
    closeEditor,
    showToast,
    dismissToast,
    pickDirectory,
    reauthorize,
    manualReload,
    resolveConflictKeepLocal,
    resolveConflictUseDisk,
    saveNow,
  };
}
