// 耐热指数页 ·「答案流」：结果优先，证据在后，录入折在最后。
//
// 这一页回答的是"打开工具第一眼就该看到什么"。改造前后的差别：
//   · 改造前：左侧录参数、右侧出结果，且必须先点「推算」—— 结果在首屏之外，改一个数还要再点一次。
//   · 改造后：数据一改就实时重算（没有按钮、没有 stale），答案（RTI + Arrhenius 图）顶在最上面，
//     各温度的衰减曲线（原「寿命推算」页）折进证据表，点一行才展开。
//
// 本组件不持有数据，只把 model（lib/rti/model.js 的 compute 输出）画出来。
import { Fragment, useRef, useState } from 'react';
import { RTI_LIFE, fmtH, fmtTemp, yearsOf } from '../../../lib/rti/calc.js';
import { downloadCanvasPNG, stamp } from '../../../lib/rti/files.js';
import { ArrheniusChart, DecayChart } from './charts.jsx';

const ciText = (ci) => (ci ? `95%CI ${ci.lo.toFixed(1)} – ${ci.hi.toFixed(1)} °C` : '95%CI 不可得（温度点不足或置信带无交点）');

function RtiHeadline({ result }) {
  return (
    <div className="tool-metrics">
      {[RTI_LIFE.r20, RTI_LIFE.r100].map((L, i) => {
        const mk = i === 0 ? result.r20 : result.r100;
        return (
          <div className="tool-metric" key={L}>
            <span className="tool-metric-label">RTI · 寿命 {L.toLocaleString('en-US')} h</span>
            <span className="tool-metric-val">
              {mk.rti.toFixed(1)}
              <small> °C</small>
            </span>
            <span className="tool-metric-note">{ciText(mk.ci)}</span>
          </div>
        );
      })}
    </div>
  );
}

function StatsBar({ result }) {
  const s = (k, v) => (
    <div className="tool-stat" key={k}>
      <b>{k}</b>
      <span>{v}</span>
    </div>
  );
  return (
    <div className="tool-stats">
      {s('活化能 Ea', `${result.Ea.toFixed(1)} kJ/mol`)}
      {s('R²', result.r2.toFixed(5))}
      {s('残差 s', result.s == null ? '—' : result.s.toFixed(5))}
      {s('温度点 n', result.n)}
      {result.ciOk ? s('自由度 df', result.df) : s('自由度 df', '—')}
      {result.ciOk ? s('t₀.₉₇₅', result.tc.toFixed(3)) : null}
    </div>
  );
}

/** 各温度 t₅₀ 表：点一行展开这条衰减曲线 —— 原「寿命推算」页的归宿 */
function PerTempEvidence({ perGroup, expanded, onToggle }) {
  if (perGroup.length === 0) return null;
  return (
    <section className="tool-sec">
      <h3 className="tool-sec-title">各温度下的 t₅₀</h3>
      <div className="tool-table-wrap">
        <table className="tool-table tool-expand">
          <thead>
            <tr>
              <th>老化温度 T（°C）</th>
              <th>t₅₀（h）</th>
              <th>求法</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {perGroup.map((g) => {
              const R = g.life.result;
              const open = expanded.has(g.T);
              return (
                <Fragment key={g.T}>
                  <tr className={open ? 'is-open' : ''} onClick={() => onToggle(g.T)}>
                    <td>{fmtTemp(g.T)}</td>
                    <td>
                      {R ? fmtH(R.t50) : '—'}
                      {R ? yearsOf(R.t50) : ''}
                    </td>
                    <td>{R ? (R.mode === 'interp' ? '半对数内插' : '趋势外推（置信度较低）') : g.life.error || '数据不足'}</td>
                    <td className="tool-td-act">
                      <span className="tool-caret" aria-hidden="true">
                        {open ? '▾' : '▸'}
                      </span>
                    </td>
                  </tr>
                  {open && (
                    <tr className="tool-expand-row">
                      <td colSpan={4}>
                        <DecayChart life={g.life} title={`图 1 · ${fmtTemp(g.T)} °C 的衰减曲线：特性值 ~ 老化时间（对数时间轴）`} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function RtiAnswer({ model, onToCmp, onToast }) {
  const canvasRef = useRef(null);
  const { groups, perGroup, blank, out } = model;
  const result = out.result;

  // 导出 PNG：先弹「另存为」选位置；用户取消就静默收场，出错才提示（没接 toast 就忽略）。
  const savePng = () =>
    downloadCanvasPNG(canvasRef.current, `图2-RTI-Arrhenius-${stamp()}.png`).catch((err) => {
      if (onToast) onToast(`保存图片失败：${(err && err.message) || err}`);
    });

  // 展开的是"哪些温度（T 值）"。用 T 而不是行号：温度是这一页的天然主键，
  // 数据一变（删/改温度）时展开态不会莫名其妙跳到别的行。
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = (T) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(T)) next.delete(T);
      else next.add(T);
      return next;
    });

  return (
    <div className="tool-stack">
      {/* 实时状态行：把"能不能算、缺什么"当场说出来，而不是等用户点按钮才报错 */}
      {out.error ? (
        <p className="tool-hint is-warn">{out.error}</p>
      ) : (
        <p className="tool-hint is-info">
          已按 {groups.length} 个温度组实时算出结果{blank ? ` · 有 ${blank} 行不完整、已跳过` : ''}
        </p>
      )}
      {!out.error && out.warns.length > 0 && (
        <ul className="tool-warns">
          {out.warns.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <div className="tool-answer-row">
        <div className="tool-stack">
          {result ? (
            <RtiHeadline result={result} />
          ) : (
            <div className="tool-empty">
              <b>还没有结果</b>在下面的「录入 / 粘贴数据」里填够 2 个老化温度（每个温度至少 2 个数据点），结果会实时出现在这里。
            </div>
          )}
          <PerTempEvidence perGroup={perGroup} expanded={expanded} onToggle={toggle} />
          {result && <StatsBar result={result} />}
        </div>
        <section className="tool-sec">
          <ArrheniusChart result={result} canvasRef={canvasRef} />
          {result && (
            <div className="tool-chart-tools">
              <button type="button" className="btn btn-sm" onClick={savePng}>
                保存 PNG
              </button>
              <button type="button" className="btn btn-sm" onClick={onToCmp}>
                加入多材料对比
              </button>
            </div>
          )}
        </section>
      </div>

      <p className="tool-note">
        <b>怎么算的：</b>① 每个温度的 (时长, 特性值) 序列按 IEC 60216 终点时间方法求 t₅₀；② 对 log₁₀ t₅₀ ~ 1/T(K)
        做最小二乘回归，寿命达 L 小时的温度即 RTI；③ 95% 置信区间 = 回归均值置信带 ±t₀.₉₇₅·s·√(1/n + (x−x̄)²/Sₓₓ)（df =
        温度数 − 2）与水平线的交点；④ 表观活化能 Ea = ln10 · R · b。数据一改就重算，本页没有「推算」按钮。
      </p>
    </div>
  );
}
