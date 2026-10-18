// 自然语言识别「长尾考卷」—— 专测当前词表没有覆盖的真实说法。
//
// 为什么还要再建一份语料：qa-nl-coverage.mjs 是**对着规则写出来的考卷**，
// 它满分只能证明"规则没写坏"，证明不了"规则够宽"。识别率的天花板由词表决定，
// 而词表里的词当然都能命中自己 —— 所以那份 100% 没有信息量。
//
// 这份语料的每条说法都在动手前**确认过当前词表里没有**（F~J 桶），
// 期望值按"人类用户的真实意图"写，不看引擎现在会怎么判。
//
// 桶划分：
//   F 长尾动词     —— 有明确动作，但用词不在触发词表里
//   G 结构变体     —— 命令包在「把…给我…」「…这个任务」这类句式里
//   H 上下文指代   —— 目标靠代词/回指给出，需要会话记忆才能定位
//   I 查询长尾     —— 问句但没问"任务"这个词
//   J 时间表达长尾 —— 时间写法超出 extractDate 现有分支
//   K 该拒的       —— 期望 unknown（测过度解读，宁缺毋滥）
//
// 用法：node scripts/qa-nl-heldout.mjs [--verbose]
// 退出码：恒为 0（这是能力探针，不是回归门；回归门看 npm test 与 qa-nl-coverage）

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
  mk('t3', '有项目标签的任务', { priority: 'C', projects: ['回测'], dueDate: '2026-10-10' }),
  mk('t4', '星标任务', { priority: 'D', starValue: 1 }),
  mk('t5', '未来才开始的任务', { priority: 'E', thresholdDate: '2026-10-05' }),
  mk('t6', '普通任务没有任何标签', { priority: 'F' }),
  mk('t7', '收集箱任务：无任何标记的裸任务'),
  mk('t8', '带截止日的周线复盘', { priority: 'B', contexts: ['投资'], projects: ['复盘'], dueDate: '2026-10-04' }),
];

// memory：H 桶需要的会话回指态（上一轮刚操作过谁 / 上一份候选列表）。
// 现有引擎完全没有这一层，所以 H 桶在改造前必然全挂 —— 这正是它要度量的东西。
const MEMORY = {
  lastTaskId: 't2',
  lastCandidates: ['t1', 't8'],
};

const CORPUS = [
  // ---- F 长尾动词 ----
  { b: 'F', t: '删了 回测报告', expect: 'delete', targetKind: 'keyword' },
  { b: 'F', t: '回测报告这条不要了', expect: 'delete', targetKind: 'keyword' },
  { b: 'F', t: '把 周线复盘 撤了', expect: 'delete', targetKind: 'keyword' },
  { b: 'F', t: '季报复核 办了', expect: 'complete', targetKind: 'keyword' },
  { b: 'F', t: '回测报告 结了', expect: 'complete', targetKind: 'keyword' },
  { b: 'F', t: '把 星标任务 干完', expect: 'complete', targetKind: 'keyword' },
  { b: 'F', t: '周线复盘 延一延', expect: 'postpone', targetKind: 'keyword' },
  { b: 'F', t: '把 回测报告 往后放放到下周五', expect: 'postpone', targetKind: 'keyword' },
  { b: 'F', t: '回测报告 改到下周五', expect: 'postpone', targetKind: 'keyword' },
  { b: 'F', t: '收藏 周线复盘', expect: 'star', targetKind: 'keyword' },
  { b: 'F', t: '把 周线复盘 置顶', expect: 'setPriority', targetKind: 'keyword', note: '置顶在 todo.txt 语义里就是排到最前 = 优先级 A' },
  { b: 'F', t: '周线复盘 归到 @投资', expect: 'addContext', targetKind: 'keyword' },
  { b: 'F', t: '提醒我 明天 交周报', expect: 'add', title: '交周报' },
  { b: 'F', t: '备忘 后天  renew 会员', expect: 'add', title: '会员' },
  { b: 'F', t: '待办 周五 交材料', expect: 'add', title: '交材料' },
  { b: 'F', t: '回测报告 优先级提到最高级', expect: 'setPriority', targetKind: 'keyword' },

  // ---- G 结构变体 ----
  { b: 'G', t: '帮我把 周线复盘 删了', expect: 'delete', targetKind: 'keyword' },
  { b: 'G', t: '把 回测报告 这个任务完成掉', expect: 'complete', targetKind: 'keyword' },
  { b: 'G', t: '麻烦把 季报复核 的截止日期改成周五', expectAny: ['postpone', 'setDue'], targetKind: 'keyword', note: '两者落到同一个 dueDate 写入，等价' },
  { b: 'G', t: '把 周线复盘 打个星', expect: 'star', targetKind: 'keyword' },
  { b: 'G', t: '新建一条任务：下周三 交年报', expect: 'add', title: '交年报' },
  { b: 'G', t: '记录 明天上午 和军信电话会', expect: 'add', title: '军信' },

  // ---- H 上下文指代（需要会话记忆）----
  { b: 'H', t: '删了它', expect: 'delete', targetKind: 'ref', note: '"它"= 上一轮刚操作过的任务' },
  { b: 'H', t: '这条完成了', expect: 'complete', targetKind: 'ref' },
  { b: 'H', t: '把它延到 下周五', expect: 'postpone', targetKind: 'ref' },
  { b: 'H', t: '这个不用了', expect: 'delete', targetKind: 'ref' },
  { b: 'H', t: '刚才那条 标为高', expect: 'setPriority', targetKind: 'ref' },
  { b: 'H', t: '上面第二个 删掉', expect: 'delete', targetKind: 'ref' },
  { b: 'H', t: '前面第一个 完成了', expect: 'complete', targetKind: 'ref' },

  // ---- I 查询长尾 ----
  { b: 'I', t: '今天有什么安排', expect: 'query' },
  { b: 'I', t: '本周还剩哪些没弄', expect: 'query' },
  { b: 'I', t: '哪些逾期了', expect: 'query' },
  { b: 'I', t: '有什么要处理的', expect: 'query' },
  { b: 'I', t: '看看 @投资 里的东西', expect: 'query' },
  { b: 'I', t: '最近做了哪些事', expect: 'query', scope: 'done' },

  // ---- J 时间表达长尾 ----
  { b: 'J', t: '加一条 过两天 复查胃镜', expect: 'add', title: '复查胃镜', due: '2026-10-03' },
  { b: 'J', t: '加一条 下下个礼拜三 交年报', expect: 'add', title: '交年报', due: '2026-10-14' },
  { b: 'J', t: '加一条 3号 交税', expect: 'add', title: '交税', due: '2026-10-03' },
  { b: 'J', t: '加一条 11/5 交房租', expect: 'add', title: '交房租', due: '2026-11-05' },
  { b: 'J', t: '加一条 周五下班前 交周报', expect: 'add', title: '交周报', due: '2026-10-02' },
  { b: 'J', t: '加一条 晚上 遛狗', expect: 'add', title: '遛狗' },

  // ---- K 该拒的（期望 unknown，测过度解读）----
  { b: 'K', t: '今天天气不错', expect: 'unknown' },
  { b: 'K', t: '你觉得这个方案怎么样', expect: 'unknown' },
  { b: 'K', t: '哈哈哈', expect: 'unknown' },
  { b: 'K', t: '这一点很重要', expect: 'unknown' },
];

