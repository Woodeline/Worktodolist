import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RECURRENCE_CHOICES, describeRecurrence } from '../lib/recurrence';
import { computeTagMenuPlacement } from '../lib/placement.js';
import { PRIORITY_LABELS, sidebarStats } from '../lib/sortFilter';
import { priorityClass } from '../lib/priority';
import { buildNesting, childrenOf } from '../lib/subtasks.js';
import { nextInTrap, pickRestoreTarget, queryFocusable } from '../lib/focusTrap.js';
import DateField from './DateField.jsx';
import Icon from './Icon.jsx';

// 子任务区块。
//
// 放在编辑浮窗里而不是列表行上：加子任务是"停下来想一想"的动作，不是一个顺手的点击 ——
// 列表行上每多一个入口，误触的代价就多一分。这里同时能看见全部子任务，
// 加完就能核对，不必回到列表里找它们缩进在哪。
function SubtaskField({ store, task }) {
  const [text, setText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const cancelEditRef = useRef(false);
  const nesting = useMemo(
    () => buildNesting([...(store.todoEntries || []), ...(store.doneEntries || [])]),
    [store.todoEntries, store.doneEntries]
  );
  const kids = childrenOf(nesting, task.stableId);
  const doneCount = kids.filter((k) => k.completed).length;
  const pct = kids.length ? Math.round((doneCount / kids.length) * 100) : 0;

  const add = () => {
    const title = text.trim();
    if (!title) return;
    store.addSubtask(task.id, title);
    setText('');
  };

  const startEdit = (k) => {
    cancelEditRef.current = false;
    setEditingId(k.id);
    setEditText(k.title);
  };

  // 输入框只在失焦时提交一次：回车 / Esc 都主动 blur，避免两条路径各写一次文件。
  const commitEdit = () => {
    const id = editingId;
    const next = editText.trim();
    const original = kids.find((k) => k.id === id);
    const cancelled = cancelEditRef.current;
    cancelEditRef.current = false;
    setEditingId(null);
    setEditText('');
    if (cancelled || !id || !original || !next || next === original.title) return;
    store.updateTask(id, { title: next });
  };

  const onEditKeyDown = (e) => {
    // 回车是「改完这一条」，Esc 是「不改了」；两者都不能漏到浮窗的保存 / 关闭上。
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditRef.current = true;
      e.currentTarget.blur();
    }
  };

  return (
    <div className="field field-subtasks">
      <div className="subtask-head">
        <span className="field-subtasks-label">
          子任务{kids.length > 0 ? ` · ${doneCount}/${kids.length}` : ''}
        </span>
        {kids.length > 0 && (
          <div className="subtask-progress" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      {kids.length > 0 && (
        <ul className="subtask-list">
          {kids.map((k) => {
            // 完成走 store 的退场窗口；勾与删除线先「演」出来，不然点一下要等一帧才有反馈。
            const done = k.completed || (store.fadingIds || []).includes(k.id);
            return (
              <li key={k.id}>
                <button
                  type="button"
                  className={`checkbox${done ? ' checked' : ''}`}
                  // 别让 mousedown 抢先让标题输入框失焦：否则 onBlur 会先写一次
                  // 标题、再执行本按钮，删除/完成变成两次落盘且用户毫无感知。
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (editingId === k.id) commitEdit();
                    store.toggleComplete(k);
                  }}
                  aria-label={done ? '取消完成子任务' : '完成子任务'}
                />
                {editingId === k.id ? (
                  <input
                    className="subtask-title-input"
                    value={editText}
                    autoFocus
                    aria-label="编辑子任务"
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={onEditKeyDown}
                    onBlur={commitEdit}
                  />
                ) : (
                  <span
                    className={'subtask-title' + (done ? ' completed' : '')}
                    onClick={() => startEdit(k)}
                    title="点击编辑"
                  >
                    {k.title}
                  </span>
                )}
                <button
                  type="button"
                  className="subtask-del"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (editingId === k.id) commitEdit();
                    store.deleteTask(k);
                  }}
                  title="删除子任务"
                  aria-label={`删除子任务 ${k.title}`}
                >
                  <Icon name="x" size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="subtask-add">
        <input
          type="text"
          value={text}
          placeholder="添加子任务"
          aria-label="添加子任务"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // 回车在这里是"加一条"，不是"保存整个浮窗" —— 不拦住的话
            // 每加一个子任务都会顺手把浮窗关掉。
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              add();
            }
          }}
        />
        <button type="button" className="btn btn-sm" onClick={add} disabled={!text.trim()}>
          添加
        </button>
      </div>
    </div>
  );
}

const PRIORITY_ORDER = ['A', 'B', 'C'];

function toList(text, prefix) {
  return text
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith(prefix) ? s.slice(1) : s))
    .filter(Boolean);
}

