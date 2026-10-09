// 统计 —— 只读工具：把当前 todo.txt / done.txt 折算成几组分布与趋势。
//
// 硬边界：capabilities.writes=false，拿不到 propose，也不碰任何文件。
// 图表是纯 CSS 条形图（tool-ramp + 内联宽度），颜色一律走 --ramp-1..5 令牌，
// 不引图表库、不写裸色值。算法在 lib/todoTools/stats.js（纯函数）。
import { useMemo } from 'react';
import ToolShell from './ToolShell.jsx';
import Icon from '../Icon.jsx';
import {
  completionTrend,
  contextHistogram,
  dueHistogram,
  priorityHistogram,
  projectHistogram,
  weekCompletion,
} from '../../lib/todoTools/stats.js';

// 填充色只有四种来源，且**都不等于轨道色**：
//   --ramp-5..2  有序刻度的四档（深 → 浅）
//   --muted      「无 / 未分类」—— 它不属于有序刻度，用中性灰而不是色阶最浅那档，
//                否则会跟 --ramp-1 的轨道同色、整条消失（这正是本轮修掉的缺陷）。
const NONE_TONE = 'var(--muted)';

const PRIORITY_TONE = {
  A: 'var(--ramp-5)',
  B: 'var(--ramp-4)',
  C: 'var(--ramp-3)',
  none: NONE_TONE,
};

const DUE_TONE = {
  overdue: 'var(--ramp-5)',
  today: 'var(--ramp-4)',
  week: 'var(--ramp-3)',
  later: 'var(--ramp-2)',
  none: NONE_TONE,
};

/** rank → 色阶令牌（第 1 名最深，越往后越浅；下限是 --ramp-2，留 --ramp-1 给轨道）。 */
function rankTone(i) {
  return `var(--ramp-${Math.min(5, Math.max(2, 5 - i))})`;
}

/** 一根条：底槽走 --ramp-1，填充色由调用方给的令牌决定。 */
function Bar({ pct, tone }) {
  return (
    <span style={{ flex: '1 1 auto', minWidth: 0 }}>
      <span className="tool-ramp" style={{ background: 'var(--ramp-1)' }}>
        <span
          style={{
            display: 'block',
            height: '100%',
            width: `${pct}%`,
            background: tone,
            borderRadius: 'inherit',
          }}
        />
      </span>
    </span>
  );
}

function BarList({ rows }) {
  return (
    <ul className="tool-list">
      {rows.map((r) => (
        <li className="tool-list-row" key={r.key}>
          <span>{r.label}</span>
          <Bar pct={r.pct} tone={r.tone} />
          <b>{r.count}</b>
        </li>
      ))}
    </ul>
  );
}

export default function StatsTool({ snapshot }) {
  const today = (snapshot && snapshot.today) || '';
  const tasks = (snapshot && snapshot.tasks) || [];
  const done = (snapshot && snapshot.done) || [];
  const counts = (snapshot && snapshot.counts) || {};

  const data = useMemo(() => {
    const dueRows = dueHistogram(tasks, today);
    const maxDue = Math.max(1, ...dueRows.map((d) => d.count));
    const trend = completionTrend(done, today, 14);
    const maxTrend = Math.max(1, ...trend.map((d) => d.count));
    return {
      priority: priorityHistogram(tasks).map((r) => ({ ...r, tone: PRIORITY_TONE[r.key] || NONE_TONE })),
      contexts: contextHistogram(tasks).map((r, i) => ({ ...r, tone: rankTone(i) })),
      projects: projectHistogram(tasks).map((r, i) => ({ ...r, tone: rankTone(i) })),
      due: dueRows.map((d) => ({ ...d, pct: Math.round((d.count / maxDue) * 100), tone: DUE_TONE[d.key] })),
      trend: trend.map((d) => ({
        ...d,
        pct: Math.round((d.count / maxTrend) * 100),
        tone: 'var(--ramp-4)',
      })),
      weekDone: weekCompletion(done, today),
    };
  }, [tasks, done, today]);

  const emptyAll = tasks.length === 0 && done.length === 0;

  return (
    <ToolShell
      layout="workbench"
      hint="只读统计：全部数字由当前 todo.txt / done.txt 现场计算，不写入任何文件。"
      hintTone="info"
    >
      {emptyAll ? (
        <div className="tool-empty">
          <b>还没有可统计的数据</b>
          打开一个有任务或已完成记录的 todo.txt 后，这里会出现分布与趋势。
        </div>
      ) : (
        <>
          <div className="tool-metrics">
            <div className="tool-metric">
              <span className="tool-metric-label">
                <Icon name="circle-half" size={13} /> 活跃任务
              </span>
              <span className="tool-metric-val">
                {counts.active || 0}
                <small> 条</small>
              </span>
            </div>
            <div className="tool-metric">
              <span className="tool-metric-label">
                <Icon name="alert-triangle" size={13} /> 逾期
              </span>
              <span className="tool-metric-val">
                {counts.overdue || 0}
                <small> 条</small>
              </span>
            </div>
            <div className="tool-metric">
              <span className="tool-metric-label">
                <Icon name="calendar" size={13} /> 今天到期
              </span>
              <span className="tool-metric-val">
                {counts.dueToday || 0}
                <small> 条</small>
              </span>
            </div>
            <div className="tool-metric">
              <span className="tool-metric-label">
                <Icon name="check-circle" size={13} /> 本周完成
              </span>
              <span className="tool-metric-val">
                {data.weekDone}
                <small> 条</small>
              </span>
            </div>
          </div>

          <section className="tool-sec">
            <h3 className="tool-sec-title">
              <Icon name="flag" size={15} /> 优先级分布
            </h3>
            <BarList rows={data.priority} />
          </section>

          <section className="tool-sec">
            <h3 className="tool-sec-title">
              <Icon name="calendar" size={15} /> 截止日期分布
            </h3>
            <BarList rows={data.due} />
          </section>

          <section className="tool-sec">
            <h3 className="tool-sec-title">
              <Icon name="filter" size={15} /> 分类 Top
            </h3>
            {data.contexts.length === 0 ? (
              <div className="tool-empty">没有带 @分类 的活跃任务</div>
            ) : (
              <BarList rows={data.contexts} />
            )}
          </section>

          <section className="tool-sec">
            <h3 className="tool-sec-title">
              <Icon name="columns" size={15} /> 项目 Top
            </h3>
            {data.projects.length === 0 ? (
              <div className="tool-empty">没有带 +项目 的活跃任务</div>
            ) : (
              <BarList rows={data.projects} />
            )}
          </section>

          <section className="tool-sec">
            <h3 className="tool-sec-title">
              <Icon name="chart" size={15} /> 最近 14 天完成趋势
            </h3>
            <BarList rows={data.trend} />
          </section>
        </>
      )}
    </ToolShell>
  );
}
