// 本地自然语言规则解析器（纯函数，仅依赖 dayjs，不发任何网络请求）。
//
// 设计目标：宁可不做也不做错。当规则命中但指代不明确（序号越界 / 关键词多命中）时，
// 返回 confidence:'low' 并把候选（matches）交回上层，由 useChatAgent 进入澄清流程，
// 而不是擅自猜测执行。
//
// parseIntent(text, ctx) -> Intent
//   ctx: { tasks: Task[], today: 'YYYY-MM-DD' }
//   Intent: {
//     intent: 'add'|'complete'|... |'unknown',
//     target: { kind:'index'|'keyword'|'context', value } | null,
//     slots: { title?, dueDate?, priority?, context?, project?, contexts?, projects? },
//     matches: string[],        // 依据 ctx.tasks 排序解析出的候选任务 id
//     confidence: 'high'|'low',
//     note: string|null,        // 例如“已按日期处理”
//     raw: string
//   }
import dayjs from 'dayjs';
// 带 .js 后缀：Vite 能解析无后缀写法，但 node 直接跑（qa-nl-coverage.mjs）不能
import { hanLength, rankBySimilarity } from './textScore.js';

const WEEKDAY_ISO = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

// 需要“目标”才能执行的意图；add/query/undo 无需目标。
const NEEDS_TARGET = new Set([
  'complete',
  'uncomplete',
  'delete',
  'postpone',
  'setPriority',
  'setDue',
  'star',
  'addContext',
  'addProject',
]);

// 各意图的动作触发词（按数组顺序匹配，先长后短，只删除首个命中项）。
// 词表以"用户真实会说的"为准，不追求穷尽——穷尽是不可能任务，
// 追不到的部分交给隐式新增判定和末端的反问兜底。
const TRIGGERS = {
  add: ['帮我记一下', '帮我记', '记一下', '记一笔', '记录一下', '添加一条', '添加任务', '添加', '新增', '新建', '加一条', '加个', '别忘记', '别忘了', '记得', '记个', '记下', '加', '记'],
  complete: ['已完成', '做完了', '弄完了', '搞定了', '打完收工', '弄完', '搞定', '勾掉', '划掉', '已办', '收工', '做完', '完成'],
  uncomplete: ['取消完成', '撤销完成', '恢复完成', '取消已办', '恢复'],
  delete: ['删除', '删掉', '干掉', '清理掉', '取消掉', '去掉', '移除', '清掉', '扔掉', '毙掉'],
  postpone: ['延期到', '推迟到', '顺延到', '往后挪', '往后推', '延期', '推迟', '延后', '顺延', '拖到', '延到', '挪到', '改到', '推后', '挪后'],
  setPriority: ['改为优先级', '改优先级', '设置优先级', '优先级', '顶到最高', '提到最高', '标为', '设为', '设置为', '降为', '顶格'],
  setDue: ['截止日期', '截止到', '截止', '到期', '死线', 'deadline', 'ddl'],
  addContext: ['加入分类', '加个分类', '加分类', '归档到', '归入', '归到', '扔到', '放到'],
  addProject: ['打个标签', '加个标签', '打标签', '加标签', '加个项目', '加项目', '贴上', '贴个'],
  star: ['打星标', '标星', '星标', '加星', '打星'],
  query: ['有哪些任务', '有什么任务', '列出任务', '列一下', '列下', '列出', '有哪些', '有什么', '看看', '看一下', '看下', '查看', '查一下', '查查', '查', '搜索一下', '搜索', '待办', '今天要做什么', '今日待办', '逾期', '已完成', '做完的', '完成的', '干啥', '要干', '剩什么', '剩下什么', '还剩', '剩啥', '要做的', '没做完', '没做'],
  undo: ['撤销上一步', '撤销刚才', '撤销', '回退', 'undo'],
};

// 需要剥离的虚词/语气词（用于从剩余文本中提炼关键词）。
const PARTICLES = ['里的任务', '的任务', '里的', '的', '把', '将', '给', '帮我', '请', '麻烦', '一下', '一个', '这条', '那条', '吧', '呢', '啊', '。', '，', ',', '。', '！', '!', '?', '？'];

// 时段词 / 日期锚点。用于判断"汉字数字时刻"是不是真在说时间。
const TIME_ANCHOR_RE = /(上午|中午|下午|傍晚|晚上|凌晨|早上|今天|明天|后天|大后天|周[一二三四五六日天]|礼拜[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}\s*月\s*\d{1,2}\s*[日号])/;
const CN_CLOCK_RE = /[一二三四五六七八九十两]{1,3}\s*点(?:半)?/;

