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
  workspaceUsage,
  writeFileText,
} from '../lib/fileStore';

// 防抖窗口期内的改动只存在于内存，「点完就关」会丢——所以这个值越 小 越安全。
// 200ms 配合下方 visibilitychange/pagehide 的转后台即时刷盘（P0-1），
// 把丢失窗口从半秒压到接近零；再小会让连续编辑退化成逐键写盘。
const SAVE_DEBOUNCE_MS = 200;
// 写盘失败后的有界重试次数（R-01）。不重试会让一次瞬时失败累积成永久 unsaved；
// 无限重试则会在磁盘真的只读时把主线程刷满 toast。
//
// 当前语义（A：失败**不回滚**内存）下它**真生效**：失败后 `dirty` 持续为真，
// 所以每一次重试都会真的去写盘 —— 实测 1 次首发 + 3 次重试 = 4 次真实尝试，
// 约 920ms 后停止，不会形成写入风暴。
// ⚠ 若将来有人把 catch 改回「回滚内存」（B 语义，2026-11-21 曾短暂采用），
// 这条机制会退化成**空转**：回滚后内存==磁盘 → `dirty === false` → 每次重试都在
// 内容比对上短路，产生 0 次 I/O，看起来还在重试、其实什么都没做。
// 也就是说：它不是「常开坏盘」的保险，别指望它兜住；兜住的是「内存 != 磁盘」本身。
const MAX_SAVE_RETRIES = 3;
const FADE_MS = 180;
// 行内「闪光」时长：重复任务新生行的高亮交接 / 新建行的入场动画。
// 与 index.css 的 --dur-flash / --dur-3 是同一次动作的两半：定时器负责
// 「什么时候收回类名」，CSS 负责「这段时间里看得见什么」。
// 2026-11-16 十八改：700 → 1400。交接期间新生行会把读数行常驻展开露出新的 due，
// 1.4s 才够读完那行字；0.7s 只够看见「闪了一下」，用户读到的却是「没消失」。
const SPAWN_FLASH_MS = 1400;
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
  // 运行态占用读数（备份 / 会话 / 日志）。只读；浏览器分支没有这项，保持 null。
  const [dataUsage, setDataUsage] = useState(null);
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
  // 写盘代次（revision）：只有「内容真变」的提交才 +1（另一处是 loadFromDisk）。
  // saveNow 进入时捕获它、写成功后比对 —— 不一致就说明写盘期间又来了新改动，
  // 绝不能把它标成 'saved'（旧实现在这里无条件置 saved，状态灯说谎、还会让
  // 关窗时的兜底刷盘以为「没什么要写的」而整段跳过）。
  const revisionRef = useRef(0);
  // 串行闸门：上一次 saveNow 的「永不 reject」版本。同一时刻最多一次写盘在飞；
  // 后来的**排队**而不是被拒绝 —— 拒绝会把最后 200ms 的改动永久留在内存里。
  const saveChainRef = useRef(null);
  // 指向最新的 saveNow。scheduleSave ↔ saveNow 互相需要（定时器要调 saveNow，
  // saveNow 失败后要重排定时器），用 ref 断掉这个循环引用，避免把 saveNow
  // 拆成两个 useCallback（拆了会改函数标识，连带影响使用它的 useEffect 依赖）。
  const saveRunnerRef = useRef(null);
  // 连续写盘失败次数：有界重试，成功即归零（不归零会累积成永久 unsaved）。
  const saveFailCountRef = useRef(0);
  const diskStateRef = useRef({ todo: '', done: '' });
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

  // 重排唯一的防抖定时器。三处复用（commit / saveNow 失败重试 / revision 未对齐时的接力），
  // 所以抽出来 —— 手抄三份迟早有一份忘了先 clearTimeout。
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      // 经 ref 调用：saveNow 在下面才定义（它自己又要用 scheduleSave）。
      const runner = saveRunnerRef.current;
      if (runner) runner();
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const loadFromDisk = useCallback(
    async (handle, { notify = false } = {}) => {
      // 先等在途写盘落定（R-05a）：否则会读到「上一条 saveNow 即将覆盖的中间态」，
      // 随后那次写盘把旧内容盖回去，用户看到的是「重载了但没变」。
      if (saveChainRef.current) await saveChainRef.current;
      const todoText = normalizeText(await readFileText(handle, 'todo.txt'));
      const doneText = normalizeText(await readFileText(handle, 'done.txt'));
      setEntries(parseFile(todoText), parseFile(doneText));
      // 备注文件可能根本不存在（还没写过备注）—— readFileText 返回空串，解析出空 Map
      refreshNotes(await readFileText(handle, NOTES_FILE));
      diskStateRef.current = { todo: todoText, done: doneText };

      // R-05a：内存已换成磁盘的另一份真相，上一份数据留下的一切挂起状态都作废。
      // 不清的话：撤销栈会按不存在的下标插回任务（磁盘上已有的那一条变成两份），
      // 挂起的 fade 提交会在重载之后再写一次盘。
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      for (const timer of flashTimersRef.current.values()) clearTimeout(timer);
      flashTimersRef.current.clear();
      for (const timer of pendingCompleteRef.current.values()) clearTimeout(timer);
      pendingCompleteRef.current.clear();
      for (const timer of pendingDeleteRef.current.values()) clearTimeout(timer);
      pendingDeleteRef.current.clear();
      // 撤销栈必须清：留着旧记录再按 Ctrl+Z 会按不存在的下标插回任务，
      // 磁盘上已经有的那一条会变成两份（由 5.1 用例守着）。
      undoStackRef.current = [];
      saveFailCountRef.current = 0;
      setFadingIds([]);
      setSpawnedIds([]);
      setEnteringIds([]);
      // 代次再进一格：万一还有人在飞（理论上已被上面 await 住），它也不许点亮 saved。
      revisionRef.current += 1;

      // 刻意**不清**的三样：toastTimerRef（非数据态，清了会留一条永不到期的 toast）、
      // editingId / focusedId（硬清会吞掉用户正在打的字；editingTask 找不到会返 null，
      // 浮窗自己就关了）。
      setSyncStatus('saved');
      if (notify) showToast('已同步外部修改');
    },
    [refreshNotes, setEntries, setSyncStatus, showToast]
  );

  // 真正执行一次写盘。**必须已经站在串行闸门内**（由 saveNow 保证）。
  const runSave = useCallback(async () => {
    const handle = dirHandleRef.current;
    if (!handle) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const startRev = revisionRef.current;
    try {
      const todoText = serializeEntries(todoEntriesRef.current);
      const doneText = serializeEntries(doneEntriesRef.current);
      const prev = diskStateRef.current;
      const todoDirty = todoText !== prev.todo;
      const doneDirty = doneText !== prev.done;
      const dirty = todoDirty || doneDirty;

      // 写序：**先 done 后 todo**（R-01 的核心）。
      // 中断时最坏是「同一条任务在两份文件里重复」—— 重复可核对、可恢复，
      // 而且内存里还留着完整条目，重试会幂等地把 todo.txt 重写一遍；
      // 反过来（先 todo 后 done）中断的后果是「两头都没有」，不可恢复。
      if (doneDirty) await writeFileText(handle, 'done.txt', doneText);
      if (todoDirty) {
        try {
          await writeFileText(handle, 'todo.txt', todoText);
        } catch (err) {
          // 补偿写回（只做一次，best effort）：done.txt 已经写进新内容了，
          // todo.txt 却没写成功，必须把 done.txt 还原成这次写入前的样子，
          // 否则会出现「任务只在日志里、清单里没有」的半提交状态。
          // 代价：会覆盖这段时间里外部编辑器对 done.txt 的修改。可接受 ——
          // 它只发生在「磁盘确实写不进去」的异常路径上，优先保证不丢数据。
          if (doneDirty) {
            try {
              await writeFileText(handle, 'done.txt', prev.done);
            } catch {
              // 补偿也失败时什么都不做：内存里仍有完整条目，重试会再走一遍。
            }
          }
          throw err;
        }
      }

      // 磁盘真相无条件更新：把它放进下面的 revision 门控会让外部变更检测读到旧值，
      // 等于给「外部改了文件」这条检测逻辑开一个新洞。
      diskStateRef.current = { todo: todoText, done: doneText };
      saveFailCountRef.current = 0;

      if (revisionRef.current === startRev) {
        setSyncStatus('saved');
        // 只在真有 dirty 时点亮 lastSavedAt：它会驱动 useNativeShell 里
        // 「保存后 3 秒自动 git 提交」，没有改动也点亮 = 每次切窗都提交一次，
        // 界面上完全看不出来，是这一批里最隐蔽的回归。
        if (dirty) setLastSavedAt(new Date());
      } else {
        // 写盘期间又有新改动：保持 unsaved，并让排队的那一次接力。
        setSyncStatus('unsaved');
        scheduleSave();
      }
    } catch {
      // 失败态复用 'unsaved'（不新增第三态）：SettingsPage 只认它，
      // 任何别的值都会被静默读成「已保存」。
      setSyncStatus('unsaved');
      // 撤销栈**不在这里清**：清栈会退回旧行为（R-01 要修的另一半）；
      // 重复插入由 undo 各分支的幂等保护挡住（QA 复核 P1-①）。
      try {
        const diskTodo = normalizeText(await readFileText(handle, 'todo.txt'));
        const diskDone = normalizeText(await readFileText(handle, 'done.txt'));
        diskStateRef.current = { todo: diskTodo, done: diskDone };
      } catch {
        // 读不回来时保持原 diskState：下次写盘会按旧值全量重写，等价于重试。
      }
      // 文案与行为必须成套（A 语义：**不回滚**内存）：这批改动确实还在内存里，
      // 只是没写进磁盘 —— 所以如实说「仍在本机内存」，用户下次保存机会会自动补写。
      showToast('保存失败，改动仍在本机内存（未写入磁盘），请检查磁盘后重试');
      if (saveFailCountRef.current < MAX_SAVE_RETRIES) {
        saveFailCountRef.current += 1;
        scheduleSave();
      }
    }
  }, [scheduleSave, setEntries, setSyncStatus, showToast]);

  // 串行闸门（R-02）：`then(run, run)` 的双回调是关键 —— 前一次失败也要继续排。
  // 用布尔 flag 拒绝并发会把「最后一次改动」永久留在内存，比现状更糟。
  const saveNow = useCallback(() => {
    const run = () => runSave();
    const next = (saveChainRef.current || Promise.resolve()).then(run, run);
    // 链上只留「永不 reject」的版本：一次失败不该让后面所有排队者一起炸掉。
    saveChainRef.current = next.then(
      () => {},
      () => {}
    );
    return next;
  }, [runSave]);
  saveRunnerRef.current = saveNow;

  const commit = useCallback(
    (updater) => {
      const prev = {
        todo: todoEntriesRef.current,
        done: doneEntriesRef.current,
      };
      const next = updater(prev);
      // 同引用短路：updater 表示「什么都没变」时（reorder 落点相同、目标已被别的
      // 操作处理掉等）不脏、不排盘、不递增 —— 旧实现会白排一次写盘。
      if (next.todo === prev.todo && next.done === prev.done) return;
      revisionRef.current += 1;
      setEntries(next.todo, next.done);
      setSyncStatus('unsaved');
      scheduleSave();
    },
    [scheduleSave, setEntries, setSyncStatus]
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
        // ⚠ 承重结构：删掉下面这行 return 会让 `useTodoStore.test.js` 的 1.5
        // 与 QA 的「失败后撤销」复现用例立刻变红（同一任务被插两次并落盘）。
        // 2026-11-21 起「写盘失败不回滚内存」那道保险已被撤掉（裁决保留回滚），
        // 所以这里是**唯一**挡住重复条目的地方。
        //
        // 幂等保护（QA 复核 P1-①）：任务已经在列表里就什么都不做。
        // 缺这一条时，任何「内存里已经有 A、撤销记录里也有 A」的组合都会 splice
        // 出第二行 A —— 而 todo.txt 是纯文本，落盘后就是两条一模一样的 `(A) …`。
        // complete 分支一直有这层保护，delete 分支漏了（两条路径的写法不对称）。
        if (todo.some((e) => e.id === action.task.id)) return { todo, done };
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
        // 完成动作留下的撤销记录到这里已经不成立了：再按 Ctrl+Z 会按旧记录
        // 把「下一次」实例删掉，还谎报「已撤销」。取消完成不单独入栈，
        // 把同一任务的 complete 记录一并丢弃即可。
        undoStackRef.current = undoStackRef.current.filter(
          (a) => !(a.kind === 'complete' && a.taskId === task.id)
        );
        commit(({ todo, done }) => {
          if (todo.some((e) => e.id === task.id)) {
            return { todo: todo.map((e) => (e.id === task.id ? reviveTask(e) : e)), done };
          }
          // 已完成的任务住在 done.txt 里（编辑浮窗的子任务就是这么来的）：
          // 只 map todo 会什么也不发生，删除线永远收不回去。把它复活后搬回去。
          const revived = done.filter((e) => e.id === task.id).map(reviveTask);
          return {
            todo: [...todo, ...revived],
            done: done.filter((e) => e.id !== task.id),
          };
        });
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
      // 重复任务的完成有两件事同时发生：这一条进 done.txt，下一条在原地长出来。
      // 只说「已完成」会让人以为界面没反应（标题 / 优先级 / 位置全同，
      // 唯一变化的 due 还折在悬停才展开的读数行里）——所以把"下一次"直接说出来。
      // 明天是最高频的一档，用人话说；其余档位报完整日期，免得「下次 3 天后」要心算。
      const tomorrow = dayjs(today).add(1, 'day').format('YYYY-MM-DD');
      const nextWhen = next ? (next.dueDate === tomorrow ? '明天' : ` ${next.dueDate}`) : '';
      showToast(
        next ? `已完成：${task.title} · 已为你排到${nextWhen}` : `已完成：${task.title}`,
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
        const patchOne = (e) => {
          if (e.id !== id || e.kind !== 'task') return e;
          // 编辑老任务时顺手给它补一个 ID —— **渐进**补齐，不为埋 ID 去改写整个文件：
          // 一份几百行的 todo.txt 一次性全部变样，git 会记下一次谁也看不懂的大 diff。
          const nextPatch =
            e.stableId || patch.stableId !== undefined
              ? patch
              : { ...patch, stableId: newStableId(taken) };
          if (nextPatch.stableId) taken.add(nextPatch.stableId);
          return applyPatch(e, nextPatch);
        };
        // 已完成的子任务也在编辑浮窗里露面，改标题同样要落到 done.txt 那一行。
        return { todo: todo.map(patchOne), done: done.map(patchOne) };
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

  const refreshDataUsage = useCallback(async () => {
    const handle = dirHandleRef.current;
    if (!handle) return;
    try {
      setDataUsage(await workspaceUsage(handle));
    } catch {
      setDataUsage(null);
    }
  }, []);

  const bootWorkspace = useCallback(
    async (handle) => {
      await loadFromDisk(handle);
      setDirReady(true);
      try {
        const created = await ensureDailyBackup(handle, dayjs().format('YYYY-MM-DD'));
        if (created) showToast('已创建今日备份');
      } catch (err) {
        showToast(`每日备份失败：${err.message || err}`);
      }
      await refreshDataUsage();
    },
    [loadFromDisk, refreshDataUsage, showToast]
  );

  const maintain = useCallback(async () => {
    const handle = dirHandleRef.current;
    if (!handle) return;
    try {
      // fs_backup 同时修剪过期备份与会话月份；再读一次占用。
      const created = await ensureDailyBackup(handle, dayjs().format('YYYY-MM-DD'));
      await refreshDataUsage();
      showToast(created ? '已创建今日备份，并清理过期数据' : '已清理过期备份与会话');
    } catch (err) {
      showToast(`清理失败：${err.message || err}`);
    }
  }, [refreshDataUsage, showToast]);

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
    // **无条件**刷一次（R-02）：状态灯只是「上一次写盘的结果」，不能当
    // 「内存里有没有未落盘改动」的判据 —— 旧实现正是靠这个判据把关窗兜底挡在门外
    // （写盘在飞时状态被误标成 saved，于是这最后一次刷盘被整段跳过）。
    // 真正的内容比对在 runSave 里：不脏时它会短路成 no-op，写不了假写。
    const flush = () => {
      const runner = saveRunnerRef.current;
      if (runner) runner();
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
  }, [dirReady]);

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

  // 「用本地内容覆盖文件」—— 与 saveNow 同构（R-01）：先 done 后 todo、
  // todo 失败时补偿写回 done、失败时保持 unsaved 且**不关闭冲突面板**。
  // 旧实现在第一行就 setConflict(false)，写失败时用户以为「已经覆盖了」，
  // 而磁盘上还是对方的内容。
  const resolveConflictKeepLocal = useCallback(async () => {
    // 先让在途写盘落定，否则两边会互相覆盖。
    if (saveChainRef.current) await saveChainRef.current;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const handle = dirHandleRef.current;
    if (!handle) {
      // 没选目录时关闭面板即可（调用方不该在欢迎页走到这里，但也别抛）。
      setConflict(false);
      return;
    }
    const startRev = revisionRef.current;
    const prev = diskStateRef.current;
    try {
      const todoText = serializeEntries(todoEntriesRef.current);
      const doneText = serializeEntries(doneEntriesRef.current);
      await writeFileText(handle, 'done.txt', doneText);
      try {
        await writeFileText(handle, 'todo.txt', todoText);
      } catch (err) {
        // 补偿（只做一次，best effort）：把 done.txt 还原成写入前的内容。
        try {
          await writeFileText(handle, 'done.txt', prev.done);
        } catch {
          // 补偿也失败时保持内存里的完整条目，让用户重试。
        }
        throw err;
      }
      diskStateRef.current = { todo: todoText, done: doneText };
      saveFailCountRef.current = 0;
      setConflict(false);
      // 与 runSave 同一套 revision 门控（P2-1）：覆盖期间用户又改了东西的话，
      // 这次写进磁盘的是**旧快照**，不能宣称「已保存」。
      if (revisionRef.current === startRev) {
        setSyncStatus('saved');
        setLastSavedAt(new Date());
      } else {
        setSyncStatus('unsaved');
        // 排一次接力，把覆盖期间的新改动也写下去 —— 否则它会一直挂在 unsaved 上，
        // 直到用户再动一次或关窗。
        scheduleSave();
      }
      showToast('已用本地内容覆盖文件');
    } catch (err) {
      // 面板必须留着：用户得知道这次覆盖没成功，才能再试或改用磁盘版本。
      setSyncStatus('unsaved');
      showToast(`写入失败：${err.message || err}`);
    }
  }, [scheduleSave, setSyncStatus, showToast]);

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
    dataUsage,
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
    refreshDataUsage,
    maintain,
    resolveConflictKeepLocal,
    resolveConflictUseDisk,
    saveNow,
  };
}
