// 本地自然语言规则解析器（纯函数，仅依赖 dayjs，不发任何网络请求）。
//
// 设计目标：宁可不做也不做错。当规则命中但指代不明确（序号越界 / 关键词多命中）时，
// 返回 confidence:'low' 并把候选（matches）交回上层，由 useChatAgent 进入澄清流程，
// 而不是擅自猜测执行。
//
// parseIntent(text, ctx) -> Intent
//   ctx: { tasks: Task[], today: 'YYYY-MM-DD', tools?: Tool[], memory?: {lastTaskId, lastCandidates} }
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
import { hanLength, rankBySimilarity, rankByFuzzy } from './textScore.js';
import { matchTool } from './toolMatch.js';
import { detectRef, resolveRef } from './nlRef.js';

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
//
// 长尾条目（删了 / 办了 / 结了 / 延一延 / 收藏 / 置顶 / 提醒我 …）来自
// scripts/qa-nl-heldout.mjs 的实测缺口：那些说法此前一律判 unknown。
const TRIGGERS = {
  add: ['帮我记一下', '帮我记', '记一下', '记一条', '记一笔', '记录一下', '添加一条', '添加任务', '新建一条任务', '加个提醒', '设个提醒', '提醒我', '备忘', '待办', '写下', '写上', '添加', '新增', '新建', '加一条', '加个', '别忘记', '别忘了', '记得', '记个', '记下', '加', '记'],
  complete: ['已完成', '做完了', '弄完了', '搞定了', '打完收工', '处理完', '弄完', '搞定', '勾掉', '划掉', '已办', '收工', '做完', '完成掉', '办完了', '办了', '办完', '结了', '结掉', '干完', '搞完', '弄好', '做掉', '还掉', '还完', '还清', '交掉', '写掉', '整掉', '完成'],
  uncomplete: ['取消完成', '撤销完成', '恢复完成', '取消已办', '恢复'],
  delete: ['黄了', '清理掉', '不想要了', '删干净', '清干净', '不用做了', '不需要做了', '不必做了', '不用再留', '不用留', '不留了', '不要了', '不用了', '删除', '删掉', '删了', '撤掉', '撤了', '清了', '扔了', '丢了', '干掉', '取消掉', '去掉', '移除', '清掉', '扔掉', '毙掉', '抹掉'],
  postpone: ['往后压', '延期到', '推迟到', '顺延到', '往后挪', '往后推', '往后放', '往后拖', '延一延', '推一推', '缓一缓', '挪一挪', '拖一拖', '延期', '推迟', '延后', '顺延', '拖到', '拖后', '延到', '挪到', '改到', '推后', '挪后'],
  setPriority: ['排到头', '头一份', '排第一', '改为优先级', '改优先级', '设置优先级', '提到最高级', '设为最高级', '顶到最高', '提到最高', '优先级', '置顶', '标为', '设为', '设置为', '降为', '顶格'],
  setDue: ['截止日期', '截止到', '提前到', '提前至', '提早到', '提早至', '截止', '到期', '死线', 'deadline', 'ddl'],
  addContext: ['加入分类', '加个分类', '加分类', '归类到', '归类为', '归档到', '归入', '归到', '扔到', '放到'],
  addProject: ['打个标签', '加个标签', '打标签', '加标签', '加个项目', '加项目', '加个', '打个', '贴上', '贴个'],
  star: ['五角星', '打星标', '加个星', '打个星', '点个星', '标星', '星标', '加星', '打星', '收藏'],
  query: ['有哪些任务', '有什么任务', '列出任务', '列一下', '列下', '列出', '有哪些', '有什么', '看看', '看一下', '看下', '查看', '查一下', '查查', '查', '搜索一下', '搜索', '待办', '今天要做什么', '今日待办', '做了哪些', '哪些事', '哪些', '最近', '逾期', '已完成', '做完的', '完成的', '干啥', '要干', '剩什么', '剩下什么', '还剩', '剩啥', '要做的', '没做完', '没做'],
  undo: ['撤销上一步', '撤销刚才', '撤销', '回退', 'undo'],
};

// 需要剥离的虚词/语气词（用于从剩余文本中提炼关键词）。
const PARTICLES = ['里的任务', '的任务', '里的', '的', '把', '将', '给', '帮我', '请', '麻烦', '一下', '一个', '这条', '那条', '这个', '那个', '吧', '呢', '啊', '。', '，', ',', '。', '！', '!', '?', '？'];

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
  '今日安排',
  '今天安排',
  '本周安排',
  '这周安排',
  '下周安排',
];

// query 的“已完成”标记 → scope:'done'
const DONE_MARKER_RE = /已完成|完成的|做完了的|已办|已勾选|做了哪些|做过的|办过的|干过的|完成了哪些/;

// 特指疑问句开头 = 在问事情，不是在下命令。
// 「哪些事拖到期了」里的"到期"是提问内容，旧逻辑会把它当成 setDue 的动作动词。
const INTERROGATIVE_HEAD_RE = /^(哪些|哪个|哪件|哪几条|有什么|有哪些|还有几|还有多少|有几个|几件|几个|多少|谁|何时|怎样|怎么办)/;

// 疑问句常有的语气/时间前垫：「现在手上还有几件事」真正的疑问词在第三拍上。
const INTERROGATIVE_LEAD_RE =
  /^(?:现在|目前|当前|眼下|请问|我想问|想问一下|帮我看看|那|那么|我?手上|我?手头|我?手里|我这儿|我这边)+/;

function isInterrogative(text) {
  return INTERROGATIVE_HEAD_RE.test(String(text || '').replace(INTERROGATIVE_LEAD_RE, ''));
}

// 「复查/检查/排查」里的"查"不是"查任务"的查 —— contains 型查询判定前先抹掉这些复合词。
const COMPOUND_VERB_RE = /复查|检查|排查|稽查|暗查|比对|监察|审查|初审|探察/g;

// query 的“逾期”标记 → scope:'overdue'（只列 dueDate 已过的活跃任务）。
// 单独一个 scope 而不是关键词：用户问的是“哪些过期了”，把"到期"当标题词去检索
// 会查不到东西，接着反问"要不要新建一条「到期」"，属于典型答非所问。
const OVERDUE_MARKER_RE = /逾期|超期|过期|拖到期|压到期|到期了|延宕|该做没做/;

// 疑问框架里的虚词 —— 它们在查询句里只承担提问功能，几乎不可能是任务标题。
// 不剥掉就会污染关键词，进而触发上面那种"要不要新建「哪些事」"的错答。
const QUERY_NOISE_RE =
  /哪些事|哪些|哪个|哪件|哪几条|哪些个|有什么|有哪些|还有几件|还有几|还有多少|还有几个|还有|还剩|剩下|剩余|有几个|几件|几个|多少|啥没办|没办|啥|手上|手头|手里|现在|目前|当前|到底|快到了|还没|拖着|到期了|拖到期|事情|事由/g;

function isQueryPrefixed(text) {
  return QUERY_PREFIXES.some((p) => text.startsWith(p));
}

// —— 极性护栏 ——
//
// 动词认出来了不等于该动手。「不要完成述职材料」里"完成"确实在句中，
// 可用户说的是**别做**；「要不要把租约改到下周？」压根是在问意见。
// 这两种情况一旦执行，就是本项目代价最高的一类错误（用户明确说别做，它做了），
// 所以宁可整句交回上层，回一句"我没动"。
//
// 否定词表刻意排掉了复合词：「别墅」「级别」「特别」里的"别"不是否定。
// 判据也不是"句中有否定词"，而是"否定词后面确实跟着一个命令动词" ——
// 否则「租约不要了」（delete 触发词本身就是"不要了"）会被自己的护栏掐死。
// 「不需要」单列：表里原本只有"不用/不必"，而「不需要完成X」字面上就摆着"完成"，
// 没有这条否定词，护栏压根不看它 —— 第八轮实测把一句拒令读成了勾掉任务。
const NEGATION_RE =
  /不需要|不要|不用|不必|不能|不该|不准|先别|暂不|暂时不|千万不|请勿|勿|甭|(?<![级特识区鉴辨分告永离送道话])别(?!墅|的|人|处|名|致|说|样|称|院|家|字|号)/;

// 征询/疑问语气：句中出现即视为"在问"，不是"在命令"。
// 句末问号单列 —— 「把租约改到下周？」也是征询，不是指令。
const CONSULT_RE =
  /要不要|需不需要|该不该|能不能|可不可以|可不可|行不行|是不是|好不好|对不对|怎么办|干嘛|拿个主意|拿主意|该选哪|怎么选好|吗[？?。！!\s]*$|呢[？?。！!\s]*$|[?？]\s*$/;

