// RTI 计算工具 —— 工具集里的第一个小工具。
//
// 由一份独立的单文件网页（RTI计算工具.html）移植而来，改动只发生在两侧：
//   · 视觉层：换成 todolist 的令牌体系（系统灰/系统蓝/发丝线/小方角），见 index.css 8.1
//   · 数据层：算法与画图抽到 lib/rti/（纯函数，可单测；数值与 Python 基准对拍一致）
// 功能与交互一律保留：三个页面、粘贴导入、PNG/CSV/JSON 导出、本机自动保存、
// 画布上的悬停读值 / 点击固定 / 右键取消。
//
// 关于"存字符串还是存数字"：表单里存的是**用户正在输入的字符串**，
// 解析统一在 lib/rti/calc.js 的 toNum 里做，落盘时再统一转回数字。
// 这样既能正常输入 "76.4" 这种小数，导出的 JSON 又保持干净的数字形。
import { useCallback, useEffect, useRef, useState } from 'react';
import { toNum, lifeCalc, rtiCalc } from '../../lib/rti/calc.js';
import { DEMO_CMP, DEMO_LIFE, DEMO_RTI, EMPTY_CMP, EMPTY_LIFE, EMPTY_RTI } from '../../lib/rti/demo.js';
import { downloadJSON, readTextFile, stamp } from '../../lib/rti/files.js';
import LifePane from './rti/LifePane.jsx';
import RtiPane from './rti/RtiPane.jsx';
import CmpPane from './rti/CmpPane.jsx';

// 本机自动保存。键名带应用前缀，避免和别的页面抢 localStorage。
const SAVE_KEY = 'todolist.tool.rti.v1';

const str = (x) => (x == null ? '' : String(x));
const EMPTY_OUT = () => ({ result: null, warns: [], error: null, stale: false });

/* ---------------------------------------------------------------------------
   落盘 / 回读
   ------------------------------------------------------------------------- */

