import { useEffect, useState } from 'react';
import { PRIORITY_LABELS } from '../lib/sortFilter';
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

export default function EditDrawer({ store }) {
  const task = store.editingTask;
  const [form, setForm] = useState(null);

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

  return (
    <>
      <div className="drawer-backdrop" onClick={store.closeEditor} />
      <aside className="drawer">
        <div className="drawer-panel">
          <div className="drawer-header">
            <h3>编辑任务</h3>
            <button className="icon-btn" onClick={store.closeEditor} title="关闭（Esc）">
              <Icon name="x" size={15} />
            </button>
          </div>

          <label className="field">
            <span>标题</span>
            <input value={form.title} onChange={set('title')} placeholder="任务标题" />
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
            <span>@分类（逗号分隔）</span>
            <input value={form.contexts} onChange={set('contexts')} placeholder="工作, 生活" />
          </label>

          <label className="field">
            <span>+标签（逗号分隔）</span>
            <input value={form.projects} onChange={set('projects')} placeholder="回测, 量化" />
          </label>

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
          </div>
        </div>
      </aside>
    </>
  );
}
