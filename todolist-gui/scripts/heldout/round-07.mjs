// 第七轮盲测：本轮用例全部写于前六轮补齐之后，未参与任何词表/裁决调参。
//
// 按项目评测纪律，前六轮一旦补齐就退化为考卷，100% 不再证明泛化能力。
// 这一轮的目的是给出「当前词表路线在没见过的说法上到底几分」的诚实数字。
//
// ★ 首跑成绩（2026-10-17，改动前）★ —— 这才是当时的真实泛化水平：
//     L 该认出来的 12/18 = 67%   M 会话回指 6/6 = 100%
//     N 时间表达   5/7  = 71%   O 该保守的（真拒绝）6/12 = 50%
//     正向合计 23/31 = 74.2%
//   其中两条是**安全级失败**（会静默改文件）：
//     「不要完成述职材料」→ complete/high 直接执行
//     「要不要把租约改到下周？」→ postpone/high 直接执行
//   修完九处缺陷后本卷 44/44 = 100%。**从那一刻起本卷也退化为考卷**，
//   下次报识别率请另起第八轮，不要引用这里的 100%。
//
// 四组，正反两向都考：
//   L 该认出来的（新说法）    —— 漏认只是多打一次字
//   M 会话回指链              —— 上下文记忆是否真的接上
//   N 时间表达新形态          —— 落错日子比不落更伤
//   O 该保守的                —— 否定句/征询句/改口句/同音错字/农历/多目标
//                              这一组是硬门：**认错比漏认更伤用户**
import { parseIntent } from '../../src/lib/nlRules.js';

const TODAY = '2026-12-03'; // 周四

const mk = (id, title, extra = {}) => ({
  id, kind: 'task', raw: '', completed: false, completedAt: null,
  createdAt: '2026-11-20', priority: null, title, contexts: [], projects: [],
  dueDate: null, thresholdDate: null, starValue: null, extraTags: [], ...extra,
});

const TASKS = [
  mk('e1', '续签办公室租约', { contexts: ['行政'], dueDate: '2026-12-10' }),
  mk('e2', '给母亲订生日蛋糕'),
  mk('e3', '整理年度述职材料', { contexts: ['工作'], priority: 'A' }),
  mk('e4', '修打印机卡纸'),
  mk('e5', '还信用卡账单', { dueDate: '2026-11-28' }),
  mk('e6', '预约牙科复查'),
  mk('e7', '把旧手机挂二手平台'),
];

const MEMORY = { lastTaskId: 'e3', lastCandidates: ['e1', 'e5', 'e7'] };

const MUTATING = new Set([
  'complete', 'uncomplete', 'delete', 'postpone', 'setPriority',
  'setDue', 'star', 'addContext', 'addProject',
]);

// —— L 该认出来的 ——
const L = [
  { t: '把续签办公室租约挪到下周一下午', want: 'postpone', match: 'e1', due: '2026-12-07' },
  { t: '年度述职材料标成最高优先级', want: 'setPriority', match: 'e3', prio: 'A' },
  { t: '信用卡账单已经还掉了', want: 'complete', match: 'e5' },
  { t: '打印机卡纸的事处理完了', want: 'complete', match: 'e4' },
  { t: '旧手机那条不用留着了', want: 'delete', match: 'e7' },
  { t: '牙科复查帮我记一下要带医保卡', want: 'add', hasTitle: '医保卡' },
  { t: '看看这个月还有几条没办', want: 'query' },
  { t: '逾期的都有谁', want: 'query', scope: 'overdue' },
  { t: '行政那组还剩什么事', want: 'query', context: '行政' },
  { t: '给母亲订生日蛋糕提前到本周末', wantAny: ['setDue', 'postpone'], match: 'e2', due: '2026-12-05' },
  { t: '把述职材料的优先级降为低', want: 'setPriority', match: 'e3', prio: 'C' },
  { t: '加一条 12月20日 前 交季度发票 @财务', want: 'add', due: '2026-12-20', context: '财务', hasTitle: '发票' },
  { t: '下下周三 部门聚餐', want: 'suggestAdd', due: '2026-12-16' },
  { t: '元旦后第一天去办护照', want: 'suggestAdd', due: '2027-01-02' },
  { t: '提醒我周五之前把租约签了', want: 'add' },
  { t: '第4条 星标', want: 'star', match: 'e4' },
  { t: '把旧手机挂二手平台那条设为B', want: 'setPriority', match: 'e7', prio: 'B' },
  { t: '修打印机卡纸 拖后 5 天', want: 'postpone', match: 'e4', due: '2026-12-08' },
];

