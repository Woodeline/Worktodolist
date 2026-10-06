// 新建提议的修改弹窗：预填助手解析出的字段，确认后按编辑值落盘。
//
// 与 EditDrawer 的本质区别：这里编辑的是一条还没落盘的草稿 —— 没有任务 id，
// 不提供删除/星标/阈值日期；确认走 useChatAgent.confirmCreate（与回「是」同一
// 条 add 执行路径），取消则提议原样保留，按钮仍在。
import { useState } from 'react';
import { PRIORITY_LABELS } from '../lib/sortFilter';
import { serializeTask } from '../lib/todoParser';
import Icon from './Icon.jsx';

const PRIORITY_ORDER = ['A', 'B', 'C'];

// 与 EditDrawer 同一套解析：输入框里随手写「工作 生活」「@工作」都能认。
function toList(text, prefix) {
  return text
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith(prefix) ? s.slice(1) : s))
    .filter(Boolean);
}

export default function ProposalModal({ proposal, busy, onConfirm, onCancel }) {
  const [form, setForm] = useState(() => ({
    title: proposal.title || '',
    priority: proposal.priority || '',
    dueDate: proposal.dueDate || '',
    contexts: (proposal.contexts || []).join(', '),
    projects: (proposal.projects || []).join(', '),
  }));

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const title = form.title.trim();
  const contexts = toList(form.contexts, '@');
  const projects = toList(form.projects, '+');

  // 与动作表 runAdd 完全同构的写入行预览：确认前就能看到会往 todo.txt 写什么。
  const preview = serializeTask({
    kind: 'task',
    raw: '',
    title,
    priority: form.priority || null,
    dueDate: form.dueDate || null,
    contexts,
    projects,
    completed: false,
    createdAt: null,
    thresholdDate: null,
    starValue: null,
    extraTags: [],
  });

  const confirm = () => {
    onConfirm({
      title,
      priority: form.priority || null,
      dueDate: form.dueDate || null,
      contexts,
      projects,
    });
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onCancel} />
      <div className="proposal-modal" role="dialog" aria-modal="true" aria-label="修改后新建">
        <div className="drawer-header">
          <h3>修改后新建</h3>
          <button className="icon-btn" onClick={onCancel} title="关闭（Esc）">
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
            {PRIORITY_ORDER.map((p) => (
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
          <span>@分类（逗号分隔）</span>
          <input value={form.contexts} onChange={set('contexts')} placeholder="工作, 生活" />
        </label>

        <label className="field">
          <span>+标签（逗号分隔）</span>
          <input value={form.projects} onChange={set('projects')} placeholder="回测, 量化" />
        </label>

        {title && <div className="drawer-preview">写入行：{preview}</div>}

        <div className="drawer-actions">
          <button className="btn btn-primary" disabled={!title || busy} onClick={confirm}>
            确认新建
          </button>
          <button className="btn" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </>
  );
}