// 「下午三点开会」要说得出是时间，「这一点很重要」不是。
// 判据：汉字数字时刻必须有日期或时段词做锚点。
export function hasClock(text) {
  const t = String(text || '');
  if (/(上午|中午|下午|傍晚|晚上|凌晨|早上)/.test(t)) return true;
  if (/\d{1,2}\s*点(?:半)?|\d{1,2}:\d{2}/.test(t)) return true;
  return CN_CLOCK_RE.test(t) && TIME_ANCHOR_RE.test(t);
}

// 中文数字 → 数值（只支持 1~99：「一」「十」「十二」「二十三」）
const CN_DIGITS = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function parseNum(raw) {
  const t = String(raw || '').trim();
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? CN_DIGITS[m[1]] : 1) * 10 + (m[2] ? CN_DIGITS[m[2]] : 0);
  if (CN_DIGITS[t] != null) return CN_DIGITS[t];
  return NaN;
}

const NUM_SRC = '(\\d+|[一二三四五六七八九十两]{1,3})';

// —— 查询强前缀 ——
// 置于其它动作之前判断，避免「有哪些任务已完成」被 complete 抢先命中。
// 规则：整句以强前缀词开头，且不含“明确命令目标指向”（第N条 / #N / 引号标题）→ 判为 query。
const QUERY_PREFIXES = [
  '有哪些',
  '有什么',
  '列出',
  '列一下',
  '列下',
  '看看',
  '看下',
  '看一下',
  '查看',
  '查一下',
  '查查',
  '查',
  '搜索一下',
  '搜索',
  '待办',
  '今天要做什么',
  '今日待办',
  '逾期',
  '已完成',
  '做完的',
  '完成的',
];

// query 的“已完成”标记 → scope:'done'
const DONE_MARKER_RE = /已完成|完成的|做完了的|已办|已勾选/;

function isQueryPrefixed(text) {
  return QUERY_PREFIXES.some((p) => text.startsWith(p));
}

