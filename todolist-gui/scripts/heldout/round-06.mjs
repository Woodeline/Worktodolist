// 第六轮盲测：专考「无分隔连写的多动作」（"把A删了把B标成高"，没有逗号也没有"然后"）。
//
// 这一轮的判据比分隔词那条更弱，所以引擎加了 stricter 门槛：每个子动作的目标
// 都必须在当前列表里锁得到，否则不计入。正反两向都要考：
//   ① 该拆的连写句拆开了吗
//   ② 「把」字重复但其实只有一件事 / 目标根本不存在 → 有没有忍住不拆
//      （拆错会把一条明确指令变成一次莫名其妙的反问）
import { parseIntent } from '../../src/lib/nlRules.js';

const TODAY = '2026-12-03'; // 周四

const mk = (id, title, extra = {}) => ({
  id, kind: 'task', raw: '', completed: false, completedAt: null,
  createdAt: '2026-11-20', priority: null, title, contexts: [], projects: [],
  dueDate: null, thresholdDate: null, starValue: null, extraTags: [], ...extra,
});

const TASKS = [
  mk('d1', '给客户回电话'),
  mk('d2', '整理报销凭证', { contexts: ['财务'] }),
  mk('d3', '预约体检', { dueDate: '2026-12-01' }),
  mk('d4', '更新部署文档'),
  mk('d5', '归档上季度邮件'),
];

const MEMORY = { lastTaskId: 'd3', lastCandidates: ['d1', 'd4'] };

// must: 'multi' → 期望拆出这些子动作；'single' → 期望整句一个意图；
// 'unknown-or-clarify' → 期望不直接动手
const CORPUS = [
  // —— 该拆（无分隔连写）——
  { t: '把预约体检改到周五把更新部署文档标成最高', must: 'multi', parts: ['postpone', 'setPriority'] },
  { t: '把归档上季度邮件删了把给客户回电话完成掉', must: 'multi', parts: ['delete', 'complete'] },
  { t: '把整理报销凭证归到@财务把预约体检打个星', must: 'multi', parts: ['addContext', 'star'] },
  { t: '把给客户回电话延到明天再把更新部署文档设为A', must: 'multi', parts: ['postpone', 'setPriority'] },
  { t: '把整理报销凭证完成了把预约体检挪到下周一', must: 'multi', parts: ['complete', 'postpone'] },
  { t: '把更新部署文档删了把归档上季度邮件也删了', must: 'multi', parts: ['delete', 'delete'] },

  // —— 不该拆 ——
  { t: '把伞收了把门禁卡带了', must: 'single', intent: 'unknown' },
  { t: '把预约体检改到周五，好的', must: 'single', intent: 'postpone' },
  { t: '把给客户回电话和整理报销凭证都完成掉', must: 'single', intent: 'complete' },
  { t: '把更新部署文档标成高要紧得很', must: 'single', intent: 'setPriority' },
  { t: '把整理报销凭证删了就是把给客户回电话那条删了', must: 'single', intent: 'delete' },

  // —— 该保守的 ——
  { t: '把鸡排饭删了把牛排延到下周', must: 'unknown-or-clarify' },
  { t: '把yuyue体检改到周五把文档删了', must: 'unknown-or-clarify' },
  { t: '要不要把预约体检改到周五把部署文档删了', must: 'unknown-or-clarify' },
];

function judge(item, got) {
  if (item.must === 'unknown-or-clarify') {
    if (got.intent === 'unknown') return null;
    if (got.intent === 'multi') return null; // 列清单等确认也算保守
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

const rows = CORPUS.map((item) => ({
  item,
  got: parseIntent(item.t, { tasks: TASKS, today: TODAY, memory: MEMORY }),
}));
rows.forEach((r) => {
  r.err = judge(r.item, r.got);
});

const groups = [
  ['该拆的（无分隔连写）', rows.filter((r) => r.item.must === 'multi')],
  ['不该拆的', rows.filter((r) => r.item.must === 'single')],
  ['该保守的', rows.filter((r) => r.item.must === 'unknown-or-clarify')],
];

console.log('\n第六轮盲测：无分隔连写的多动作（本轮写于「把」字复现切句之后）');
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
