// RTI 计算工具 —— 工具集里的第一个小工具，也是 ToolShell 骨架的第一个消费者。
//
// 由一份独立的单文件网页（RTI计算工具.html）移植而来，改动只发生在两侧：
//   · 视觉层：换成 todolist 的令牌体系（系统灰/系统蓝/发丝线/小方角），见 index.css 8.1
//   · 数据层：算法与画图抽到 lib/rti/（纯函数，可单测；数值与 Python 基准对拍一致）
// 功能与交互一律保留：三个页面、粘贴导入、PNG/CSV/JSON 导出、本机自动保存、
// 画布上的悬停读值 / 点击固定 / 右键取消。
//
// v0.1.6 改造：页签条 / 保存徽标 / 导出・导入动作组 / 滚动容器 / toast / 粘贴弹窗
// 这六件交给 ToolShell；存档读写交给 toolStorage（键名仍是 todolist.tool.rti.v1，
// 因此不需要任何迁移）。本文件只剩"RTI 自己是什么"。
//
// 布局：三页都用 inspector 版式的两列 —— 左列录参数（窄而高），右列出结果与图（宽而高）。
// 之所以要分列，是因为这三张图都是按容器宽度画的：挤在单列的 360px 里既看不清，
// 又把结果推到首屏之外；并排之后"改一个数 → 右边立刻对照"才成立。
//
// 关于"存字符串还是存数字"：表单里存的是**用户正在输入的字符串**，
// 解析统一在 lib/rti/calc.js 的 toNum 里做，落盘时再统一转回数字。
import { useCallback, useEffect, useState } from 'react';
import { toNum, lifeCalc, rtiCalc } from '../../lib/rti/calc.js';
import { DEMO_CMP, DEMO_LIFE, DEMO_RTI, EMPTY_CMP, EMPTY_LIFE, EMPTY_RTI } from '../../lib/rti/demo.js';
import { downloadJSON, readTextFile, stamp } from '../../lib/rti/files.js';
import ToolShell from './ToolShell.jsx';
import { saveLabel, useRestoredState, useToolAutoSave, useToolPaste, useToolToast } from '../../hooks/useToolShell.js';
import LifePane from './rti/LifePane.jsx';
import RtiPane from './rti/RtiPane.jsx';
import CmpPane from './rti/CmpPane.jsx';

const TOOL_ID = 'rti';
const STATE_VERSION = 1;

const str = (x) => (x == null ? '' : String(x));
const EMPTY_OUT = () => ({ result: null, warns: [], error: null, stale: false });

/* ---------------------------------------------------------------------------
   落盘 / 回读
   ------------------------------------------------------------------------- */

/** 界面状态 → 存档状态（把输入字符串收敛成数字或 null） */
function toStorage(app) {
  return {
    life: {
      name: app.life.name,
      T: toNum(app.life.T),
      p0: toNum(app.life.p0),
      pts: app.life.pts.map((p) => ({ t: toNum(p.t), v: toNum(p.v) })),
    },
    rti: {
      name: app.rti.name,
      p0: toNum(app.rti.p0),
      temps: app.rti.temps.map((g) => ({
        T: toNum(g.T),
        rows: g.rows.map((r) => [toNum(r[0]), toNum(r[1])]),
      })),
    },
    cmp: {
      mats: app.cmp.mats.map((m) => ({
        name: m.name,
        rows: m.rows.map((r) => ({ T: toNum(r.T), t: toNum(r.t) })),
      })),
      xMax: toNum(app.cmp.xMax),
      xMin: toNum(app.cmp.xMin),
      logY: app.cmp.logY,
    },
  };
}

