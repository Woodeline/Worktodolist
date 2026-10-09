// 工具路由的匹配层（纯函数）：把一句话落到 registry 里的某个工具上。
//
// 与"改数据"的意图识别完全相反的取舍：**打开工具没有副作用**（只切个页、
// 顶多预填一段参数），所以按代价不对称原则，它的门槛可以放宽 ——
// 认错了用户只是看到另一个工具，不像误删任务那样要改文件。
//
// 两条既有识别规则仍然必须遵守（否则会污染整套引擎）：
//   ① 命令必须出现在**句首窗口 8 字**内才算命令；
//   ② 不允许单字动词（裸 `查` 曾把「下周三去医院复查」判成 query）。
//
// 门槛分两档：
//   · 句首窗口里出现"打开类"触发词 → 阈值 0.22（弱匹配即可，用户已经明说要开）
//   · 没有触发词，只是句子长得像工具名 → 阈值 0.5（宁可不开，别乱开）
import { rankBySimilarity } from './textScore.js';

/** 句首窗口（与 nlRules 同口径）。 */
export const HEAD_WINDOW = 8;

// "打开类"触发词。全部是多字词：单字动词的命中率高得毫无意义。
export const TOOL_OPEN_TRIGGERS = [
  '打开',
  '开启',
  '调用',
  '用一下',
  '用下',
  '试用一下',
  '算一下',
  '算算',
  '换算',
  '转换',
  '转成',
  '转为',
  '格式化',
];

/** 剥掉触发词，返回 { triggered, rest }。只剥第一个命中项。 */
export function stripToolTrigger(text) {
  const t = String(text || '');
  for (const trig of TOOL_OPEN_TRIGGERS) {
    const i = t.indexOf(trig);
    if (i >= 0) return { triggered: trig, rest: `${t.slice(0, i)} ${t.slice(i + trig.length)}` };
  }
  return { triggered: null, rest: t };
}

function matchKey(tool) {
  return [tool.name, ...(tool.keywords || []), ...(tool.tags || [])].join(' ');
}

/**
 * 在一句话里找工具。
 * @param {string} text 用户原话
 * @param {Array<object>} tools registry 工具清单（只读）
 * @returns {{tool:object, score:number, query:string, triggered:string|null}|null}
 */
export function matchTool(text, tools) {
  const raw = String(text || '').trim();
  if (!raw || !Array.isArray(tools) || !tools.length) return null;

  const { triggered, rest } = stripToolTrigger(raw);
  const head = raw.slice(0, HEAD_WINDOW);
  // 触发词必须落在句首窗口内 —— 否则「加一条 用一下会议室」里的"用一下"
  // 只是任务内容，不该被当成"打开工具"。
  const inHead = Boolean(triggered) && head.includes(triggered);

  const query = rest.replace(/[\s?？。！!，,、；;：:]+/g, ' ').trim();
  if (!query) return null;

  const scored = rankBySimilarity(query, tools, {
    key: matchKey,
    minScore: inHead ? 0.22 : 0.5,
  });
  if (!scored.length) return null;

  return { tool: scored[0].item, score: scored[0].score, query, triggered: inHead ? triggered : null };
}