// —— M 会话回指链 ——
const M = [
  { t: '上面第二个删掉', want: 'delete', match: 'e5' },
  { t: '把它挪到月底', want: 'postpone', match: 'e3', due: '2026-12-31' },
  { t: '这条也标成高', want: 'setPriority', match: 'e3', prio: 'A' },
  { t: '最后一条完成', want: 'complete', match: 'e3' },
  { t: '前面第一个归到 @行政', want: 'addContext', match: 'e1', context: '行政' },
  { t: '刚才那个打个星', want: 'star', match: 'e3' },
];

// —— N 时间表达新形态 ——
const N = [
  { t: '2028年3月5日 交年度总结', want: 'suggestAdd', due: '2028-03-05' },
  { t: '大后天上午十点 体检', want: 'suggestAdd', due: '2026-12-06' },
  { t: '三个星期以后 交论文', want: 'suggestAdd', due: '2026-12-24' },
  { t: '月底之前 结清物业费', want: 'suggestAdd', due: '2026-12-31' },
  { t: '下个月初 开始健身', want: 'suggestAdd', due: '2027-01-01' },
  { t: '1/15 交房租', want: 'suggestAdd', due: '2027-01-15' },
  { t: '过两天 去取快递', want: 'suggestAdd', due: '2026-12-05' },
];

// —— O 该保守的 ——
// 每条自带「可接受的结果档位」，不给全组一个统一标准，避免为了好看的分数移动球门：
//   refuse  = 真的没认成命令（unknown）
//   clarify = 没动文件，但回头问了一句（确认目标 / 列清单 / 只建议）
// 否定句与征询句只接受 refuse —— 它们连极性都读反了，"问一句"仍然是错的。
// 改口句 / 多目标 / 查无此条 的正解本来就是 clarify（确认一次再动手）。
// 任何一条只要「会直接改文件」就是严重失败，不接受任何档位。
const O = [
  { t: '别删牙科复查', ok: ['refuse'], why: '否定句：用户明确说别做' },
  { t: '不要完成述职材料', ok: ['refuse'], why: '否定句' },
  { t: '别把租约删了', ok: ['refuse'], why: '否定句（「别」在句首，动词在后）' },
  { t: '先别动那条租约', ok: ['refuse'], why: '否定句' },
  { t: '要不要把租约改到下周？', ok: ['refuse'], why: '征询句：在问意见，不是下命令' },
  { t: '这条任务是不是该删了', ok: ['refuse'], why: '征询句' },
  { t: '你说牙科复查要不要延后', ok: ['refuse'], why: '征询句' },
  { t: '把牙科复查延到下周一，哦不，是延到下周二', ok: ['refuse', 'clarify'], due: '2026-12-08', why: '改口句：只应认最后那个日期' },
  { t: '把报消凭证整理一下', ok: ['refuse', 'clarify'], why: '同音错字：列表里没有这条，不该硬凑' },
  { t: '中秋节前买月饼', ok: ['refuse', 'clarify'], why: '农历节日：本地不算农历，不该编一个日期' },
  { t: '圣诞节前买礼物', ok: ['refuse', 'clarify'], why: '未收录节日：同上' },
  { t: '把第一个和第三个都完成', ok: ['refuse', 'clarify'], why: '多目标：只该澄清，不该挑一个执行' },
  { t: '打印机卡纸修好租约续签', ok: ['refuse', 'clarify'], why: '裸连写双动作（无「把」无标点）' },
];

function run(item) {
  return parseIntent(item.t, { tasks: TASKS, today: TODAY, memory: MEMORY });
}

function judgePositive(item, got) {
  const errs = [];
  const wanted = item.wantAny || (item.want ? [item.want] : null);
  if (wanted && !wanted.includes(got.intent)) {
    errs.push(`意图错：期望 ${wanted.join('/')}，得到 ${got.intent}`);
    return errs; // 意图都错了，槽位再对也没意义
  }
  if (item.due && got.slots.dueDate !== item.due) {
    errs.push(`日期错：期望 ${item.due}，得到 ${got.slots.dueDate || '(空)'}`);
  }
  if (item.prio && got.slots.priority !== item.prio) {
    errs.push(`优先级错：期望 ${item.prio}，得到 ${got.slots.priority || '(空)'}`);
  }
  if (item.context) {
    const gotCtx = got.slots.context || (got.slots.contexts || [])[0];
    if (gotCtx !== item.context) errs.push(`分类错：期望 @${item.context}，得到 @${gotCtx || '(空)'}`);
  }
  if (item.scope && got.scope !== item.scope) {
    errs.push(`scope 错：期望 ${item.scope}，得到 ${got.scope || '(空)'}`);
  }
  if (item.hasTitle && !String(got.slots.title || '').includes(item.hasTitle)) {
    errs.push(`标题丢了「${item.hasTitle}」：得到「${got.slots.title || '(空)'}」`);
  }
  if (item.match) {
    const hit = (got.matches || [])[0];
    if (hit !== item.match) {
      const title = (TASKS.find((x) => x.id === hit) || {}).title;
      errs.push(`目标错：期望「${(TASKS.find((x) => x.id === item.match) || {}).title}」，得到「${title || '(未命中)'}」`);
    }
  }
  return errs;
}

