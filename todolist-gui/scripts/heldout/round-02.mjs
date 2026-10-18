// 长尾识别「第二轮压测」：换一批全新的说法，检验第一轮那批补丁是不是真的泛化。
//
// 为什么要有第二轮：qa-nl-heldout 从 36% 打到 100% 之后，它就变成了一份
// "对着规则写的考卷" —— 词表是照着这些句子补的。只有拿**没参与过调参**的
// 新句子再测一次，才能区分"引擎变强了"和"考卷被背下来了"。
//
// 期望值一律按人类真实意图写。听不懂就记 unknown；判错就记判错，不做宽容。
import { parseIntent } from '../../src/lib/nlRules.js';

const VERBOSE = process.argv.includes('--verbose');
const TODAY = '2026-10-01'; // 周四

const mk = (id, title, extra = {}) => ({
  id, kind: 'task', raw: '', completed: false, completedAt: null,
  createdAt: '2026-09-20', priority: null, title, contexts: [], projects: [],
  dueDate: null, thresholdDate: null, starValue: null, extraTags: [], ...extra,
});

const TASKS = [
  mk('t1', '逾期任务：季报复核', { priority: 'A', dueDate: '2026-09-25' }),
  mk('t2', '今天到期：写第 10 周回测报告', { priority: 'B', dueDate: '2026-10-07' }),
  mk('t3', '有项目标签的任务', { projects: ['回测'], dueDate: '2026-10-10' }),
  mk('t4', '星标任务', { starValue: 1 }),
  mk('t5', '带截止日的周线复盘', { contexts: ['投资'], projects: ['复盘'], dueDate: '2026-10-04' }),
];

const MEMORY = { lastTaskId: 't5', lastCandidates: ['t1', 't5'] };

const CORPUS = [
  // 长尾动词（第二轮新写法）
  { t: '撤掉 周线复盘', expect: 'delete' },
  { t: '周线复盘 不用做了', expect: 'delete' },
  { t: '回测报告 交掉了', expect: 'complete' },
  { t: '记一条 明天 交材料', expect: 'add', title: '交材料' },
  { t: '帮我把 收集箱 那条清了', expect: 'delete' },
  { t: '周线复盘 延后两天', expect: 'postpone' },
  { t: '把 回测报告 的优先级调成低', expect: 'setPriority' },
  { t: '周线复盘 归入 @投资', expect: 'addContext' },
  { t: '给 周线复盘 加个 +复盘', expect: 'addProject' },
  { t: '周线复盘 设为最高优先级', expect: 'setPriority' },

  // 回指（新写法）
  { t: '上一条 删掉', expect: 'delete', kind: 'ref' },
  { t: '刚才那个改成高优先级', expect: 'setPriority', kind: 'ref' },
  { t: '这个延到 下周三', expect: 'postpone', kind: 'ref' },
  { t: '它标为高', expect: 'setPriority', kind: 'ref' },

  // 时间（新写法）
  { t: '加一条 两天以后 复审', expect: 'add', due: '2026-10-03' },
  { t: '加一条 周三之前 交周报', expect: 'add', due: '2026-10-07' },
  { t: '加一条 本月底之前 结账', expect: 'add', due: '2026-10-31' },
  { t: '加一条 下周三上午 开会', expect: 'add', due: '2026-10-07', title: '开会' },
  { t: '加一条 国庆后 体检', expect: 'add', due: '2026-10-08', title: '体检' },
  { t: '加一条 下个月初 对账', expect: 'add', due: '2026-11-01' },

  // 结构与查询（新写法）
  { t: '周线复盘 这个任务删掉', expect: 'delete' },
  { t: '今日安排', expect: 'query' },
  { t: '还有什么没搞', expect: 'query' },
  { t: '看看这周要交什么', expect: 'query' },

  // 该拒的
  { t: '明天天气怎么样', expect: 'unknown' },
  { t: '我刚吃完早饭', expect: 'unknown' },
  { t: '这个方案还行', expect: 'unknown' },
  { t: '哈哈哈', expect: 'unknown' },
];

function judge(item, got) {
  if (got.intent !== item.expect) {
    if (item.expect === 'unknown') return '过度解读';
    if (got.intent === 'unknown') return '听不懂';
    return `意图判错（期望 ${item.expect}，得到 ${got.intent}）`;
  }
  if (item.kind && got.target?.kind !== item.kind) return `目标类型错（期望 ${item.kind}，得到 ${got.target?.kind ?? 'null'}）`;
  if (item.kind === 'ref' && !(got.matches?.length > 0)) return '回指没解析出目标';
  if (item.title && !(got.slots?.title || '').includes(item.title)) return `标题不对（得到「${got.slots?.title ?? ''}」）`;
  if (item.due && got.slots?.dueDate !== item.due) return `日期不对（期望 ${item.due}，得到 ${got.slots?.dueDate ?? 'null'}）`;
  return null;
}

const rows = CORPUS.map((item) => {
  const got = parseIntent(item.t, { tasks: TASKS, today: TODAY, memory: MEMORY });
  return { item, got, err: judge(item, got) };
});

const pass = rows.filter((r) => !r.err).length;
console.log(`\n长尾识别第二轮压测：${pass}/${CORPUS.length} = ${((pass / CORPUS.length) * 100).toFixed(1)}%\n`);

const fails = rows.filter((r) => r.err);
const byMode = new Map();
for (const r of fails) byMode.set(r.err.replace(/（.*）/, '（…）'), (byMode.get(r.err.replace(/（.*）/, '（…）')) || 0) + 1);
console.log('失败模式分布：');
for (const [mode, n] of [...byMode.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(2)} 条  ${mode}`);
console.log('');

if (VERBOSE || fails.length) {
  console.log('失败明细：');
  for (const r of fails) {
    console.log(`  「${r.item.t}」 → intent=${r.got.intent} conf=${r.got.confidence}` +
      ` target=${r.got.target ? r.got.target.kind + ':' + r.got.target.value : 'null'}` +
      (r.got.slots?.title ? ` title=「${r.got.slots.title}」` : '') +
      (r.got.slots?.dueDate ? ` due=${r.got.slots.dueDate}` : ''));
    console.log(`      ${r.err}`);
  }
  console.log('');
}
