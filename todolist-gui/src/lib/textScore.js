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
// bigram 对短文本的召回已经够用，且不需要任何模型文件。

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
