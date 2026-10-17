// RTI 的两个"只画图"组件 —— 把 lib/rti/chart.js 的纯绘制函数包成 React 组件。
//
// 它们刻意不持有任何数据：图的内容完全由 props 决定，画布尺寸跟随容器宽度，
// 所以窗口一缩放就重画（画布按像素画，不重画就会被拉伸变形）。
//
// 页 1 并进页 2 之后，DecayChart 不再挂在"寿命推算"页，而是每个温度组的下钻视图。
import { useCallback, useEffect, useRef } from 'react';
import { drawLifeChart, drawRtiChart } from '../../../lib/rti/chart.js';

/* ---------------------------------------------------------------------------
   图 1 · 单温度衰减曲线（某个温度组的下钻视图，原「寿命推算」页）
   ------------------------------------------------------------------------- */

export function DecayChart({ life, title }) {
  const ref = useRef(null);
  const draw = useCallback(() => {
    if (ref.current && life && !life.error) drawLifeChart(ref.current, life.result);
  }, [life]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [draw]);

  if (!life) return null;
  // 单个温度组数据不够（例如只有 1 个点）时，lifeCalc 会给出可读的 error
  if (life.error) return <div className="tool-empty">{life.error}</div>;

  return (
    <div className="tool-chart">
      <canvas ref={ref} className="tool-canvas" />
      {title && <p className="tool-chart-title">{title}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   图 2 · Arrhenius（RTI 主结果）
   ------------------------------------------------------------------------- */

export function ArrheniusChart({ result, canvasRef }) {
  // 允许外部传入 ref：结果区要拿这块画布做「保存 PNG」，而那按钮住在图外面
  const localRef = useRef(null);
  const ref = canvasRef || localRef;
  const draw = useCallback(() => {
    if (ref.current && result) drawRtiChart(ref.current, result);
  }, [ref, result]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [draw]);

  if (!result) {
    return <div className="tool-empty">凑够 2 个老化温度后，Arrhenius 回归图与 95% 置信带显示在这里。</div>;
  }

  return (
    <div className="tool-chart">
      <canvas ref={ref} className="tool-canvas" />
      <p className="tool-chart-title">图 2 · Arrhenius 图：t₅₀ ~ 1/T 回归、95% 置信带与 RTI 交点</p>
    </div>
  );
}
