// 自然语言识别覆盖率诊断 —— 量化「本地规则引擎到底听得懂多少」。
//
// 为什么要有这个脚本：改进识别能力之前，必须先知道现在错在哪、错多少、错成什么样。
// 否则"加几个同义词"就是瞎改，改完也没有证据说变好了。
//
// 语料分 5 个桶，桶的划分就是失败模式的分类：
//   A 显式命令    —— 现有设计目标，作为基线（这些必须全过）
//   B 隐式新增    —— 陈述句隐含"记一条"，句中没有动词（当前引擎的结构性盲区）
//   C 同义词口语  —— 有意图但用词不在词表里
//   D 模糊指代    —— 目标不唯一，正确行为是澄清而不是猜
//   E 时间边界    —— 时间表达本身（配合 add 观察标题是否被污染）
//
// 用法：node scripts/qa-nl-coverage.mjs [--verbose]
// 退出码：基线桶 A 有失败 → 1（A 属于已承诺能力，回退即失败）

import { parseIntent } from '../src/lib/nlRules.js';

const VERBOSE = process.argv.includes('--verbose');
const TODAY = '2026-10-01';

// 上下文取自工作区真实的 todo.txt（活跃任务 + 当前排序）
const mk = (id, title, extra = {}) => ({
  id, kind: 'task', raw: '', completed: false, completedAt: null,
  createdAt: '2026-09-20', priority: null, title, contexts: [], projects: [],
  dueDate: null, thresholdDate: null, starValue: null, extraTags: [], ...extra,
});

const TASKS = [
  mk('t1', '逾期任务：季报复核', { priority: 'A', dueDate: '2026-09-25' }),
  mk('t2', '今天到期：写第 10 周回测报告', { priority: 'B', dueDate: '2026-10-07' }),
  mk('t3', '有项目标签的任务', { priority: 'C', projects: ['回测'], dueDate: '2026-10-10' }),
  mk('t4', '星标任务', { priority: 'D', starValue: 1 }),
  mk('t5', '未来才开始的任务', { priority: 'E', thresholdDate: '2026-10-05' }),
  mk('t6', '普通任务没有任何标签', { priority: 'F' }),
  mk('t7', '收集箱任务：无任何标记的裸任务'),
  mk('t8', '带截止日的周线复盘', { priority: 'B', contexts: ['投资'], projects: ['复盘'], dueDate: '2026-10-04' }),
];

