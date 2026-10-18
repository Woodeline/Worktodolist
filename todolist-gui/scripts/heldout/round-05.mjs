// 多动作单句「第五轮盲测」：句子是写完 splitMultiActions 之后新造的，没有照着一句改一行词。
//
// 这一轮要同时回答两个问题：
//   ① 该拆的拆开了吗（两件事 → 列清单，不硬猜一个）
//   ② 不该拆的有没有被乱拆（同一件事的两种说法、后半句其实没有动作）——
//      ②比①更要命：拆错会把一条本来明确的指令变成一次莫名其妙的反问。
import { parseIntent } from '../../src/lib/nlRules.js';

const TODAY = '2026-11-10'; // 周二

const mk = (id, title, extra = {}) => ({
  id, kind: 'task', raw: '', completed: false, completedAt: null,
  createdAt: '2026-11-01', priority: null, title, contexts: [], projects: [],
  dueDate: null, thresholdDate: null, starValue: null, extraTags: [], ...extra,
});

const TASKS = [
  mk('c1', '给供应商对账', { priority: 'B' }),
  mk('c2', '提交差旅报销单', { contexts: ['行政'] }),
  mk('c3', '约牙医洗牙', { contexts: ['健康'] }),
  mk('c4', '整理年终路演材料', { projects: ['融资'] }),
];

const MEMORY = { lastTaskId: 'c3', lastCandidates: ['c1', 'c4'] };

// must: 'multi' → 期望拆出这几件（子串顺序匹配）；'single' → 期望整句就是一个意图
const CORPUS = [
  { t: '把对账删了，然后把报销单标成高', must: 'multi', parts: ['delete', 'setPriority'] },
  { t: '完成洗牙，顺便给路演材料打个星', must: 'multi', parts: ['complete', 'star'] },
  { t: '把对账延到下周五，优先级顶格', must: 'multi', parts: ['postpone', 'setPriority'] },
  { t: '报销单归到 @行政，再打个 +Q4', must: 'multi', parts: ['addContext', 'addProject'] },
  { t: '删掉路演材料，另外加一条 下周三 补交发票', must: 'multi', parts: ['delete', 'add'] },
  { t: '对账完成了，把报销单也延到月底', must: 'multi', parts: ['complete', 'postpone'] },

  // —— 不该拆 ——
  { t: '回测这条要紧，顶格', must: 'single', intent: 'setPriority' },
  { t: '把对账删了，就是昨天说的那条', must: 'single', intent: 'delete' },
  { t: '完成洗牙，好的', must: 'single', intent: 'complete' },
  { t: '加一条 明天 交周报，别忘了', must: 'single', intent: 'add' },

  // —— 该保守的 ——
  { t: '要不要把对账删了再延到下周', must: 'unknown-or-clarify' },
  { t: '把对账删了把报销延了把洗牙也弄了', must: 'unknown-or-clarify' }, // 三件事连写无分隔
];

function judge(item, got) {
  if (item.must === 'unknown-or-clarify') {
    if (got.intent === 'unknown') return null;
    if (got.confidence === 'low' || got.needsConfirm) return null;
    return '该保守却直接执行了';
  }
  if (item.must === 'multi') {
    if (got.intent !== 'multi') return `没拆成 multi（得到 ${got.intent}）`;
    const got2 = (got.slots.items || []).map((i) => i.intent);
    const missing = item.parts.filter((p) => !got2.includes(p));
    if (missing.length) return `拆出的动作不全：缺 ${missing.join('/')}（得到 ${got2.join('/')}）`;
    return null;
  }
  if (got.intent === 'multi') return '不该拆却被拆成多动作';
  if (got.intent !== item.intent) return `意图判错（期望 ${item.intent}，得到 ${got.intent}）`;
  return null;
}

const rows = CORPUS.map((item) => {
  const got = parseIntent(item.t, { tasks: TASKS, today: TODAY, memory: MEMORY });
  return { item, got, err: judge(item, got) };
});

const groups = [
  ['该拆的', rows.filter((r) => r.item.must === 'multi')],
  ['不该拆的', rows.filter((r) => r.item.must === 'single')],
  ['该保守的', rows.filter((r) => r.item.must === 'unknown-or-clarify')],
];

console.log('\n第五轮：多动作单句拆分（正反两向都考）');
for (const [name, list] of groups) {
  const pass = list.filter((r) => !r.err).length;
  console.log(`  ${name}：${pass}/${list.length} = ${((pass / list.length) * 100).toFixed(0)}%`);
}
console.log('');
for (const r of rows.filter((x) => x.err)) {
  const items = r.got.intent === 'multi' ? ` [${r.got.slots.items.map((i) => i.intent).join('/')}]` : '';
  console.log(`  ✗「${r.item.t}」 → ${r.got.intent}/${r.got.confidence}${items}`);
  console.log(`      ${r.err}`);
}
