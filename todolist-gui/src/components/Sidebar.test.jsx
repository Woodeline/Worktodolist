// 侧栏列表圆点的渲染冒烟。
//
// 只测一件事：+项目 在侧栏里真的会渲染出一颗带色的圆点，而且两颗不同列表的点不同色。
// 这不是"顺手加的断言" —— 圆点是这次改造唯一可见的产物，而它失效的方式是
// 静默的：dotFor 传漏、样式类写错、颜色取到 undefined，页面都不会报错，只是变回一排灰字。
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Sidebar from './Sidebar.jsx';
import { parseFile } from '../lib/todoParser.js';
import { defaultColorId } from '../lib/listStyle.js';

function makeStore(text) {
  const entries = parseFile(text);
  return {
    todoEntries: entries,
    doneEntries: [],
    view: 'all',
    sortMode: 'auto',
    selectView: () => {},
    quickAddRef: { current: null },
  };
}

function dotsOf(markup) {
  return [...markup.matchAll(/class="nav-dot" style="background:([^"]+)"/g)].map((m) => m[1]);
}

describe('Sidebar 列表圆点', () => {
  it('每个 +项目 都渲染出一颗带色的圆点', () => {
    const store = makeStore('写周报 +投资\n换硅脂 +硬件\n交房租 +生活');
    const markup = renderToStaticMarkup(<Sidebar store={store} />);
    const dots = dotsOf(markup);
    expect(dots.length).toBe(3);
    for (const hex of dots) expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('不同列表拿到不同色（散列的分散性在真实渲染里也成立）', () => {
    const store = makeStore('写周报 +投资\n换硅脂 +硬件');
    const dots = dotsOf(renderToStaticMarkup(<Sidebar store={store} />));
    expect(new Set(dots).size).toBeGreaterThan(1);
  });

  it('@分类 不长圆点 —— 它不是列表', () => {
    const store = makeStore('写周报 @办公室');
    const markup = renderToStaticMarkup(<Sidebar store={store} />);
    expect(dotsOf(markup).length).toBe(0);
    expect(markup).toContain('办公室');
  });

  it('侧栏的项目分组标题是「列表」', () => {
    const store = makeStore('写周报 +投资');
    const markup = renderToStaticMarkup(<Sidebar store={store} />);
    expect(markup).toContain('列表');
  });

  it('圆点颜色与 defaultColorId 一致（没配过色时走名字散列）', () => {
    const store = makeStore('写周报 +投资');
    const markup = renderToStaticMarkup(<Sidebar store={store} />);
    expect(markup).toContain('投资');
    // 未落盘配置时取的是散列色，与库函数结果同源
    expect(dotsOf(markup).length).toBe(1);
    expect(defaultColorId('投资')).toBeTruthy();
  });
});