// ------------------------------------------------------------------ 语料
// expect: 期望意图；'unknown' 表示"听不懂是合理的"（不该硬猜）
// title:  add 时期望标题包含的词
// note:   对期望行为的补充说明
const CORPUS = [
  // ---- A 显式命令：现有设计目标，基线 ----
  { b: 'A', t: '加一条 明天 交周报', expect: 'add', title: '交周报' },
  { b: 'A', t: '添加任务 明天 交周报', expect: 'add', title: '交周报' },
  { b: 'A', t: '完成 回测报告', expect: 'complete', targetKind: 'keyword' },
  { b: 'A', t: '删除 星标任务', expect: 'delete', targetKind: 'keyword' },
  { b: 'A', t: '把 周线复盘 延到下周三', expect: 'postpone', targetKind: 'keyword' },
  { b: 'A', t: '标为高 周线复盘', expect: 'setPriority', targetKind: 'keyword' },
  { b: 'A', t: '星标 收集箱任务', expect: 'star', targetKind: 'keyword' },
  { b: 'A', t: '撤销', expect: 'undo' },
  { b: 'A', t: '有哪些任务', expect: 'query' },
  { b: 'A', t: '列出逾期', expect: 'query' },
  { b: 'A', t: '完成 第1条', expect: 'complete', targetKind: 'index' },

  // ---- B 隐式新增：陈述句里没有动词 ----
  { b: 'B', t: '后天上午9点有月报会议要开', expect: 'suggestAdd', title: '月报', note: '陈述句 = 记一条' },
  { b: 'B', t: '周四下午要交周报', expect: 'suggestAdd', title: '周报' },
  { b: 'B', t: '10月8日 体检', expect: 'suggestAdd', title: '体检' },
  { b: 'B', t: '下周一跟产品对齐需求', expect: 'suggestAdd', title: '对齐需求' },
  { b: 'B', t: '月底前把季度复盘写完', expect: 'suggestAdd', title: '复盘' },
  { b: 'B', t: '周五 和军信股份电话会', expect: 'suggestAdd', title: '电话会' },
  { b: 'B', t: '这周还要写第10周回测报告', expect: 'suggestAdd', title: '回测报告' },
  { b: 'B', t: '明天9:30 交材料', expect: 'suggestAdd', title: '交材料' },
  { b: 'B', t: '下午三点开会', expect: 'suggestAdd', title: '开会', note: '只有时刻没日期' },
  { b: 'B', t: '周末把移动硬盘测一下', expect: 'suggestAdd', title: '硬盘' },
  { b: 'B', t: '12月31日前完成年报', expect: 'suggestAdd', title: '年报' },
  { b: 'B', t: '下周要去趟银行', expect: 'suggestAdd', title: '银行' },

  // ---- C 同义词 / 口语 ----
  { b: 'C', t: '把 收 集箱任务 干掉', expect: 'delete', targetKind: 'keyword' },
  { b: 'C', t: '回测报告搞定了', expect: 'complete', targetKind: 'keyword' },
  { b: 'C', t: '周线复盘往后挪一周', expect: 'postpone', targetKind: 'keyword' },
  { b: 'C', t: '今天有啥要干的', expect: 'query' },
  { b: 'C', t: '给我看看今天干啥', expect: 'query' },
  { b: 'C', t: '还剩啥没做', expect: 'query' },
  { b: 'C', t: '这周要做的事', expect: 'query' },
  { b: 'C', t: '把 周线复盘 扔到 @投资', expect: 'addContext', targetKind: 'keyword' },
  { b: 'C', t: '给 周线复盘 贴个 +复盘', expect: 'addProject', targetKind: 'keyword' },
  { b: 'C', t: '回测这条要紧，顶格', expect: 'setPriority', targetKind: 'keyword' },
  { b: 'C', t: '记一下 明天 交周报', expect: 'add', title: '交周报' },

  // ---- D 模糊指代：正解是澄清，不是猜 ----
  { b: 'D', t: '把那个报告延到下周', expect: 'postpone', lowConfidence: true, note: '应回澄清列表' },
  { b: 'D', t: '完成 报告', expect: 'complete', lowConfidence: true, note: '命中多条应澄清' },
  { b: 'D', t: '删掉那个没用的', expect: 'delete', lowConfidence: true },
  { b: 'D', t: '把任务星标一下', expect: 'star', lowConfidence: true },

  // ---- E 时间表达边界 ----
  { b: 'E', t: '加一条 下下周五 交材料', expect: 'add', title: '交材料', due: '2026-10-16' },
  { b: 'E', t: '加一条 3天后 复审', expect: 'add', title: '复审', due: '2026-10-04' },
  { b: 'E', t: '加一条 月底 结账', expect: 'add', title: '结账', due: '2026-10-31' },
  { b: 'E', t: '加一条 12月31日 前完成年报', expect: 'add', title: '年报', due: '2026-12-31' },
  { b: 'E', t: '加一条 大后天 交报告', expect: 'add', title: '交报告', due: '2026-10-04' },
  { b: 'E', t: '加一条 下月初始 对账', expect: 'add', title: '对账', due: '2026-11-01' },
];

// ------------------------------------------------------------------ 失败模式分类
function failureMode(item, got) {
  if (got.intent === 'unknown' && item.expect !== 'unknown') return '听不懂（无任何触发词命中）';
  if (item.expect === 'unknown' && got.intent !== 'unknown') return '过度解读（本该拒绝却猜了）';
  if (got.intent !== item.expect) return `意图判错（期望 ${item.expect}）`;

  // 隐式新增只产出"建议"，必须带着能展示给用户的标题
  if (item.expect === 'suggestAdd') {
    if (!got.needsConfirm) return '建议新增却没有要求确认（会静默写文件）';
    if (!got.slots?.title) return '建议新增但标题为空';
  }
  if (item.targetKind && (got.target?.kind ?? null) !== item.targetKind) {
    return `目标类型错（期望 ${item.targetKind}，得到 ${got.target?.kind ?? 'null'}）`;
  }
  if (item.title) {
    const title = got.slots?.title ?? '';
    if (!title) return '标题为空';
    if (!title.includes(item.title)) return `标题不对（期望含「${item.title}」，得到「${title}」）`;
  }
  if (item.due && got.slots?.dueDate !== item.due) {
    return `日期不对（期望 ${item.due}，得到 ${got.slots?.dueDate ?? 'null'}）`;
  }
  // 模糊指代的正解可以是三种：降为低置信、要求二次确认、或给出相近候选
  if (item.lowConfidence) {
    const okLow = got.confidence === 'low';
    const okConfirm = Boolean(got.needsConfirm);
    const okNear = (got.nearMatches?.length ?? 0) > 0;
    if (!okLow && !okConfirm && !okNear) {
      return `该澄清却直接执行（confidence=${got.confidence}, 命中 ${got.matches.length} 条, 相近 ${got.nearMatches?.length ?? 0} 条）`;
    }
  }
  return null;
}