/** 存档状态 → 界面状态（数字回到字符串，null 回到空串） */
function applyIn(s) {
  const lifePts = Array.isArray(s.life.pts) ? s.life.pts : [];
  const temps = Array.isArray(s.rti.temps) ? s.rti.temps : [];
  const mats = Array.isArray(s.cmp.mats) ? s.cmp.mats : [];
  return {
    life: {
      name: s.life.name ?? '',
      T: str(s.life.T),
      p0: str(s.life.p0),
      pts: lifePts.length
        ? lifePts.map((p) => ({ t: str(p && p.t), v: str(p && p.v) }))
        : EMPTY_LIFE.pts.map((p) => ({ ...p })),
    },
    rti: {
      name: s.rti.name ?? '',
      p0: str(s.rti.p0),
      temps: temps.length
        ? temps.map((g) => ({
            T: str(g && g.T),
            rows: ((g && g.rows) || []).map((r) => [str(r && r[0]), str(r && r[1])]),
          }))
        : EMPTY_RTI.temps.map((g) => ({ T: '', rows: g.rows.map((r) => [...r]) })),
    },
    cmp: {
      mats: mats.map((m) => ({
        name: String((m && m.name) ?? ''),
        rows: ((m && m.rows) || []).map((r) => ({ T: str(r && r.T), t: str(r && r.t) })),
      })),
      xMax: str(s.cmp.xMax ?? 160),
      xMin: str(s.cmp.xMin ?? 60),
      logY: s.cmp.logY !== false,
    },
  };
}

/** 存档结构校验（工具自己最清楚什么算合法） */
function isValidArchive(s) {
  return Boolean(
    s.life &&
      s.rti &&
      s.cmp &&
      Array.isArray(s.life.pts) &&
      Array.isArray(s.rti.temps) &&
      Array.isArray(s.cmp.mats)
  );
}

/** 三页示例数据 → 界面状态（数字转字符串） */
function demoState() {
  return {
    life: {
      name: DEMO_LIFE.name,
      T: str(DEMO_LIFE.T),
      p0: str(DEMO_LIFE.p0),
      pts: DEMO_LIFE.pts.map((p) => ({ t: str(p.t), v: str(p.v) })),
    },
    rti: {
      name: DEMO_RTI.name,
      p0: str(DEMO_RTI.p0),
      temps: DEMO_RTI.temps.map((g) => ({ T: str(g.T), rows: g.rows.map((r) => [str(r[0]), str(r[1])]) })),
    },
    cmp: {
      mats: DEMO_CMP.mats.map((m) => ({
        name: m.name,
        rows: m.rows.map((r) => ({ T: str(r.T), t: str(r.t) })),
      })),
      xMax: str(DEMO_CMP.xMax),
      xMin: str(DEMO_CMP.xMin),
      logY: DEMO_CMP.logY,
    },
  };
}

const PANES = [
  { id: 'life', label: '寿命推算' },
  { id: 'rti', label: 'RTI 耐热指数' },
  { id: 'cmp', label: '多材料对比' },
];

