import { useEffect, useMemo, useRef, useState } from 'react';
import { RECURRENCE_CHOICES, describeRecurrence } from '../lib/recurrence';
import { PRIORITY_LABELS, sidebarStats } from '../lib/sortFilter';
import { serializeTask } from '../lib/todoParser';
import { buildNesting, childrenOf } from '../lib/subtasks.js';
import Icon from './Icon.jsx';

// 子任务区块。
//
// 放在编辑浮窗里而不是列表行上：加子任务是"停下来想一想"的动作，不是一个顺手的点击 ——
// 列表行上每多一个入口，误触的代价就多一分。这里同时能看见全部子任务，
// 加完就能核对，不必回到列表里找它们缩进在哪。
function SubtaskField({ store, task }) {
  const [text, setText] = useState('');
  const nesting = useMemo(
    () => buildNesting([...(store.todoEntries || []), ...(store.doneEntries || [])]),
    [store.todoEntries, store.doneEntries]
  );
  const kids = childrenOf(nesting, task.stableId);

  const add = () => {
    const title = text.trim();
    if (!title) return;
    store.addSubtask(task.id, title);
    setText('');
  };

  return (
    <div className="field field-subtasks">
      <span className="field-subtasks-label">
        子任务{kids.length > 0 ? ` · ${kids.filter((k) => k.completed).length}/${kids.length}` : ''}
      </span>
      {kids.length === 0 ? (
        <p className="subtasks-empty">还没有子任务</p>
      ) : (
        <ul className="subtask-list">
          {kids.map((k) => (
            <li key={k.id}>
              <button
                type="button"
                className={`checkbox${k.completed ? ' checked' : ''}`}
                onClick={() => store.toggleComplete(k)}
                aria-label={k.completed ? '取消完成子任务' : '完成子任务'}
              />
              <span className={'subtask-title' + (k.completed ? ' completed' : '')}>{k.title}</span>
              <button
                type="button"
                className="subtask-del"
                onClick={() => store.deleteTask(k)}
                title="删除子任务"
                aria-label={`删除子任务 ${k.title}`}
              >
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="subtask-add">
        <input
          type="text"
          value={text}
          placeholder="添加子任务，回车确认"
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
function TagField({ label, prefix, placeholder, value, onChange, options, emptyHint }) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const boxRef = useRef(null);
  const selected = toList(value, prefix);

  // 点浮窗其它地方 / 点外部即收起候选清单
  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const toggle = (name) => {
    const next = selected.includes(name)
      ? selected.filter((s) => s !== name)
      : [...selected, name];
    onChange(next.join(', '));
  };

  // 菜单默认向下展开；若下方空间不足则向上翻，避免被可滚动的浮窗裁掉。
  const openMenu = () => {
    const box = boxRef.current;
    const win = box && box.closest('.edit-window');
    if (box && win) {
      const b = box.getBoundingClientRect();
      const w = win.getBoundingClientRect();
      setDropUp(b.bottom + 224 > w.bottom);
    }
    setOpen(true);
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
          title="从已保存的项中选择"
          onClick={() => (open ? setOpen(false) : openMenu())}
        >
          <Icon name="chevron-down" size={14} />
        </button>
      </div>
      {open && (
        <div className={'tag-menu' + (dropUp ? ' drop-up' : '')} role="listbox">
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
                    {on ? <Icon name="check" size={13} /> : null}
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
        </div>
      )}
    </div>
  );
}

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
    thresholdDate: task.thresholdDate || '',
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

  // 已保存的分类 / 标签候选：复用侧栏统计，取的就是 todo.txt 里的真实值。
  const { contexts: contextOptions, projects: projectOptions } = useMemo(
    () => sidebarStats(store.todoEntries || []),
    [store.todoEntries]
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

  const preview = serializeTask({
    ...task,
    title: form.title.trim(),
    priority: form.priority || null,
    dueDate: form.dueDate || null,
    thresholdDate: form.thresholdDate || null,
    remindAt: form.remindAt || null,
    recurrence: form.recurrence || null,
    contexts: toList(form.contexts, '@'),
    projects: toList(form.projects, '+'),
    starValue: form.starred ? '1' : null,
  });

  const save = async () => {
    store.updateTask(task.id, {
      title: form.title.trim(),
      priority: form.priority || null,
      dueDate: form.dueDate || null,
      thresholdDate: form.thresholdDate || null,
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
        onKeyDown={handleKeyDown}
      >
        <div className="drawer-header">
          <h3>编辑任务</h3>
          <button className="icon-btn" onClick={store.closeEditor} title="关闭（Esc）">
            <Icon name="x" size={15} />
          </button>
        </div>

        <label className="field">
          <span>标题</span>
          <input value={form.title} onChange={set('title')} placeholder="任务标题" autoFocus />
        </label>

        <div className="field">
          <span>优先级</span>
          <div className="priority-picker">
            <button
              className={form.priority === '' ? 'sel' : ''}
              onClick={() => setForm((f) => ({ ...f, priority: '' }))}
            >
              无
            </button>
            {priorities.map((p) => (
              <button
                key={p}
                className={form.priority === p ? 'sel' : ''}
                onClick={() => setForm((f) => ({ ...f, priority: p }))}
              >
                {PRIORITY_LABELS[p] || p} ({p})
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>截止日期</span>
          <input type="date" value={form.dueDate} onChange={set('dueDate')} />
        </label>

        <label className="field">
          <span>阈值日期（到期前在“今天”隐藏）</span>
          <input type="date" value={form.thresholdDate} onChange={set('thresholdDate')} />
        </label>

        <label className="field">
          <span>提醒时刻（到点弹系统通知，一次性）</span>
          <input
            type="datetime-local"
            value={form.remindAt}
            onChange={set('remindAt')}
            title="留空表示不提醒"
          />
        </label>

        <label className="field">
          <span>重复（完成后自动生成下一次）</span>
          <select value={form.recurrence} onChange={set('recurrence')}>
            {recurrenceOptions.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <TagField
          label="@分类（逗号分隔）"
          prefix="@"
          placeholder="工作, 生活"
          value={form.contexts}
          onChange={(v) => setForm((f) => ({ ...f, contexts: v }))}
          options={contextOptions}
          emptyHint="暂无已保存的分类"
        />

        <TagField
          label="+标签（逗号分隔）"
          prefix="+"
          placeholder="回测, 量化"
          value={form.projects}
          onChange={(v) => setForm((f) => ({ ...f, projects: v }))}
          options={projectOptions}
          emptyHint="暂无已保存的标签"
        />

        <label className="field field-inline">
          <input
            type="checkbox"
            checked={form.starred}
            onChange={(e) => setForm((f) => ({ ...f, starred: e.target.checked }))}
          />
          <span>星标 ★</span>
        </label>
        <label className="field">
          <span>备注（存数据目录的 notes.md，不进 todo.txt）</span>
          <textarea
            className="note-input"
            rows={4}
            value={form.note}
            onChange={set('note')}
            placeholder="长文本、多行、Markdown 都行。它不在待办那一行上，所以不会挤压列表。"
          />
        </label>
        <SubtaskField store={store} task={task} />

        {task.extraTags.length > 0 && (
          <div className="extra-tags">
            <span>其他字段（只读）：</span>
            {task.extraTags.map((t, i) => (
              <span key={`${t.key}-${i}`} className="chip chip-star">
                {t.key}:{t.value}
              </span>
            ))}
          </div>
        )}

        <div className="drawer-preview">写入行：{preview}</div>

        <div className="drawer-actions">
          <button className="btn btn-primary" onClick={save}>
            保存
          </button>
          <button className="btn" onClick={store.closeEditor}>
            取消
          </button>
          <button className="btn btn-danger" onClick={remove}>
            删除
          </button>
          <span className="spacer" />
          <span className="drawer-hint">回车保存 · Esc 取消</span>
        </div>
      </div>
    </div>
  );
}
