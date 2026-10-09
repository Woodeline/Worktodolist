// 批量优先级 —— 会写 todo.txt 的工具（capabilities.writes=true）。
//
// 硬边界：本组件**绝不自己写文件**。它唯一能做的"写"是把一份批量提议交给
// 外壳（propose → 确认弹窗 → dispatch）。没拿到 propose（未授权）时按钮直接
// 拒绝并在工具内 toast 说明原因，而不是静默失败。
//
// 版式：inspector。左栏（aside）放筛选条件与选中摘要；右栏放命中列表与操作区。
import { useMemo, useState } from 'react';
import ToolShell from './ToolShell.jsx';
import Icon from '../Icon.jsx';
import { useToolToast } from '../../hooks/useToolShell.js';
import { makeBatchProposal } from '../../lib/proposals.js';
import {
  WRITE_OPS,
  applicableTasks,
  filterTasks,
  invertIds,
  opNeedsValue,
  selectAllIds,
  summarizeSelection,
  toggleId,
  valueKindOf,
} from '../../lib/todoTools/bulkSelect.js';

const PRIORITY_CHOICES = [
  { value: '', label: '全部优先级' },
  { value: 'A', label: 'A 高' },
  { value: 'B', label: 'B 中' },
  { value: 'C', label: 'C 低' },
  { value: 'none', label: '无优先级' },
];

const PLACEHOLDER = {
  date: 'YYYY-MM-DD',
  days: '天数，可为负',
  priority: 'A / B / C',
  context: '分类名（不带 @）',
  project: '项目名（不带 +）',
};