// 明确“命令目标指向”：序号（第N条 / #N）或引号包裹的标题。出现则不被查询前缀规则抢占。
function hasExplicitCommandTarget(text) {
  return (
    /第\s*\d+\s*(?:条|个|项)?/.test(text) ||
    /#\s*\d+/.test(text) ||
    /["“「][^"”」]{1,40}["”」]/.test(text)
  );
}

// 清理 @分类 / +项目 名称末尾的虚词（如「@工作的任务」→「工作」）。
function cleanName(name) {
  return String(name || '').replace(/(的目标|的任务|标签|目标|任务|的)$/u, '');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function fmt(d) {
  return d.format('YYYY-MM-DD');
}

// ISO 星期（周一=1 ... 周日=7）
function isoDow(d) {
  const w = d.day();
  return w === 0 ? 7 : w;
}

// 句中（不限句首）出现的“命令触发词”正则，按既有优先级排列。
// 顺序即规则：先命令，后查询。
//
// when：可选前置条件。加 @/+ 类动作必须真的带了 @ 或 +，
// 否则「扔到垃圾桶」这种会被误判成"加入分类"。
const COMMAND_RULES = [
  { intent: 'uncomplete', re: /^恢复|取消完成|撤销完成|恢复完成|取消已办/ },
  { intent: 'complete', re: /完成|搞定|做完了|弄完|勾掉|划掉|已办|收工/ },
  { intent: 'delete', re: /删除|删掉|干掉|去掉|移除|清理掉|清掉|扔掉|毙掉|取消掉/ },
  { intent: 'postpone', re: /延期|推迟|顺延|延到|挪到|改到|延后|推后|挪后|往后挪|往后推|拖到/ },
  { intent: 'setPriority', re: /标为|设为|设置为|优先级|顶格|顶到最高|提到最高|降为/ },
  { intent: 'setDue', re: /截止|到期|死线|deadline|ddl/i },
  { intent: 'addContext', re: /加分类|归到|归入|归档到|加入分类|加个分类|扔到|放到/, when: (t) => /@\S+/.test(t) },
  { intent: 'addProject', re: /打标签|加标签|加个项目|加项目|打个标签|加个标签|贴个|贴上/, when: (t) => /\+\S+/.test(t) },
  { intent: 'star', re: /星标|标星|加星|打星/ },
  { intent: 'add', re: /加|添加|新增|新建|记一下|记一笔|记个|帮我记|别忘了|别忘记|记得|记录/ },
];

// 句中 contains 型查询词（仅在无任何命令触发词时生效）。
//
// 不要在这里放单字动词：曾经有过一个裸的 `查`，于是「下周三去医院复查」
// 被判成 query —— 「复查」里的"查"和"查任务"的"查"完全是两回事。
// 单字动词的命中率高得毫无意义，宁可只留多字组合（查一下 / 查查 / 查看）。
const QUERY_CONTAINS_RE = /有哪些|有什么|列出|列一下|看看|看一下|看下|查看|查一下|查查|搜索|待办|今天要做什么|今日待办|逾期|干啥|要干|还剩|剩啥|剩下什么|要做的|没做完|没做/;

// —— 隐式新增 ——
// 本引擎最大的盲区：人写待办是"内容式"的，句子里根本没有动词。
//   「后天上午9点有月报会议要开」「周四下午要交周报」「10月8日 体检」
// 这些不是"没听懂"，而是意图藏在句式里。
//
// 判据故意收得很紧（时间表达 + 非疑问），因为判错的代价是凭空多出一条任务。
// 而且隐式新增永远只产出「建议」，绝不直接写文件——用户回一句"不是"就结束。
const QUESTION_RE = /[?？]|吗[。!！\s]*$|呢[。!！\s]*$|怎么样|如何|为什么|是不是|对不对|好不好|干嘛|怎么办/;

function looksImplicitAdd(text, todayStr) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (QUESTION_RE.test(t)) return false; // 疑问句不是待办
  if (t.length < 3) return false;
  // 必须有"任务式时间"：能解析成日期（含周范围词），或含具体时刻。
  // 「我今天很累」没有时间 → 不判；「明天天气怎么样」有时间但是疑问句 → 不判。
  return Boolean(extractDate(t, todayStr).date) || hasClock(t);
}

// 句首窗口：开头这几个字里出现的触发词，才算"用户真正在下达的命令"。
// 「加一条 12月31日 前完成年报」——句首的"加一条"是命令，句中的"完成"是任务内容。
const HEAD_WINDOW = 8;

function matchRuleInWindow(text, limit) {
  const head = text.slice(0, limit);
  for (const rule of COMMAND_RULES) {
    if (rule.when && !rule.when(text)) continue;
    if (rule.re.test(head)) return rule;
  }
  return null;
}

// 触发词之前是否已经出现时间表达。
// 「12月31日前完成年报」里的"完成"前面有"12月31日" → 它修饰的是任务内容，不是命令。
// 反例：「把 回测报告 延到下周三」的"延到"前面没有时间（"下周三"在后面）→ 仍是命令。
function timeBefore(text, idx, todayStr) {
  if (idx <= 0) return false;
  const before = text.slice(0, idx);
  return Boolean(extractDate(before, todayStr).date) || hasClock(before);
}

// 从文本中识别一次“动作”，返回 intent 名；未命中返回 'unknown'。
// 顺序即规则：
//   撤销 → 「已完成…」歧义特判 → 查询强前缀
//   → 句首窗口内的命令触发词 → 句中触发词（时间前置的跳过）
//   → 句中查询词 → 隐式新增 → unknown
export function detectAction(text, todayStr) {
  const t = String(text || '').trim();
  if (!t) return 'unknown';

  if (/^撤销$|^回退$|^undo$/i.test(t) || /撤销上一步|撤销刚才|回退一步/.test(t)) return 'undo';

  // 「已完成 …」歧义：句首为“已完成”。带引用/序号目标 → complete；否则先按 query，
  // 是否升级为 complete（残余关键词命中）由 parseIntent 依据 ctx.tasks 决定。
  if (t.startsWith('已完成')) {
    return hasExplicitCommandTarget(t) ? 'complete' : 'query';
  }

  // 查询强前缀优先（且无明确命令目标指向）→ query。
  if (isQueryPrefixed(t) && !hasExplicitCommandTarget(t)) return 'query';

  // 句首窗口：最高优先级，句首说了什么就是什么。
  const headRule = matchRuleInWindow(t, HEAD_WINDOW);
  if (headRule) return headRule.intent;

  // 句中触发词优先于句中查询词（修复"加一条 列出购物清单"被抢为 query）。
  for (const rule of COMMAND_RULES) {
    if (rule.when && !rule.when(t)) continue;
    const m = t.match(rule.re);
    if (!m) continue;
    if (timeBefore(t, m.index, todayStr)) continue; // 时间修饰的是内容，不是命令
    return rule.intent;
  }

  // 无任何命令触发词时，才判定查询。
  if (isQueryPrefixed(t) || QUERY_CONTAINS_RE.test(t)) return 'query';

  // 最后才谈隐式新增：前面所有明确形式都不成立，才考虑"这是不是一句待办描述"。
  if (looksImplicitAdd(t, todayStr)) return 'suggestAdd';

  return 'unknown';
}

// 剥离动作触发词，返回剩余文本。
function stripAction(text, intent) {
  const list = TRIGGERS[intent] || [];
  for (const trig of list) {
    const idx = text.indexOf(trig);
    if (idx !== -1) {
      return `${text.slice(0, idx)} ${text.slice(idx + trig.length)}`;
    }
  }
  return text;
}

// 剥离虚词与时间片段（含时刻），返回“核心剩余文本”。
function stripNoise(text, timeText) {
  let out = ` ${text} `;
  if (timeText) out = out.split(timeText).join(' ');
  // 时刻（上午/下午/3点/15:30 等）忽略，仅保留日期语义。
  // 汉字数字时刻必须抢在时段词前面剥 —— 否则"下午"先被换成空格，
  // 「下午三点开会」就只剩"三点开会"，匹配不上"时段+汉字数字"的组合了。
  out = out.replace(
    /(?:上午|中午|下午|傍晚|晚上|凌晨|早上)\s*[一二三四五六七八九十两]{1,3}\s*点(?:半)?/g,
    ' '
  );
  out = out.replace(/(上午|中午|下午|傍晚|晚上|凌晨|早上)/g, ' ');
  out = out.replace(/\d{1,2}\s*点(?:半)?/g, ' ');
  out = out.replace(/\d{1,2}:\d{2}/g, ' ');

  // 句首框架词：把它们留在标题里会让"有月报会议要开"这种变成长标题。
  // 只在句首剥，避免把"和平路""需要评审"这类词内部的和/要拆开。
  out = out.replace(/^\s*(?:还有|还要|另外|另外还要|记得|别忘了|别忘记|需要|应该|准备|打算|要|得|跟|和|与|有个?|有)+/, ' ');
  // 句尾的"要开会""要交材料"式框架，剥掉后标题更像任务名
  out = out.replace(/\s*(?:要|需要|得)(?:开|做|办|交|写|买|看|查|说|问|发|打|去|参加)\s*$/, ' ');
  // 孤立的时间方向词（"月底"已剥掉，"前"会剩下来）
  out = out.replace(/^\s*(?:前|后|内|以内|之前|以前|之内)\s*/, ' ');

  for (const p of PARTICLES) out = out.split(p).join(' ');
  // 时间表达被剥掉后可能剩下"数量+单位"的尾巴：
  // 「往后挪一周」里 stripAction 先吃掉了"往后挪"，剩下"一周"无人认领。
  // 用后视边界保护「第10周回测报告」这类真·内容。
  out = out.replace(/[0-9一二三四五六七八九十两]{1,3}\s*(?:天|周|星期|礼拜|个?月)(?=\s|$)/g, ' ');

  out = out.replace(/\s+/g, ' ').trim();
  // 句尾语气助词
  out = out.replace(/(?:的|吧|呢|啊|了|啦|呀|嘛)+$/, '').trim();
  // 「回测 要紧」这种被空格隔开的评价词是独立片段，可以剥；
  // 「这一点很重要」里的"重要"粘在"很"后面，不能碰 —— 所以要求前导空格。
  out = out.replace(/\s+(?:要紧|重要|紧急|急)+$/, '').trim();
  return out;
}

// 解析相对/绝对日期表达；返回 { date, matchedText, clockIgnored } 或 { date:null }。
export function extractDate(text, todayStr) {
  const today = dayjs(todayStr).startOf('day');
  const t = String(text || '');
  let m;

  m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = dayjs(`${m[1]}-${pad2(m[2])}-${pad2(m[3])}`);
    if (d.isValid()) return { date: fmt(d), matchedText: m[0], clockIgnored: false };
  }

  // 数量词支持阿拉伯与中文两种写法：「3天后」和「三天后」都得认。
  m = t.match(new RegExp(NUM_SRC + '\\s*天\\s*后'));
  if (m) return { date: fmt(today.add(parseNum(m[1]), 'day')), matchedText: m[0], clockIgnored: false };

  m = t.match(new RegExp(NUM_SRC + '\\s*(?:周|星期|礼拜)\\s*后'));
  if (m) return { date: fmt(today.add(parseNum(m[1]) * 7, 'day')), matchedText: m[0], clockIgnored: false };

  // 偏移词在前、数量在后：「往后挪一周」「推后 3 天」「延两个月」
  // 「往后挪」要排在「往后」前面，否则"挪"字会被剩下，数量词匹配不到
  m = t.match(new RegExp('(?:往后挪|往后推|往后|推后|顺延|延后|推迟|挪后|拖|延)\\s*' + NUM_SRC + '\\s*(个?月|天|周|星期|礼拜)'));
  if (m) {
    const n = parseNum(m[1]);
    const unit = m[2];
    if (Number.isFinite(n)) {
      const d = /月/.test(unit)
        ? today.add(n, 'month')
        : today.add(/天/.test(unit) ? n : n * 7, 'day');
      return { date: fmt(d), matchedText: m[0], clockIgnored: false };
    }
  }

  const wd = t.match(/(本|这|下个|下下|下)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天])/);
  if (wd) {
    const prefix = wd[1] || '';
    const iso = WEEKDAY_ISO[wd[2]];
    const mondayThis = today.subtract(isoDow(today) - 1, 'day');
    let baseWeek = mondayThis;
    if (prefix.includes('下下')) baseWeek = mondayThis.add(14, 'day');
    else if (prefix.includes('下')) baseWeek = mondayThis.add(7, 'day');
    let date = baseWeek.add(iso - 1, 'day');
    // 无前缀时表示“即将到来的周X”：若本周该日已过则顺延至下周。
    if (!prefix && date.isBefore(today, 'day')) date = date.add(7, 'day');
    return { date: fmt(date), matchedText: wd[0], clockIgnored: false };
  }

  // —— 周范围词 ——
  // 必须排在"下周三"之后：否则「下周一」会被「下周」抢走。
  // 也不能裸匹配「周」——「第10周回测报告」里的周不是时间。
  const mondayThis = today.subtract(isoDow(today) - 1, 'day');

  // 「周末」口径锁定为【周六】，不是周日 —— 这是有意为之，不是实现偷懒。
  // 待办要回答的是"什么时候之前做完"，而周末是从周六开始的；取周六 = "在周末开始前做完"，
  // 与待办的截止感一致（取周日会白白多给一天，等于悄悄放宽了用户的期限）。
  m = t.match(/(下下|下|这|本)?\s*(?:周末|礼拜末)/);
  if (m) {
    const p = m[1] || '';
    let sat = mondayThis.add(5, 'day'); // 周六
    if (p.includes('下下')) sat = sat.add(14, 'day');
    else if (p.includes('下')) sat = sat.add(7, 'day');
    // 无前缀的「周末」= 最近一个"还没到"的周六（今天正好是周六时即今天）。
    else if (!p && sat.isBefore(today, 'day')) sat = sat.add(7, 'day');
    // 「这/本周末」明确指"本周的周末"：今天已经是周六或周日（都落在周末里）时，
    // 本周六可能是昨天，此时只能 clamp 到今天，绝不顺延 ——
    // 顺延到下一个周六就变成「下周末」的语义了，等于替用户改写了时间。
    else if ((p.includes('这') || p.includes('本')) && sat.isBefore(today, 'day')) sat = today;
    return { date: fmt(sat), matchedText: m[0], clockIgnored: false };
  }

  m = t.match(/(下下|下|这|本)\s*(?:周|礼拜)(?!\s*(?:末|[一二三四五六日天]))/);
  if (m) {
    const p = m[1];
    let sun = mondayThis.add(6, 'day'); // 周日
    if (p.includes('下下')) sun = sun.add(14, 'day');
    else if (p.includes('下')) sun = sun.add(7, 'day');
    else if (sun.isBefore(today, 'day')) sun = sun.add(7, 'day');
    return { date: fmt(sun), matchedText: m[0], clockIgnored: false };
  }

  if (/大后天/.test(t)) return { date: fmt(today.add(3, 'day')), matchedText: '大后天', clockIgnored: false };
  if (/后天/.test(t)) return { date: fmt(today.add(2, 'day')), matchedText: '后天', clockIgnored: false };
  if (/明天|明日/.test(t)) return { date: fmt(today.add(1, 'day')), matchedText: '明天', clockIgnored: false };
  if (/今天|今日/.test(t)) return { date: fmt(today), matchedText: '今天', clockIgnored: false };

  m = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
  if (m) {
    let d = dayjs(`${today.year()}-${pad2(m[1])}-${pad2(m[2])}`);
    if (!d.isValid()) return { date: null, matchedText: null, clockIgnored: false };
    // 若当年该日已过，则理解为次年（例如 12 月说“1 月 5 日”）。
    if (d.isBefore(today, 'day')) d = d.add(1, 'year');
    return { date: fmt(d), matchedText: m[0], clockIgnored: false };
  }

  if (/月底|月末/.test(t)) return { date: fmt(today.endOf('month')), matchedText: '月底', clockIgnored: false };
  if (/下月(初|开始|伊始)/.test(t)) return { date: fmt(today.add(1, 'month').startOf('month')), matchedText: '下月初', clockIgnored: false };

  return { date: null, matchedText: null, clockIgnored: false };
}