export default function RtiTool() {
  // 首次挂载时读一次存档；读到了就用存档，没读到就载入三页示例。
  //
  // ⚠ 这两行必须在**顶层**，不能把 useRestoredState 塞进 useState 的初始化器里：
  // 初始化器是在 mountState 内部被调用的，此时它往"正在挂载的 hook 链表"里再插一个
  // hook，链表就比后续渲染多出一节 —— 第二次渲染起整条链表错位，
  // useCallback / useEffect 会读到别的 hook 的状态，报出
  // "Cannot read properties of undefined (reading 'length')" 这种跟现场毫无关系的错。
  const saved = useRestoredState(TOOL_ID, STATE_VERSION, { isValid: isValidArchive });
  const [app, setApp] = useState(() => (saved ? applyIn(saved) : demoState()));

  const [pane, setPane] = useState('life');
  const [lifeOut, setLifeOut] = useState(EMPTY_OUT);
  const [rtiOut, setRtiOut] = useState(EMPTY_OUT);
  const [cmpDrawn, setCmpDrawn] = useState(false);
  // 「画对比图」的重画计数：drawn 已经为 true 时再点一次也要能刷新，
  // 所以除了布尔量还需要一个计数器。按钮在页头工具条上，状态只能由本组件持有。
  const [cmpTick, setCmpTick] = useState(0);

  // 骨架提供的三件公共设施：toast / 粘贴弹窗 / 自动保存
  const { toast, showToast } = useToolToast();
  const { paste, open: openPaste } = useToolPaste(showToast);
  const { savedAt } = useToolAutoSave(TOOL_ID, STATE_VERSION, toStorage(app));

  // 「已恢复上次的数据」是持久状态（用户得去点推算），所以放在骨架的提示行里，
  // 而不是 3.4 秒就消失的 toast —— 提示本身要说清"下一步做什么"。
  const [resumed, setResumed] = useState(Boolean(saved));

  useEffect(() => {
    if (saved) showToast('已恢复上次的数据（结果需重新推算）');
    // 只在挂载时说一次：saved 是"首次挂载读到的那一份"，之后不再变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 结果一旦落后于数据就标记出来 —— 免得"看着结果改数据"还以为结果是新的
  useEffect(() => {
    setLifeOut((o) => (o.result ? { ...o, stale: true } : o));
  }, [app.life]);
  useEffect(() => {
    setRtiOut((o) => (o.result ? { ...o, stale: true } : o));
  }, [app.rti]);

  const setLife = useCallback((fn) => setApp((s) => ({ ...s, life: typeof fn === 'function' ? fn(s.life) : fn })), []);
  const setRti = useCallback((fn) => setApp((s) => ({ ...s, rti: typeof fn === 'function' ? fn(s.rti) : fn })), []);
  const setCmp = useCallback((fn) => setApp((s) => ({ ...s, cmp: typeof fn === 'function' ? fn(s.cmp) : fn })), []);

  /* --- 页 1 --- */
  const calcLife = () => {
    const out = lifeCalc(app.life);
    setLifeOut(out.error ? { result: null, warns: [], error: out.error, stale: false } : { ...out, error: null, stale: false });
    if (out.result) setResumed(false);
  };

  /* --- 页 2 --- */
  const calcRti = () => {
    const out = rtiCalc(app.rti);
    setRtiOut(out.error ? { result: null, warns: [], error: out.error, stale: false } : { ...out, error: null, stale: false });
    if (out.result) setResumed(false);
  };

  /* --- 跨页：把结果送进页 3 --- */
  const upsertMat = (name, rows) =>
    setCmp((c) => {
      const i = c.mats.findIndex((m) => (m.name || '').trim() === name.trim());
      const mats = i >= 0 ? c.mats.map((m, j) => (j === i ? { ...m, rows } : m)) : [...c.mats, { name, rows }];
      return { ...c, mats };
    });

  const lifeToCmp = () => {
    const R = lifeOut.result;
    if (!R) return;
    if (R.T == null) {
      showToast('请先在页 1 填写老化温度 T，再加入对比');
      return;
    }
    const name = R.name.trim();
    upsertMat(name, [{ T: str(R.T), t: str(Math.round(R.t50 * 10) / 10) }]);
    setCmpDrawn(true);
    setPane('cmp');
    showToast(`已把「${name}」（T = ${R.T} °C）加入页 3 对比`);
  };

  const rtiToCmp = () => {
    const R = rtiOut.result;
    if (!R) return;
    const name = R.name.trim();
    upsertMat(name, R.perT.map((p) => ({ T: str(p.T), t: str(Math.round(p.t50 * 10) / 10) })));
    setCmpDrawn(true);
    setPane('cmp');
    showToast(`已把「${name}」的 ${R.perT.length} 个温度点 t₅₀ 加入页 3 对比`);
  };

  /* --- 粘贴导入（弹窗外壳由 ToolShell 渲染，这里只给解析规则） --- */
  const pasteLife = (rows) => {
    const pts = [];
    let skip = 0;
    rows.forEach((r) => {
      const t = toNum(r[0]);
      const v = toNum(r[1]);
      if (t == null || v == null || t <= 0) {
        skip += 1;
        return;
      }
      pts.push({ t: String(t), v: String(v) });
    });
    if (!pts.length) return null;
    setLife((s) => ({ ...s, pts }));
    setLifeOut(EMPTY_OUT());
    return `页 1 已导入 ${pts.length} 行（替换原数据${skip ? `，跳过 ${skip} 行` : ''}），请重新推算`;
  };

  const pasteRti = (rows) => {
    const byT = new Map();
    let skip = 0;
    rows.forEach((r) => {
      if (r.length < 3) {
        skip += 1;
        return;
      }
      const T = toNum(r[0]);
      const t = toNum(r[1]);
      const v = toNum(r[2]);
      if (T == null || t == null || v == null || t <= 0) {
        skip += 1;
        return;
      }
      if (!byT.has(T)) byT.set(T, []);
      byT.get(T).push([String(t), String(v)]);
    });
    if (!byT.size) return null;

    let added = 0;
    let updated = 0;
    let total = 0;
    setRti((s) => {
      const temps = s.temps.map((g) => ({ ...g, rows: g.rows.map((r) => [...r]) }));
      byT.forEach((rs, T) => {
        total += rs.length;
        rs.sort((a, b) => toNum(a[0]) - toNum(b[0]));
        const i = temps.findIndex((g) => toNum(g.T) === T);
        if (i >= 0) {
          temps[i] = { ...temps[i], rows: rs };
          updated += 1;
        } else {
          temps.push({ T: String(T), rows: rs });
          added += 1;
        }
      });
      return { ...s, temps };
    });
    setRtiOut(EMPTY_OUT());
    return `页 2 已导入 ${total} 行（新增 ${added} 个温度组、更新 ${updated} 个${skip ? `，跳过 ${skip} 行` : ''}），请重新推算`;
  };

  const pasteCmp = (rows) => {
    const byName = new Map();
    let skip = 0;
    rows.forEach((r) => {
      let name = '';
      let T;
      let t;
      if (r.length >= 3) {
        name = (r[0] || '').trim();
        T = toNum(r[1]);
        t = toNum(r[2]);
      } else {
        T = toNum(r[0]);
        t = toNum(r[1]);
      }
      if (T == null || t == null || t <= 0) {
        skip += 1;
        return;
      }
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push({ T: String(T), t: String(t) });
    });
    if (!byName.size) return null;

    let added = 0;
    let updated = 0;
    let total = 0;
    setCmp((c) => {
      const mats = c.mats.map((m) => ({ ...m, rows: m.rows.map((r) => ({ ...r })) }));
      byName.forEach((rs, name) => {
        total += rs.length;
        const matName = name || (mats.length ? (mats[0].name || '材料 A').trim() : '导入材料');
        const i = mats.findIndex((m) => (m.name || '').trim() === matName);
        if (i >= 0) {
          mats[i] = { ...mats[i], rows: rs };
          updated += 1;
        } else {
          mats.push({ name: matName, rows: rs });
          added += 1;
        }
      });
      return { ...c, mats };
    });
    setCmpDrawn(true);
    return `页 3 已导入 ${total} 行（新增 ${added} 个材料、更新 ${updated} 个${skip ? `，跳过 ${skip} 行` : ''}）`;
  };

  /* --- 全局：清空 / 示例 / 导出 / 导入 --- */
  const clearLife = () => {
    setLife({ ...EMPTY_LIFE, pts: EMPTY_LIFE.pts.map((p) => ({ ...p })) });
    setLifeOut(EMPTY_OUT());
  };
  const clearRti = () => {
    setRti({ ...EMPTY_RTI, temps: EMPTY_RTI.temps.map((g) => ({ T: '', rows: g.rows.map((r) => [...r]) })) });
    setRtiOut(EMPTY_OUT());
  };
  const clearCmp = () => {
    setCmp({ ...EMPTY_CMP, mats: [] });
    setCmpDrawn(false);
  };

  const demoLife = () => {
    setLife(demoState().life);
    setLifeOut(EMPTY_OUT());
  };
  const demoRti = () => {
    setRti(demoState().rti);
    setRtiOut(EMPTY_OUT());
  };
  const demoCmp = () => {
    setCmp(demoState().cmp);
    setCmpDrawn(true);
  };

  const exportData = () => {
    downloadJSON(`RTI工具数据-${stamp()}.json`, { v: STATE_VERSION, ...toStorage(app) });
    showToast('数据已导出为 JSON（含三页全部内容）');
  };

  const importData = async (input) => {
    try {
      const text = await readTextFile(input);
      if (!text) return;
      const s = JSON.parse(text);
      if (!s || !isValidArchive(s)) throw new Error('数据结构不匹配');
      setApp(applyIn(s));
      setLifeOut(EMPTY_OUT());
      setRtiOut(EMPTY_OUT());
      setCmpDrawn(false);
      setResumed(false);
      showToast('数据已从文件导入（结果需重新推算）');
    } catch (err) {
      showToast(`导入失败：${(err && err.message) || err}`);
    }
  };

  /* --- 当前页的主操作：钉在页头工具条上，跟着页签换 ---
     三页的主操作原本都躺在左列最底下，数据一多就得先滚到底才能点。
     放到工具条之后它常驻可见，"改一格 → 立刻重算"才成立。 */
  const PRIMARY_ACTIONS = {
    life: {
      label: '推算 t₅₀',
      title: '按 IEC 60216-1 终点时间法求 t₅₀',
      onClick: calcLife,
      primary: true,
    },
    rti: {
      label: '推算 RTI',
      title: '对 log₁₀ t₅₀ ~ 1/T 做回归，外推 RTI 与 95% 置信区间',
      onClick: calcRti,
      primary: true,
    },
    cmp: {
      label: '画对比图',
      title: '按当前数据与坐标范围重画图 3（图是按下这一刻的快照）',
      onClick: () => {
        setCmpDrawn(true);
        setCmpTick((t) => t + 1);
      },
      primary: true,
    },
  };

  /* --- 当前页拆成两半渲染：输入进左列（aside），结果进右列 ---
     拆开纯粹是版式需要（左列是窄而高的表单、右列是宽而高的图，并排才装得进一屏），
     两份实例共用同一份 state（app / out 都还由本组件单点持有），所以不会出现"两份数据"。 */
  const panePart = (part) => {
    switch (pane) {
      case 'life':
        return (
          <LifePane
            part={part}
            state={app.life}
            setState={setLife}
            out={lifeOut}
            onDemo={demoLife}
            onClear={clearLife}
            onPaste={() =>
              openPaste(
                '页 1 · 粘贴导入寿命数据',
                '每行两列：老化时长 t（h）, 特性值。支持从 Excel 直接复制（制表符分隔）。',
                pasteLife
              )
            }
            onCalc={calcLife}
            onToCmp={lifeToCmp}
          />
        );
      case 'rti':
        return (
          <RtiPane
            part={part}
            state={app.rti}
            setState={setRti}
            out={rtiOut}
            onDemo={demoRti}
            onClear={clearRti}
            onPaste={() =>
              openPaste(
                '页 2 · 粘贴导入多温度数据',
                '每行三列：老化温度 T（°C）, 老化时长 t（h）, 特性值。相同温度会自动归到一组（同名更新，新温度追加）。',
                pasteRti
              )
            }
            onCalc={calcRti}
            onToCmp={rtiToCmp}
          />
        );
      case 'cmp':
        return (
          <CmpPane
            part={part}
            state={app.cmp}
            setState={setCmp}
            drawn={cmpDrawn}
            tick={cmpTick}
            onDemo={demoCmp}
            onClear={clearCmp}
            onPaste={() =>
              openPaste(
                '页 3 · 粘贴导入对比数据',
                '每行三列：材料名, 温度, t₅₀；或两列：温度, t₅₀（填入第一个材料）。',
                pasteCmp
              )
            }
            onToast={showToast}
          />
        );
      default:
        return null;
    }
  };

  return (
    <ToolShell
      layout="inspector"
      aside={panePart('in')}
      tabs={PANES}
      activeTab={pane}
      onTabChange={setPane}
      saveText={saveLabel(savedAt)}
      hint={resumed ? '已从本机存档恢复上次的数据；结果是清空的，点对应页的「推算」按钮即可复现。' : null}
      hintTone="info"
      actions={[
        PRIMARY_ACTIONS[pane],
        { label: '导出数据', title: '把三页数据导出为 JSON 文件', onClick: exportData },
      ]}
      importAccept="application/json,.json"
      onImport={importData}
      importLabel="导入数据"
      toast={toast}
      paste={paste}
    >
      {panePart('out')}
    </ToolShell>
  );
}
