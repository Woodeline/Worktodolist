// 长尾识别「第三轮压测」：完全新写的一批句子，用来给改进幅度定一个不掺水的数。
//
// 前两轮已经变成考卷（词表是照着它们补的）。这一轮动手前**没有**先看引擎行为，
// 并且故意放进三类引擎结构性做不到的东西（多动作单句、同音错别字、农历节日），
// 让"还剩多少上限"这件事有数字可依。
import { parseIntent } from '../../src/lib/nlRules.js';

const TODAY = '2026-10-15'; // 周四

const mk = (id, title, extra = {}) => ({
  id, kind: 'task', raw: '', completed: false, completedAt: null,
  createdAt: '2026-10-01', priority: null, title, contexts: [], projects: [],
  dueDate: null, thresholdDate: null, starValue: null, extraTags: [], ...extra,
});

const TASKS = [
  mk('a1', '给客户回电话', { priority: 'B' }),
  mk('a2', '整理十月报销单据', { dueDate: '2026-10-20' }),
  mk('a3', '和医生约复诊', { contexts: ['健康'] }),
  mk('a4', '写季度总结初稿', { projects: ['汇报'] }),
  mk('a5', '续费服务器', { starValue: 1 }),
];

const MEMORY = { lastTaskId: 'a2', lastCandidates: ['a1', 'a4'] };

// ok: 'must' = 应当认出来；'should-refuse' = 正确行为是听不懂/走澄清（不算错）
const CORPUS = [
  // —— 应当认出来（与前两轮用词不同的新说法）——
  { t: '电话那条帮我回了', must: 'complete' },
  { t: '报销 搞定一下', must: 'complete' },
  { t: '复诊 挪到 下周一', must: 'postpone' },
  { t: '把季度总结 优先级降到最低', must: 'setPriority' },
  { t: '服务器续费 归到 @健康', must: 'addContext' },
  { t: '周六 带孩子去打疫苗', must: 'suggestAdd', title: '疫苗' },
  { t: '17号 交房租', must: 'suggestAdd', title: '房租', verbless: true },
  { t: '记一条 10月25日 参加同学婚礼', must: 'add', title: '婚礼' },
  { t: '过三天 复查一下血压', must: 'suggestAdd', title: '血压' },
  { t: '它先标为高', must: 'setPriority' },
  { t: '这个不做了', must: 'delete' },
  { t: '前面第二个 完成了', must: 'complete' },
  { t: '现在手上还有几件事', must: 'query' },
  { t: '这周安排', must: 'query' },
  { t: '哪些事拖到期了', must: 'query' },
  { t: '把 a1 删掉', must: 'delete' },

  // —— 正确行为是"不硬猜"：算通过 ——
  { t: '删掉给客户回电话并把季度总结延到下周三', must: 'unknown-or-clarify' },
  { t: '记的十月报销但结', must: 'unknown-or-clarify' }, // 同音错别字
  { t: '中秋前 买月饼', must: 'unknown-or-clarify' }, // 农历节日
  { t: '你觉得复诊要不要提前', must: 'unknown-or-clarify' }, // 征询意见
];

function judge(item, got) {
  const want = item.must;
  if (want === 'unknown-or-clarify') {
    if (got.intent === 'unknown') return null;
    if (got.confidence === 'low' || got.needsConfirm) return null; // 拿不准并反问 = 正确
    return '该保守却直接执行了';
  }
  if (got.intent === 'unknown') return '听不懂';
  if (got.intent !== want) return `意图判错（期望 ${want}，得到 ${got.intent}）`;
  if (item.title && !(got.slots?.title || '').includes(item.title)) return `标题不对（「${got.slots?.title ?? ''}」）`;
  if (item.due && got.slots?.dueDate !== item.due) return `日期不对（期望 ${item.due}，得到 ${got.slots?.dueDate ?? 'null'}）`;
  return null;
}

const rows = CORPUS.map((item) => {
  const got = parseIntent(item.t, { tasks: TASKS, today: TODAY, memory: MEMORY });
  return { item, got, err: judge(item, got) };
});

const must = rows.filter((r) => r.item.must !== 'unknown-or-clarify');
const guard = rows.filter((r) => r.item.must === 'unknown-or-clarify');
const mustPass = must.filter((r) => !r.err).length;
const guardPass = guard.filter((r) => !r.err).length;

console.log(`\n第三轮压测（全新生成，未参与调参）`);
console.log(`  该认出来的：${mustPass}/${must.length} = ${((mustPass / must.length) * 100).toFixed(0)}%`);
console.log(`  该保守的  ：${guardPass}/${guard.length} = ${((guardPass / guard.length) * 100).toFixed(0)}%`);
console.log('');
for (const r of rows.filter((x) => x.err)) {
  console.log(`  ✗「${r.item.t}」 → ${r.got.intent}/${r.got.confidence}${r.got.slots?.title ? ` title=「${r.got.slots.title}」` : ''}${r.got.slots?.dueDate ? ` due=${r.got.slots.dueDate}` : ''}`);
  console.log(`      ${r.err}`);
}
