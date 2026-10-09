// 周报导出 —— 只读工具：把 done.txt / todo.txt 现场汇总成一份可粘贴的中文周报。
//
// 硬边界：这个工具**不会**写 todo.txt（capabilities.writes=false，因此根本拿不到
// propose）。它只做两件事：选周偏移、把 Markdown 复制到剪贴板。算法在
// lib/todoTools/weekly.js（纯函数），这里只负责渲染与状态。
import { useMemo, useState } from 'react';
import ToolShell from './ToolShell.jsx';
import Icon from '../Icon.jsx';
import { useToolToast } from '../../hooks/useToolShell.js';
import { buildWeeklyReport } from '../../lib/todoTools/weekly.js';

export default function WeeklyTool({ snapshot }) {
  const { toast, showToast } = useToolToast();
  const [weeksAgo, setWeeksAgo] = useState(0);

  const today = (snapshot && snapshot.today) || '';
  const done = (snapshot && snapshot.done) || [];
  const tasks = (snapshot && snapshot.tasks) || [];

  const report = useMemo(
    () => buildWeeklyReport({ done, tasks, today, weeksAgo }),
    [done, tasks, today, weeksAgo]
  );
  const { stats } = report;

  const copyMarkdown = async () => {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(report.markdown);
      showToast('Markdown 已复制到剪贴板');
    } catch (err) {
      showToast('复制失败：当前环境不允许访问剪贴板');
    }
  };

  const actions = [
    { label: '上一周', title: '看更早一周', onClick: () => setWeeksAgo((n) => n + 1) },
    { label: '本周', title: '回到本周', onClick: () => setWeeksAgo(0) },
    { label: '下一周', title: '看更晚一周', onClick: () => setWeeksAgo((n) => n - 1) },
    { label: '复制 Markdown', title: '把下方预览复制到剪贴板', primary: true, onClick: copyMarkdown },
  ];

  return (
    <ToolShell
      layout="workbench"
      status={<span className="tool-badge">{report.label}</span>}
      hint="只读视图：周报由 todo.txt 与 done.txt 现场汇总，不会写入任何文件。"
      hintTone="info"
      actions={actions}
      toast={toast}
    >
      <div className="tool-metrics">
        <div className="tool-metric">
          <span className="tool-metric-label">
            <Icon name="check-circle" size={13} /> 本周完成
          </span>
          <span className="tool-metric-val">
            {stats.doneCount}
            <small> 条</small>
          </span>
          <span className="tool-metric-note">{report.label}</span>
        </div>
        <div className="tool-metric">
          <span className="tool-metric-label">
            <Icon name="circle-half" size={13} /> 活跃待办
          </span>
          <span className="tool-metric-val">
            {stats.activeCount}
            <small> 条</small>
          </span>
          <span className="tool-metric-note">未完成任务总数</span>
        </div>
        <div className="tool-metric">
          <span className="tool-metric-label">
            <Icon name="calendar" size={13} /> 本周到期
          </span>
          <span className="tool-metric-val">
            {stats.dueCount}
            <small> 条</small>
          </span>
          <span className="tool-metric-note">截止日落在本周</span>
        </div>
        <div className="tool-metric">
          <span className="tool-metric-label">
            <Icon name="alert-triangle" size={13} /> 逾期未完成
          </span>
          <span className="tool-metric-val">
            {stats.overdueCount}
            <small> 条</small>
          </span>
          <span className="tool-metric-note">截止日早于今天</span>
        </div>
      </div>

      <section className="tool-sec">
        <h3 className="tool-sec-title">每日完成</h3>
        {stats.doneCount === 0 ? (
          <div className="tool-empty">
            <b>这一周还没有完成记录</b>
            完成一条待办后，这里会按日显示出数。
          </div>
        ) : (
          <div className="tool-stats">
            {stats.byDay.map((d) => (
              <span className="tool-stat" key={d.date}>
                <b>{d.date.slice(5)}</b>
                <span>{d.count}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="tool-sec">
        <h3 className="tool-sec-title">Markdown 预览</h3>
        <pre className="tool-pre">{report.markdown}</pre>
      </section>

      <section className="tool-sec">
        <h3 className="tool-sec-title">分类分布（本周完成）</h3>
        {stats.contextCounts.length === 0 ? (
          <div className="tool-empty">本周完成的任务里没有 @分类</div>
        ) : (
          <ul className="tool-list">
            {stats.contextCounts.map((c) => (
              <li className="tool-list-row" key={c.name}>
                <span className="tool-tag">@{c.name}</span>
                <b>{c.count}</b>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="tool-sec">
        <h3 className="tool-sec-title">项目分布（本周完成）</h3>
        {stats.projectCounts.length === 0 ? (
          <div className="tool-empty">本周完成的任务里没有 +项目</div>
        ) : (
          <ul className="tool-list">
            {stats.projectCounts.map((p) => (
              <li className="tool-list-row" key={p.name}>
                <span className="tool-tag">+{p.name}</span>
                <b>{p.count}</b>
              </li>
            ))}
          </ul>
        )}
      </section>
    </ToolShell>
  );
}
