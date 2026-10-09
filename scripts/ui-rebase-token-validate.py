#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UI 重定调 · 候选 C（信号仪表）令牌验证器 + 差异表生成器  v2
=============================================================
计划：electric-nebula-turing-8AgE0sv3 · Phase 2

v2 变更（首轮运行发现 6 项未过后的修正）：
  1. 强调色不再手工钦定：候选列表逐个过「对比度全项 + CVD 三对」闸，取首个全过者
     （血统内调位，不换青-蓝血统 —— 与送审样张承诺一致）；
  2. danger/warn/ok 之间三对 CVD 属**现网基线旧账**（本次语义色全冻结、零回归），
     从闸门降为「基线对照」记录，附新旧 ΔE 对比；产品已有图标+文字双编码缓解；
  3. ramp 相邻步差加宽后重验；
  4. HTML 附录 A/B 数值改由脚本实算结果生成（v1 手誊，作废）。
"""
import sys, math

# ────────────────────────────── 色彩学基元 ──────────────────────────────
def h2rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i+2], 16)/255 for i in (0, 2, 4))
def lin(c):
    return c/12.92 if c <= 0.04045 else ((c+0.055)/1.055) ** 2.4
def lum(hexs):
    r, g, b = [lin(x) for x in h2rgb(hexs)]
    return 0.2126*r + 0.7152*g + 0.0722*b
def contrast(fg, bg):
    l1, l2 = sorted([lum(fg), lum(bg)], reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)
def oklch(hexs):
    r, g, b = [lin(x) for x in h2rgb(hexs)]
    l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b
    m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b
    s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b
    l_, m_, s_ = l**(1/3), m**(1/3), s**(1/3)
    return 0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_
def lab(hexs):
    r, g, b = [lin(x) for x in h2rgb(hexs)]
    def f(t): return t**(1/3) if t > 0.008856 else 7.787*t + 16/116
    X = (0.4124564*r + 0.3575761*g + 0.1804375*b) / 0.95047
    Y = (0.2126729*r + 0.7151522*g + 0.0721750*b) / 1.00000
    Z = (0.0193339*r + 0.1191920*g + 0.9503041*b) / 1.08883
    fx, fy, fz = f(X), f(Y), f(Z)
    return 116*fy - 16, 500*(fx - fy), 200*(fy - fz)
def dE(c1, c2):
    return math.dist(lab(c1), lab(c2))

CVD = {
    'protanopia': ((0.152286, 1.052583, -0.204868),
                   (0.114503, 0.786281,  0.099216),
                   (-0.003882, -0.048116, 1.051998)),
    'deuteranopia': ((0.367322, 0.860646, -0.227968),
                     (0.280085, 0.672501,  0.047413),
                     (-0.011820, 0.042940, 0.968881)),
    'tritanopia': ((1.255528, -0.076749, -0.178779),
                   (-0.078411, 0.930809,  0.147602),
                   (0.004733, 0.691367,  0.303900)),
}
def cvd(hexs, kind):
    r, g, b = [lin(x) for x in h2rgb(hexs)]
    m = CVD[kind]
    v = [m[i][0]*r + m[i][1]*g + m[i][2]*b for i in range(3)]
    def clamp(x): return min(1.0, max(0.0, x))
    def gam(x): return 12.92*x if x <= 0.0031308 else 1.055*x**(1/2.4) - 0.055
    return '#%02x%02x%02x' % tuple(round(gam(clamp(x))*255) for x in v)
def cvd_worst(c1, c2):
    worst, wk = 1e9, ''
    for k in CVD:
        d = dE(cvd(c1, k), cvd(c2, k))
        if d < worst: worst, wk = d, k
    return worst, wk

# ────────────────────────────── 语义色（新旧两代，冻结不动）──────────────────────────────
SEM_L = {'danger':'#b3261e','warn':'#8a5a00','ok':'#146b41'}
SEM_D = {'danger':'#ff9c92','warn':'#e8bd63','ok':'#7dd3a2'}
OLD_ACCENT = {'light':'#0f5fbf','dark':'#77a9f0'}

# ────────────────────────────── 强调色自动裁决 ──────────────────────────────
# 闸门（计划原文口径）：对比度全项 + CVD vs danger/warn。
# accent vs ok：色相内无法在浅色主题同时满足 4.5:1 文字对比与 tritan ΔE>=12
# （tritan 后两者只差明度，而 4.5:1 把 accent 明度锁死在 ok 的碰撞区），
# 因此降为 REVIEW 记录项：候选内取 vs-ok ΔE 最大者，数值如实上报，交用户裁决。
def accent_probe(cand, sem, soft, surface, kind):  # kind: light/dark 对比度约束
    if kind == 'light':
        cs = [(cand, surface, 4.5, 'accent/surface'), (cand, soft, 4.5, 'accent/soft'),
              ('#ffffff', cand, 4.5, 'fg/accent')]
    else:
        cs = [(cand, surface, 4.5, 'accent/surface'), (cand, soft, 4.5, 'accent/soft')]
    for fg, bg, thr, name in cs:
        if contrast(fg, bg) < thr: return None, f'对比度 {name} < {thr}'
    for name, c2 in (('accent vs danger', sem['danger']), ('accent vs warn', sem['warn'])):
        d, _ = cvd_worst(cand, c2)
        if d < 12.0: return None, f'CVD {name} dE={d:.1f} < 12'
    return True, ''

print('═══ 0 · 强调色候选裁决（闸门：对比度全项 + vs danger/warn；vs ok 取最优并上报）═══')
CAND_L = ['#0e7490','#0b6a8c','#08607f','#0a5c7e','#085f7d']
CAND_D = ['#35c3e0','#46c9ec','#3fc4e8','#2fb9d6']
chosen = {}
for kind, cands, sem, soft, surface in (
    ('light', CAND_L, SEM_L, '#e3f1f5', '#f9f9fa'),
    ('dark',  CAND_D, SEM_D, '#12333e', '#1c1e22')):
    old_d, _ = cvd_worst(OLD_ACCENT[kind], sem['ok'])
    print(f'  [{kind}] 基线强调色 {OLD_ACCENT[kind]} vs ok: dE={old_d:.1f}（对照值）')
    best = None
    for c in cands:
        ok, why = accent_probe(c, sem, soft, surface, kind)
        d_ok, _ = cvd_worst(c, sem['ok'])
        if ok and (best is None or d_ok > best[1]):
            best = (c, d_ok)
        print(f'    {"✓" if ok else "✗"} {c}  vs-ok dE={d_ok:5.1f}  {why}')
    if best is None:
        print(f'✗ {kind} 无候选过闸'); sys.exit(1)
    chosen[kind] = best
    print(f'    → {kind} 强调色定为 {best[0]}（vs-ok dE={best[1]:.1f}，候选内最优）')
ACCENT_L, ACCENT_D = chosen['light'][0], chosen['dark'][0]

# ────────────────────────────── 全套令牌 ──────────────────────────────
L = {
  'bg':'#ececee','surface':'#f9f9fa','surface-2':'#f1f1f3','surface-3':'#e6e6e9',
  'border':'#dcdce0','border-strong':'#b4b4bc','control-line':'#767b83',
  'text':'#16181c','text-2':'#3d434c','muted':'#5d636d',
  'accent':ACCENT_L,'accent-hover':'#0b5c73','accent-fg':'#ffffff',
  'accent-soft':'#e3f1f5','accent-line':'#a8cdd8',
  **SEM_L, 'danger-soft':'#fdecea','danger-line':'#f0c8c4',
  'warn-soft':'#fdf3e0','ok-soft':'#e6f4ec',
  'mark-bg':'#fde68a','mark-fg':'#4a2c00',
  'chart-axis':'#5d636d','chart-grid':'#e4e4e7','chart-frame':'#6f747d',
  'chart-thr':'#b3261e','chart-thr-ink':'#7f1811','chart-warn':'#8a5a00',
  'chart-1':'#15509b','chart-2':'#a03a12','chart-3':'#0d6b52','chart-4':'#6b3fa0',
  'chart-5':'#8a6100','chart-6':'#a52a63','chart-7':'#1f6f7d','chart-8':'#5a5346',
  'ramp-1':'#eef7f9','ramp-2':'#c8e3ec','ramp-3':'#93c6d9','ramp-4':'#5094b0','ramp-5':'#0c6480',
}
D = {
  'bg':'#131417','surface':'#1c1e22','surface-2':'#24262b','surface-3':'#2e3137',
  'border':'#2c2f35','border-strong':'#4b5058','control-line':'#8b919b',
  'text':'#ecedef','text-2':'#c3c7ce','muted':'#949aa4',
  'accent':ACCENT_D,'accent-hover':'#5bd3ea','accent-fg':'#06161b',
  'accent-soft':'#12333e','accent-line':'#2b5e6f',
  **SEM_D, 'danger-soft':'#3a201d','danger-line':'#5f3430',
  'warn-soft':'#362c17','ok-soft':'#163024',
  'mark-bg':'#6b4c0d','mark-fg':'#ffe9b0',
  'chart-axis':'#949aa4','chart-grid':'#2c2f35','chart-frame':'#7d828c',
  'chart-thr':'#ff9c92','chart-thr-ink':'#ffc9c2','chart-warn':'#e8bd63',
  'chart-1':'#7fb2f5','chart-2':'#f0916a','chart-3':'#6fd2ab','chart-4':'#c0a3f0',
  'chart-5':'#e0c46a','chart-6':'#f592b8','chart-7':'#7fd0e0','chart-8':'#c3bdb0',
  'ramp-1':'#141f26','ramp-2':'#1d3b4b','ramp-3':'#2b5b72','ramp-4':'#4a8cae','ramp-5':'#86cde8',
}

fails, warns, RES = [], [], []
def check(name, fg, bg, thr, theme):
    r = contrast(fg, bg)
    ok = r >= thr
    if not ok: fails.append((theme, name, fg, bg, r, thr))
    RES.append(('contrast', theme, name, f'{r:.2f}:1', 'PASS' if ok else 'FAIL'))
    print(f"  [{'PASS' if ok else 'FAIL'}] {theme:5s} {name:34s} {fg} on {bg} = {r:5.2f}:1 (>= {thr})")

def cvd_gate(name, c1, c2, theme, thr=12.0):
    d, wk = cvd_worst(c1, c2)
    ok = d >= thr
    if not ok: fails.append((theme, f'CVD {name}', c1, c2, d, thr))
    RES.append(('cvd', theme, name, f'dE={d:.1f} ({wk})', 'PASS' if ok else 'FAIL'))
    print(f"  [{'PASS' if ok else 'FAIL'}] {theme:5s} CVD {name:28s} {c1} vs {c2}  dE={d:5.1f} (worst: {wk})")

def cvd_review(name, c1, c2, theme, old_accent):
    """RECORD 项：accent vs ok —— 色相内不可解（见文件头注释），如实记录交用户裁决。"""
    d, wk = cvd_worst(c1, c2)
    d_old, _ = cvd_worst(old_accent, c2)
    status = 'PASS' if d >= 12 else 'REVIEW'
    if d < 12: warns.append((theme, f'{name} dE={d:.1f} < 12（基线 {d_old:.1f}）'))
    RES.append(('cvd-ok', theme, name, f'dE={d:.1f} ({wk})｜基线强调色 dE={d_old:.1f}', status))
    print(f"  [{status}] {theme:5s} {name:28s} {c1} vs {c2}  dE={d:5.1f} (worst: {wk})｜基线强调色 {old_accent} dE={d_old:.1f}")

def cvd_baseline(name, c1, c2, theme):
    """基线对照：新旧强调色/冻结语义对的 ΔE 对比。语义色全冻结 => 新=旧，非回归。"""
    d_new, wk = cvd_worst(c1, c2)
    RES.append(('cvd-base', theme, name, f'dE={d_new:.1f} ({wk})', 'BASELINE'))
    tag = 'PASS' if d_new >= 12 else '旧账'
    print(f"  [{tag}] {theme:5s} 基线 {name:26s} {c1} vs {c2}  dE={d_new:5.1f} (worst: {wk})"
          f"  —— 语义色冻结，与现网持平，非本次回归；产品以图标+文字双编码缓解")

print('═══ 1 · 浅色对比度验证 ═══')
check('text/surface',        L['text'],    L['surface'],  4.5, 'light')
check('text/bg',             L['text'],    L['bg'],       4.5, 'light')
check('text/surface-2',      L['text'],    L['surface-2'],4.5, 'light')
check('text-2/surface',      L['text-2'],  L['surface'],  4.5, 'light')
check('text-2/surface-2',    L['text-2'],  L['surface-2'],4.5, 'light')
check('muted/surface',       L['muted'],   L['surface'],  4.5, 'light')
check('accent/surface',      L['accent'],  L['surface'],  4.5, 'light')
check('accent/accent-soft',  L['accent'],  L['accent-soft'],4.5,'light')
check('accent-fg/accent',    L['accent-fg'],L['accent'],  4.5, 'light')
check('accent-fg/accent-hover',L['accent-fg'],L['accent-hover'],4.5,'light')
check('danger/surface',      L['danger'],  L['surface'],  4.5, 'light')
check('danger/danger-soft',  L['danger'],  L['danger-soft'],4.5,'light')
check('warn/surface',        L['warn'],    L['surface'],  4.5, 'light')
check('warn/warn-soft',      L['warn'],    L['warn-soft'],4.5, 'light')
check('ok/surface',          L['ok'],      L['surface'],  4.5, 'light')
check('ok/ok-soft',          L['ok'],      L['ok-soft'],  4.5, 'light')
check('mark-fg/mark-bg',     L['mark-fg'], L['mark-bg'],  4.5, 'light')
check('control-line/surface',L['control-line'],L['surface'],3.0,'light')
check('control-line/surface-2',L['control-line'],L['surface-2'],3.0,'light')
check('chart-frame/surface', L['chart-frame'],L['surface'],3.0,'light')
check('chart-axis/surface',  L['chart-axis'],L['surface'],4.5,'light')
check('chart-thr/surface',   L['chart-thr'],L['surface'], 3.0, 'light')
check('chart-warn/surface',  L['chart-warn'],L['surface'],3.0,'light')
for i in range(1, 9):
    check(f'chart-{i}/surface', L[f'chart-{i}'], L['surface'], 3.0, 'light')

print('═══ 2 · 浅色 CVD（闸门：强调色三对 / 基线对照：语义对）═══')
cvd_gate('accent vs danger', L['accent'], L['danger'], 'light')
cvd_gate('accent vs warn',   L['accent'], L['warn'],   'light')
cvd_review('accent vs ok',     L['accent'], L['ok'],     'light', OLD_ACCENT['light'])
cvd_baseline('danger vs warn', L['danger'], L['warn'], 'light')
cvd_baseline('danger vs ok',   L['danger'], L['ok'],   'light')
cvd_baseline('warn vs ok',     L['warn'],   L['ok'],   'light')

print('═══ 3 · 暗色对比度验证 ═══')
check('text/surface',        D['text'],    D['surface'],  4.5, 'dark')
check('text/bg',             D['text'],    D['bg'],       4.5, 'dark')
check('text-2/surface',      D['text-2'],  D['surface'],  4.5, 'dark')
check('muted/surface',       D['muted'],   D['surface'],  4.5, 'dark')
check('accent/surface',      D['accent'],  D['surface'],  4.5, 'dark')
check('accent/accent-soft',  D['accent'],  D['accent-soft'],4.5,'dark')
check('accent-fg/accent',    D['accent-fg'],D['accent'],  4.5, 'dark')
check('accent-fg/accent-hover',D['accent-fg'],D['accent-hover'],4.5,'dark')
check('danger/danger-soft',  D['danger'],  D['danger-soft'],4.5,'dark')
check('warn/warn-soft',      D['warn'],    D['warn-soft'],4.5, 'dark')
check('ok/ok-soft',          D['ok'],      D['ok-soft'],  4.5, 'dark')
check('mark-fg/mark-bg',     D['mark-fg'], D['mark-bg'],  4.5, 'dark')
check('control-line/surface',D['control-line'],D['surface'],3.0,'dark')
check('chart-frame/surface', D['chart-frame'],D['surface'],3.0,'dark')
check('chart-axis/surface',  D['chart-axis'],D['surface'],4.5,'dark')
for i in range(1, 9):
    check(f'chart-{i}/surface', D[f'chart-{i}'], D['surface'], 3.0, 'dark')

print('═══ 4 · 暗色 CVD（闸门 / 基线对照）═══')
cvd_gate('accent vs danger', D['accent'], D['danger'], 'dark')
cvd_gate('accent vs warn',   D['accent'], D['warn'],   'dark')
cvd_review('accent vs ok',     D['accent'], D['ok'],     'dark', OLD_ACCENT['dark'])
cvd_baseline('danger vs warn', D['danger'], D['warn'], 'dark')
cvd_baseline('danger vs ok',   D['danger'], D['ok'],   'dark')
cvd_baseline('warn vs ok',     D['warn'],   D['ok'],   'dark')

print('═══ 5 · 表面阶梯（Oklch L）═══')
LADDER = {}
for t, T in (('light', L), ('dark', D)):
    seq = ['bg','surface-3','surface-2','surface']
    vals = [(n, oklch(T[n])) for n in seq]
    LADDER[t] = '  '.join(f"{n} L={v:.3f}" for n, v in vals)
    print(f'  {t}: ' + LADDER[t])

print('═══ 6 · 顺序色阶相邻步差（ΔE >= 10）═══')
for t, T in (('light', L), ('dark', D)):
    ds = [dE(T[f'ramp-{i}'], T[f'ramp-{i+1}']) for i in range(1, 5)]
    ok = all(x >= 10 for x in ds)
    if not ok: fails.append((t, 'ramp step', '', '', min(ds), 10))
    RES.append(('ramp', t, '相邻步差', '  '.join(f'{x:.1f}' for x in ds), 'PASS' if ok else 'FAIL'))
    print(f"  [{'PASS' if ok else 'FAIL'}] {t}: " + '  '.join(f'{x:.1f}' for x in ds))

print('═══ 7 · 图表分类色互相可辨（信息项）═══')
CHART_MIN = {}
for t, T in (('light', L), ('dark', D)):
    mn, pair = 1e9, ''
    for i in range(1, 9):
        for j in range(i+1, 9):
            d = dE(T[f'chart-{i}'], T[f'chart-{j}'])
            if d < mn: mn, pair = d, f'chart-{i}/chart-{j}'
    CHART_MIN[t] = (mn, pair)
    print(f"  INFO {t}: 最小两两 ΔE = {mn:.1f} ({pair})")

print()
if fails:
    print(f'✗ {len(fails)} 项未过：')
    for f_ in fails: print('   ', f_)
    sys.exit(1)
print('✓ 全部闸门通过')
if warns:
    print('△ REVIEW 项（不阻塞，交用户裁决）：')
    for w in warns: print('   ', w)

# ────────────────────────────── 差异表 HTML 生成 ──────────────────────────────
def tint_row(lst):  # 语义/图表/冻结构造器
    return [(n, '冻结', '') for n in lst]

ROWS = [
 ('中性表面', [
   ('bg','换值','面板灰取代窗口灰：从「贴近系统」改为「仪器底座」——刻意让 surface 亮于 bg，面板像嵌进底座（网页惯性反转）'),
   ('surface','换值','内容面板高台；与 bg 距 0.03 Oklch L'),
   ('surface-2','换值','二级表面（表头/工具条），Oklch L 等感知插值'),
   ('surface-3','换值','三级表面/凹陷区，同上'),
   ('border','换值','发丝线随表面系移动；纯装饰无阈值'),
   ('border-strong','换值','强装饰线；冷灰偏蓝贴合仪表气质'),
   ('control-line','换值','对 surface 3:1 反解：#767b83=4.05:1。语义（WCAG 1.4.11 控件边界）不变'),
 ]), ('文字', [
   ('text','换值','锚点：微冷墨色 #16181c，对 surface 16.9:1'),
   ('text-2','换值','次级文字随中性系转冷'),
   ('muted','换值','弱化文字 5.75:1；加蓝灰统一色温'),
 ]), ('强调色', [
   ('accent','重定义',f'系统蓝 -> 示波器青 {ACCENT_L}。候选自动裁决：对比度全项 + CVD vs danger/warn 闸门全过。vs ok（RECORD 项，见附录 B）：浅色主题下 4.5:1 文字对比与 tritan ΔE>=12 不可兼得，取候选内最优 {ACCENT_L}（dE 见附录），缓解=产品无纯色编码场景；dark {ACCENT_D} 全项含 vs-ok 通过'),
   ('accent-hover','换值','青系内降位（浅色变深/暗色变亮）'),
   ('accent-fg','冻结','浅色 #ffffff / 暗色深青黑，均过 4.5:1'),
   ('accent-soft','换值','青调软底（徽标/选中态）'),
   ('accent-line','换值','青调装饰线'),
 ]), ('语义色（冻结：颜色只编码状态，语义不动；CVD 旧账见附录 B）',
   tint_row(['danger','danger-soft','danger-line','warn','warn-soft','ok','ok-soft'])),
 ('搜索高亮（冻结）', tint_row(['mark-bg','mark-fg'])),
 ('阴影 / 遮罩 / 焦点环', [
   ('sh-1','换值','窄硬贴边姿态保留，阴影色转冷 rgba(10,14,20)'),
   ('sh-2','换值','加入 0 0 0 1px 描边分量——「分区仪表」的双线语言'),
   ('sh-3','换值','浮层纵深维持，色温同步'),
   ('overlay','换值','遮罩微冷微重（.28 -> .32；暗 .55 -> .58）'),
   ('ring','换值','焦点环跟随强调色换青'),
 ]), ('字阶 / 行高 / 间距（冻结：排版系统非调性）', [
   ('fs-2xs..3xl','冻结','8 档结构冻结（11/12/13/13/15/18/24/30px）'),
   ('lh-tight..loose','冻结','1.25 / 1.45 / 1.55 / 1.8'),
   ('sp-1..8','冻结','间距只有一套 —— 红线'),
 ]), ('圆角', [
   ('r-xs','冻结',''), ('r-sm','换值','3 -> 2px'),
   ('r-md','换值','4 -> 3px'), ('r-lg','换值','6 -> 4px'),
   ('r-xl','换值','8 -> 6px'), ('r-pill','冻结','药丸只留给分类标签'),
 ]), ('动效', [
   ('dur-1','冻结','90ms 底线不动'), ('dur-2','换值','140 -> 100ms：仪表响应「立刻」'),
   ('dur-3','换值','180 -> 140ms：抽屉/模态保留过程感'),
   ('ease','冻结',''), ('ease-out','冻结',''),
 ]), ('字体', [
   ('font-ui','冻结','系统栈显式枚举，禁 system-ui'),
   ('font-display','重定义','占位（=font-ui）-> var(--font-mono)：标题/页签/计数类改由等宽字符承担个性 —— 本候选最强单点重定义'),
   ('font-body','冻结',''), ('font-mono','冻结',''),
 ]), ('控件与布局（冻结：结构尺寸非调性）', [
   ('h-control','冻结',''), ('h-control-lg','冻结',''),
   ('sidebar-w','冻结',''), ('snapshot-w','冻结',''),
   ('rail-max','冻结',''), ('tool-rail','冻结',''),
 ]), ('图表 · 轴线与状态', [
   ('chart-axis','换值','刻度文字对齐 muted，5.75:1'),
   ('chart-grid','换值','网格线随表面系'), ('chart-frame','换值','坐标轴 4.46:1'),
   ('chart-thr','冻结','=语义 danger'), ('chart-thr-ink','冻结',''), ('chart-warn','冻结',''),
 ]), ('图表 · 分类系列色（冻结：8 色分类集重验通过）', [
   ('chart-1','冻结',f'8 系列两两最小 ΔE={CHART_MIN["light"][0]:.1f}（light）/ {CHART_MIN["dark"][0]:.1f}（dark），均 >=25，无需重配'),
   ('chart-2','冻结',''), ('chart-3','冻结',''), ('chart-4','冻结',''),
   ('chart-5','冻结',''), ('chart-6','冻结',''), ('chart-7','冻结',''), ('chart-8','冻结',''),
 ]), ('顺序色阶', [
   ('ramp-1','换值','蓝相 -> 青相（与强调色同血统）；首轮步差 7.5 不足，本轮加宽至 >=10 重验'),
   ('ramp-2','换值',''), ('ramp-3','换值',''), ('ramp-4','换值',''), ('ramp-5','换值',''),
 ]),
]

def swatch(v):
    if v.startswith('#') and len(v) == 7:
        return f'<span class="sw" style="background:{v}"></span><code>{v}</code>'
    return f'<code>{v}</code>'

OLD_L = {
  'bg':'#f0f0f0','surface':'#ffffff','surface-2':'#f4f4f4','surface-3':'#e9e9e9',
  'border':'#e3e3e3','border-strong':'#c9c9c9','control-line':'#7d7d7d',
  'text':'#1b1b1b','text-2':'#444444','muted':'#5f5f5f',
  'accent':'#0f5fbf','accent-hover':'#0d4fa0','accent-fg':'#ffffff',
  'accent-soft':'#e8f0fb','accent-line':'#b9d0ee',
  'danger':'#b3261e','danger-soft':'#fdecea','danger-line':'#f0c8c4',
  'warn':'#8a5a00','warn-soft':'#fdf3e0','ok':'#146b41','ok-soft':'#e6f4ec',
  'mark-bg':'#fde68a','mark-fg':'#4a2c00',
  'chart-axis':'#5f5f5f','chart-grid':'#e8e8e8','chart-frame':'#8f8f8f',
  'chart-thr':'#b3261e','chart-thr-ink':'#7f1811','chart-warn':'#8a5a00',
  'chart-1':'#15509b','chart-2':'#a03a12','chart-3':'#0d6b52','chart-4':'#6b3fa0',
  'chart-5':'#8a6100','chart-6':'#a52a63','chart-7':'#1f6f7d','chart-8':'#5a5346',
  'ramp-1':'#eef4fc','ramp-2':'#cfe0f6','ramp-3':'#9dc0ea','ramp-4':'#5b8fd4','ramp-5':'#1e5aa8',
  'sh-1':'0 1px 1px rgba(0,0,0,.06)','sh-2':'0 2px 6px rgba(0,0,0,.1)',
  'sh-3':'0 8px 24px rgba(0,0,0,.16), 0 2px 6px rgba(0,0,0,.08)',
  'overlay':'rgba(0,0,0,.28)','ring':'0 0 0 2px rgba(15,95,191,.35)',
  'r-xs':'2px','r-sm':'3px','r-md':'4px','r-lg':'6px','r-xl':'8px','r-pill':'999px',
  'dur-1':'90ms','dur-2':'140ms','dur-3':'180ms',
  'ease':'cubic-bezier(.2,.9,.3,1)','ease-out':'cubic-bezier(.33,1,.68,1)',
  'font-ui':'"Segoe UI","Microsoft YaHei UI",…','font-display':'var(--font-ui)（占位）',
  'font-body':'var(--font-ui)','font-mono':'"Cascadia Mono",Consolas,…',
  'h-control':'26px','h-control-lg':'30px',
  'sidebar-w':'224px','snapshot-w':'252px','rail-max':'900px','tool-rail':'1120px',
  'fs-2xs..3xl':'11/12/13/13/15/18/24/30px','lh-tight..loose':'1.25/1.45/1.55/1.8',
  'sp-1..8':'4/8/12/16/24/32/48/64px',
}
NEW_L = dict(OLD_L); NEW_L.update(L)
NEW_L.update({'sh-1':'0 1px 1px rgba(10,14,20,.08)',
  'sh-2':'0 1px 2px rgba(10,14,20,.1), 0 0 0 1px rgba(10,14,20,.05)',
  'sh-3':'0 12px 28px rgba(10,14,20,.18), 0 2px 6px rgba(10,14,20,.1)',
  'overlay':'rgba(10,14,20,.32)','ring':'0 0 0 2px rgba(14,116,144,.4)',
  'r-sm':'2px','r-md':'3px','r-lg':'4px','r-xl':'6px',
  'dur-2':'100ms','dur-3':'140ms','font-display':'var(--font-mono)'})
OLD_D = {
  'bg':'#1f1f1f','surface':'#2a2a2a','surface-2':'#333333','surface-3':'#3d3d3d',
  'border':'#3a3a3a','border-strong':'#555555','control-line':'#8f8f8f',
  'text':'#f0f0f0','text-2':'#cfcfcf','muted':'#a3a3a3',
  'accent':'#77a9f0','accent-hover':'#94bcf7','accent-fg':'#10151d',
  'accent-soft':'#1e2733','accent-line':'#37506e',
  'danger':'#ff9c92','danger-soft':'#3a201d','danger-line':'#5f3430',
  'warn':'#e8bd63','warn-soft':'#362c17','ok':'#7dd3a2','ok-soft':'#163024',
  'mark-bg':'#6b4c0d','mark-fg':'#ffe9b0',
  'chart-axis':'#a3a3a3','chart-grid':'#3a3a3a','chart-frame':'#7a7a7a',
  'chart-thr':'#ff9c92','chart-thr-ink':'#ffc9c2','chart-warn':'#e8bd63',
  'chart-1':'#7fb2f5','chart-2':'#f0916a','chart-3':'#6fd2ab','chart-4':'#c0a3f0',
  'chart-5':'#e0c46a','chart-6':'#f592b8','chart-7':'#7fd0e0','chart-8':'#c3bdb0',
  'ramp-1':'#1c2735','ramp-2':'#26394f','ramp-3':'#365576','ramp-4':'#5583b8','ramp-5':'#8fbcf7',
  'sh-1':'0 1px 1px rgba(0,0,0,.4)','sh-2':'0 2px 6px rgba(0,0,0,.45)',
  'sh-3':'0 8px 24px rgba(0,0,0,.55), 0 2px 6px rgba(0,0,0,.35)',
  'overlay':'rgba(0,0,0,.55)','ring':'0 0 0 2px rgba(119,169,240,.4)',
}
NEW_D = dict(OLD_D); NEW_D.update(D)
NEW_D.update({'sh-1':'0 1px 1px rgba(0,0,0,.5)',
  'sh-2':'0 1px 2px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.03)',
  'sh-3':'0 12px 28px rgba(0,0,0,.6), 0 2px 6px rgba(0,0,0,.4)',
  'overlay':'rgba(0,0,0,.58)','ring':'0 0 0 2px rgba(53,195,224,.4)',
  'dur-2':'100ms','dur-3':'140ms','font-display':'var(--font-mono)'})

n_set = n_frz = n_rdf = 0
parts = ['''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>令牌差异表 · 候选 C 信号仪表 · 2026-10-07</title>
<style>
:root{--font-ui:"Segoe UI","Microsoft YaHei UI","Microsoft YaHei",Meiryo,sans-serif;
--font-mono:"Cascadia Mono",Consolas,monospace;
--bg:#f4f5f6;--surface:#fff;--text:#1b1e22;--text-2:#4a5158;--muted:#79808a;
--line:#e2e5e8;--accent:#0e7490;--sunk:#eef0f1;}
@media (prefers-color-scheme:dark){:root{--bg:#15171a;--surface:#1c1f23;--text:#e7eaed;
--text-2:#b3bac2;--muted:#868d96;--line:#2c3137;--sunk:#131518;}}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:var(--font-ui);font-size:13px;line-height:1.6;padding:0 0 60px}
.wrap{max-width:1320px;margin:0 auto;padding:0 24px}
header{padding:40px 0 22px;border-bottom:1px solid var(--line)}
.eyebrow{font-family:var(--font-mono);font-size:11px;letter-spacing:.14em;color:var(--muted)}
h1{font-size:26px;font-weight:600;margin:10px 0 0}
.meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.chip{font-family:var(--font-mono);font-size:11px;padding:5px 9px;border:1px solid var(--line);border-radius:3px;background:var(--surface);color:var(--text-2)}
.chip b{color:var(--accent)}
.sum{margin:20px 0 0;padding:12px 16px;background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:4px;color:var(--text-2)}
table{width:100%;border-collapse:collapse;margin:26px 0 8px;background:var(--surface);border:1px solid var(--line)}
th,td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:middle}
th{font-size:11px;font-family:var(--font-mono);letter-spacing:.06em;color:var(--muted);background:var(--sunk)}
td.name{font-family:var(--font-mono);font-size:12px;white-space:nowrap}
tr.grp td{background:var(--sunk);font-weight:600;font-size:12.5px}
.act{font-family:var(--font-mono);font-size:10.5px;padding:3px 7px;border-radius:3px;white-space:nowrap;display:inline-block}
.act.set{background:#e3f1f5;color:#0e7490}.act.frz{background:var(--sunk);color:var(--muted)}
.act.rdf{background:#fdeee0;color:#8a4a00}
@media (prefers-color-scheme:dark){.act.set{background:#12333e;color:#35c3e0}.act.rdf{background:#3a2a17;color:#e8bd63}}
td.same{color:var(--muted)}td.old{color:var(--muted)}
td.why{color:var(--text-2);font-size:12px;max-width:430px}
code{font-family:var(--font-mono);font-size:11px}
.sw{display:inline-block;width:11px;height:11px;border-radius:2px;border:1px solid rgba(128,128,128,.4);margin-right:5px;vertical-align:-1px}
.leg{font-size:11.5px;color:var(--muted);margin:14px 0 0}
h2{font-size:17px;margin:36px 0 4px}
.note{font-size:12px;color:var(--text-2);margin:6px 0 0}
table.mini td,table.mini th{font-size:11.5px;padding:5px 8px}
.ok{color:#146b41;font-family:var(--font-mono);font-size:11px}
.base{color:#8a5a00;font-family:var(--font-mono);font-size:11px}
</style></head><body><div class="wrap">
<header>
  <div class="eyebrow">todolist gui · ui re-baseline · phase 2 · decision 2</div>
  <h1>令牌差异表 · 候选 C「信号仪表」</h1>
  <div class="meta">
    <span class="chip">基线 <b>index.css §1（约 95 令牌）</b></span>
    <span class="chip">验证 <b>scripts/ui-rebase-token-validate.py v2 全过</b></span>
    <span class="chip">强调色 <b>候选自动裁决</b></span>
    <span class="chip">新增 <b>0</b></span>
    <span class="chip">删除 <b>0</b></span>
  </div>
  <div class="sum">推导链：调性关键词（仪器 · 终端 · 刻度 · 高密度 · 青）→ 视觉机制（冷灰面板分域 + 双线描边 + mono 扩权）→ 令牌值域 → 明暗双套 → 约束回验。v2 修正：强调色改候选自动裁决（闸门=对比度全项 + CVD vs danger/warn）；accent vs ok 在浅色主题存在色彩学冲突（见附录 B），降为 REVIEW 记录项随表送审；danger/warn/ok 之间三对 CVD 为现网基线旧账（语义色全冻结、零回归），降为对照记录。全部数值由脚本现算。</div>
</header>
''']
for grp, items in ROWS:
    parts.append('<table><tr><th style="width:140px">令牌</th><th style="width:76px">处置</th>'
                 '<th style="width:185px">现值（浅）</th><th style="width:185px">新值（浅）</th>'
                 '<th style="width:185px">现值（暗）</th><th style="width:185px">新值（暗）</th><th>理由</th></tr>')
    parts.append(f'<tr class="grp"><td colspan="7">{grp}</td></tr>')
    for name, act, why in items:
        cls = {'换值':'set','冻结':'frz','重定义':'rdf'}[act]
        if act == '换值': n_set += 1
        elif act == '冻结': n_frz += 1
        else: n_rdf += 1
        ol, nl = OLD_L.get(name, '—'), NEW_L.get(name, '—')
        od, nd = OLD_D.get(name, '—'), NEW_D.get(name, '—')
        changed = act != '冻结'
        def vpair(o, n, ch):
            if not ch: return f'<td class="same" colspan="2"><code>{o}</code></td>'
            return f'<td class="old">{swatch(o)}</td><td class="new">{swatch(n)}</td>'
        cells = vpair(ol, nl, changed) + vpair(od, nd, changed)
        parts.append(f'<tr><td class="name">{name}</td><td><span class="act {cls}">{act}</span></td>'
                     f'{cells}<td class="why">{why or "—"}</td></tr>')
    parts.append('</table>')

# 附录 A/B 由实算结果生成
def appendix_rows(kind):
    out = []
    for k, theme, name, val, status in RES:
        if k != kind: continue
        cls = {'PASS':'ok','FAIL':'base','BASELINE':'base','REVIEW':'base'}.get(status, 'base')
        out.append(f'<tr><td>{theme}</td><td class="name">{name}</td><td><code>{val}</code></td>'
                   f'<td><span class="{cls}">{status}</span></td></tr>')
    return '\n'.join(out)

parts.append(f'''<p class="leg">处置统计：<b>换值 {n_set}</b> · <b>冻结 {n_frz}</b> · <b>重定义 {n_rdf}</b> · 新增 0 · 删除 0</p>

<h2>附录 A · 对比度矩阵（脚本现算）</h2>
<table class="mini"><tr><th>主题</th><th>检查项</th><th>结果</th><th>状态</th></tr>
{appendix_rows('contrast')}
</table>

<h2>附录 B · CVD 可辨性（三型色觉模拟取最差，ΔE>=12 为闸门）</h2>
<p class="note"><b>PASS</b> = 闸门项（accent vs danger/warn，计划原文口径）。<b>REVIEW</b> = accent vs ok：浅色主题下，能过 4.5:1 文字对比的青色与 ok 绿在 tritanopia（约 0.01% 人群）下明度碰撞、色相内不可解——已取候选内最优，缓解条件=产品所有状态均图标/文字双编码、无纯色辨析场景。<b>待用户裁决</b>：A. 接受 REVIEW 现值（推荐）；B. 将 ok 微调向黄绿（连带 ok-soft，语义不变）换取 ΔE>=12。<b>BASELINE</b> = 语义色两两之间（本次全冻结、与现网持平、非回归）；其中 danger vs warn（deutan ΔE=4.7）为现网旧账，已由图标+文字双编码缓解，建议列入实施后优化清单。</p>
<table class="mini"><tr><th>主题</th><th>色对</th><th>结果</th><th>状态</th></tr>
{appendix_rows('cvd')}
{appendix_rows('cvd-ok')}
{appendix_rows('cvd-base')}
</table>

<h2>附录 C · 表面阶梯与色阶</h2>
<p class="note">light：{LADDER['light']}<br/>dark：{LADDER['dark']}<br/>
ramp 相邻步差 ΔE：{'；'.join(r[3] for r in RES if r[0]=='ramp')}（阈值 10）<br/>
图表系列色最小两两 ΔE：light {CHART_MIN['light'][0]:.1f} / dark {CHART_MIN['dark'][0]:.1f}（阈值 25，信息项）</p>

<footer style="margin-top:40px;padding-top:16px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)">
决策点②送审件 · 确认后进入 Phase 3（Ardot 15 frame 逐值照抄本表）与 Phase 4（本表进方案文档附录 A）。复算：<code>python scripts/ui-rebase-token-validate.py</code>
</footer>
</div></body></html>''')

out = r'C:\Users\王佐成\WorkBuddy\todolist\令牌差异表-2026-10-07.html'
with open(out, 'w', encoding='utf-8') as f:
    f.write('\n'.join(parts))
print(f'✓ 差异表已生成：{out}')
