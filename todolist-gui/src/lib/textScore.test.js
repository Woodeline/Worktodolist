// textScore 纯函数测试（零新增依赖，node 环境）。
import { describe, expect, it } from 'vitest';
import {
  editDistance,
  hanLength,
  rankByFuzzy,
  rankBySimilarity,
  similarity,
  similarityFuzzy,
  tokenize,
} from './textScore.js';

describe('tokenize', () => {
  it('中文长片段切 bigram，并把整段本身也放入（完整词要能命中）', () => {
    expect(tokenize('回测报告')).toEqual(['回测', '测报', '报告', '回测报告']);
  });

  it('2 字片段不做 bigram，只留整段（避免产出重复 token）', () => {
    expect(tokenize('报告')).toEqual(['报告']);
    expect(tokenize('复盘')).toEqual(['复盘']);
  });

  it('单字保留', () => {
    expect(tokenize('钱')).toEqual(['钱']);
  });

  it('拉丁字母与数字整词保留、并转小写', () => {
    expect(tokenize('Task-01')).toEqual(['task', '01']);
  });

  it('中英数混排按边界切开', () => {
    expect(tokenize('第10周 readme')).toEqual(['第', '10', '周', 'readme']);
  });

  it('空 / null 安全', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null)).toEqual([]);
    expect(tokenize(undefined)).toEqual([]);
  });

  it('标点与空白不产生 token', () => {
    expect(tokenize('   ，。！？ ')).toEqual([]);
  });
});

describe('hanLength', () => {
  it('只数汉字', () => {
    expect(hanLength('第10周回测')).toBe(4); // 第 周 回 测
    expect(hanLength('abc')).toBe(0);
    expect(hanLength('')).toBe(0);
  });
});

describe('similarity', () => {
  it('标题完整包含查询串 → 满分', () => {
    expect(similarity('回测报告', '今天到期：写第 10 周回测报告')).toBe(1);
    expect(similarity('报告', '回测报告')).toBe(1);
  });

  it('完全无关 → 0', () => {
    expect(similarity('买牛奶', '带截止日的周线复盘')).toBe(0);
  });

  it('部分重合 → 介于 0 与 1 之间（不能和精准命中混为一谈）', () => {
    const s = similarity('周复盘', '带截止日的周线复盘');
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });

  it('空查询 / 空标题 → 0（不抛异常）', () => {
    expect(similarity('', '回测报告')).toBe(0);
    expect(similarity('回测', '')).toBe(0);
    expect(similarity(null, null)).toBe(0);
  });

  it('大小写不敏感', () => {
    expect(similarity('README', 'readme 更新')).toBe(1);
  });

  it('单字查询不会因为出现在长标题里就拿到高分', () => {
    // 「报」在「回测报告」里，但作为查询它太宽泛 —— 覆盖率只有 1/1，
    // 是"整串包含"分支的天然结果，这里确认它确实走满分（说明为什么
    // 上游要靠 hanLength + looksLikeFragment 再补一层确认）。
    expect(similarity('报', '回测报告')).toBe(1);
    expect(hanLength('报')).toBeLessThan(3);
  });
});

describe('rankBySimilarity', () => {
  const items = [
    { id: 1, title: '带截止日的周线复盘' },
    { id: 2, title: '今天到期：写第 10 周回测报告' },
    { id: 3, title: '收集箱任务：无任何标记的裸任务' },
  ];

  it('按分数降序返回，且剔除低于阈值的项', () => {
    const r = rankBySimilarity('回测报告', items, { key: (x) => x.title, minScore: 0.5 });
    expect(r.map((x) => x.item.id)).toEqual([2]);
    expect(r[0].score).toBe(1);
  });

  it('阈值可调：放宽后能看到更多候选', () => {
    const strict = rankBySimilarity('复盘', items, { key: (x) => x.title, minScore: 0.9 });
    const loose = rankBySimilarity('复盘', items, { key: (x) => x.title, minScore: 0.2 });
    expect(loose.length).toBeGreaterThanOrEqual(strict.length);
  });

  it('默认 key 为恒等（可直接对字符串数组打分）', () => {
    const r = rankBySimilarity('回测', ['回测报告', '买牛奶']);
    expect(r).toHaveLength(1);
    expect(r[0].item).toBe('回测报告');
  });

  it('空候选 → 空数组', () => {
    expect(rankBySimilarity('回测', [])).toEqual([]);
  });
});

// 容错档是第八轮才接进 resolveTarget 的，此前只有 held-out 卷间接压过它。
// 这里守的是那条架构红线本身：容错分**永远进不了**强匹配门槛。
describe('editDistance（OSA + 相邻交换）', () => {
  it('单字替换 / 增删各算一处', () => {
    expect(editDistance('疫苗合同', '疫苗合约')).toBe(1);
    expect(editDistance('疫苗合同', '疫苗书合同')).toBe(1);
  });

  it('相邻两字交换算一处 —— 经典 Levenshtein 要记两处，会把双字手误挡在门外', () => {
    expect(editDistance('疫苗', '苗疫')).toBe(1);
  });

  it('同音字换序（疫苗→苗役）是两处，不是手误', () => {
    // 这一条是给注释里的例子把关的：它看着像"一次手误"，其实换了序又换了字。
    expect(editDistance('疫苗合同', '苗役合同')).toBe(2);
  });

  it('空串 / 完全相同', () => {
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('周线复盘', '周线复盘')).toBe(0);
  });
});

describe('similarityFuzzy / rankByFuzzy', () => {
  const STRONG = 0.5; // rankBySimilarity 的默认门槛

  it('一处错字的短标题被接住', () => {
    expect(similarityFuzzy('疫苗合同书', '疫苗协同书')).toBeGreaterThan(0);
  });

  it('分数刻意卡在强匹配门槛之下：容错档只能扩澄清候选，不能抬成可直接执行', () => {
    for (const [q, t] of [
      ['疫苗合同书', '疫苗协同书'],
      ['苗役合同', '疫苗合同'],
      ['周线副盘', '周线复盘'],
    ]) {
      const s = similarityFuzzy(q, t);
      expect(s, `${q} vs ${t}`).toBeGreaterThan(0);
      expect(s, `${q} vs ${t} 不许进 matches`).toBeLessThan(STRONG);
    }
  });

  it('已经强命中的不归容错档管 —— 否则同一条任务会同时进两个池子', () => {
    expect(similarityFuzzy('疫苗合约', '疫苗合同续签')).toBe(0); // 覆盖率已达 0.5
    expect(similarityFuzzy('回测报告', '今天到期：写第 10 周回测报告')).toBe(0);
  });

  it('三个字以下不容错：两字窗口跟任何两字都凑得出距离 1', () => {
    for (const [q, t] of [['牛奶', '牛乃'], ['买牛奶', '牛奶']]) {
      expect(similarityFuzzy(q, t), `${q} vs ${t}`).toBe(0);
    }
  });

  it('差两处以上不算手误 —— 容错档只接手滑，不接手滑以外的东西', () => {
    expect(similarityFuzzy('疫苗合同书签', '疫苗那约事情')).toBe(0);
  });

  it('rankByFuzzy 只回正分候选，key 可自定义', () => {
    const items = [
      { id: 1, title: '疫苗协同书' },
      { id: 2, title: '买牛奶' },
    ];
    const r = rankByFuzzy('疫苗合同', items, { key: (x) => x.title });
    expect(r.map((x) => x.item.id)).toEqual([1]);
    expect(r[0].score).toBeLessThan(STRONG);
  });
});