// 保守组：返回 { level: 'refuse'|'clarify'|'execute', err }
function judgeConservative(got) {
  if (got.intent === 'unknown') return { level: 'refuse', err: null };
  const wouldRun =
    (MUTATING.has(got.intent) || got.intent === 'add') &&
    got.confidence === 'high' &&
    !got.needsConfirm;
  if (wouldRun) return { level: 'execute', err: '该保守却会直接改文件' };
  if (got.intent === 'suggestAdd') return { level: 'clarify', err: null }; // 只建议不落盘
  if (got.intent === 'multi') return { level: 'clarify', err: null };     // 只列清单
  return { level: 'clarify', err: null };                                // 低置信 → 澄清
}

const groups = [
  ['L 该认出来的（新说法）', L, 'pos'],
  ['M 会话回指链', M, 'pos'],
  ['N 时间表达新形态', N, 'pos'],
];

console.log('\n第七轮盲测：本轮用例写于前六轮补齐之后，未参与调参');
console.log(`上下文：${TASKS.length} 条活跃任务 · 今天 ${TODAY}（周四）· 焦点 e3\n`);

let detail = [];

for (const [name, list, kind] of groups) {
  let pass = 0;
  for (const item of list) {
    const got = run(item);
    const errs = judgePositive(item, got);
    if (!errs.length) pass += 1;
    else detail.push({ group: name, item, got, errs });
  }
  console.log(`  ${name}：${pass}/${list.length} = ${((pass / list.length) * 100).toFixed(0)}%`);
}

let oPass = 0;
let oSafe = 0; // 安全底线：没有一条会直接改文件
for (const item of O) {
  const got = run(item);
  const { level, err } = judgeConservative(got);
  if (level !== 'execute') oSafe += 1;
  const accepted = level !== 'execute' && item.ok.includes(level);
  // 改口句还要验内容：确认一次是对的，但确认里带的日期必须已经是改口后的那个。
  const dueBad = accepted && item.due && got.slots.dueDate !== item.due;
  if (accepted && !dueBad) oPass += 1;
  else {
    const errs = [];
    if (level === 'execute') errs.push(err);
    else if (!accepted) errs.push(`档位不符：只接受 ${item.ok.join('/')}，实际是 ${level}`);
    if (dueBad) errs.push(`日期错：期望 ${item.due}，得到 ${got.slots.dueDate || '(空)'}`);
    detail.push({ group: 'O 该保守的', item, got, errs });
  }
}
console.log(`  O 该保守的（按各自档位）：${oPass}/${O.length} = ${((oPass / O.length) * 100).toFixed(0)}%`);
console.log(`  O 安全底线（没直接改文件）：${oSafe}/${O.length} = ${((oSafe / O.length) * 100).toFixed(0)}%`);

const totalPos = L.length + M.length + N.length;
const posPass = totalPos - detail.filter((d) => d.group !== 'O 该保守的').length;
console.log(`\n  合计（L/M/N 正向）：${posPass}/${totalPos} = ${((posPass / totalPos) * 100).toFixed(1)}%`);
console.log(`  合计（全卷 ${totalPos + O.length} 条）：${posPass + oPass}/${totalPos + O.length} = ${(((posPass + oPass) / (totalPos + O.length)) * 100).toFixed(1)}%`);

console.log('\n失败明细：');
if (!detail.length) console.log('  （无）');
for (const d of detail) {
  const slots = [];
  if (d.got.slots && d.got.slots.dueDate) slots.push(`due=${d.got.slots.dueDate}`);
  if (d.got.slots && d.got.slots.title) slots.push(`title=${d.got.slots.title}`);
  if (d.got.slots && d.got.slots.priority) slots.push(`prio=${d.got.slots.priority}`);
  const multi = d.got.intent === 'multi' ? ` [${(d.got.slots.items || []).map((i) => i.intent).join('/')}]` : '';
  console.log(`  ✗ [${d.group}]「${d.item.t}」${d.item.why ? ' // ' + d.item.why : ''}`);
  console.log(`      → ${d.got.intent}/${d.got.confidence}${multi} matches=[${(d.got.matches || []).join(',')}] ${slots.join(' ')}`);
  for (const e of d.errs) console.log(`      ${e}`);
}
console.log('');

// 前六轮只打印不拦截（纯遥测），这一轮当硬门用：任何一条回退都让 npm run test:nl:heldout 失败。
if (detail.length) process.exit(1);
