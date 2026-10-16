import { useEffect, useMemo, useRef, useState } from 'react';
import { PRIORITY_LABELS, sidebarStats } from '../lib/sortFilter';
import { serializeTask } from '../lib/todoParser';
import Icon from './Icon.jsx';

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

export default function EditDrawer({ store }) {
  const task = store.editingTask;
  const [form, setForm] = useState(null);

  // 已保存的分类 / 标签候选：复用侧栏统计，取的就是 todo.txt 里的真实值。
  const { contexts: contextOptions, projects: projectOptions } = useMemo(
    () => sidebarStats(store.todoEntries || []),
    [store.todoEntries]
  );

  useEffect(() => {
    if (task) {
      setForm({
        title: task.title,
        priority: task.priority || '',
        dueDate: task.dueDate || '',
        thresholdDate: task.thresholdDate || '',
        contexts: task.contexts.join(', '),
        projects: task.projects.join(', '),
        starred: Boolean(task.starValue),
      });
    } else {
      setForm(null);
    }
  }, [task && task.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!task || !form) return null;

  const priorities = [...PRIORITY_ORDER];
  if (task.priority && !priorities.includes(task.priority)) priorities.push(task.priority);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const preview = serializeTask({
    ...task,
    title: form.title.trim(),
    priority: form.priority || null,
    dueDate: form.dueDate || null,
    thresholdDate: form.thresholdDate || null,
    contexts: toList(form.contexts, '@'),
    projects: toList(form.projects, '+'),
    starValue: form.starred ? '1' : null,
  });

  const save = () => {
    store.updateTask(task.id, {
      title: form.title.trim(),
      priority: form.priority || null,
      dueDate: form.dueDate || null,
      thresholdDate: form.thresholdDate || null,
      contexts: toList(form.contexts, '@'),
      projects: toList(form.projects, '+'),
      starValue: form.starred ? '1' : null,
    });
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
