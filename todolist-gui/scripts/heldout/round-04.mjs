// 长尾识别「第四轮盲测」：动手写这一轮之前没有回看引擎行为，也没有针对它补过任何词。
//
// 为什么要再来一轮：前三轮的最后一轮已经边测边改过（疑问句抢占、复合动词、逾期 scope），
// 它同样变成了考卷。识别率要可信，必须有一批"改完之后才第一次写出来"的句子。
// 这一轮的分数才是当前引擎真实的泛化能力；下面的 100% 只说明"这一批我猜中了"，
// 不说明词表覆盖了一切。
import { parseIntent } from '../../src/lib/nlRules.js';

const TODAY = '2026-11-03'; // 周二

const mk = (id, title, extra = {}) => ({
  id, kind: 'task', raw: '', completed: false, completedAt: null,
  createdAt: '2026-10-20', priority: null, title, contexts: [], projects: [],
  dueDate: null, thresholdDate: null, starValue: null, extraTags: [], ...extra,
});

const TASKS = [
  mk('b1', '给供应商对账', { priority: 'A', dueDate: '2026-10-28' }),
  mk('b2', '提交差旅报销', { priority: 'B', contexts: ['行政'] }),
  mk('b3', '约牙医洗牙', { contexts: ['健康'], dueDate: '2026-11-10' }),
  mk('b4', '整理年终路演材料', { projects: ['融资'] }),
  mk('b5', '换季给车里换胎', { starValue: 1 }),
];

const MEMORY = { lastTaskId: 'b3', lastCandidates: ['b1', 'b4'] };

const CORPUS = [
  // —— 应当认出来 ——
  { t: '对账那笔早过了日子了，先放最前面', must: 'setPriority' },
  { t: '差旅报销我报过了', must: 'complete' },
  { t: '洗牙不用去了', must: 'delete' },
  { t: '把 对账 挪到本周五', must: 'postpone', due: '2026-11-06' },
  { t: '三天内 写完述职材料', must: 'suggestAdd', title: '述职', due: '2026-11-06' },
  { t: '下礼拜五之前 交年度述职', must: 'suggestAdd', title: '述职' },
  { t: '帮我把 洗牙 标成要紧的', must: 'setPriority' },
  { t: '车胎那条打个星', must: 'star' },
  { t: '行政里还有啥没办', must: 'query' },
  { t: '看看 overdue 的', must: 'query' },
  { t: '上面第一个 撤了', must: 'delete' },
  { t: '把 它 归到 @融资', must: 'addContext' },
  { t: '记一笔 11月20日 交物业费', must: 'add', title: '物业费' },
  { t: '月底最后一天 盘点库存', must: 'suggestAdd', title: '盘点库存' },
  { t: '大后天上午 面试候选人', must: 'suggestAdd', title: '面试' },
  { t: '这单子作废', must: 'delete' },
  { t: '有什么是要下周做的', must: 'query' },

  // —— 正确行为是不硬猜 ——
  { t: '把对账删了顺便把报销延到下个月', must: 'unknown-or-clarify' }, // 单句多动作
  { t: '路演材料弄它个三天', must: 'unknown-or-clarify' }, // 耗时估计 ≠ 截止日：没有期限就不该落一条
  { t: '帮我查下洗牙那个宇浩医生有没有空', must: 'unknown-or-clarify' }, // 域外问题
  { t: '今天天气还不错', must: 'unknown-or-clarify' }, // 闲聊
  { t: '把 不知道是什么的东西 完成', must: 'unknown-or-clarify' }, // 目标不存在
];

function judge(item, got) {
  const want = item.must;
  if (want === 'unknown-or-clarify') {
    if (got.intent === 'unknown') return null;
    if (got.confidence === 'low' || got.needsConfirm) return null;
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

console.log(`\n第四轮盲测（本轮写于词表改动之后，未参与调参）`);
console.log(`  该认出来的：${mustPass}/${must.length} = ${((mustPass / must.length) * 100).toFixed(0)}%`);
console.log(`  该保守的  ：${guardPass}/${guard.length} = ${((guardPass / guard.length) * 100).toFixed(0)}%`);
console.log('');
for (const r of rows.filter((x) => x.err)) {
  console.log(`  ✗「${r.item.t}」 → ${r.got.intent}/${r.got.confidence}${r.got.target ? ` target=${r.got.target.kind}:${r.got.target.value}` : ''}${r.got.slots?.title ? ` title=「${r.got.slots.title}」` : ''}${r.got.slots?.dueDate ? ` due=${r.got.slots.dueDate}` : ''}`);
  console.log(`      ${r.err}`);
}
