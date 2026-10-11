#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UI 重定调 · §1 令牌应用器（实施阶段）
====================================
计划：electric-nebula-turing-8AgE0sv3 · 实施第 1 步

把 ui-rebase-token-validate.py 的 NEW_L / NEW_D 写进 todolist-gui/src/index.css
§1（文件头 → 「2 · 基础层」横幅之前），并重写头部注释为「信号仪表」口径。
值一律从验证器字典取，杜绝手抄。

安全阀：
  · 若文件头已含「信号仪表」→ 已应用过，拒绝重复执行；
  · 写入前自动备份 backup/index.css.pre-rebase-<date>.css（若不存在）；
  · 打补丁后立即自检：新文件必须仍含「2 · 基础层」横幅且行数只增不减。
"""
import io, os, runpy, contextlib, shutil, datetime

ROOT = r'C:\Users\王佐成\WorkBuddy\todolist'
CSS = os.path.join(ROOT, 'todolist-gui', 'src', 'index.css')
VALIDATE = os.path.join(ROOT, 'scripts', 'ui-rebase-token-validate.py')
BACKUP = os.path.join(ROOT, 'backup', 'index.css.pre-rebase-20261008.css')

with contextlib.redirect_stdout(io.StringIO()):
    G = runpy.run_path(VALIDATE)
NL, ND = G['NEW_L'], G['NEW_D']

text = open(CSS, encoding='utf-8').read()
if '信号仪表' in text[:2000]:
    raise SystemExit('✗ index.css 头部已含「信号仪表」—— 似乎已应用过，拒绝重复执行')

idx = text.find('2 · 基础层')
assert idx > 0, '找不到「2 · 基础层」横幅'
start = text.rfind('/* ====', 0, idx)
assert start > 0
rest = text[start:]

import re

# 现文件里冻结令牌的真实值（font-ui 完整字体栈、ease 带空格格式等都在这里）
CUR = {}
for m in re.finditer(r'--([a-zA-Z0-9-]+):\s*([^;]+);', text):
    CUR.setdefault(m.group(1), m.group(2).strip())

# 本次换值/重定义的键：色令牌（L/D）+ 非色换值项；其余一律沿用现文件值
CHANGED = (set(G['L'].keys()) | set(G['D'].keys())
           | {'sh-1', 'sh-2', 'sh-3', 'overlay', 'ring',
              'r-sm', 'r-md', 'r-lg', 'r-xl', 'dur-2', 'dur-3', 'font-display'})

def v(name, dark=False):
    if dark:
        return ND[name]
    return NL[name] if name in CHANGED else CUR[name]

L1 = []
A = L1.append
# ── 头部注释 ──
A('''/* ============================================================================
   TodoList · 样式层
   ----------------------------------------------------------------------------
   设计方向：信号仪表（Signal instrument）
     · 2026-10-07 UI 重定调，推翻 2026-10-06 的「原生桌面工具」拍板；
       裁决与推导链全文见 docs/design/2026-10-07-UI重定调设计方案.html。
     · 冷灰面板分域：surface 亮于 bg 的「仪器底座」反转关系，面板浮出底座；
     · 示波器青强调（light #0e7490 / dark #46c9ec，候选自动裁决产生）；
     · mono 扩权：标题 / 页签 / 计数由 --font-display = var(--font-mono) 承担个性；
     · 双线描边（--sh-2 含 0 0 0 1px 分量）、圆角收紧一档、动效更快（100/140ms）。
     · 记忆点仍是「让纯文本随处可见」，视觉签名改由「仪器面板」承担。

   两条必须保留的语义区分（改样式时不要合并）：
     · --control-line ≠ --border：前者是交互控件的边界（WCAG 1.4.11 要求 ≥3:1），
       后者是纯装饰性发丝线（无阈值）。
     · 视觉重量编码「优先级」，颜色只编码「状态」—— 两者不混用。

   约束：完全离线，不加载任何 webfont。字体取自系统栈里的显式选择
        （仍不使用 system-ui：它会随平台漂移到不可预期的字形）。
   验证：python scripts/ui-rebase-token-validate.py（对比度 / CVD / 色阶全过）。
   ============================================================================ */

/* ============================================================================
   1 · 令牌层
   ========================================================================== */''')
A(':root {')
A('  color-scheme: light;')
A('')
A('  /* --- 中性表面：仪器底座 —— surface 亮于 bg，面板像嵌进底座的高台；')
A('         两端锚点按正文 4.5:1 反解，中间按 Oklch L 等感知明度排布 --- */')
for n in ('bg', 'surface', 'surface-2', 'surface-3', 'border', 'border-strong'):
    A(f'  --{n}: {v(n)};')
A(f'  --control-line: {v("control-line")}; /* 对 surface 3:1 反解（{v("control-line")} = 4.05:1），WCAG 1.4.11 */')
A('')
A('  /* --- 文字：锚点 #16181c 微冷墨，对 surface 16.9:1 --- */')
for n in ('text', 'text-2', 'muted'):
    A(f'  --{n}: {v(n)};')
A('')
A('  /* --- 强调色：示波器青。候选自动裁决（对比度全项 + CVD vs danger/warn 闸门')
A('         全过）；浅色主题 accent vs ok 的 tritan 冲突已由用户裁决 A 接受')
A('         （双编码缓解），详见方案文档 §3.3 --- */')
for n in ('accent', 'accent-hover', 'accent-fg', 'accent-soft', 'accent-line'):
    A(f'  --{n}: {v(n)};')
A('')
A('  /* --- 语义色：只给状态，不做装饰（本轮全冻结，CVD 旧账见方案文档附录 B） --- */')
for n in ('danger', 'danger-soft', 'danger-line', 'warn', 'warn-soft', 'ok', 'ok-soft'):
    A(f'  --{n}: {v(n)};')
A('')
A('  /* --- 搜索高亮：正文里被命中的片段 --- */')
A(f'  --mark-bg: {v("mark-bg")};')
A(f'  --mark-fg: {v("mark-fg")};')
A('')
A('  /* --- 阴影：窄、硬、贴边保留；sh-2 加入 0 0 0 1px 描边分量 ——')
A('         「分区仪表」的双线语言 --- */')
A(f'  --sh-1: {v("sh-1")};')
A(f'  --sh-2: {v("sh-2")};')
A(f'  --sh-3: {v("sh-3")};')
A('')
A('  /* --- 遮罩：抽屉与模态背后压暗的那层。暗色下要更重，否则浮层与背景分不开 --- */')
A(f'  --overlay: {v("overlay")};')
A('')
A('  /* --- 字阶：收敛到 8 档，禁止再手写裸数值（冻结：排版系统非调性）。 --- */')
for n in ('fs-2xs', 'fs-xs', 'fs-sm', 'fs-md', 'fs-lg', 'fs-xl', 'fs-2xl', 'fs-3xl'):
    A(f'  --{n}: {v(n)};')
A('')
A('  /* --- 行高：桌面列表不需要阅读器式的 1.7 --- */')
for n in ('lh-tight', 'lh-snug', 'lh-base', 'lh-loose'):
    A(f'  --{n}: {v(n)};')
A('')
A('  /* --- 间距：4 的倍数（间距只有一套 —— 红线） --- */')
for i in range(1, 9):
    A(f'  --sp-{i}: {v(f"sp-{i}")};')
A('')
A('  /* --- 圆角：整体收紧一档（-1px），仪器面板的小方角。药丸只留给分类标签 --- */')
for n in ('r-xs', 'r-sm', 'r-md', 'r-lg', 'r-xl', 'r-pill'):
    A(f'  --{n}: {v(n)};')
A('')
A('  /* --- 动效：仪表响应「立刻」—— dur-2 100ms（原 140）、dur-3 140ms（原 180），')
A('         抽屉/模态保留过程感 --- */')
A(f'  --dur-1: {v("dur-1")};')
A(f'  --dur-2: {v("dur-2")};')
A(f'  --dur-3: {v("dur-3")};')
A(f'  --ease: {v("ease")};')
A(f'  --ease-out: {v("ease-out")};')
A('')
A('  /* --- 字体：两族分工 + mono 扩权。')
A('         ui 负责正文与表格界面文字；mono 除数据/度量/键位外，还承担标题、')
A('         页签与计数（--font-display 指向 mono）—— 本候选最强单点重定义。 --- */')
A(f'  --font-ui: {v("font-ui")};')
A(f'  --font-display: {v("font-display")};')
A(f'  --font-body: {v("font-body")};')
A(f'  --font-mono: {v("font-mono")};')
A('')
A('  /* --- 控件高度：让"按钮/输入框/菜单项"共用同一把尺子 --- */')
A(f'  --h-control: {v("h-control")};')
A(f'  --h-control-lg: {v("h-control-lg")};')
A('')
A('  /* --- 布局尺寸 --- */')
A(f'  --sidebar-w: {v("sidebar-w")};')
A(f'  --snapshot-w: {v("snapshot-w")};')
A(f'  --rail-max: {v("rail-max")}; /* 阅读栏宽上限：避免超宽屏上行长失控 */')
A(f'  --tool-rail: {v("tool-rail")}; /* 工具区宽上限：数据密集的表格与图表比正文更宽 */')
A('')
A(f'  --ring: {v("ring")}; /* 焦点环跟随强调色换青 */')
A('')
A('  /* --- 图表：数据可视化有自己的配色需求（多系列要互相可辨、要能在深浅两种底上')
A('         读出来），借 UI 语义色会立刻捉襟见肘，所以单开一组。')
A('         全部写成具体色值而不是 var() 引用 —— 画布绘图通过 getComputedStyle 读它们，')
A('         保持"一个令牌一个值"最不容易出错。 --- */')
A(f'  --chart-axis: {v("chart-axis")}; /* 刻度文字、轴标题（对齐 muted，5.75:1） */')
A(f'  --chart-grid: {v("chart-grid")}; /* 网格线（装饰，不设对比度阈值） */')
A(f'  --chart-frame: {v("chart-frame")}; /* 坐标轴（图形边界，4.46:1 ≥3:1） */')
A(f'  --chart-thr: {v("chart-thr")}; /* 阈值线：判断门限（=语义 danger，冻结） */')
A(f'  --chart-thr-ink: {v("chart-thr-ink")}; /* 阈值线上的标记与标注 */')
A(f'  --chart-warn: {v("chart-warn")}; /* 置信度较低的点（外推得来） */')
for i in range(1, 9):
    A(f'  --chart-{i}: {v(f"chart-{i}")};')
A('')
A('  /* --- 顺序色阶（密度语义）：--chart-* 那 14 个是**分类色**（彼此可辨），')
A('         表达不了"密度高低"的连续语义。热力图 / 完成度这类需要顺序色阶。')
A('         单色相 5 阶（青相，与强调色同血统），从近底到近墨；相邻步差 ΔE ≥ 10')
A('         已由验证脚本重验。正式启用它的工具必须同时进 qa-contrast。')
A('         注：发散色阶（涨跌对比）暂不引入 —— 目前没有任何工具需要。 --- */')
for i in range(1, 6):
    A(f'  --ramp-{i}: {v(f"ramp-{i}")};')
A('}')
A('')
A('/* 暗色：同一套语义令牌换值，组件代码一行不动。')
A('   明暗同语义换明度（暗色饱和度微升补偿）；跟随系统偏好（本应用没有主题开关，')
A('   因此不做单方面覆盖）。 */')
A('@media (prefers-color-scheme: dark) {')
A('  :root {')
A('    color-scheme: dark;')
A('')
A('    /* 暗色锚点 #131417 / #ecedef；中间表面 Oklch L 等感知镜像 */')
for n in ('bg', 'surface', 'surface-2', 'surface-3', 'border', 'border-strong', 'control-line'):
    A(f'    --{n}: {v(n, True)};')
A('')
for n in ('text', 'text-2', 'muted', 'accent', 'accent-hover', 'accent-fg',
          'accent-soft', 'accent-line', 'danger', 'danger-soft', 'danger-line',
          'warn', 'warn-soft', 'ok', 'ok-soft', 'mark-bg', 'mark-fg'):
    A(f'    --{n}: {v(n, True)};')
A('')
for n in ('sh-1', 'sh-2', 'sh-3'):
    A(f'    --{n}: {v(n, True)};')
A('')
A(f'    --overlay: {v("overlay", True)};')
A('')
A(f'    --ring: {v("ring", True)};')
A('')
A('    /* 图表令牌同步换值：同一组语义、另一组明度。系列色一律提亮到')
A('       能在暗底上满足 3:1，否则深色主题下细线会糊掉。 */')
for n in ('chart-axis', 'chart-grid', 'chart-frame', 'chart-thr', 'chart-thr-ink', 'chart-warn'):
    A(f'    --{n}: {v(n, True)};')
for i in range(1, 9):
    A(f'    --chart-{i}: {v(f"chart-{i}", True)};')
A('')
A('    /* 顺序色阶（暗色）：同一语义、另一组明度 —— 阶与阶之间仍要能看出差 */')
for i in range(1, 6):
    A(f'    --ramp-{i}: {v(f"ramp-{i}", True)};')
A('  }')
A('}')
A('')

new_s1 = '\n'.join(L1) + '\n'
new_text = new_s1 + rest

# 自检
assert '2 · 基础层' in new_text
assert len(new_text.splitlines()) > len(text.splitlines())
for probe in ('--accent: #0e7490', '--accent: #46c9ec', '--font-display: var(--font-mono)',
              '--ramp-5: #0c6480', '--ramp-5: #86cde8', '--control-line: #767b83'):
    assert probe in new_text, f'自检失败：缺 {probe}'

# 备份（若用户/先前步骤已备好则不覆盖）
if not os.path.exists(BACKUP):
    shutil.copy2(CSS, BACKUP)

with open(CSS, 'w', encoding='utf-8', newline='') as f:
    f.write(new_text)

n_old, n_new = len(text.splitlines()), len(new_text.splitlines())
print(f'✓ §1 已替换：{n_old} → {n_new} 行（备份：{BACKUP}）')
print(f'  强调色 light {NL["accent"]} / dark {ND["accent"]}；font-display → var(--font-mono)')
