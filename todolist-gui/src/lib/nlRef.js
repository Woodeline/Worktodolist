// 会话回指（anaphora）解析：把「它 / 这条 / 刚才那条 / 上面第二个」落到具体任务 id。
//
// 为什么单独一层：旧引擎把每句话当独立输入，可人说话是连续的 ——
//   「把 回测报告 延到下周五」 → 「再把它标为高」
// 第二句的目标不在字面里，只能靠上一轮留下的焦点（lastTaskId）与候选列表
// （lastCandidates）还原。这是"听得懂上下文"与"只会听单句"的分界线。
//
// 回指词分两档，档位决定敢不敢认：
//   序数回指  上面第二个 / 前面第一个 —— 明确指向上一份候选列表，无歧义
//   强回指    它 / 刚才那条 / 上一条 / 最后一个 —— 句子别处没给目标，认它不会错
//   弱回指    这条 / 这个 / 那条 / 那个 —— **只有剥完动作词后什么都不剩**才算。
//     否则「删掉那个没用的」会被读成"上一条"，而用户明明给了一个新关键词。
const STRONG_LAST = ['刚才那条', '刚才那个', '刚才这条', '刚刚那条', '上一条', '上一个', '最后一条', '最后一个', '最后那个', '最后那件', '刚才', '刚刚'];
const WEAK = ['它', '这条', '这个', '那条', '那个', '这件', '那件'];

/**
 * 从原话里找回指。
 * @param {string} raw 用户原话
 * @param {string} core 剥掉动作词与时间片段后的剩余文本（用于弱回指的"别处没有目标"判据）
 * @returns {{kind:'ref', type:'ordinal'|'last', n?:number, matchedText:string}|null}
 */
export function detectRef(raw, core = '') {
  const t = String(raw || '');
  const rest = String(core || '');

  // ① 序数回指：必须带"上面/前面/列表"这类指向词。
  //    裸「第N条」不算回指 —— 它指的是右侧任务列表的序号，走原来的 index 通道，
  //    口径不能变（否则「完成 第1条」会被上一轮的候选列表劫持）。
  const ord = t.match(/(?:上面|上头|前面|前头|下面|底下|列表|清单|刚才那个?|刚才)\s*第\s*(\d+|[一二三四五六七八九十两]{1,3})\s*(?:个|条|项|号)?/);
  if (ord) {
    const n = /^\d+$/.test(ord[1]) ? Number(ord[1]) : cnNum(ord[1]);
    if (Number.isFinite(n) && n >= 1) return { kind: 'ref', type: 'ordinal', n, matchedText: ord[0].trim() };
  }

  // ② 强回指：对象代词 / 焦点回指，直接认定。
  for (const w of STRONG_LAST) {
    if (t.includes(w)) return { kind: 'ref', type: 'last', matchedText: w };
  }

  // ③ 弱回指：剥完动作词后只剩回指词本身，才承认它指的是焦点任务。
  //    残留里允许出现"纯语气/纯级别"的单字：「把它标成高」剥掉"把它/标成"后
  //    剩下的「高」是**参数**，不是目标线索 —— 单字级别词按既有约定不从标题里剥
  //    （否则「高中同学聚会」会被挖空），所以这里改判"残留有没有实义"，
  //    而不是要求残留恰好为空。
  //    「删掉那个没用的」里的"没用"是实义定语，仍然挡住回指 —— 判据没有放松到"随便"。
  for (const w of WEAK) {
    if (!t.includes(w)) continue;
    const residual = rest
      .split(w)
      .join(' ')
      .replace(/[\s的了呢吧啊嘛呀]+/g, ' ')
      .trim();
    const substantive = residual
      .split(/\s+/)
      .filter(Boolean)
      .filter((tok) => !/^(?:就|才|也|还|再|又|反正|高|中|低|A|B|C|要紧|急)$/.test(tok));
    if (substantive.length === 0) return { kind: 'ref', type: 'last', matchedText: w };
  }
  return null;
}

/**
 * 把回指解析成任务 id。
 * @param {object} ref detectRef 的产物
 * @param {{lastTaskId?:string, lastCandidates?:string[]}|null} memory 会话焦点态
 * @param {Array} tasks 当前活跃任务快照（与序号口径一致）
 * @returns {string|null} 命中的任务 id；解析不出唯一对象返回 null
 */
export function resolveRef(ref, memory, tasks) {
  if (!ref) return null;
  const pool = Array.isArray(tasks) ? tasks : [];
  const candidates = memory && Array.isArray(memory.lastCandidates) ? memory.lastCandidates : [];

  if (ref.type === 'ordinal') {
    // 上一轮给过候选列表 → 序号指列表；否则退回全量快照（与「第N条」同口径）
    const ids = candidates.length ? candidates : pool.map((t) => t.id);
    return ids[ref.n - 1] ?? null;
  }

  const focus = memory && memory.lastTaskId;
  if (focus && pool.some((t) => t.id === focus)) return focus;
  // 焦点任务已被删/已完成（不在活跃快照里）→ 退回上一份候选列表的首条，
  // 而不是直接放弃 —— 用户说"它"的时候，列表还挂在屏幕上。
  return candidates.length ? candidates[0] : null;
}

const CN = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function cnNum(raw) {
  const t = String(raw || '');
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? CN[m[1]] : 1) * 10 + (m[2] ? CN[m[2]] : 0);
  return CN[t] ?? NaN;
}
