import { describe, expect, it } from 'vitest';
import { displayTitle } from './displayTitle.js';
import { parseSingleLine, serializeTask } from './todoParser.js';

describe('展示层过滤以 @ 开头的信息', () => {
  it('普通标题一字不改', () => {
    expect(displayTitle('写第 10 周回测报告')).toBe('写第 10 周回测报告');
  });

  it('合法 @分类 与 @**** 这类残留词都不再显示', () => {
    expect(displayTitle('交周报 @工作 @****')).toBe('交周报');
    expect(displayTitle('@**** 交周报')).toBe('交周报');
    expect(displayTitle('甲 @a 乙 @b 丙')).toBe('甲 乙 丙');
  });

  it('只认词首的 @，词中间的 @ 不当标签摘掉', () => {
    expect(displayTitle('邮箱 a@b.com 要发')).toBe('邮箱 a@b.com 要发');
  });

  it('全是 @ 词时显示为空，但不抛错', () => {
    expect(displayTitle('@**** @工作')).toBe('');
  });

  it('空值 / 非字符串返回空串', () => {
    expect(displayTitle('')).toBe('');
    expect(displayTitle(null)).toBe('');
    expect(displayTitle(undefined)).toBe('');
    expect(displayTitle(42)).toBe('');
  });

  it('过滤只在显示层：解析、title、raw 与写回都保留原文', () => {
    const valid = parseSingleLine('交周报 @工作');
    expect(valid.contexts).toEqual(['工作']);
    expect(displayTitle(valid.title)).toBe('交周报');
    expect(serializeTask(valid)).toContain('@工作');

    const odd = parseSingleLine('交周报 @****');
    expect(odd.contexts).toEqual([]);
    expect(odd.title).toContain('@****');
    expect(odd.raw).toContain('@****');
    expect(displayTitle(odd.title)).toBe('交周报');
    expect(serializeTask(odd)).toContain('@****');
  });
});