// 否定词是否真的辖住了一个命令动词。
//
// 「不用X了 / 不必X了 / 不想X了」一族必须先跳过：它本身就是 delete 的触发词
// （框式说法，X 是开放集），同时也是否定词的字面。不跳过的话
// 「办公室绿植不用换了三季度发票核完」里的"不用"会被当成在否定后面的"核完"，
// 整句被判成"叫我不做"而拒答 —— 可用户说的两件事恰恰都是要做的。
//
// 但第八轮的实测证明"无条件跳过"更危险：「不要删了这条」和「办公室绿植不用换了」
// 是同一个框，意思却正好相反，跳过时它会把用户明说"别删"的任务删掉。
// 出路是看"了"后面还剩什么，这一步不需要词典：
//   什么都不剩        → 框说的是"这件事不再需要了"  → delete
//   还剩一句自己的动作 → 那是后半句话，两件事各自成立  → 跳过，交给 multi 拆
//   只剩一个宾语      → "了"属于框里的动词，否定确实辖住了它 → 拒答走澄清
const SELF_NEG_BARE_RE = /^(?:不用|不必|不需要|不想|不要)了/;
const SELF_NEG_FRAME_RE = /^(?:不用|不必|不需要|不想|不要)([\u4e00-\u9fff]{1,3})了/;
// 语气尾巴不算宾语：「不用删了吧」「这条不要了哦」。
const TONE_TAIL_RE = /^[\s。，,、！!？?；;啊呢吧呀哦噢嗯哈]+$/;

function isSelfCommandFrame(text, index) {
  const rest = text.slice(index);
  if (SELF_NEG_BARE_RE.test(rest)) return true;
  const m = SELF_NEG_FRAME_RE.exec(rest);
  if (!m) return false;
  const after = rest.slice(m[0].length);
  if (!after || TONE_TAIL_RE.test(after)) return true;
  return hasCommandAfter(after, text);
}

function hasCommandAfter(after, text) {
  return COMMAND_RULES.some((r) => (r.when ? r.when(text) : true) && r.re.test(after));
}

