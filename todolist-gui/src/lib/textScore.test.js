// textScore 纯函数测试（零新增依赖，node 环境）。
import { describe, expect, it } from 'vitest';
import { hanLength, rankBySimilarity, similarity, tokenize } from './textScore.js';

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
