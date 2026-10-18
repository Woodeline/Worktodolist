// 中文文本相似度打分（纯函数，零依赖）。
//
// 为什么不用 includes：`title.includes(query)` 会把「报告」匹配到
// 「今天到期：写第 10 周回测报告」——数量级上是对的，但它对
// 「测报」「周回」这类噪音同样命中，且无法给出"像不像"的程度，
// 于是"唯一命中"和"牵强命中"被当成同一件事。
//
// 这里做两件事：
//   ① 分词：中文连续串切 bigram（双字组），拉丁数字整词保留
//   ② 打分：查询侧 token 被标题覆盖的比例（覆盖率），整串包含给满分
//
// 为什么用 bigram 而不是词典分词：装词典要几 MB，而待办标题都很短，
// bigram 对短文本的匹配已经够用，且不需要任何外部数据文件。

const HAN = /[\u4e00-\u9fff]/;

// 切词：先按非字母数字汉字切开，再对每段做「拉丁整词 + 汉字 bigram」
export function tokenize(input) {
  const text = String(input == null ? '' : input).toLowerCase();
  const out = [];
  for (const seg of text.split(/[^\p{Script=Han}a-z0-9]+/u)) {
    if (!seg) continue;
    for (const m of seg.matchAll(/[a-z0-9]+|[\u4e00-\u9fff]+/g)) {
      const part = m[0];
      if (!HAN.test(part)) {
        out.push(part);
        continue;
      }
      // 1~2 字的片段没有 bigram 可言，直接整段留下。
      // （不加这个短路的话，2 字片段会同时产出 bigram 和整段两个相同的 token，
      //   虽然覆盖率结果一样，但 queryTokens 里混着重复项没有意义。）
      if (part.length <= 2) {
        out.push(part);
        continue;
      }
      // bigram 覆盖中文片段；整段本身也放进去，便于命中"回测报告"这种完整词
      for (let i = 0; i < part.length - 1; i += 1) out.push(part.slice(i, i + 2));
      out.push(part);
    }
  }
  return out;
}

// 纯汉字部分的字数（用于判断"信息量够不够"）
export function hanLength(input) {
  return (String(input == null ? '' : input).match(/[\u4e00-\u9fff]/g) || []).length;
}

/**
 * 查询串与标题的相似度，0~1。
 * 1.0 = 标题完整包含查询串；否则按查询侧 token 的覆盖率折算。
 */
export function similarity(query, title) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  const t = String(title == null ? '' : title).toLowerCase();
  if (!q || !t) return 0;

  // 整串包含：最可靠，直接满分（「回测报告」vs「…写第 10 周回测报告」）
  if (t.includes(q)) return 1;

  const qTokens = tokenize(q);
  if (!qTokens.length) return 0;
  const tTokens = new Set(tokenize(t));

  let hit = 0;
  for (const tok of qTokens) if (tTokens.has(tok)) hit += 1;
  // 直接用覆盖率，不做非线性抬升：整串包含已经走上面那条满分分支了，
  // 剩下的都是"部分匹配"，此时线性值最能保留区分度（0.25 和 0.75 必须能分开）。
  return hit / qTokens.length;
}

/**
 * 受限编辑距离（OSA 距离）：单字替换、单字增删、**相邻两字交换**各算一处。
 * 只在短串上用（待办标题 ≤ 20 字），O(mn) 且无截断风险。
 *
 * 为什么要"相邻交换"这一档：「疫苗 → 苗疫」这类相邻换序在双字词上极常见，
 * 经典 Levenshtein 要记两处（删+插），会把真正的单字手误挡在阈值外。
 * 反过来说，换了字又换了序（「疫苗 → 苗役」）本就是两处，不该被容错档接走。
 */
export function editDistance(a, b) {
  const s = String(a == null ? '' : a);
  const t = String(b == null ? '' : b);
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;
  let prev2 = null;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let v = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

// 只留汉字：错字判定不该被空格、数字、标点稀释。
function hanOnly(input) {
  return (String(input == null ? '' : input).match(/[\u4e00-\u9fff]/g) || []).join('');
}

/**
 * 容错档相似度：**只**认"一处错字"的命中，返回固定值 0.45。
 *
 * 为什么固定而不是算比例：这个函数的用途只有一个 —— 把"完全听不懂"变成
 * "是不是这几条"。0.45 刻意卡在强匹配门槛 0.5 **之下**，所以它的结果
 * 天生只可能进 nearMatches（澄清候选），不可能进 matches（直接执行）。
 * 这是一道用数值表达的架构红线，不靠调用方自觉。
 *
 * 为什么不背拼音词典（几十 KB 起）：待办标题只有 4~8 字，同音/形近错字在这种
 * 长度上表现为"标题里存在一个与查询只差一处的等长窗口"。允许一处编辑就已经接住了，
 * 拼音词典并不能比它多认什么，只是把"为什么像"解释了一遍 —— 而解释不是判据。
 *
 * @returns {number} 0 或 0.45
 */
export function similarityFuzzy(query, title) {
  // 已经算强命中的（含整串包含）不归容错档管，否则会重复给候选加分。
  if (similarity(query, title) >= 0.5) return 0;
  const q = hanOnly(query);
  const t = hanOnly(title);
  // 三个字以下没有"一处错字"可言：两字窗口几乎能和任何两字凑成距离 1。
  if (q.length < 3 || t.length < 3) return 0;
  for (const len of [q.length - 1, q.length, q.length + 1]) {
    if (len < 3 || len > t.length) continue;
    for (let i = 0; i + len <= t.length; i += 1) {
      // 只在标题里滑与查询**等长或差一字**的窗口，不做全局对齐 ——
      // 全局对齐会让一条长标题跟任何短句都"只差几个字"，容错档就失去意义了。
      if (editDistance(q, t.slice(i, i + len)) <= 1) return 0.45;
    }
  }
  return 0;
}

/**
 * 容错档候选排序：语义与 rankBySimilarity 一致，但门槛就是上面那个固定值。
 * 用途**只有一个** —— 在强匹配与常规弱匹配都空手时，再兜一批澄清候选出来。
 */
export function rankByFuzzy(query, items, { key = (x) => x.title } = {}) {
  const out = [];
  for (const item of items) {
    const score = similarityFuzzy(query, key(item));
    if (score > 0) out.push({ item, score });
  }
  return out;
}

/**
 * 在一组候选里按相似度排序。
 * 默认阈值 0.5 —— 即查询侧的 bigram 有一半以上命中才算候选。
 * 这条线是"宁可少认，不要认错"的取舍：认错了会去改用户的文件，认少了只是多问一轮。
 * @returns {{item:any, score:number}[]} 降序，低于 minScore 的已剔除
 */
export function rankBySimilarity(query, items, { key = (x) => x, minScore = 0.5 } = {}) {
  const out = [];
  for (const item of items) {
    const score = similarity(query, key(item));
    if (score >= minScore) out.push({ item, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