// 框式说法在否定词位上出现，且"了"后面只剩宾语 —— 那个动词就是被否定的对象，
// 不必再等它撞上词表（「不要勾了这条」里的"勾"压根不在表里，等就漏了）。
function hasNegatedCommand(text) {
  const t = String(text || '');
  const re = new RegExp(NEGATION_RE.source, 'g');
  let m;
  while ((m = re.exec(t))) {
    if (isSelfCommandFrame(t, m.index)) continue;
    const frame = SELF_NEG_FRAME_RE.exec(t.slice(m.index));
    if (frame) return true;
    const after = t.slice(m.index + m[0].length);
    if (hasCommandAfter(after, t)) return true;
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return false;
}

// —— 「未 V / 没 V / 还没 V」—— 第八轮补的另一族否定，判据必须比上面那族**窄**。
//
// 第八轮首跑抓到「需求文档未完成」被判成 complete/high —— 会把任务直接勾掉，
// 动作与用户意思正好相反。第七轮的护栏是按词加的（别/不要/不用一族），
// 而 uncomplete 的正则锚在句首（^恢复|取消完成|…），接不住句中的「未完成」，
// 于是 complete 抢先命中。「发票还没核完」落在 unknown 纯属侥幸：
// 「核完」本来就不在词表里。
//
// 为什么这一族不能沿用"否定词之后某处有动词"的宽判据：
//   「把没用的那条删了」里的"没"是定语（没用的），它管不住句末的"删了"。
//   宽判会把这条正常的删除掐死。所以只认**否定词紧贴命令动词**：
//   未完成 / 还没核完 / 没填过 —— 中间隔了定语就不算。
const PREVERBAL_NEG_RE = /还没|尚未|未曾|没能|没有|没|未/g;

function hasUnrealizedComplement(text) {
  const t = String(text || '');
  const re = new RegExp(PREVERBAL_NEG_RE.source, 'g');
  let m;
  while ((m = re.exec(t))) {
    const after = t.slice(m.index + m[0].length);
    const hit = COMMAND_RULES.some((r) => {
      if (r.when && !r.when(t)) return false;
      const v = r.re.exec(after);
      return Boolean(v) && v.index === 0; // 必须从第 0 个字就开始是动词
    });
    if (hit) return true;
    if (m[0].length === 0) re.lastIndex += 1; // 防空转
  }
  return false;
}

const REFUSAL_NOTE = {
  negated: '句中有「别 / 不要」，按"叫我不做"处理',
  unrealized: '句中是「未 / 没 + 动词」，按"还没做"处理',
  consult: '这句是在征求意见，不是命令',
};

// 只拦会改数据的意图：查询/撤销/开工具没有极性风险，照常走。
function refusalReason(text, act) {
  if (!MUTATING_INTENTS.has(act) && act !== 'add' && act !== 'suggestAdd') return null;
  if (CONSULT_RE.test(text)) return 'consult';
  if (hasNegatedCommand(text)) return 'negated';
  if (hasUnrealizedComplement(text)) return 'unrealized';
  return null;
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
// 顺序只用于**同一位置上的并列裁决** —— 真正的胜负手是动作在句中的位置
// （见 detectAction 的"最靠前动作优先"）。
const COMMAND_RULES = [
  { intent: 'uncomplete', re: /^恢复|取消完成|撤销完成|恢复完成|取消已办/ },
  // 末尾那一支是**结果补语**结构（V+完/好/掉/妥[+了]，且必须在句尾），不是动词枚举。
  // 词表再宽也列不完"核完、码完、付掉、填好、整完…"——动词是开放集，补语只有四个。
  // 认结构而不是认词，一处规则接住一整族说法，这是本轮补漏里性价比最高的一条。
  // 三道护栏都为了压住误报（认错比漏认更伤）：
  //   ① 句尾锚定：「看完电影再买爆米花」里的"看完"不在句尾，不算完成命令；
  //   ② 前一词否定/修饰屏蔽：还没写好、别弄好、要备好、比较好 一律不算；
  //   ③ 「很好/最好」这类程度词+好 由 ② 的 很/挺/太/更/就/最 挡住。
  { intent: 'uncomplete', re: /^恢复|取消完成|撤销完成|恢复完成|取消已办/ },
  { intent: 'complete', re: /完成|搞定|做完了|做完|弄完|勾掉|划掉|已办|收工|办了|办完|结了|结掉|干完|搞完|弄好|处理完|做掉|还掉|还完|还清|(?:交|写|弄|搞|整)掉|(?:回|回复|答复|处理|解决)了(?=$|[。！？!?\s])|(?:报|交|提交|发|回复|答复|联系|问|说|弄|做)过了/ },
  // 「不用换了 / 不必去了 / 不想做了」是**框式**说法（不用 X 了），X 是开放集。
  // 词表里原有的"不用了/不必做了"只能命中 X 恰好为空或为"做/了"的情况，
  // 「办公室绿植不用换了」这种把动词塞进框中间的写法一律漏掉。
  // 中间限 1~3 字：再长就会跨到下一个子句去。
  // 「黄了」是口语里"告吹/作废"的专职说法，没有别的读法。
  {
    intent: 'delete',
    re: /删除|删掉|删了|删干净|清干净|撤掉|撤了|清了|扔了|扔掉|丢了|抹掉|干掉|去掉|移除|清理掉|清掉|毙掉|取消掉|不想要了|不用做了|不做了|不需要做了|不必做了|不要了|不用了|不用留|不用再留|不留了|作废|不用去了|不必去了|不去了|去不了|黄了|(?:不用|不必|不需要|不想|不要)(?:[\u4e00-\u9fff]{1,3})?了/,
  },
  { intent: 'postpone', re: /延期|推迟|顺延|延到|挪到|改到|延后|推后|挪后|拖后|往后拖|往后挪|往后推|往后放|往后压|拖到|延一延|推一推|缓一缓|挪一挪|拖一拖/ },
  { intent: 'setPriority', re: /标为|标成|设为|设置为|优先级|顶格|顶到最高|提到最高|降为|置顶|定为|放最前|放到最前|排最前|排在最前|最前面|先做|最要紧|要紧|排到头|头一份|排第一|排到第一|放到第一|放第一/ },
  // 「提前到 / 提早到」归 setDue 而不是 postpone：两者都只改 dueDate，
  // 但 postpone 的回复文案是「已延期到…」，用户说的是提前，回一句"延期"等于答反了。
  // 必须带「到/至」才算 —— 裸「提前」（「提前完成年报」）里的"提前"是修饰语，不是命令。
  // 「设到 / 设成」只有后面**真的接日期**才算改截止日 ——
  // 「把优先级设成高」里它俩属于 setPriority，裸收会抢走那句。
  // 这一支是带前瞻的结构，不进 TRIGGERS（词表里也没有能独立成立的"设到"）。
  { intent: 'setDue', re: /截止|到期|死线|提前到|提前至|提早到|提早至|(?:设到|设成|调整到)\s*(?=[\d下本这明后前周礼拜月底月初国庆十一元旦春节中秋端午])|deadline|ddl/i },
  { intent: 'addContext', re: /加分类|归类到|归类为|归到|归入|归档到|加入分类|加个分类|扔到|放到/, when: (t) => /@\S+/.test(t) },
  { intent: 'addProject', re: /打标签|加标签|加个项目|加项目|打个标签|加个标签|贴个|贴上|加个|打个/, when: (t) => /\+\S+/.test(t) },
  { intent: 'star', re: /星标|标星|加星|打星|打个星|加个星|点个星|收藏|点个星|五角星|点个五角星/ },
  // 多字触发词必须排在裸「加」之前：正则在同一个位置上按"书写顺序"取第一条能匹配的分支，
  // 「加一条 3号 交税」若先撞上裸「加」，就会把「一条」留在标题里。
  // 同理「加个提醒」要排在「加个」前面，否则标题里会剩下一个"提醒"。
  { intent: 'add', re: /添加|新增|新建|记一下|记一条|记一笔|记下|记个|帮我记|别忘了|别忘记|记得|记录|提醒我|设个提醒|备忘|待办|写下|写上|加一条|加个提醒|加个|加/ },
  // —— 结果补语结构（**必须排在最后**）——
  // 「干掉 / 扔掉 / 清掉 / 去掉」这些既是"V+掉"又早就是 delete 的词，
  // 和结构式补语撞在同一个句尾位置上。detectAction 同位置按规则书写顺序裁决，
  // 所以这条排在 delete 之后，「把收集箱任务干掉」才会仍是 delete。
  // 反面断言见 nlRules.test：「把 收 集箱任务 干掉」不许变成 complete。
  //
  // 词表再宽也列不完"核完、码完、付掉、填好、整完…"——动词是开放集，补语只有四个。
  // 认结构而不是认词，一处规则接住一整族说法。三道护栏压住误报（认错比漏认更伤）：
  //   ① 句尾锚定：「看完电影再买爆米花」里的"看完"不在句尾，不算完成命令；
  //   ② 否定/修饰前缀屏蔽：还没写好、别弄好、要备好、比较好 一律不算；
  //   ③ 程度词+好 屏蔽：很好 / 挺好 / 最好 / 更妥 不当命令读。
  {
    intent: 'complete',
    re: /(?<!先)(?<!准)(?<!要)(?<!会)(?<!别)(?<!没)(?<!未)(?<!不)(?<!比)(?<!很)(?<!挺)(?<!太)(?<!更)(?<!就)(?<!最)[\u4e00-\u9fff](?:完|好|掉|妥)(?:了)?(?=$|[。！？!?])/,
  },
];

// 「待办 / 备忘 / 提醒我」这类前缀既能当查询词也能当命令词，分界只看后面还有没有实义内容：
//   「待办」          → 查询（后面什么都没有）
//   「待办 周五 交材料」→ 新增（剥掉前缀与时间后还剩「交材料」）
const TODO_PREFIX_RE = /^(?:待办|备忘|提醒我|设个提醒|加个提醒|写下|写上|todo)[：:，,、]?\s*(.*)$/i;

// 句中 contains 型查询词（仅在无任何命令触发词时生效）。
//
// 不要在这里放单字动词：曾经有过一个裸的 `查`，于是「下周三去医院复查」
// 被判成 query —— 「复查」里的"查"和"查任务"的"查"完全是两回事。
// 单字动词的命中率高得毫无意义，宁可只留多字组合（查一下 / 查查 / 查看）。
const QUERY_CONTAINS_RE = /有哪些|有什么|列出|列一下|看看|看一下|看下|查看|查一下|查查|搜索|待办|今天要做什么|今日待办|逾期|干啥|要干|还剩|剩啥|剩下什么|要做的|要办的|没做完|没做|没办|做了哪些|做过的|哪些事|哪些|要处理|处理哪些|有啥|还有啥/;

// 句尾疑问框架。判定的是"这句话的落点在提问上"，所以只认**收尾**的疑问短语
// （用 $ 锚定），句中出现不算 —— 否则「查一下有哪些逾期」这种本来就合法的查询
// 会被重复触发，而「把 有哪些 那几条删了」这种拿标题当句子的情况交给引号/序号判定。
const QUERY_TAIL_RE =
  /(有哪些|有什么|有啥|都有什么|是哪几条|是哪几个|哪几件|哪几笔|剩什么|还剩什么|剩下什么|还剩啥|剩啥|还有啥|还有什么|几件|几笔|几个|哪几条|哪些|怎么着|来着|到期了|逾期了|过期了)[？?。!！\s]*$/;

// —— 隐式新增 ——
// 本引擎最大的盲区：人写待办是"内容式"的，句子里根本没有动词。
//   「后天上午9点有月报会议要开」「周四下午要交周报」「10月8日 体检」
// 这些不是"没听懂"，而是意图藏在句式里。
//
// 判据故意收得很紧（时间表达 + 非疑问），因为判错的代价是凭空多出一条任务。
// 而且隐式新增永远只产出「建议」，绝不直接写文件——用户回一句"不是"就结束。
const QUESTION_RE = /[?？]|吗[。!！\s]*$|呢[。!！\s]*$|怎么样|如何|为什么|是不是|对不对|好不好|干嘛|怎么办/;

// 感想句 vs 待办句的分界。旧引擎只看"有没有时间"，于是「今天天气不错」
// 被当成一条待办（它有"今天"）。判据改为两条同时成立才怀疑是感想：
//   有评价/状态词 + 全句找不到任何动作或事项线索。
// 评价词单独不够（「周五要交的材料有点烦」既是感想也是待办），所以配 TASK_MARK 反查。
const EVALUATIVE_RE = /不错|挺好|很好|真好|不舒服|难受|开心|无聊|有点烦|太热|太冷|下雨|下雪|转凉|累得很|真不错/;
const TASK_MARK_RE =
  /要|得|去|做|办|交|写|买|看|查|参加|开|约|准备|处理|汇报|会议|体检|面试|上课|提交|订|弄|带|接|送|还|缴|跑|签|发|谈|碰|对齐|复盘|材料|报告|费|单据|例会|周会|电话会|课程|考试|续约|报销/;

function looksImplicitAdd(text, todayStr) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (QUESTION_RE.test(t)) return false; // 疑问句不是待办
  if (t.length < 3) return false;
  if (EVALUATIVE_RE.test(t) && !TASK_MARK_RE.test(t)) return false; // 只是句感想
  // 必须有"任务式时间"：能解析成日期（含周范围词），或含具体时刻。
  // 「我今天很累」没有时间 → 不判；「明天天气怎么样」有时间但是疑问句 → 不判。
  return Boolean(extractDate(t, todayStr).date) || hasClock(t);
}

// 句首窗口：开头这几个字里出现的触发词，才算"用户真正在下达的命令"。
// 「加一条 12月31日 前完成年报」——句首的"加一条"是命令，句中的"完成"是任务内容。
// 口径与 toolMatch.HEAD_WINDOW 共用同一个常量，改一处即可。
//
// 但"在窗口内"不等于"是命令"：旧实现拿 8 字窗口做子串扫描，于是
// 「把 星标任务 干完」窗口里的"星标"（其实是任务名的一部分）抢走了句末真正的动词"干完"。
// 现在只认**开口就说**（index 0）的触发词 —— 那是"我先说要干什么"的汉语语序；
// 剩下的交给 detectAction 里"离两端越近越像命令"的位置打分去裁决。
function matchRuleAtHead(text) {
  if (!text) return null;
  for (const rule of COMMAND_RULES) {
    if (rule.when && !rule.when(text)) continue;
    const m = text.match(rule.re);
    if (m && m.index === 0) return rule;
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
//   → 句首窗口内的命令触发词 → 工具路由（tool.open）→ 句中触发词（时间前置的跳过）
//   → 句中查询词 → 隐式新增 → unknown
//
// tool.open 的位置是有讲究的：**排在句首命令之后、句中规则之前**。
//   · 排在句首命令之后 —— 「加一条 打开阀门」里的"打开"是任务内容，命令优先；
//   · 排在句中规则之前 —— 「算一下耐热指数」在句中规则里什么都不命中，
//     但它是明确的"打开工具"请求；而打开工具没有副作用，按代价不对称可以放宽。
export function detectAction(text, todayStr, tools) {
  const t = String(text || '').trim();
  if (!t) return 'unknown';

  if (/^撤销$|^回退$|^undo$/i.test(t) || /撤销上一步|撤销刚才|回退一步/.test(t)) return 'undo';

  // 「已完成 …」歧义：句首为“已完成”。带引用/序号目标 → complete；否则先按 query，
  // 是否升级为 complete（残余关键词命中）由 parseIntent 依据 ctx.tasks 决定。
  if (t.startsWith('已完成')) {
    return hasExplicitCommandTarget(t) ? 'complete' : 'query';
  }

  // 特指疑问句开头：先于一切命令判定（问东西不是下命令）。
  if (isInterrogative(t) && !hasExplicitCommandTarget(t)) return 'query';

  // 「待办 周五 交材料」：前缀后面还有实义内容（剥掉时间后≥2汉字）→ 这是一条新增，不是查询。
  // 「待办」/「待办有哪些」：剩余为空或本身是查询短语 → 仍走查询。
  const todoPrefix = t.match(TODO_PREFIX_RE);
  if (todoPrefix) {
    const residual = String(todoPrefix[1] || '');
    const matched = extractDate(residual, todayStr).matchedText;
    const stripped = matched ? residual.split(matched).join(' ') : residual;
    if (!QUERY_CONTAINS_RE.test(residual) && hanLength(stripped) >= 2) return 'add';
  }

  // 查询强前缀优先（且无明确命令目标指向）→ query。
  if (isQueryPrefixed(t) && !hasExplicitCommandTarget(t)) return 'query';

  // 开口就说的触发词：最高优先级，句首说了什么就是什么。
  const headRule = matchRuleAtHead(t);
  if (headRule) return headRule.intent;

  // 句尾是疑问框架 → 整句是在问清单，不是下命令。
  // 「没做完的有哪些」「财务那边剩什么」—— 疑问词长在尾巴上，句里的"做完/到期"
  // 其实是**查询条件**。旧实现让 COMMAND_RULES 的位置打分先抢，于是"哪些事压到期了"
  // 变成 setDue、"没做完的有哪些"变成 complete —— 全部答非所问。
  // 排在句首命令之后：「有哪些」类前缀早已被 isQueryPrefixed 接走，这里是补"后缀式"的问法。
  if (QUERY_TAIL_RE.test(t) && !hasExplicitCommandTarget(t)) return 'query';

  // 工具路由：只在这一句确实指向某个已登记工具时才成立（匹配层自带阈值）。
  if (Array.isArray(tools) && tools.length && matchTool(t, tools)) return 'tool.open';

  // 句中触发词：**离句首/句尾越近，越像命令**。
  // 旧实现按规则表顺序扫全句，于是「把 星标任务 干完」里句中根本没写出来的"星标"
  // 赢了句末真正说出口的"干完"。
  // 光按"最先出现"也不对 —— 汉语的命令动词要么开头说（「删了 X」）要么收尾说（「X 干完」），
  // 夹在中间的动词大概率是任务名的一部分（「星标任务」「复查」）。所以取"到两端的最短距离"。
  let best = null;
  COMMAND_RULES.forEach((rule, order) => {
    if (rule.when && !rule.when(t)) return;
    const m = t.match(rule.re);
    if (!m) return;
    if (timeBefore(t, m.index, todayStr)) return; // 时间修饰的是内容，不是命令
    const edge = Math.min(m.index, t.length - (m.index + m[0].length));
    if (!best || edge < best.edge || (edge === best.edge && order < best.order)) {
      best = { intent: rule.intent, index: m.index, edge };
    }
  });
  if (best) return best.intent;

  // 无任何命令触发词时，才判定查询。复合动词（复查/检查）不参与。
  if (isQueryPrefixed(t) || QUERY_CONTAINS_RE.test(t.replace(COMPOUND_VERB_RE, ' '))) return 'query';

  // 最后才谈隐式新增：前面所有明确形式都不成立，才考虑"这是不是一句待办描述"。
  if (looksImplicitAdd(t, todayStr)) return 'suggestAdd';

  return 'unknown';
}

// 剥离动作触发词，返回剩余文本。
// 用规则自身的正则剥（而不是回查词表）：检测与剥离共用同一份口径，
// 不会出现"认得出 删了 却剥不掉 删了"这种错位。
function stripAction(text, intent) {
  // 同一意图可能有多条规则（complete：词表一条 + 结果补语结构一条）。
  // 取**最靠左**的那次命中：一个意图的规则本质是同一个词族的不同形态，
  // 但残留文本是按"用户先说的就是命令"来理解的，位置才是准绳。
  const rules = COMMAND_RULES.filter((r) => r.intent === intent);
  let best = null;
  for (const rule of rules) {
    const m = String(text).match(rule.re);
    if (m && m[0] && (best === null || m.index < best.index)) best = m;
  }
  if (best && best[0]) {
    return cleanDangling(`${text.slice(0, best.index)} ${text.slice(best.index + best[0].length)}`);
  }
  const list = TRIGGERS[intent] || [];
  for (const trig of list) {
    const idx = text.indexOf(trig);
    if (idx !== -1) {
      return cleanDangling(`${text.slice(0, idx)} ${text.slice(idx + trig.length)}`);
    }
  }
  return text;
}

// 剥掉动词后残留的孤立体貌字与量词框架：
// 「把X这个任务完成掉」剥掉"完成"会剩下一个"掉"，「加一条 交税」剥掉"加"会剩下"一条"。
function cleanDangling(text) {
  return String(text)
    .replace(/(^|\s)[了掉完光过我](?=\s|$)/g, ' ')
    .replace(/(^|\s)(?:一|两|几)(?:条|个|项)(?=\s|$)/g, ' ');
}

// 剥离虚词与时间片段（含时刻），返回“核心剩余文本”。
function stripNoise(text, timeText) {
  let out = ` ${text} `;
  // 汉字序数先归一成阿拉伯数字：「第一个」里含着 PARTICLES 的「一个」，
  // 下面那轮虚词剥离会把它挖成「第」，序号通道就此失效（表现为"说了第几条却说没找到"）。
  // 选归一而不是加白名单：下游（buildTarget、澄清回填）本来就按数字口径写，
  // 白名单只修这一处，归一把两类写法并成一条路。
  out = out.replace(/第\s*([一二三四五六七八九十两]{1,3})(?=\s*(?:条|个|项|名|号))/g, (whole, g) => {
    const n = parseNum(g);
    return Number.isFinite(n) ? `第${n}` : whole;
  });
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
  out = out.replace(/[0-9一二三四五六七八九十两]{1,3}\s*(?:天|个?周|个?星期|个?礼拜|个?月)(?=\s|$)/g, ' ');

  out = out.replace(/\s+/g, ' ').trim();
  // 被空格隔开的单字副词是独立片段（"这条 也 标成高"），留着它会盖掉回指。
  // 只认整块单字，所以"也门局势""都市场景"这类连写内容不受影响。
  out = out
    .split(' ')
    .filter((w) => w && !/^[也就还便又再先]$/.test(w))
    .join(' ')
    .trim();
  // 句尾语气助词 + 句中副词残留（"把这条也"剥掉动作词后只剩"也"，
  // 留着它会盖掉真正的回指，让「把这条也标成高」被当成关键词检索）
  out = out.replace(/(?:的|吧|呢|啊|了|啦|呀|嘛|也|还|就|便|又|再)+$/, '').trim();
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

  // 「2028年3月5日」必须整段吃掉：只匹配「3月5日」会丢掉年份，
  // 再经"当年已过则算次年"那条规则，2028 会被悄悄改写成 2027 ——
  // 落错年份比不落日期更伤（用户以为记对了）。
  m = t.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
  if (m) {
    const d = dayjs(`${m[1]}-${pad2(m[2])}-${pad2(m[3])}`);
    if (d.isValid()) return { date: fmt(d), matchedText: m[0], clockIgnored: false };
  }

  // 数量词支持阿拉伯与中文两种写法：「3天后」和「三天后」都得认；「两天以后」同族。
  m = t.match(new RegExp(NUM_SRC + '\\s*天\\s*(?:以后|之后|后)'));
  if (m) return { date: fmt(today.add(parseNum(m[1]), 'day')), matchedText: m[0], clockIgnored: false };

  // 周/星期/礼拜 前面允许量词「个」：「三个星期以后」和「三周以后」是一个意思。
  m = t.match(new RegExp(NUM_SRC + '\\s*个?\\s*(?:周|星期|礼拜)\\s*(?:以后|之后|后)'));
  if (m) return { date: fmt(today.add(parseNum(m[1]) * 7, 'day')), matchedText: m[0], clockIgnored: false };

  // 「三天内 / 两周内 / 5天以内」：时长上限本身就是一种截止 —— "三天内写完"落到的日子
  // 就是"第 3 天"。注意必须有"内/以内"才算：光说「弄它个三天」是耗时估计，不是期限。
  m = t.match(new RegExp(NUM_SRC + '\\s*(个?月|天|个?周|个?星期|个?礼拜)\\s*(?:以内|之内|内)'));
  if (m) {
    const n = parseNum(m[1]);
    if (Number.isFinite(n)) {
      const unit = m[2];
      const d = /月/.test(unit) ? today.add(n, 'month') : today.add(/天/.test(unit) ? n : n * 7, 'day');
      return { date: fmt(d), matchedText: m[0], clockIgnored: false };
    }
  }

  // 偏移词在前、数量在后：「往后挪一周」「推后 3 天」「延两个月」「拖后 5 天」
  // 长词必须排在短词前面（往后挪 > 往后、拖后 > 拖），否则"挪/后"字会被剩下，数量词匹配不到
  m = t.match(new RegExp('(?:往后压|往后挪|往后推|往后拖|往后|拖后|推后|顺延|延后|推迟|挪后|压|拖|延)\\s*' + NUM_SRC + '\\s*(个?月|天|个?周|个?星期|个?礼拜)'));
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

  // 「过两天 / 再过 3 天 / 过几周」—— 和「N天后」同族，但前置词是"过"。
  // 「几」没有确切数量，取 3：待办要落一个具体日子，模糊表达宁可不落也不空着。
  m = t.match(new RegExp('(?:再过|过)\\s*(?:' + NUM_SRC + '|几)\\s*(个?月|天|个?周|个?星期|个?礼拜)'));
  if (m) {
    const raw = m[1] === '几' || m[1] === undefined ? '三' : m[1];
    const n = parseNum(raw);
    if (Number.isFinite(n)) {
      const unit = m[2];
      const d = /月/.test(unit) ? today.add(n, 'month') : today.add(/天/.test(unit) ? n : n * 7, 'day');
      return { date: fmt(d), matchedText: m[0], clockIgnored: false };
    }
  }

  const wd = t.match(/((?:上上|上个|上|下下|下个|下|这|本)\s*个?)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天])/);
  if (wd) {
    const prefix = wd[1] || '';
    const iso = WEEKDAY_ISO[wd[2]];
    const mondayThis = today.subtract(isoDow(today) - 1, 'day');
    let baseWeek = mondayThis;
    if (prefix.includes('下下')) baseWeek = mondayThis.add(14, 'day');
    else if (prefix.includes('下')) baseWeek = mondayThis.add(7, 'day');
    else if (prefix.includes('上上')) baseWeek = mondayThis.subtract(14, 'day');
    else if (prefix.includes('上')) baseWeek = mondayThis.subtract(7, 'day');
    let date = baseWeek.add(iso - 1, 'day');
    // 无前缀时表示“即将到来的周X”：若本周该日已过则顺延至下周。
    if (!prefix && date.isBefore(today, 'day')) date = date.add(7, 'day');
    return { date: fmt(date), matchedText: wd[0], clockIgnored: false };
  }

  // —— 周范围词 ——
  // 必须排在"下周三"之后：否则「下周一」会被「下周」抢走。
  // 也不能裸匹配「周」——「第10周回测报告」里的周不是时间。
  const mondayThis = today.subtract(isoDow(today) - 1, 'day');

  // 「下周初 / 下下周头」：初、头 = 该周第一天。
  // 必须排在下面那组"周范围词"之前 —— 否则「下下周初」会被裸「下下周」抢走，
  // 而周范围词的口径是"取该周最后一天"，正好把用户说的"初"翻成了相反的一端。
  // 刻意不收无前缀的裸「周初」：不知道是哪一周，宁可不落。
  m = t.match(/(下下|下个|下|这|本)\s*个?\s*(?:周|星期|礼拜)\s*(?:初|头|开始|伊始)/);
  if (m) {
    const p = m[1];
    let mon = mondayThis;
    if (p.includes('下下')) mon = mon.add(14, 'day');
    else if (p.includes('下')) mon = mon.add(7, 'day');
    return { date: fmt(mon), matchedText: m[0], clockIgnored: false };
  }

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

  // 「11/5」= 11 月 5 日（中文习惯月在前）。当年已过则理解为次年。
  m = t.match(/(^|[^\d/])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/);
  if (m) {
    const d = dayjs(`${today.year()}-${pad2(m[2])}-${pad2(m[3])}`);
    if (d.isValid()) {
      return { date: fmt(d.isBefore(today, 'day') ? d.add(1, 'year') : d), matchedText: m[0].trim(), clockIgnored: false };
    }
  }

  // 裸「3号 / 3日」：本月的第 3 天，已过或本月没这天则顺延到下月。
  // 前面带「第」时不算日期（「第3号」是序号，走 buildTarget 的 index 通道）。
  m = t.match(/(^|[^第\d月])((\d{1,2})\s*[日号])(?![\d])/);
  if (m) {
    const day = Number(m[3]);
    const build = (base) => {
      const ym = base.format('YYYY-MM');
      const d = dayjs(`${ym}-${pad2(day)}`);
      // dayjs 会把 2月31日 静默滚进 3 月，靠"年月是否还是那个月"来判溢出
      return d.isValid() && d.format('YYYY-MM') === ym ? d : null;
    };
    let d = build(today);
    if (!d || d.isBefore(today, 'day')) d = build(today.add(1, 'month'));
    if (d) return { date: fmt(d), matchedText: m[2], clockIgnored: false };
  }

  // 法定假期锚点：「国庆后体检」里的"国庆"是真日期，不是背景词。
  // 公历固定节日直接算月日；农历节日走下面那张窄年份表。
  // "后"取长假结束回到工作日那天（国庆/五一 7 天假，其余 1 天），"前"取节日前一天。
  const FESTIVAL_DATE = { 国庆: [10, 1, 7], 十一: [10, 1, 7], 五一: [5, 1, 7], 元旦: [1, 1, 1], 三八: [3, 8, 1], 六一: [6, 1, 1], 圣诞: [12, 25, 1] };
  m = t.match(/(国庆|十一|元旦|五一|三八|六一|圣诞)\s*(之后|以后|后|之前|以前|前)?/);
  if (m && FESTIVAL_DATE[m[1]]) {
    const [mo, dy, holiday] = FESTIVAL_DATE[m[1]];
    let d = dayjs(`${today.year()}-${pad2(mo)}-${pad2(dy)}`);
    if (/后/.test(m[2] || '')) d = d.add(holiday, 'day');
    else if (/前/.test(m[2] || '')) d = d.subtract(1, 'day');
    if (d.isBefore(today, 'day')) d = d.add(1, 'year');
    return { date: fmt(d), matchedText: m[0], clockIgnored: false };
  }

  // 农历节日：本地不引入历法依赖，改用**窄年份表**。
  // 只收录人工核对过的年份（2026–2028，来源见下），表外年份一律返回空 ——
  // 用户说「中秋前买月饼」而表里没有那一年时，引擎不编一个日子出来，交回澄清。
  // 这是"认错比漏认更伤"在时间维度的落地：落错日子比不落更难被发现。
  //
  // 核对来源：国务院办公厅节假日安排通知（2026：春节 2/17、端午 6/19、中秋 9/25）
  // 与公历农历对照表（2027：2/6、6/9、9/15；2028：1/26、5/28、10/3）。
  // 除夕 = 春节前一天，可直接推，不另立条目。
  // 刻意不建模"长假/调休"：那是每年由国务院临时公布的行政安排，
  // 写死会在某一年悄悄变成错的；「后」在这里只给到节日次日。
  const LUNAR_FESTIVAL = {
    春节: { 2026: '02-17', 2027: '02-06', 2028: '01-26' },
    过年: { 2026: '02-17', 2027: '02-06', 2028: '01-26' },
    除夕: { 2026: '02-16', 2027: '02-05', 2028: '01-25' },
    端午: { 2026: '06-19', 2027: '06-09', 2028: '05-28' },
    中秋: { 2026: '09-25', 2027: '09-15', 2028: '10-03' },
  };
  m = t.match(/(春节|过年|除夕|端午|中秋)(节)?\s*(之后|以后|后|之前|以前|前)?/);
  if (m && LUNAR_FESTIVAL[m[1]]) {
    const table = LUNAR_FESTIVAL[m[1]];
    // 已过则顺延到下一年；下一年也不在表里 → 不猜，交回 unknown。
    let key = String(today.year());
    if (!table[key] || dayjs(`${key}-${table[key]}`).isBefore(today, 'day')) {
      key = String(today.year() + 1);
    }
    if (table[key]) {
      let d = dayjs(`${key}-${table[key]}`);
      if (/后/.test(m[3] || '')) d = d.add(1, 'day');
      else if (/前/.test(m[3] || '')) d = d.subtract(1, 'day');
      if (!d.isBefore(today, 'day')) {
        return { date: fmt(d), matchedText: m[0], clockIgnored: false };
      }
    }
  }

  m = t.match(/下\s*个?\s*月\s*(伊始|开始|初)?/);
  if (m) {
    const d = m[1] ? today.add(1, 'month').startOf('month') : today.add(1, 'month');
    return { date: fmt(d), matchedText: m[0], clockIgnored: false };
  }

  if (/月底|月末/.test(t)) return { date: fmt(today.endOf('month')), matchedText: '月底', clockIgnored: false };

  return { date: null, matchedText: null, clockIgnored: false };
}

// 解析优先级表达：高/中/低、A/B/C 或 (A)~(C)。
//
// 除了级别，还要把**实际命中的那段说法**交出去（matched）：
// 「标成最高优先级」「降为低」是连写的一整块，靠"按空格分词再比对词表"剥不掉，
// 残留在关键词里会把相似度压到 0.5 阈值以下 —— 级别认对了，目标却找不到。
// matched 只在长度 ≥2 时才用于剥离：裸「高/中/低」是单字，
// 从标题里挖掉它会毁掉「高中同学聚会」这种正常内容。
function matchPriority(text) {
  const t = String(text || '');
  const paren = t.match(/\(([A-Za-z])\)/);
  if (paren) return { level: paren[1].toUpperCase(), matched: paren[0] };
  const bare = t.match(/(?:优先级|标为|设为|设置为|改为)\s*([A-Fa-f])\b/);
  if (bare) return { level: bare[1].toUpperCase(), matched: bare[0] };
  let m = t.match(/顶格|顶到最高|提到最高|最高级|最要紧|最重要|最优先|置顶|放到最前|放最前|排到最前|排最前|最前面|先做|排到头|排到第一|排第一|放到第一|放第一|头一份|头一个|最高/);
  if (m) return { level: 'A', matched: m[0] };
  m = t.match(/降为低|降级|最低级|最不重要|不急|随意|随便放|不着急|最低/);
  if (m) return { level: 'C', matched: m[0] };
  m = t.match(/要紧|急着|很急|挺急/);
  if (m) return { level: 'A', matched: m[0] };
  m = t.match(/高|中|低/);
  if (m) return { level: m[0] === '高' ? 'A' : m[0] === '中' ? 'B' : 'C', matched: m[0] };
  return null;
}

// 解析优先级表达（只取级别）。保留导出：既有单测与上层按这个签名用。
export function parsePriorityWord(text) {
  const hit = matchPriority(text);
  return hit ? hit.level : null;
}

// 从剩余文本中提取目标（序号 / 分类 / 关键词）。
function buildTarget(core) {
  const text = String(core || '').trim();
  if (!text) return null;

  // 汉字序数也要认：「第二个不要了」「把第一个和第三个都完成」里的"第二个"
  // 与「第2条」是同一个指代，过去只认阿拉伯数字，于是整句退化成关键词检索，
  // 命中不了任何标题 —— 用户看到的是"没找到"，其实他说得很清楚。
  // 汉字分支**必须**带量词（条/个/项/名）：裸「第一」在标题里太常见（「第一季报告」）。
  let m =
    text.match(/第\s*(\d+)\s*(?:条|个|项|名)?/) ||
    text.match(/第\s*([一二三四五六七八九十两]{1,3})\s*(?:条|个|项|名)/) ||
    text.match(/#\s*(\d+)/) ||
    text.match(/(\d+)\s*号/);
  if (m) {
    const n = parseNum(m[1]);
    if (Number.isFinite(n) && n >= 1) return { kind: 'index', value: n };
  }

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
// memory（会话焦点态）只服务于回指目标：「把它标为高」的"它"要靠上一轮的焦点还原。
function resolveTarget(target, tasks, memory) {
  if (!target) return { matches: [], nearMatches: [], confidence: 'low' };

  if (target.kind === 'ref') {
    const id = resolveRef(target, memory, tasks);
    return { matches: id ? [id] : [], nearMatches: [], confidence: id ? 'high' : 'low' };
  }

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
  // 容错档：常规弱匹配也空手时，再兜一批"差一处错字"的候选。
  // 只在 strong 与 weak 都拿不到东西时才跑 —— 已经认出来的情况下加进来只会稀释澄清列表。
  // similarityFuzzy 恒返回 0.45 < 0.5，结构上就进不了 matches 那一档。
  const fuzzy = strong.length || weak.length ? [] : rankByFuzzy(kw, tasks, { key: (t) => t.title });
  return {
    matches: strong.map((r) => r.item.id),
    nearMatches: [
      ...weak.filter((r) => !strongIds.has(r.item.id)).map((r) => r.item.id),
      ...fuzzy.map((r) => r.item.id),
    ],
    confidence: strong.length === 1 ? 'high' : 'low',
  };
}

// —— 多动作单句 ——
//
// 「把对账删了顺便把报销延到下个月」里塞了两个动作。旧引擎要么硬认一个（删了报销？），
// 要么整体 unknown —— 两种都让用户觉得"它没听懂我说话"。
// 现在按分隔词切句，逐条解析：**拆得出两个以上不同的会改数据的动作时，只列清单不动文件**，
// 由用户回序号（只做一条）或回"都做"（按说出的顺序执行）。
// 要求"意图互不相同"才成立：「回测这条要紧，顶格」是同一件事的两种说法，不该被拆开。
const CLAUSE_SPLIT_RE = /[，,。;；;、]+|(?:顺便|然后|接着|并且|同时|另外|末了|再一个)/;
const MUTATING_INTENTS = new Set([
  'add',
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

// 「把A删了把B延到后天」：没有逗号也没有"然后"，分隔词切不出两段。
// 只认「把」的重复出现当硬边界（不用"再/又/将"——它们在任务名里太常见，误切面大）。
function splitByCoverb(text) {
  const hits = [];
  const re = /把/g;
  for (let m = re.exec(text); m; m = re.exec(text)) hits.push(m.index);
  if (hits.length < 2) return [];
  // 切点落在后续每个「把」之前：这样"就是把…"这类改口前缀会留在第二段开头，
  // 能被复述护栏认出（切在「把」上会把"就是"甩到上一段尾巴，护栏就瞎了）。
  const cuts = [0, ...hits.slice(1), text.length];
  const parts = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const seg = text.slice(cuts[i], cuts[i + 1]).trim();
    if (hanLength(seg) >= 2) parts.push(seg);
  }
  return parts;
}

// 并列多序号：「第1条和第4条都标星」里两件事**共享同一个动作**，
// 分隔词切不出两段（没有逗号、没有"然后"），但序号自己就是天然分界。
//
// 三道门槛，缺一条就不切（切错的代价是把一句明确的命令摊成一张没人要的清单）：
//   ① 至少两个**不同**的序号；
//   ② 有并列证据：连词（和/与/跟/以及/、）或共享标记（都/各/分别/一起/全）；
//   ③ 每个序号段解析后都要能锁定目标（下面用 mustLock 把关）。
// 「第3条和第5条的区别是什么」有①有②，但落在问句上 —— 它压根走不到这里，
// detectAction 先判成 query 了（句尾疑问框架优先级在前）。
const ORD_TOKEN_RE = /第\s*(?:\d+|[一二三四五六七八九十两]{1,3})\s*(?:条|个|项|名|号)?/g;

function splitByOrdinals(text) {
  const t = String(text || '');
  const hits = [...t.matchAll(ORD_TOKEN_RE)];
  if (hits.length < 2) return [];
  const nums = new Set(hits.map((h) => parseNum(h[0].match(/[\d一二三四五六七八九十两]+/)[0])));
  if (nums.size < 2) return [];
  if (!/(和|与|跟|以及|、|都|各|分别|一起|全|同时)/.test(t)) return [];
  const head = t.slice(0, hits[0].index).trim();
  const last = hits[hits.length - 1];
  // 共享动作：优先取序号之后的那截（「第1条和第4条都标星」→"标星"），
  // 动作用「标星第1条」这种前置写法时尾部为空，退回 head。
  let tail = t.slice(last.index + last[0].length).replace(/^[\s，,、和与跟以及]+/, '');
  tail = tail.replace(/^(?:都|各|分别|一起|全|同时)[\s]*/, '').trim();
  const parts = [];
  for (const h of hits) {
    const seg = `${head} ${h[0]} ${tail}`.replace(/\s+/g, ' ').trim();
    if (hanLength(seg) >= 2) parts.push(seg);
  }
  return parts;
}

// 裸连写多动作：既没有分隔词、没有重复的「把」、也没有并列序号，
// 两件事直接连成一串（「办公室绿植不用换了三季度发票核完」）。
//
// 原计划用"标题词典最大匹配"切，这里换成**反向验证**，理由：
// 词典要预知用户会怎么缩写标题（"三季度发票"对「核对三季度发票」算不算命中？），
// 而"这一截能不能锁定到一个真实任务"是引擎每一步自己的实测结果 ——
// 拿不准的那一截必然落进 nearMatches，被门槛直接挡掉。判据不用猜，判据是问出来的。
//
// 门槛按最严设计，因为这一族证据最弱（连写可能是打字漏了标点，也可能真是两件事）：
//   ① 两截各自汉字数 ≥4（短到一截只剩个动词的，不算两件事）；
//   ② 两截都解析成**会改数据**的意图；
//   ③ 每一截都要有**唯一**的落点：锁定（matches 恰 1 条）最好，退一步也只接受
//      "澄清候选恰好只有 1 条"。这一档是在"多问一轮"与"少问一轮"之间取的：
//      裸连写本来就一定要变成清单让用户挑，挑的是两条各自唯一的候选，
//      而不是"两截都不知道在说谁"。候选多于一条的仍然不收 —— 那才是真拆错。
//   ④ 两截的落点必须是**不同**任务 —— 同一件事说两遍不拆。
// 敢在这里试切，是因为 multi 只列清单不执行：切错的成本是多问一轮，不是改坏文件。
function splitByBareRun(text, todayStr, tools, tasks, memory) {
  const t = String(text || '');
  const total = hanLength(t);
  if (total < 8) return [];
  const chars = [...t];
  const landing = (x) => {
    if ((x.matches || []).length === 1) return x.matches[0];
    if ((x.matches || []).length === 0 && (x.nearMatches || []).length === 1) return x.nearMatches[0];
    return null;
  };
  for (let i = 1; i < chars.length; i += 1) {
    const left = chars.slice(0, i).join('').trim();
    const right = chars.slice(i).join('').trim();
    if (hanLength(left) < 4 || hanLength(right) < 4) continue;
    const a = parseIntent(left, { tasks, today: todayStr, tools, memory, noMulti: true });
    const b = parseIntent(right, { tasks, today: todayStr, tools, memory, noMulti: true });
    const ok = (x) => (MUTATING_INTENTS.has(x.intent) || x.intent === 'add') && landing(x) !== null;
    if (!ok(a) || !ok(b)) continue;
    if (landing(a) === landing(b)) continue;
    return [left, right];
  }
  return [];
}

// 子动作的身份：先认已解析出的任务 id，再退到字面查询词。
function itemKey(item) {
  if (Array.isArray(item.matches) && item.matches.length) return `id:${item.matches.join(',')}`;
  const t = item.target;
  if (!t || t.value == null) return null;
  const v = String(t.value).trim();
  return v ? `kw:${v}` : null;
}

// 后半句以复述标记开头时，它是在**改口**（"删了，就是昨天那条"），不是第二件事。
// 这类句子整体交给单句解析，切分只会把一次明确的指令变成一次反问。
// 尾巴形态也要认：无分隔连写按「把」切，"就是把"会被切到前一段末尾。
const RESTATEMENT_RE = /^\s*(?:其实就是|也就是说|我是说|意思是|指的是|说的是|就是|反正|哦不|噢不|啊不|呃不|不对|不是|说错了|搞错了|写错了|应该是)/;
const RESTATEMENT_TAIL_RE = /(?:其实就是|也就是说|我是说|意思是|指的是|说的是|就是|反正)\s*$/;

// 改口标记：后半句**推翻**前半句（「延到下周一，哦不，是延到下周二」）。
//
// 必须是被句首或标点隔开的独立一拍。句中的"不是"往往是内容本身
// （「记一下 报销单不是今天的」），那种当改口处理会把一条正常新增拆坏。
const CORRECTION_RE = /(^|[\s，,。；;！!？?])(哦不|噢不|啊不|呃不|不对|不是|说错了|搞错了|写错了|我意思是|应该是)/g;

// 从最后一次改口处切开。返回 null 表示这句里没有改口。
function splitRestatement(text) {
  const t = String(text || '');
  let cut = -1;
  CORRECTION_RE.lastIndex = 0;
  for (let m = CORRECTION_RE.exec(t); m; m = CORRECTION_RE.exec(t)) cut = m.index + m[1].length;
  if (cut <= 0) return null;
  const before = t.slice(0, cut).replace(/[\s，,。；;！!？?]+$/, '').trim();
  const after = t.slice(cut).trim();
  if (!before || hanLength(after) < 2) return null;
  return { before, after };
}

function splitMultiActions(text, todayStr, tools, tasks, memory) {
  let parts = String(text)
    .split(CLAUSE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => hanLength(s) >= 2);
  // 无分隔连写时退一步按「把」复现切句。这条证据比分隔词弱得多，所以门槛更高：
  // 每个子动作的目标都必须在当前列表里锁定（或本身是新增），否则不计入。
  let coverbSplit = false;
  let strictLock = false;
  if (parts.length < 2) {
    parts = splitByCoverb(String(text));
    coverbSplit = parts.length >= 2;
    strictLock = coverbSplit;
  }
  // 序号并列排在「把」字复现之后：一句里既有重复的"把"又有多个序号时，
  // 前者是更强的边界证据（"把A…把B…"本身就写了两个受事），不该被序号抢走。
  if (parts.length < 2) {
    parts = splitByOrdinals(String(text));
    if (parts.length >= 2) strictLock = true;
  }
  // 裸连写排在最后：它是"猜出来的边界"，前面三种都是用户自己写出来的边界。
  if (parts.length < 2) {
    parts = splitByBareRun(String(text), todayStr, tools, tasks, memory);
    if (parts.length >= 2) strictLock = true;
  }
  if (parts.length < 2) return null;
  if (parts.slice(1).some((p, i) => RESTATEMENT_RE.test(p) || RESTATEMENT_TAIL_RE.test(parts[i]))) return null;

  const items = [];
  parts.forEach((part) => {
    const sub = parseIntent(part, { tasks, today: todayStr, tools, memory, noMulti: true });
    if (!MUTATING_INTENTS.has(sub.intent)) return;
    if (strictLock && sub.intent !== 'add' && !(sub.matches || []).length) return;
    items.push(sub);
  });

  if (items.length < 2) return null;
  // 「同一件事换着说两遍」不是两件事：意图不同当然算，意图相同但目标不同也算
  // （「把A删了把B也删了」是真·两条），但目标锁到同一条时必须合并不拆。
  const names = new Set(items.map((i) => i.intent));
  if (names.size < 2 && new Set(items.map(itemKey).filter(Boolean)).size < 2) return null;

  return {
    intent: 'multi',
    target: null,
    slots: { items },
    matches: [],
    nearMatches: [],
    confidence: 'low',
    note: null,
    raw: text,
    needsConfirm: true,
  };
}

/**
 * 解析用户输入为结构化意图。
 * @param {string} text 用户原始输入
 * @param {{tasks?: Array, today?: string, tools?: Array, memory?: object, noMulti?: boolean}} ctx 上下文
 * @returns {object} Intent
 */
export function parseIntent(text, ctx = {}) {
  const raw = String(text == null ? '' : text).trim();
  const todayStr = ctx.today || dayjs().format('YYYY-MM-DD');
  const tasks = Array.isArray(ctx.tasks) ? ctx.tasks : [];
  const tools = Array.isArray(ctx.tools) ? ctx.tools : [];
  // memory：会话焦点态 { lastTaskId, lastCandidates }，由 useChatAgent 维护。
  // 不传就退化成"单句理解"——回指一律解析不出目标，走澄清流程，不会瞎猜。
  const memory = ctx.memory && typeof ctx.memory === 'object' ? ctx.memory : null;

  if (!raw) {
    return { intent: 'unknown', target: null, slots: {}, matches: [], nearMatches: [], confidence: 'low', note: null, raw };
  }

  const detected = detectAction(raw, todayStr, tools);

  // —— 极性护栏 ——
  // 排在多动作拆分之前：「别把A删了把B删了」不该被摊成一份两件事的清单，
  // 它压根不是命令。refused 交给上层回一句"我没动"，比通用的"没听懂"诚实。
  const refused = refusalReason(raw, detected);
  if (refused) {
    return {
      intent: 'unknown',
      refused,
      target: null,
      slots: {},
      matches: [],
      nearMatches: [],
      confidence: 'low',
      note: REFUSAL_NOTE[refused],
      raw,
      needsConfirm: false,
    };
  }

  // —— 改口 ——
  // 「把X延到下周一，哦不，是延到下周二」：动词与日期取**最后一次**说法，
  // 目标若只在前面出现过就沿用前面。改口过 → 一律确认一次，不静默执行。
  //
  // 为什么不能靠多动作拆分兜住：拆开会变成"我听到 2 件事"（其实是 1 件），
  // 而合成单句更糟 —— 位置打分会选中后一个动词，日期却取句子里第一个，
  // 于是"延到下周二"配上"下周一"的日期，两处各对一半。
  const restated = splitRestatement(raw);
  if (restated) {
    const late = parseIntent(restated.after, { tasks, today: todayStr, tools, memory, noMulti: true });
    if (MUTATING_INTENTS.has(late.intent) || late.intent === 'add') {
      if (!(late.matches || []).length) {
        const early = parseIntent(restated.before, { tasks, today: todayStr, tools, memory, noMulti: true });
        if ((early.matches || []).length) {
          late.target = early.target;
          late.matches = early.matches;
          late.nearMatches = early.nearMatches || [];
        }
      }
      late.raw = raw;
      late.note = '按你最后说的算';
      late.confidence = late.matches.length === 1 ? 'high' : 'low';
      late.needsConfirm = late.matches.length === 1;
      return late;
    }
  }

  // 一句话里两个动作：先拆，拆得出就只列清单（见 splitMultiActions）。
  if (!ctx.noMulti) {
    const multi = splitMultiActions(raw, todayStr, tools, tasks, memory);
    if (multi) return multi;
  }

  const intent = detected;
  if (intent === 'unknown') {
    return { intent: 'unknown', target: null, slots: {}, matches: [], nearMatches: [], confidence: 'low', note: null, raw, needsConfirm: false };
  }

  // —— 工具路由 ——
  // 无副作用意图（只切页 + 预填参数），所以门槛可以放宽；也正因为它不写文件，
  // 这里不需要走澄清框架：认到哪个就开哪个，认不到就回一句"没找到"。
  if (intent === 'tool.open') {
    const hit = matchTool(raw, tools);
    if (!hit) {
      return { intent: 'unknown', target: null, slots: {}, matches: [], nearMatches: [], confidence: 'low', note: null, raw, needsConfirm: false };
    }
    return {
      intent: 'tool.open',
      target: null,
      slots: { toolId: hit.tool.id, toolName: hit.tool.name, plan: hit.query, trigger: hit.triggered },
      matches: [],
      nearMatches: [],
      confidence: hit.score >= 0.5 ? 'high' : 'low',
      note: null,
      raw,
      needsConfirm: false,
    };
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
    const p = matchPriority(raw);
    if (p) slots.priority = p.level;
    // 从目标文本中剔除优先级词，仅保留任务关键词。两条路一起走：
    //   ① 被空格隔开的独立片段（「述职材料 高」）按词表整块丢
    //   ② 连写的那一段（「最高优先级」「降为低」）按实际命中的字面切掉
    // 只有 ① 的话，「年度述职材料标成最高优先级」会剩下关键词
    // 「年度述职材料 最高优先级」，相似度掉到 0.45，目标反而找不到了。
    const drop = new Set(['高', '中', '低', '最高', '最低', '优先级', '级别']);
    core = core
      .split(/\s+/)
      .filter((w) => w && !drop.has(w) && !/^[A-Fa-f]$/.test(w) && !/^\([A-Fa-f]\)$/.test(w))
      .join(' ');
    if (p && p.matched.length >= 2) core = core.split(p.matched).join(' ');
    core = core.replace(/优先级|级别/g, ' ').replace(/\s+/g, ' ').trim();
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
    const target = detectRef(raw, cleaned) || buildTarget(cleaned);
    const { matches, nearMatches, confidence } = resolveTarget(target, tasks, memory);
    const low = matches.length === 0 ? 'low' : confidence;
    return { intent, target, slots, matches, nearMatches, confidence: low, note, raw, needsConfirm: false };
  }

  if (intent === 'query') {
    // 「已完成 X」：若 X 构成明确目标（引用/序号，或残余关键词命中活跃任务）→ 按 complete 处理。
    if (raw.startsWith('已完成')) {
      const residualCore = stripNoise(stripAction(raw, 'complete'), time.matchedText);
      const t = buildTarget(residualCore);
      const rr = resolveTarget(t, tasks, memory);
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

    // scope：带“已完成”类标记 → done（从 doneEntries 取数）；带逾期标记 → overdue；否则 active。
    let scope = 'active';
    if (DONE_MARKER_RE.test(raw)) scope = 'done';
    else if (OVERDUE_MARKER_RE.test(raw)) scope = 'overdue';
    const cm = raw.match(/@(\S+)/);
    if (cm) slots.context = cleanName(cm[1]);
    // 「行政里还有啥没办」：汉语说分类常常不带 @，直接「X里/X这组」。
    // 只在没写 @ 且这个名字确实是个已有分类时才认 —— 否则「这周里」会被当成分类名。
    let contextFromWord = null;
    if (!slots.context) {
      const im = raw.match(/([^\s@+，。,？?！!的]{1,8}?)(?:里|里面|这组|这一组|那组)/);
      if (im) {
        const name = cleanName(im[1]);
        const known = tasks.some((t) => (t.contexts || []).includes(name));
        if (known) {
          slots.context = name;
          contextFromWord = im[0];
        }
      }
    }

    // 残余关键词（查询前缀/查询触发词之外仍残留的疑似标题词）。
    let core = stripAction(raw, 'query');
    if (contextFromWord) core = core.split(contextFromWord).join(' ');
    if (time.matchedText) core = core.split(time.matchedText).join(' ');
    core = core.replace(/[@+]\S+/g, ' ');
    if (scope === 'done') {
      core = core.replace(/已完成|完成的|做完了的|已办|已勾选/g, ' ').replace(/任务/g, ' ');
    }
    if (scope === 'overdue') {
      core = core.replace(/逾期|超期|过期|拖到期|延宕|任务/g, ' ');
    }
    // 疑问框架虚词对三种 scope 都是噪音（「手上还有几件事」不该拿「几件事」当关键词）。
    core = core.replace(QUERY_NOISE_RE, ' ');
    core = core.replace(/[\s，。,.!！?？、；;：:]+/g, ' ').trim();
    core = core
      .replace(/^(的|把|请|帮我|给我|一下|一个|这个|那个)+/, '')
      .replace(/(的|吧|呢|啊|了)+$/, '')
      .trim();
    // 剥完虚词只剩一两个字的残片（「事」「的」）不是关键词：留着它，查询必然 0 命中，
    // 接着反问"要不要新建一条「事」" —— 用户问的是清单，不是想做新增。
    if (core && hanLength(core) >= 2) slots.keyword = core;

    return {
      intent,
      target: null,
      slots,
      scope,
      matches: scope === 'done' ? [] : tasks.map((t) => t.id),
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

  // 其余均需目标。回指优先于关键词：「把它延到下周」的目标不在字面里，
  // 走关键词通道会得到一个「它」字样的空命中，用户只看到一句"没找到"。
  const target = detectRef(raw, core) || buildTarget(core);
  const { matches, nearMatches, confidence } = resolveTarget(target, tasks, memory);
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
  {
    intent: 'tool.open',
    label: '打开工具',
    sample: '打开 单位换算',
    triggers: '打开 / 调用 / 用一下 / 算一下（工具名，见「工具」页）',
  },
];