function failureMode(item, got) {
  // expectAny：几种写法落到同一个写入结果时视为等价（如 setDue / postpone）
  const allowed = item.expectAny || [item.expect];
  if (!allowed.includes(got.intent)) {
    if (allowed.length === 1 && allowed[0] === 'unknown') return '过度解读（本该拒绝却猜了）';
    if (got.intent === 'unknown') return '听不懂（无命中）';
    return `意图判错（期望 ${allowed.join('/')}，得到 ${got.intent}）`;
  }
  if (allowed.length === 1 && allowed[0] === 'unknown') return null;
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
  if (item.scope && got.scope !== item.scope) {
    return `查询范围错（期望 ${item.scope}，得到 ${got.scope ?? 'null'}）`;
  }
  // H 桶还要求真的定位到候选任务
  if (item.targetKind === 'ref' && (got.matches?.length ?? 0) === 0 && got.confidence !== 'low') {
    return '回指没有解析出目标';
  }
  return null;
}

const rows = CORPUS.map((item) => {
  const got = parseIntent(item.t, { tasks: TASKS, today: TODAY, memory: MEMORY });
  return { item, got, err: failureMode(item, got) };
});

const LABEL = {
  F: 'F 长尾动词',
  G: 'G 命令结构变体',
  H: 'H 上下文指代（需会话记忆）',
  I: 'I 查询长尾',
  J: 'J 时间表达长尾',
  K: 'K 该拒的（期望 unknown）',
};

const buckets = [...new Set(CORPUS.map((c) => c.b))].sort();
console.log('\n自然语言识别「长尾考卷」');
console.log(`上下文：${TASKS.length} 条活跃任务 · 今天 ${TODAY}（周四） · 语料 ${CORPUS.length} 条\n`);
console.log('─'.repeat(60));
console.log('桶'.padEnd(32) + '通过'.padStart(8) + '  识别率');
console.log('─'.repeat(60));
for (const b of buckets) {
  const list = rows.filter((r) => r.item.b === b);
  const pass = list.filter((r) => !r.err).length;
  const pct = ((pass / list.length) * 100).toFixed(0).padStart(3);
  const bar = '█'.repeat(Math.round((pass / list.length) * 16)).padEnd(16, '·');
  console.log(LABEL[b].padEnd(32) + `${pass}/${list.length}`.padStart(8) + `  ${pct}% ${bar}`);
}
const totalPass = rows.filter((r) => !r.err).length;
console.log('─'.repeat(60));
console.log('合计'.padEnd(32) + `${totalPass}/${CORPUS.length}`.padStart(8) + `  ${((totalPass / CORPUS.length) * 100).toFixed(0)}%`);
console.log('');

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
    console.log(`        → intent=${r.got.intent} conf=${r.got.confidence}` +
      ` target=${r.got.target ? r.got.target.kind + ':' + r.got.target.value : 'null'}` +
      (r.got.slots?.title ? ` title=「${r.got.slots.title}」` : '') +
      (r.got.slots?.dueDate ? ` due=${r.got.slots.dueDate}` : '') +
      ` matches=${r.got.matches?.length ?? 0}`);
    console.log(`        原因：${r.err}${r.item.note ? ' · ' + r.item.note : ''}`);
  }
  console.log('');
}
console.log(`[nl-heldout] 长尾识别率 ${((totalPass / CORPUS.length) * 100).toFixed(1)}%`);