// @分类 / +标签 字段：文本输入照旧可手打；右侧箭头展开**已保存**的候选清单，
// 点候选即勾选/取消。候选与手输写回同一个逗号分隔的字符串，只有一份真相。
//
// 清单用 createPortal 挂到 body：它原来绝对定位在 .drawer-body 里，向上翻时
// 顶部一行会被那个 overflow-y:auto 的滚动容器裁掉，还把上方两行字段整片盖住。
// 挂出去之后按实测空间决定上下方向、收缩高度并自身滚动，首行永远完整可见。
function TagField({ label, prefix, placeholder, value, onChange, options, emptyHint }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState(null);
  const boxRef = useRef(null);
  const menuRef = useRef(null);
  const selected = toList(value, prefix);

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => {
      // 清单挂在 body 上，不在 boxRef 内，必须单独放行：
      // 否则 mousedown 先把菜单收掉，随后的 click 就落空了。
      if (boxRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // 捕获阶段：候选清单的 Esc 只收清单，不把整个编辑浮窗一起关掉。
      e.stopPropagation();
      setOpen(false);
    };
    const onDismiss = () => setOpen(false);
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('resize', onDismiss);
    };
  }, [open]);

  const toggle = (name) => {
    const next = selected.includes(name)
      ? selected.filter((s) => s !== name)
      : [...selected, name];
    onChange(next.join(', '));
  };

  // 先量后放：下方不够才向上翻，两个方向都夹在视口内（纯函数见 lib/placement.js）。
  const openMenu = () => {
    const box = boxRef.current;
    if (!box) return;
    setPlacement(
      computeTagMenuPlacement(box.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      })
    );
    setOpen(true);
  };

  // 焦点落在清单里时，Tab 在清单内部循环，不让它穿到浮窗背后。
  // React Portal 的事件会沿组件树冒泡到 .edit-window，所以这里必须截断，
  // 否则浮窗自己的 Tab 陷阱会把焦点抢回表单里。
  const onMenuKeyDown = (e) => {
    if (e.key !== 'Tab') return;
    const items = menuRef.current ? queryFocusable(menuRef.current) : [];
    if (items.length === 0) return;
    e.stopPropagation();
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="field field-tags" ref={boxRef}>
      <span>{label}</span>
      <div className="tag-input">
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        <button
          type="button"
          className={'tag-toggle' + (open ? ' is-open' : '')}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="展开候选"
          onClick={() => (open ? setOpen(false) : openMenu())}
        >
          <Icon name="chevron-down" size={16} />
        </button>
      </div>
      {open && placement && typeof document !== 'undefined' && createPortal(
        <div
          className="tag-menu"
          ref={menuRef}
          role="listbox"
          onKeyDown={onMenuKeyDown}
          style={{
            top: placement.top,
            left: placement.left,
            width: placement.width,
            maxHeight: placement.maxHeight,
          }}
        >
          {options.length === 0 ? (
            <div className="tag-menu-empty">{emptyHint}</div>
          ) : (
            options.map(({ name, count }) => {
              const on = selected.includes(name);
              return (
                <button
                  type="button"
                  key={name}
                  role="option"
                  aria-selected={on}
                  className={'tag-option' + (on ? ' sel' : '')}
                  onClick={() => toggle(name)}
                >
                  <span className="tag-option-check">
                    {on ? <Icon name="check" size={16} /> : null}
                  </span>
                  <span className="tag-option-name">
                    {prefix}
                    {name}
                  </span>
                  {count != null && <span className="count">{count}</span>}
                </button>
              );
            })
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// 日期字段已抽成独立组件 ./DateField.jsx：编辑浮窗、提议弹窗、批量工具共用同一套
// 短日期读数 / 自绘弹层 / 清除 / 快捷预设，避免三处口径再次分叉。

/** 备注正文（备注存在 notes.md 里，不在 todo.txt 的行上）。store 缺这个能力时当没备注。 */
function noteOf(store, stableId) {
  if (!stableId || typeof store.getNote !== 'function') return '';
  return store.getNote(stableId) || '';
}

// 表单初始值：把一条任务摊平成表单字段。
//
// 它同时是「表单的初始状态」—— 不再走「先渲染空壳、再在 effect 里 setState」那条路。
// 那条路要求组件在 form 还是 null 时提前 return，而提前 return 会**跳过后面的 Hooks**，
// 于是在「没在编辑 → 正在编辑」这一次切换里 Hook 数量从 3 个变成 4 个，React 直接抛
// "Rendered more hooks than during the previous render."，整棵树被卸载（白屏 + 点哪都没反应）。
// v1.1.0 在 Windows 上「点编辑就卡死且看不到界面」就是这个。
function formFromTask(task, store) {
  return {
    title: task.title,
    priority: task.priority || '',
    dueDate: task.dueDate || '',
    remindAt: task.remindAt || '',
    recurrence: task.recurrence || '',
    note: noteOf(store, task.stableId),
    contexts: task.contexts.join(', '),
    projects: task.projects.join(', '),
    starred: Boolean(task.starValue),
  };
}

/**
 * 编辑浮窗（外壳）。
 *
 * 只回答一个问题：现在有没有正在编辑的任务。没有就整体不挂载 ——
 * 于是表单组件**只在真的要编辑时才 mount**，它的初始状态能用 useState 直接算出来，
 * 不需要「空壳渲染一次 + effect 里补状态」这种会改变 Hook 数量的写法。
 *
 * Hooks 的数量必须在组件的每一次渲染里恒定，这不是风格问题：少一个多一个，
 * React 就认为前后两次渲染不是同一个组件，直接抛错并卸载整棵树。
 */
export default function EditDrawer({ store }) {
  const task = store.editingTask;
  if (!task) return null;
  // key 让「从 A 直接切到 B」也重新初始化一次表单，否则会留着上一条的标题。
  return <EditForm key={task.id} task={task} store={store} />;
}

function EditForm({ task, store }) {
  const [form, setForm] = useState(() => formFromTask(task, store));
  const [editingNote, setEditingNote] = useState(false);
  const winRef = useRef(null);

  // 已保存的分类 / 标签候选：复用侧栏统计，取的就是 todo.txt 里的真实值。
  const { contexts: contextOptions, projects: projectOptions } = useMemo(
    () => sidebarStats(store.todoEntries || []),
    [store.todoEntries]
  );

  // 焦点契约（与 useHotkeys 的「编辑时禁用全局快捷键」配套）：
  // ① 关闭（卸载）时把焦点还给来源那一行；来源行正在退场（刚在浮窗里被删除）
  //    或已经不在文档里，就顺延到相邻的活行，再不行退回快速添加框 ——
  //    绝不撒手让焦点落到 body：那之后按 Tab 会从工具栏第一个按钮开始，
  //    用户看到的就是「焦点跑进了工具栏」；
  // ② Tab / Shift+Tab 在浮窗内循环，不穿透到背后的列表（陷阱逻辑见 lib/focusTrap.js）。
  // 注意：这必须是 useEffect 里的清理函数 —— 只在真的编辑时 mount 的组件，
  // 它的卸载时机就是「浮窗关闭」的唯一真相。
  // deps 只留 task.id：store 每次渲染都是新对象，但它身上的 quickAddRef 是
  // 稳定 ref，清理时读 .current 拿到的就是当前那个输入框。
  useEffect(
    () => () => {
      const origin = document.querySelector(`.task-row[data-task-id="${task.id}"]`);
      const allRows = Array.from(document.querySelectorAll('.task-row'));
      const quickAdd = store.quickAddRef && store.quickAddRef.current;
      const target = pickRestoreTarget(origin, allRows, quickAdd);
      if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
    },
    [task.id]
  );

  const priorities = [...PRIORITY_ORDER];
  if (task.priority && !priorities.includes(task.priority)) priorities.push(task.priority);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  // 手写的规则（rec:+5d、rec:mon,wed）可能不在预设里，补一个选项进去，
  // 否则下拉框会显示成空 —— 看起来像「没设重复」，实际设着。
  const recurrenceOptions = useMemo(() => {
    const cur = form.recurrence || '';
    if (!cur || RECURRENCE_CHOICES.some((c) => c.value === cur)) return RECURRENCE_CHOICES;
    return [...RECURRENCE_CHOICES, { value: cur, label: describeRecurrence(cur) || cur }];
  }, [form.recurrence]);

  const save = async () => {
    // 只提交表单里有的字段；未列出的（如 t: 阈值日期）由 applyPatch 原样保留，
    // 编辑一次不该把已有数据抹掉。
    store.updateTask(task.id, {
      title: form.title.trim(),
      priority: form.priority || null,
      dueDate: form.dueDate || null,
      remindAt: form.remindAt || null,
      recurrence: form.recurrence || null,
      contexts: toList(form.contexts, '@'),
      projects: toList(form.projects, '+'),
      starValue: form.starred ? '1' : null,
    });
    // 备注写在数据目录的 notes.md 里，不在 todo.txt 的行上 —— 它是异步写，
    // 但先关浮窗不等它：失败会自己弹 toast，而让人对着一个已经保存的任务等着没意义。
    if (form.note !== noteOf(store, task.stableId) && typeof store.saveNote === 'function') {
      store.saveNote(task.id, form.note);
    }
    store.closeEditor();
  };

  const remove = () => {
    store.deleteTask(task);
    store.closeEditor();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      store.closeEditor();
      return;
    }
    // Tab 焦点陷阱：到头循环，不让焦点穿过浮窗落到背后的列表上。
    if (e.key === 'Tab') {
      const target = nextInTrap(queryFocusable(winRef.current), document.activeElement, e.shiftKey);
      if (target) {
        e.preventDefault();
        target.focus();
      }
      return;
    }
    // 回车即确认保存；按钮上的回车留给按钮自身的语义（选中优先级等）。
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      save();
    }
  };

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) store.closeEditor();
  };

  return (
    <div className="modal" onMouseDown={handleBackdrop}>
      <div
        className="edit-window"
        role="dialog"
        aria-modal="true"
        aria-label="编辑任务"
        tabIndex={-1}
        ref={winRef}
        onKeyDown={handleKeyDown}
      >
        <div className="drawer-header">
          <input
            className="drawer-title-input"
            value={form.title}
            onChange={set('title')}
            placeholder="任务标题"
            aria-label="任务标题"
            autoFocus
          />
          {/* 标题栏那枚旗标按钮已于 2026-11-15 退场：旗标此后只表示优先级
              （列表标题左侧的中空旗），同一处再摆一枚「加旗标」开关会让两个概念
              撞在一起。star: 数据本身仍原样保留（form.starred 直接透传保存）。 */}
          <button className="icon-btn" onClick={store.closeEditor} aria-label="关闭">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="drawer-body">
          {/* 优先级与重复同一行，优先级占 2/3；两个日期在下一行并排。 */}
          <div className="field-row field-row-prio">
            <div className="field">
              <span>优先级</span>
              <div className="priority-picker">
                <button
                  type="button"
                  className={'prio-none' + (form.priority === '' ? ' sel' : '')}
                  onClick={() => setForm((f) => ({ ...f, priority: '' }))}
                >
                  无
                </button>
                {priorities.map((p) => (
                  <button
                    type="button"
                    key={p}
                    className={priorityClass(p) + (form.priority === p ? ' sel' : '')}
                    onClick={() => setForm((f) => ({ ...f, priority: p }))}
                  >
                    {PRIORITY_LABELS[p] || p}
                  </button>
                ))}
              </div>
            </div>

            <label className="field">
              <span>重复</span>
              <select value={form.recurrence} onChange={set('recurrence')}>
                {recurrenceOptions.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="field-row">
            <DateField
              label="截止日期"
              value={form.dueDate}
              onChange={(v) => setForm((f) => ({ ...f, dueDate: v }))}
            />
            <DateField
              label="提醒时刻"
              value={form.remindAt}
              onChange={(v) => setForm((f) => ({ ...f, remindAt: v }))}
              withTime
            />
          </div>

          <div className="field-row">
            <TagField
              label="@分类"
              prefix="@"
              placeholder="工作, 生活"
              value={form.contexts}
              onChange={(v) => setForm((f) => ({ ...f, contexts: v }))}
              options={contextOptions}
              emptyHint="暂无已保存的分类"
            />

            <TagField
              label="+标签"
              prefix="+"
              placeholder="回测, 量化"
              value={form.projects}
              onChange={(v) => setForm((f) => ({ ...f, projects: v }))}
              options={projectOptions}
              emptyHint="暂无已保存的标签"
            />
          </div>

          {/* 子任务与上方标签、下方备注各一道分隔：三组动作不是同一件事。 */}
          <div className="field-sep" role="separator" />

          <SubtaskField store={store} task={task} />

          {/* 子任务与备注之间一道分隔：两组动作不是同一件事。 */}
          <div className="field-sep" role="separator" />

          <div className="field field-note">
            <button
              type="button"
              className="note-edit-btn"
              onClick={() => setEditingNote((v) => !v)}
            >
              {editingNote ? <Icon name="check" size={12} /> : null}
              {editingNote ? '完成' : form.note ? '编辑备注' : '添加备注'}
            </button>
            {editingNote ? (
              <textarea
                className="note-input"
                rows={4}
                value={form.note}
                onChange={set('note')}
                autoFocus
              />
            ) : form.note ? (
              <div className="note-display">{form.note}</div>
            ) : null}
          </div>

          {task.extraTags.length > 0 && (
            <div className="extra-tags">
              {task.extraTags.map((t, i) => (
                <span key={`${t.key}-${i}`} className="chip chip-star">
                  {t.key}:{t.value}
                </span>
              ))}
            </div>
          )}

        </div>

        <div className="drawer-actions">
          <button className="btn btn-danger" onClick={remove}>
            删除
          </button>
          <span className="spacer" />
          <button className="btn" onClick={store.closeEditor}>
            取消
          </button>
          <button className="btn btn-primary" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