// 解析优先级表达：高/中/低、A/B/C 或 (A)~(C)。
export function parsePriorityWord(text) {
  const t = String(text || '');
  const paren = t.match(/\(([A-Za-z])\)/);
  if (paren) return paren[1].toUpperCase();
  const bare = t.match(/(?:优先级|标为|设为|设置为|改为)\s*([A-Fa-f])\b/);
  if (bare) return bare[1].toUpperCase();
  // 口语里的"最高级"说法，和 A/B/C 是同一件事
  if (/顶格|顶到最高|提到最高|最高级|最要紧|最重要|最优先/.test(t)) return 'A';
  if (/降为低|降级|最低级|最不重要/.test(t)) return 'C';
  if (/高/.test(t)) return 'A';
  if (/中/.test(t)) return 'B';
  if (/低/.test(t)) return 'C';
  return null;
}

// 从剩余文本中提取目标（序号 / 分类 / 关键词）。
function buildTarget(core) {
  const text = String(core || '').trim();
  if (!text) return null;

  let m = text.match(/第\s*(\d+)\s*(?:条|个|项)?/) || text.match(/#\s*(\d+)/) || text.match(/(\d+)\s*号/);
  if (m) return { kind: 'index', value: Number(m[1]) };

  m = text.match(/@(\S+)/);
  if (m) {
    const leftover = text.replace(m[0], ' ').replace(/\s+/g, ' ').trim();
    return { kind: 'context', value: cleanName(m[1]), leftover };
  }

  // 纯数字 → 视为序号（用于澄清阶段的“2”）。
  if (/^\d+$/.test(text)) return { kind: 'index', value: Number(text) };

  const kw = text.replace(/\s+/g, ' ').trim();
  if (kw) return { kind: 'keyword', value: kw };
  return null;
}

// 短查询词只是标题里某个更长词的片段时，唯一命中也不足以认定用户指的就是它。
//   「完成 报告」→ 标题「…写第 10 周回测报告」里的"报告"被"测"包着 → 该确认
//   「完成 体检」→ 标题就叫"体检"，没有更长词包着 → 不必确认
// 这比"按字数一刀切"准得多：字少但自成一词的，不该被反复打扰。
function looksLikeFragment(query, title) {
  if (hanLength(query) >= 3) return false;
  const q = String(query).trim();
  const t = String(title || '');
  const i = t.indexOf(q);
  if (i < 0) return false;
  const before = t[i - 1] || '';
  const after = t[i + q.length] || '';
  return /[\u4e00-\u9fff]/.test(before) || /[\u4e00-\u9fff]/.test(after);
}

// add / suggestAdd 共用的槽位抽取（@分类、+项目、优先级、标题）。
function buildAddSlots(raw, core) {
  let body = core;
  const contexts = [];
  const projects = [];
  let m;
  const ctxRe = /@(\S+)/g;
  while ((m = ctxRe.exec(body)) !== null) contexts.push(cleanName(m[1]));
  body = body.replace(/@\S+/g, ' ');
  const projRe = /\+(\S+)/g;
  while ((m = projRe.exec(body)) !== null) projects.push(cleanName(m[1]));
  body = body.replace(/\+\S+/g, ' ');
  const slots = { contexts, projects, title: body.replace(/\s+/g, ' ').trim() };
  const p = parsePriorityWord(raw);
  if (p) slots.priority = p;
  return slots;
}

// 依据 ctx.tasks 顺序解析目标 → { matches: id[], confidence }。
function resolveTarget(target, tasks) {
  if (!target) return { matches: [], nearMatches: [], confidence: 'low' };

  if (target.kind === 'index') {
    const idx = target.value - 1;
    const t = tasks[idx];
    return { matches: t ? [t.id] : [], nearMatches: [], confidence: t ? 'high' : 'low' };
  }

  if (target.kind === 'context') {
    const name = String(target.value).replace(/^@/, '');
    const hits = tasks.filter((t) => (t.contexts || []).includes(name));
    return { matches: hits.map((t) => t.id), nearMatches: [], confidence: hits.length === 1 ? 'high' : 'low' };
  }

  // keyword：分词 + bigram 相似度打分，而不是子串 includes。
  // includes 只有"命中/不命中"两态，无法区分「回测报告」这种精准命中
  // 和「报告」这种泛词命中；打分之后「语序不同但有实质重合」也能认出来。
  //
  // 分两档：
  //   matches     强匹配（≥0.5）—— 唯一时可以直接执行
  //   nearMatches 弱匹配（≥0.22）—— 强匹配为空时拿来做澄清候选
  // 只有一档的话，「把那个报告延到下周」会得到一个空候选列表，
  // 用户看到的是一句"没找到匹配的任务，请确认："后面什么都没有。
  const kw = String(target.value).trim();
  const scored = rankBySimilarity(kw, tasks, { key: (t) => t.title, minScore: 0.5 });

  // 满分档有否决权：只要有一条标题"真的包含"你输入的串，模糊命中的那些就退出竞争。
  // 不加这条，「把 回测报告复核 延后」会同时命中「回测报告复核」(1.0) 与
  // 「写第 10 周回测报告」(恰好踩在 0.5 线上)，把一个字面精确的命中
  // 稀释成"需要澄清"——用户明明把标题原样打了出来。
  const perfect = scored.filter((r) => r.score >= 1);
  const strong = perfect.length ? perfect : scored;

  const weak = rankBySimilarity(kw, tasks, { key: (t) => t.title, minScore: 0.22 });
  const strongIds = new Set(strong.map((r) => r.item.id));
  return {
    matches: strong.map((r) => r.item.id),
    nearMatches: weak.filter((r) => !strongIds.has(r.item.id)).map((r) => r.item.id),
    confidence: strong.length === 1 ? 'high' : 'low',
  };
}

/**
 * 解析用户输入为结构化意图。
 * @param {string} text 用户原始输入
 * @param {{tasks?: Array, today?: string}} ctx 上下文（活跃任务列表 + 今天）
 * @returns {object} Intent
 */
export function parseIntent(text, ctx = {}) {
  const raw = String(text == null ? '' : text).trim();
  const todayStr = ctx.today || dayjs().format('YYYY-MM-DD');
  const tasks = Array.isArray(ctx.tasks) ? ctx.tasks : [];

  if (!raw) {
    return { intent: 'unknown', target: null, slots: {}, matches: [], nearMatches: [], confidence: 'low', note: null, raw };
  }

  const intent = detectAction(raw, todayStr);
  if (intent === 'unknown') {
    return { intent: 'unknown', target: null, slots: {}, matches: [], nearMatches: [], confidence: 'low', note: null, raw, needsConfirm: false };
  }

  // add / query / undo 不需要目标，但也顺带解析时间/优先级作为 slot。
  const time = extractDate(raw, todayStr);
  const clockIgnored = Boolean(time.date) && hasClock(raw);
  const note = clockIgnored ? '已按日期处理（忽略具体时刻）' : null;

  let core = stripNoise(stripAction(raw, intent), time.matchedText);

  const slots = {};
  if (time.date) slots.dueDate = time.date;

  // —— 隐式新增 ——
  // 句子里没有动词，但形态上就是一条待办（「后天上午9点有月报会议要开」）。
  // 这里只产出「建议」，绝不直接执行：认错了用户回一句"不是"就结束，
  // 认对了则省掉一次"加一条"的输入。代价与收益不对称，所以值得做。
  if (intent === 'suggestAdd') {
    const add = buildAddSlots(raw, core);
    if (!add.title) {
      // 剥完时间和虚词什么都不剩（例如只说"明天"）→ 不是待办
      return { intent: 'unknown', target: null, slots: {}, matches: [], nearMatches: [], confidence: 'low', note: null, raw, needsConfirm: false };
    }
    return {
      intent: 'suggestAdd',
      target: null,
      slots: { ...slots, ...add },
      matches: [],
      nearMatches: [],
      confidence: 'low',
      note,
      raw,
      needsConfirm: true,
    };
  }

  if (intent === 'setPriority') {
    const p = parsePriorityWord(raw);
    if (p) slots.priority = p;
    // 从目标文本中剔除优先级词，仅保留任务关键词。
    const drop = new Set(['高', '中', '低', '最高', '优先级']);
    core = core
      .split(/\s+/)
      .filter((w) => w && !drop.has(w) && !/^[A-Fa-f]$/.test(w) && !/^\([A-Fa-f]\)$/.test(w))
      .join(' ');
  }

  if (intent === 'add') {
    const add = buildAddSlots(raw, core);
    slots.contexts = add.contexts;
    slots.projects = add.projects;
    slots.title = add.title;
    if (add.priority) slots.priority = add.priority;
    return { intent, target: null, slots, matches: [], nearMatches: [], confidence: slots.title ? 'high' : 'low', note, raw, needsConfirm: false };
  }

  if (intent === 'addContext' || intent === 'addProject') {
    const cm = core.match(/@(\S+)/);
    const pm = core.match(/\+(\S+)/);
    if (intent === 'addContext' && cm) slots.context = cleanName(cm[1]);
    if (intent === 'addProject' && pm) slots.project = cleanName(pm[1]);
    const cleaned = core.replace(/[@+]\S+/g, ' ').replace(/\s+/g, ' ').trim();
    const target = buildTarget(cleaned);
    const { matches, nearMatches, confidence } = resolveTarget(target, tasks);
    const low = matches.length === 0 ? 'low' : confidence;
    return { intent, target, slots, matches, nearMatches, confidence: low, note, raw, needsConfirm: false };
  }

  if (intent === 'query') {
    // 「已完成 X」：若 X 构成明确目标（引用/序号，或残余关键词命中活跃任务）→ 按 complete 处理。
    if (raw.startsWith('已完成')) {
      const residualCore = stripNoise(stripAction(raw, 'complete'), time.matchedText);
      const t = buildTarget(residualCore);
      const rr = resolveTarget(t, tasks);
      if (hasExplicitCommandTarget(raw) || (t && rr.matches.length > 0)) {
        const slotsC = {};
        if (time.date) slotsC.dueDate = time.date;
        return {
          intent: 'complete',
          target: t,
          slots: slotsC,
          matches: rr.matches,
          nearMatches: rr.nearMatches,
          confidence: rr.matches.length === 1 ? 'high' : 'low',
          note,
          raw,
          needsConfirm: false,
        };
      }
      return { intent: 'query', target: null, slots, scope: 'done', matches: [], nearMatches: [], confidence: 'high', note, raw, needsConfirm: false };
    }

    // scope：带“已完成”类标记 → done（从 doneEntries 取数），否则 active。
    const scope = DONE_MARKER_RE.test(raw) ? 'done' : 'active';
    const cm = raw.match(/@(\S+)/);
    if (cm) slots.context = cleanName(cm[1]);

    // 残余关键词（查询前缀/查询触发词之外仍残留的疑似标题词）。
    let core = stripAction(raw, 'query');
    if (time.matchedText) core = core.split(time.matchedText).join(' ');
    core = core.replace(/[@+]\S+/g, ' ');
    if (scope === 'done') {
      core = core.replace(/已完成|完成的|做完了的|已办|已勾选/g, ' ').replace(/任务/g, ' ');
    }
    core = core.replace(/[\s，。,.!！?？、；;：:]+/g, ' ').trim();
    core = core
      .replace(/^(的|把|请|帮我|给我|一下|一个|这个|那个)+/, '')
      .replace(/(的|吧|呢|啊|了)+$/, '')
      .trim();
    if (core) slots.keyword = core;

    return {
      intent,
      target: null,
      slots,
      scope,
      matches: scope === 'active' ? tasks.map((t) => t.id) : [],
      nearMatches: [],
      confidence: 'high',
      note,
      raw,
      needsConfirm: false,
    };
  }

  if (intent === 'undo') {
    return { intent, target: null, slots, matches: tasks.map((t) => t.id), nearMatches: [], confidence: 'high', note, raw, needsConfirm: false };
  }

  // 其余均需目标。
  const target = buildTarget(core);
  const { matches, nearMatches, confidence } = resolveTarget(target, tasks);
  const finalConfidence =
    matches.length === 1 && confidence === 'high' ? 'high' : 'low';

  // 唯一命中但"这个查询词只是标题里某个更长词的片段"时，仍然要确认一次。
  //   「完成 报告」只命中 1 条，可"报告"在标题里是"回测报告"的后半截 ——
  //   这种唯一性是假象，直接执行等于替用户做了决定。
  let needsConfirm = false;
  if (finalConfidence === 'high' && target && target.kind === 'keyword' && matches.length === 1) {
    const hit = tasks.find((t) => t.id === matches[0]);
    if (hit && looksLikeFragment(target.value, hit.title)) needsConfirm = true;
  }

  return { intent, target, slots, matches, nearMatches, confidence: finalConfidence, note, raw, needsConfirm };
}

// 供 UI “/ 指令提示面板”使用的动作词表（不含 unknown）。
export const COMMAND_HINTS = [
  { intent: 'add', label: '新增任务', sample: '加一条 明天 交周报', triggers: '加 / 添加 / 新增 / 记一下 / 别忘了' },
  { intent: 'complete', label: '完成任务', sample: '完成 回测报告', triggers: '完成 / 搞定 / 做完了 / 勾掉 / 已办' },
  { intent: 'uncomplete', label: '取消完成', sample: '取消完成 回测报告', triggers: '取消完成 / 恢复 / 撤销完成' },
  { intent: 'delete', label: '删除任务', sample: '删除 回测报告', triggers: '删除 / 删掉 / 去掉 / 移除' },
  { intent: 'postpone', label: '延期', sample: '把 回测报告 延到下周三', triggers: '延期 / 推迟 / 顺延 / 改到 / 挪到' },
  { intent: 'setPriority', label: '设置优先级', sample: '标为高 回测报告', triggers: '标为高/中/低 / 设为(A) / 优先级' },
  { intent: 'setDue', label: '设置截止日', sample: '截止 周五 交报告', triggers: '截止 / 到期 / 死线' },
  { intent: 'query', label: '查询任务', sample: '有哪些任务', triggers: '有哪些 / 列出 / 看看 / 逾期 / 待办' },
  { intent: 'addContext', label: '加分类', sample: '把 回测报告 归到 @工作', triggers: '加分类 / 归到 @x' },
  { intent: 'addProject', label: '打标签', sample: '给 回测报告 打标签 +复盘', triggers: '打标签 +y' },
  { intent: 'star', label: '星标', sample: '星标 回测报告', triggers: '星标 / 加星 / 打星' },
  { intent: 'undo', label: '撤销上一步', sample: '撤销', triggers: '撤销 / 回退' },
];