/** 界面状态 → 存档状态（把输入字符串收敛成数字或 null） */
function toStorage(app) {
  return {
    v: 1,
    savedAt: Date.now(),
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

function readStorage() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || s.v !== 1) return null;
    if (!s.life || !s.rti || !s.cmp) return null;
    if (!Array.isArray(s.life.pts) || !Array.isArray(s.rti.temps) || !Array.isArray(s.cmp.mats)) return null;
    return applyIn(s);
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
   粘贴导入：多分隔符容错（Excel 复制出来是 tab，手写常常是逗号/空格）
   ------------------------------------------------------------------------- */

function pasteRows(text) {
  const rows = [];
  text.split(/\r\n|\n|\r/).forEach((line) => {
    if (!line.trim()) return;
    let cells = line
      .trim()
      .split(/\t|,|，|;|；/)
      .map((c) => c.trim())
      .filter((c) => c !== '');
    if (cells.length === 1) cells = cells[0].split(/\s+/).filter((c) => c !== '');
    if (cells.length) rows.push(cells);
  });
  return rows;
}

const PANES = [
  { id: 'life', label: '寿命推算' },
  { id: 'rti', label: 'RTI 耐热指数' },
  { id: 'cmp', label: '多材料对比' },
];

export default function RtiTool() {
  // 首次挂载时读一次存档；读到了就用存档，没读到就载入三页示例。
  // （初始化函数可能被调用两次，但只做读取与赋值，是幂等的。）
  const restored = useRef(false);
  const [app, setApp] = useState(() => {
    const saved = readStorage();
    if (saved) {
      restored.current = true;
      return saved;
    }
    return demoState();
  });

  const [pane, setPane] = useState('life');
  const [lifeOut, setLifeOut] = useState(EMPTY_OUT);
  const [rtiOut, setRtiOut] = useState(EMPTY_OUT);
  const [cmpDrawn, setCmpDrawn] = useState(false);

  const [paste, setPaste] = useState(null); // { title, hint, apply }
  const [pasteText, setPasteText] = useState('');
  const [pasteHint, setPasteHint] = useState('');
  const [toast, setToast] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const fileRef = useRef(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3400);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useEffect(() => {
    if (restored.current) showToast('已恢复上次的数据（结果需重新推算）');
  }, [showToast]);

  // 自动保存：改动停下 400ms 后落盘，避免每敲一个字都写一次
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(toStorage(app)));
        setSavedAt(Date.now());
      } catch {
        /* localStorage 不可用（隐私模式等）→ 静默降级：导出/导入 JSON 仍然可用 */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [app]);

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
  };

  /* --- 页 2 --- */
  const calcRti = () => {
    const out = rtiCalc(app.rti);
    setRtiOut(out.error ? { result: null, warns: [], error: out.error, stale: false } : { ...out, error: null, stale: false });
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

  /* --- 粘贴导入 --- */
  const openPaste = (title, hint, apply) => {
    setPaste({ title, hint, apply });
    setPasteText('');
    setPasteHint(hint);
  };
  const closePaste = () => {
    setPaste(null);
    setPasteHint('');
  };

  useEffect(() => {
    if (!paste) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closePaste();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paste]);

  const applyPaste = () => {
    if (!paste) return;
    const rows = pasteRows(pasteText);
    if (!rows.length) {
      setPasteHint('没有解析到有效内容，请粘贴后重试');
      return;
    }
    const res = paste.apply(rows);
    if (res == null) {
      setPasteHint('未能解析出有效数据行，请检查列数与数值格式');
      return;
    }
    closePaste();
    showToast(res);
  };

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
    downloadJSON(`RTI工具数据-${stamp()}.json`, toStorage(app));
    showToast('数据已导出为 JSON（含三页全部内容）');
  };

  const importData = async (input) => {
    try {
      const text = await readTextFile(input);
      if (!text) return;
      const s = JSON.parse(text);
      if (!s || s.v !== 1 || !s.life || !s.rti || !s.cmp) throw new Error('数据结构不匹配');
      setApp(applyIn(s));
      setLifeOut(EMPTY_OUT());
      setRtiOut(EMPTY_OUT());
      setCmpDrawn(false);
      showToast('数据已从文件导入（结果需重新推算）');
    } catch (err) {
      showToast(`导入失败：${(err && err.message) || err}`);
    }
  };

  const savedLabel = savedAt
    ? `已自动保存 ${String(new Date(savedAt).getHours()).padStart(2, '0')}:${String(new Date(savedAt).getMinutes()).padStart(2, '0')}`
    : '自动保存已开启';

  return (
    <div className="rti">
      <div className="rti-bar">
        <div className="rti-tabs">
          {PANES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={'rti-tab' + (pane === p.id ? ' is-on' : '')}
              onClick={() => setPane(p.id)}
              aria-current={pane === p.id ? 'true' : undefined}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="rti-toolbar-spring" />
        <span className="rti-save">{savedLabel}</span>
        <button type="button" className="btn btn-sm" onClick={exportData} title="把三页数据导出为 JSON 文件">
          导出数据
        </button>
        <button type="button" className="btn btn-sm" onClick={() => fileRef.current && fileRef.current.click()}>
          导入数据
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => importData(e.target)}
        />
      </div>

      {pane === 'life' && (
        <LifePane
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
      )}
      {pane === 'rti' && (
        <RtiPane
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
      )}
      {pane === 'cmp' && (
        <CmpPane
          state={app.cmp}
          setState={setCmp}
          drawn={cmpDrawn}
          onDrawn={setCmpDrawn}
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
      )}

      {paste && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && closePaste()}>
          <div className="modal-card">
            <h3>{paste.title}</h3>
            <textarea
              className="paste-text"
              spellCheck={false}
              value={pasteText}
              autoFocus
              onChange={(e) => {
                setPasteText(e.target.value);
                setPasteHint(paste.hint);
              }}
            />
            <p className="paste-hint">{pasteHint}</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={closePaste}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={applyPaste}>
                解析并填充
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast tool-toast">
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