// ------------------------------------------------------------------ 跑
const rows = CORPUS.map((item) => {
  const got = parseIntent(item.t, { tasks: TASKS, today: TODAY });
  return { item, got, err: failureMode(item, got) };
});

const buckets = [...new Set(CORPUS.map((c) => c.b))].sort();
const LABEL = {
  A: 'A 显式命令（基线，必须全过）',
  B: 'B 隐式新增（句中没有动词）',
  C: 'C 同义词 / 口语',
  D: 'D 模糊指代（正解是澄清）',
  E: 'E 时间表达边界',
};

console.log('\n自然语言识别覆盖率诊断');
console.log(`上下文：${TASKS.length} 条活跃任务 · 今天 ${TODAY} · 语料 ${CORPUS.length} 条\n`);

const table = [];
for (const b of buckets) {
  const list = rows.filter((r) => r.item.b === b);
  const pass = list.filter((r) => !r.err).length;
  table.push({ b, pass, total: list.length });
}

console.log('─'.repeat(64));
console.log('桶'.padEnd(34) + '通过'.padStart(8) + '  覆盖率');
console.log('─'.repeat(64));
for (const { b, pass, total } of table) {
  const pct = ((pass / total) * 100).toFixed(0).padStart(3);
  const bar = '█'.repeat(Math.round((pass / total) * 16)).padEnd(16, '·');
  console.log(LABEL[b].padEnd(34) + `${pass}/${total}`.padStart(8) + `  ${pct}% ${bar}`);
}
const totalPass = table.reduce((n, r) => n + r.pass, 0);
console.log('─'.repeat(64));
console.log('合计'.padEnd(34) + `${totalPass}/${CORPUS.length}`.padStart(8) + `  ${((totalPass / CORPUS.length) * 100).toFixed(0)}%`);
console.log('');

// 失败明细：按失败模式聚合，这类聚合才是"下一步该改什么"的依据
const fails = rows.filter((r) => r.err);
const byMode = new Map();
for (const r of fails) {
  const key = r.err.replace(/（.*?）/g, '（…）');
  if (!byMode.has(key)) byMode.set(key, []);
  byMode.get(key).push(r);
}

console.log('失败模式分布：');
for (const [mode, list] of [...byMode.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(list.length).padStart(2)} 条  ${mode}`);
}
console.log('');

if (VERBOSE || fails.length) {
  console.log('失败明细：');
  for (const r of fails) {
    console.log(`  [${r.item.b}] 「${r.item.t}」`);
    console.log(`        → 实际 intent=${r.got.intent} conf=${r.got.confidence}` +
      ` target=${r.got.target ? r.got.target.kind + ':' + r.got.target.value : 'null'}` +
      (r.got.slots?.title ? ` title=「${r.got.slots.title}」` : '') +
      (r.got.slots?.dueDate ? ` due=${r.got.slots.dueDate}` : ''));
    console.log(`        原因：${r.err}${r.item.note ? ' · ' + r.item.note : ''}`);
  }
  console.log('');
}

// 基线桶 A 不允许有失败
const aFail = rows.filter((r) => r.item.b === 'A' && r.err).length;
if (aFail) {
  console.error(`[nl-coverage] 基线桶 A 出现 ${aFail} 条失败 —— 已承诺能力回退，不通过。`);
  process.exit(1);
}
console.log('[nl-coverage] 基线桶 A 全过。');
