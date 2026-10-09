// registry 契约测试 —— 新增一个工具时，最先亮红灯的地方应该是这里。
//
// 「加工具只改 registry」这条承诺要成立，前提是 registry 的**形状**本身是被校验的：
// 外壳只认这些字段，任一字段缺失或类型不对，工具就会在运行时静默失效
// （徽标不出来、布局串味、懒加载挂不上）。这些都不是类型错误 —— 项目是 plain JS，
// 没有编译期，所以只能靠这个测试当"类型检查"用。
import { describe, expect, it } from 'vitest';
import {
  GROUPS,
  GROUP_LABELS,
  TOOLS,
  canWrite,
  findTool,
  riskBadges,
  visibleTools,
} from './registry.js';

const LAYOUTS = ['instant', 'inspector', 'workbench'];
const GROUP_IDS = GROUPS.map((g) => g.id);

describe('registry 形状契约', () => {
  it('至少登记了一个工具', () => {
    expect(Array.isArray(TOOLS)).toBe(true);
    expect(TOOLS.length).toBeGreaterThan(0);
  });

  it('每个工具 id 唯一且是非空字符串', () => {
    const ids = TOOLS.map((t) => t.id);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('必备字段齐全且类型正确', () => {
    for (const t of TOOLS) {
      const where = `tool(${t.id})`;
      expect(typeof t.name, where).toBe('string');
      expect(t.name.length, where).toBeGreaterThan(0);
      expect(typeof t.desc, where).toBe('string');
      expect(t.desc.length, where).toBeGreaterThan(0);
      expect(typeof t.detail, where).toBe('string');
      expect(t.detail.length, where).toBeGreaterThan(0);
      expect(Array.isArray(t.tags), where).toBe(true);
      expect(t.tags.every((s) => typeof s === 'string' && s), where).toBe(true);
      expect(typeof t.icon, where).toBe('string');
      expect(t.icon.length, where).toBeGreaterThan(0);
      expect(typeof t.load, where).toBe('function');
      expect(Number.isInteger(t.stateVersion), where).toBe(true);
      expect(t.stateVersion, where).toBeGreaterThan(0);
    }
  });

  it('左栏描述足够短（两行以内，不会把清单挤变形）', () => {
    for (const t of TOOLS) {
      expect(t.desc.length, `tool(${t.id}).desc 太长：${t.desc}`).toBeLessThanOrEqual(40);
    }
  });

  it('group 必须落在 GROUPS 里（否则会掉进"其它"兜底组）', () => {
    for (const t of TOOLS) {
      expect(GROUP_IDS, `tool(${t.id}).group=${t.group}`).toContain(t.group);
    }
  });

  it('layout 必须是三种版式之一', () => {
    for (const t of TOOLS) {
      expect(LAYOUTS, `tool(${t.id}).layout=${t.layout}`).toContain(t.layout);
    }
  });

  it('capabilities 恰好是 {net,writes,files} 三个布尔，且默认全 false 才安全', () => {
    for (const t of TOOLS) {
      const c = t.capabilities;
      expect(typeof c, `tool(${t.id}).capabilities 缺失`).toBe('object');
      expect(Object.keys(c).sort()).toEqual(['files', 'net', 'writes']);
      for (const k of ['net', 'writes', 'files']) {
        expect(typeof c[k], `tool(${t.id}).capabilities.${k}`).toBe('boolean');
      }
    }
  });

  it('keywords 是非空字符串数组（tool.open 靠它做自然语言匹配）', () => {
    for (const t of TOOLS) {
      expect(Array.isArray(t.keywords), `tool(${t.id}).keywords 缺失`).toBe(true);
      expect(t.keywords.length, `tool(${t.id}).keywords 为空`).toBeGreaterThan(0);
      expect(t.keywords.every((s) => typeof s === 'string' && s.trim()), `tool(${t.id}).keywords`).toBe(
        true
      );
    }
  });

  it('keywords 去掉空白与大小写后不重复', () => {
    for (const t of TOOLS) {
      const norm = t.keywords.map((s) => s.trim().toLowerCase());
      expect(new Set(norm).size, `tool(${t.id}).keywords 有重复`).toBe(norm.length);
    }
  });

  it('registry 只描述"是什么"—— 绝不出现 render / component 之类描述"怎么渲染"的字段', () => {
    const banned = ['render', 'component', 'Component', 'jsx', 'element', 'view'];
    for (const t of TOOLS) {
      for (const k of banned) {
        expect(Object.prototype.hasOwnProperty.call(t, k), `tool(${t.id}) 出现了 ${k}`).toBe(false);
      }
    }
  });

  it('id 与 name 一一对应（复制粘贴新条目时最容易漏改 name）', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('分组与可见性', () => {
  it('GROUPS 的 id 唯一，且都有中文标签', () => {
    const ids = GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of GROUPS) {
      expect(typeof g.label).toBe('string');
      expect(g.label.length).toBeGreaterThan(0);
      expect(GROUP_LABELS[g.id]).toBe(g.label);
    }
  });

  it('visibleTools 只过滤 hidden，beta 仍出现', () => {
    const visible = visibleTools();
    expect(visible.every((t) => !t.hidden)).toBe(true);
    const withHidden = TOOLS.filter((t) => !t.hidden);
    expect(visible.map((t) => t.id)).toEqual(withHidden.map((t) => t.id));
  });

  it('findTool 命中已知 id、未知 id 返回 null', () => {
    expect(findTool(TOOLS[0].id)).toBe(TOOLS[0]);
    expect(findTool('__no_such_tool__')).toBe(null);
  });
});

describe('风险徽标与写授权', () => {
  it('每个工具都能算出徽标，且"只读/可写"两类恰好出现一个', () => {
    for (const t of TOOLS) {
      const badges = riskBadges(t);
      expect(badges.length, `tool(${t.id})`).toBeGreaterThan(0);
      const tl = badges.map((b) => b.label);
      expect(tl.some((x) => x === '只读') !== tl.some((x) => x === '会写入 todo.txt')).toBe(true);
      for (const b of badges) {
        expect(['quiet', 'warn', 'danger']).toContain(b.tone);
      }
    }
  });

  it('联网与可读本地文件必须显式标红/标黄（数据出机与读盘都要看得见）', () => {
    for (const t of TOOLS) {
      const badges = riskBadges(t);
      if (t.capabilities.net) {
        expect(badges.find((b) => b.label === '会联网').tone).toBe('danger');
      } else {
        expect(badges.some((b) => b.label === '不联网')).toBe(true);
      }
      if (t.capabilities.files) {
        expect(badges.find((b) => b.label === '可读本地文件').tone).toBe('warn');
      }
    }
  });

  it('canWrite 是写白名单的唯一入口（未声明 = 拿不到确认通道）', () => {
    for (const t of TOOLS) {
      expect(canWrite(t)).toBe(Boolean(t.capabilities && t.capabilities.writes));
    }
    expect(canWrite(null)).toBe(false);
    expect(canWrite({})).toBe(false);
  });

  it('被授权写 todo.txt 的工具是少数（默认全只读，逐个开）', () => {
    const writers = TOOLS.filter((t) => t.capabilities.writes).map((t) => t.id);
    expect(writers.length).toBeLessThanOrEqual(2);
  });

  it('联网工具必须极少数，且不允许同时写 todo.txt', () => {
    // 数据出机与数据落地不该耦合在同一个工具里：一旦耦合，
    // "把它禁掉"就同时意味着"丢掉一个能改 todo.txt 的工具"，用户会因此不敢禁。
    const netTools = TOOLS.filter((t) => t.capabilities.net);
    expect(netTools.length).toBeLessThanOrEqual(1);
    for (const t of netTools) {
      expect(t.capabilities.writes, `tool(${t.id}) 既联网又能写 todo.txt`).toBe(false);
    }
  });

  it('读本地文件的工具一律不写 todo.txt（读盘与落地分开授权）', () => {
    for (const t of TOOLS.filter((x) => x.capabilities.files)) {
      expect(t.capabilities.writes, `tool(${t.id})`).toBe(false);
    }
  });
});