export default function BulkPrioTool({ snapshot, propose }) {
  const { toast, showToast } = useToolToast();

  const today = (snapshot && snapshot.today) || '';
  const tasks = (snapshot && snapshot.tasks) || [];
  const contexts = (snapshot && snapshot.contexts) || [];
  const projects = (snapshot && snapshot.projects) || [];

  const [keyword, setKeyword] = useState('');
  const [context, setContext] = useState('');
  const [project, setProject] = useState('');
  const [priority, setPriority] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);

  const [selected, setSelected] = useState([]);
  const [opType, setOpType] = useState('setPriority');
  const [opValue, setOpValue] = useState('');

  const filtered = useMemo(
    () => filterTasks(tasks, { keyword, context, project, priority, overdueOnly, today }),
    [tasks, keyword, context, project, priority, overdueOnly, today]
  );

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedTasks = useMemo(
    () => tasks.filter((t) => selectedSet.has(t.id)),
    [tasks, selectedSet]
  );
  const summary = summarizeSelection(selectedTasks, today);

  const needsValue = opNeedsValue(opType);
  const kind = valueKindOf(opType);

  const buildOp = () => (needsValue ? { type: opType, value: opValue.trim() } : { type: opType });

  const submit = () => {
    if (!propose) {
      showToast('这个工具没有被授权写 todo.txt');
      return;
    }
    if (!selectedTasks.length) {
      showToast('请先勾选要操作的任务');
      return;
    }
    const op = buildOp();
    if (needsValue && !String(op.value || '').trim()) {
      showToast('请先填写操作值');
      return;
    }
    if (!applicableTasks(selectedTasks, op, today).length) {
      showToast('所选任务都不适用这个操作');
      return;
    }
    propose(makeBatchProposal(selectedTasks, op, today));
    setSelected([]);
    showToast('已提交批量提议，确认后才会落盘');
  };

  /* --- 左栏：筛选 + 选中摘要 --- */
  const aside = (
    <>
      <section className="tool-sec">
        <h3 className="tool-sec-title">
          <Icon name="filter" size={15} /> 筛选
        </h3>
        <div className="tool-fields">
          <label className="tool-field">
            <span className="tool-field-label">关键字</span>
            <span className="tool-field-body">
              <input
                className="tool-input"
                value={keyword}
                placeholder="按标题匹配"
                onChange={(e) => setKeyword(e.target.value)}
              />
            </span>
          </label>
          <label className="tool-field">
            <span className="tool-field-label">分类 @</span>
            <span className="tool-field-body">
              <select className="tool-select" value={context} onChange={(e) => setContext(e.target.value)}>
                <option value="">全部分类</option>
                {contexts.map((c) => (
                  <option key={c.name} value={c.name}>
                    @{c.name}（{c.count}）
                  </option>
                ))}
              </select>
            </span>
          </label>
          <label className="tool-field">
            <span className="tool-field-label">项目 +</span>
            <span className="tool-field-body">
              <select className="tool-select" value={project} onChange={(e) => setProject(e.target.value)}>
                <option value="">全部项目</option>
                {projects.map((p) => (
                  <option key={p.name} value={p.name}>
                    +{p.name}（{p.count}）
                  </option>
                ))}
              </select>
            </span>
          </label>
          <label className="tool-field">
            <span className="tool-field-label">优先级</span>
            <span className="tool-field-body">
              <select className="tool-select" value={priority} onChange={(e) => setPriority(e.target.value)}>
                {PRIORITY_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </div>
        <label className="tool-check">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          仅看逾期
        </label>
      </section>

      <section className="tool-sec">
        <h3 className="tool-sec-title">选中摘要</h3>
        <div className="tool-metrics">
          <div className="tool-metric">
            <span className="tool-metric-label">已选任务</span>
            <span className="tool-metric-val">{summary.count}</span>
          </div>
          <div className="tool-metric">
            <span className="tool-metric-label">逾期 / 今日到期</span>
            <span className="tool-metric-val">
              {summary.overdue}
              <small> / {summary.dueToday}</small>
            </span>
          </div>
          <div className="tool-metric">
            <span className="tool-metric-label">无截止日</span>
            <span className="tool-metric-val">{summary.noDue}</span>
          </div>
        </div>
        <p className="tool-note">
          优先级分布：
          {Object.keys(summary.byPriority).length === 0
            ? '（空）'
            : Object.entries(summary.byPriority)
                .map(([k, n]) => `${k === 'none' ? '无' : k} ${n}`)
                .join(' · ')}
        </p>
      </section>
    </>
  );

  /* --- 右栏：命中列表 + 操作区 --- */
  return (
    <ToolShell
      layout="inspector"
      aside={aside}
      hint={propose ? null : '未获写入授权：本工具只能浏览与筛选，无法生成落盘提议。'}
      hintTone="warn"
      toast={toast}
    >
      <div className="tool-toolbar">
        <span className="tool-name">命中 {filtered.length} 条</span>
        <button type="button" className="btn btn-sm" onClick={() => setSelected(selectAllIds(filtered))}>
          全选
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setSelected([])}>
          全不选
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setSelected(invertIds(filtered, selected))}>
          反选
        </button>
        <span className="tool-toolbar-spring" />
        <span className="tool-group-meta">已选 {selected.length}</span>
      </div>

      <section className="tool-sec">
        {filtered.length === 0 ? (
          <div className="tool-empty">
            <b>没有匹配的任务</b>
            放宽筛选条件试试，或先确认 todo.txt 里确实有未完成任务。
          </div>
        ) : (
          <ul className="tool-list">
            {filtered.map((t) => (
              <li className="tool-list-row" key={t.id}>
                <label className="tool-check">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(t.id)}
                    onChange={() => setSelected(toggleId(selected, t.id))}
                  />
                  <span>
                    {t.priority ? `(${t.priority}) ` : ''}
                    {t.title}
                  </span>
                </label>
                {t.contexts.map((c) => (
                  <span className="tool-tag" key={c}>
                    @{c}
                  </span>
                ))}
                {t.projects.map((p) => (
                  <span className="tool-tag" key={p}>
                    +{p}
                  </span>
                ))}
                {t.dueDate && <span className="tool-group-meta">{t.dueDate}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="tool-sec">
        <h3 className="tool-sec-title">批量操作</h3>
        <div className="tool-fields">
          <label className="tool-field">
            <span className="tool-field-label">操作</span>
            <span className="tool-field-body">
              <select className="tool-select" value={opType} onChange={(e) => setOpType(e.target.value)}>
                {WRITE_OPS.map((o) => (
                  <option key={o.type} value={o.type}>
                    {o.label}
                  </option>
                ))}
              </select>
            </span>
          </label>
          {needsValue && (
            <label className="tool-field">
              <span className="tool-field-label">操作值</span>
              <span className="tool-field-body">
                <input
                  className="tool-input"
                  type="text"
                  inputMode={kind === 'days' ? 'decimal' : undefined}
                  value={opValue}
                  placeholder={PLACEHOLDER[kind] || '填写操作值'}
                  onChange={(e) => setOpValue(e.target.value)}
                />
              </span>
            </label>
          )}
        </div>
        <div className="tool-actions-row">
          <button type="button" className="btn btn-sm btn-primary" onClick={submit}>
            生成批量提议
          </button>
          <span className="tool-hint">确认后由外壳统一落盘；本工具不会直接写 todo.txt。</span>
        </div>
      </section>
    </ToolShell>
  );
}
