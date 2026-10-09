// 提议弹窗 —— 「产出建议 → 用户确认 → 落盘」里那个"确认"的界面。
//
// 支持三种提议（见 lib/proposals.js）：
//   create  新建：预填助手解析出的字段，确认后按编辑值落盘（原有行为，一字未改）
//   edit    改已存在任务的字段：**差异视图**，不是编辑器
//   batch   一次对多条做同一动作：同样只做展示
//
// 为什么 edit / batch 刻意不做成可编辑表格：① 提议的全部意义就是"确认前看到会写什么"，
// 掰开再改一遍等于把校验责任推回给用户；② 可编辑表格是新的控件族，一进来就要连带
// 补 styleguide 视图、qa-css-check 与 qa-responsive 三档断点，代价远大于收益。
// 要改就直接改建议的来源（工具里的条件），而不是在最后一秒手改。
//
// 与 EditDrawer 的本质区别：这里编辑的是**还没落盘的提议**。确认走 dispatch
// （与对话页同一张 ACTIONS 表），取消则提议原样保留，按钮仍在。
import dayjs from 'dayjs';
import { useState } from 'react';
import { PRIORITY_LABELS } from '../lib/sortFilter';
import { PREVIEW_LIMIT } from '../lib/proposals';
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

/* ---------------------------------------------------------------------------
   一 · 新建：可编辑表单（对话页的「修改后新建」与工具的"新建类建议"共用）
   ------------------------------------------------------------------------- */
function CreateForm({ source, busy, onConfirm, onCancel }) {
  const [form, setForm] = useState(() => ({
    title: source.title || '',
    priority: source.priority || '',
    dueDate: source.dueDate || '',
    contexts: (source.contexts || []).join(', '),
    projects: (source.projects || []).join(', '),
  }));

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const title = form.title.trim();
  const contexts = toList(form.contexts, '@');
  const projects = toList(form.projects, '+');

  // 与动作表 runAdd 完全同构的写入行预览：确认前就能看到会往 todo.txt 写什么。
  // 注意 createdAt 必须一起带上 —— store.addTask 会给新任务补当天创建日期，
  // 预览里不含它就是"预览和落盘差一个字段"。
  const preview = serializeTask({
    kind: 'task',
    raw: '',
    title,
    priority: form.priority || null,
    dueDate: form.dueDate || null,
    contexts,
    projects,
    completed: false,
    createdAt: dayjs().format('YYYY-MM-DD'),
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

/* ---------------------------------------------------------------------------
   二 · 改 / 批量：差异视图
   ------------------------------------------------------------------------- */
function DiffView({ proposal, busy, onConfirm, onCancel }) {
  const isEdit = proposal.kind === 'edit';
  const items = proposal.items || [];
  const shown = items.slice(0, PREVIEW_LIMIT);
  const rest = items.length - shown.length;

  return (
    <>
      <div className="drawer-backdrop" onClick={onCancel} />
      <div
        className="proposal-modal is-wide"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? '按建议修改' : '批量修改'}
      >
        <div className="drawer-header">
          <h3>{isEdit ? '按建议修改' : '批量修改'}</h3>
          <button className="icon-btn" onClick={onCancel} title="关闭（Esc）">
            <Icon name="x" size={15} />
          </button>
        </div>

        <p className="proposal-summary">
          {proposal.summary}
          <br />
          下面是<b>确认后</b>会写进 todo.txt 的内容；现在还没动过文件。
        </p>

        <div className="proposal-list">
          {shown.map((item) => (
            <div className="proposal-item" key={item.id || item.title}>
              <div className="proposal-item-title">{item.title || '（无标题）'}</div>
              {item.before && <div className="proposal-item-line is-before">{item.before}</div>}
              <div className="proposal-item-line is-after">
                {item.after ? item.after : '（整行移除）'}
              </div>
            </div>
          ))}
        </div>
        {rest > 0 && <p className="proposal-more">还有 {rest} 条未在弹窗中展开（确认后一并执行）。</p>}

        <div className="drawer-actions">
          <button className="btn btn-primary" disabled={busy || !items.length} onClick={() => onConfirm()}>
            确认写入 {items.length} 条
          </button>
          <button className="btn" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </>
  );
}

export default function ProposalModal({ proposal, busy, onConfirm, onCancel }) {
  if (!proposal) return null;
  const kind = proposal.kind || 'create';
  if (kind === 'create') {
    // 兼容两种来源：对话页的裸字段对象，与工具产出的 {kind, items:[{fields}]}
    const source = (proposal.items && proposal.items[0] && proposal.items[0].fields) || proposal;
    return <CreateForm source={source} busy={busy} onConfirm={onConfirm} onCancel={onCancel} />;
  }
  return <DiffView proposal={proposal} busy={busy} onConfirm={onConfirm} onCancel={onCancel} />;
}
