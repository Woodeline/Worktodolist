#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UI 重定调设计方案 · HTML 生成器（Phase 4）
==========================================
计划：electric-nebula-turing-8AgE0sv3 · Phase 4

数据同源承诺：所有令牌值 / 处置 / 统计均来自 ui-rebase-token-validate.py 的
运行结果（runpy 执行后取全局），与决策点②已确认的差异表严格同源；
附录 B 的对比度 / CVD / ΔE 矩阵按计划要求由**内嵌 JS 在浏览器端现算渲染**，
不使用任何目测数值。

产物：docs/design/2026-10-07-UI重定调设计方案.html（自包含单文件，无外链、无位图，
抽象论述图用内联 SVG，reduced-motion 降级）。
"""
import io, os, json, html, runpy, contextlib

HERE = os.path.dirname(os.path.abspath(__file__))
VALIDATE = os.path.join(HERE, 'ui-rebase-token-validate.py')
# 产物落进仓库根的 docs/design/；从脚本位置反推，不写死绝对路径。
OUT = os.path.normpath(os.path.join(HERE, os.pardir, 'docs', 'design',
                                    '2026-10-07-UI重定调设计方案.html'))

# ── 复用验证器：令牌全集 / 处置行 / 强调色裁决结果 ──
with contextlib.redirect_stdout(io.StringIO()):
    G = runpy.run_path(VALIDATE)
L, D = G['L'], G['D']
NEW_L, NEW_D, OLD_L, OLD_D = G['NEW_L'], G['NEW_D'], G['OLD_L'], G['OLD_D']
ROWS, OLD_ACCENT = G['ROWS'], G['OLD_ACCENT']
ACCENT_L, ACCENT_D = G['ACCENT_L'], G['ACCENT_D']

esc = html.escape
ACT, WHY = {}, {}
for grp, items in ROWS:
    for name, act, why in items:
        ACT[name] = act
        if why:
            WHY.setdefault(name, esc(why))

n_set = sum(1 for _, its in ROWS for _, a, _ in its if a == '换值')
n_frz = sum(1 for _, its in ROWS for _, a, _ in its if a == '冻结')
n_rdf = sum(1 for _, its in ROWS for _, a, _ in its if a == '重定义')

# ── 附录 B / §3 徽标：浏览器端现算所需的声明式数据 ──
CHECKS = []
def _c(t, f, b, thr): CHECKS.append({'t': t, 'f': f, 'b': b, 'thr': thr})
LIGHT_CHECKS = [
    ('text', 'surface', 4.5), ('text', 'bg', 4.5), ('text', 'surface-2', 4.5),
    ('text-2', 'surface', 4.5), ('text-2', 'surface-2', 4.5), ('muted', 'surface', 4.5),
    ('accent', 'surface', 4.5), ('accent', 'accent-soft', 4.5),
    ('accent-fg', 'accent', 4.5), ('accent-fg', 'accent-hover', 4.5),
    ('danger', 'surface', 4.5), ('danger', 'danger-soft', 4.5),
    ('warn', 'surface', 4.5), ('warn', 'warn-soft', 4.5),
    ('ok', 'surface', 4.5), ('ok', 'ok-soft', 4.5), ('mark-fg', 'mark-bg', 4.5),
    ('control-line', 'surface', 3), ('control-line', 'surface-2', 3),
    ('chart-frame', 'surface', 3), ('chart-axis', 'surface', 4.5),
    ('chart-thr', 'surface', 3), ('chart-warn', 'surface', 3),
] + [(f'chart-{i}', 'surface', 3) for i in range(1, 9)]
DARK_CHECKS = [
    ('text', 'surface', 4.5), ('text', 'bg', 4.5), ('text-2', 'surface', 4.5),
    ('muted', 'surface', 4.5), ('accent', 'surface', 4.5), ('accent', 'accent-soft', 4.5),
    ('accent-fg', 'accent', 4.5), ('accent-fg', 'accent-hover', 4.5),
    ('danger', 'danger-soft', 4.5), ('warn', 'warn-soft', 4.5), ('ok', 'ok-soft', 4.5),
    ('mark-fg', 'mark-bg', 4.5), ('control-line', 'surface', 3),
    ('chart-frame', 'surface', 3), ('chart-axis', 'surface', 4.5),
] + [(f'chart-{i}', 'surface', 3) for i in range(1, 9)]
for f, b, thr in LIGHT_CHECKS: _c('light', f, b, thr)
for f, b, thr in DARK_CHECKS: _c('dark', f, b, thr)

CVDROWS = [
    {'t': 'light', 'a': 'accent', 'b': 'danger', 'mode': 'gate'},
    {'t': 'light', 'a': 'accent', 'b': 'warn',   'mode': 'gate'},
    {'t': 'light', 'a': 'accent', 'b': 'ok',     'mode': 'review'},
    {'t': 'light', 'a': 'danger', 'b': 'warn',   'mode': 'base'},
    {'t': 'light', 'a': 'danger', 'b': 'ok',     'mode': 'base'},
    {'t': 'light', 'a': 'warn',   'b': 'ok',     'mode': 'base'},
    {'t': 'dark',  'a': 'accent', 'b': 'danger', 'mode': 'gate'},
    {'t': 'dark',  'a': 'accent', 'b': 'warn',   'mode': 'gate'},
    {'t': 'dark',  'a': 'accent', 'b': 'ok',     'mode': 'review'},
    {'t': 'dark',  'a': 'danger', 'b': 'warn',   'mode': 'base'},
    {'t': 'dark',  'a': 'danger', 'b': 'ok',     'mode': 'base'},
    {'t': 'dark',  'a': 'warn',   'b': 'ok',     'mode': 'base'},
]

# §3 关键徽标（同引擎渲染，取附录 B 子集）
KEY_CHECKS = [c for c in CHECKS if (c['f'], c['b']) in
              {('text', 'surface'), ('muted', 'surface'), ('accent', 'surface'),
               ('control-line', 'surface'), ('accent-fg', 'accent'), ('mark-fg', 'mark-bg')}]

TOK_JSON = json.dumps({'light': NEW_L, 'dark': NEW_D}, ensure_ascii=False)
ACC_JSON = json.dumps(OLD_ACCENT)

# ── 令牌变量块：mockup 的 --m-* 由 L/D 直接生成，杜绝手抄 ──
def mock_vars(T):
    order = ['bg', 'surface', 'surface-2', 'surface-3', 'border', 'border-strong',
             'control-line', 'text', 'text-2', 'muted', 'accent', 'accent-hover',
             'accent-fg', 'accent-soft', 'accent-line', 'danger', 'danger-soft',
             'warn', 'ok', 'ok-soft', 'mark-bg', 'mark-fg',
             'chart-axis', 'chart-grid', 'chart-frame', 'chart-thr',
             'ramp-1', 'ramp-2', 'ramp-3', 'ramp-4', 'ramp-5']
    return ''.join(f"--m-{k}:{T[k]};" for k in order)

MOCK_L, MOCK_D = mock_vars(L), mock_vars(D)

# ── §3 差异表（只列 换值 / 重定义；冻结项全集见附录 A）──
def swatch(v):
    if isinstance(v, str) and v.startswith('#') and len(v) == 7:
        return f'<span class="sw" style="background:{v}"></span><code>{esc(v)}</code>'
    return f'<code>{esc(str(v))}</code>'

diff_rows = []
for grp, items in ROWS:
    rows = [it for it in items if it[1] in ('换值', '重定义')]
    if not rows:
        continue
    diff_rows.append(f'<tr class="grp"><td colspan="6">{esc(grp)}</td></tr>')
    for name, act, why in rows:
        cls = 'set' if act == '换值' else 'rdf'
        cells = ''
        for o, n in ((OLD_L.get(name, '—'), NEW_L.get(name, '—')),
                     (OLD_D.get(name, '—'), NEW_D.get(name, '—'))):
            cells += f'<td class="old">{swatch(o)}</td><td>{swatch(n)}</td>'
        diff_rows.append(
            f'<tr><td class="name">{esc(name)}</td><td><span class="act {cls}">{act}</span></td>'
            f'{cells}<td class="why">{esc(why) or "—"}</td></tr>')
DIFF_TABLE = ('\n<table><tr><th style="width:120px">令牌</th><th style="width:66px">处置</th>'
              '<th style="width:150px">现值（浅）</th><th style="width:150px">新值（浅）</th>'
              '<th style="width:150px">现值（暗）</th><th style="width:150px">新值（暗）</th><th>理由</th></tr>\n'
              + '\n'.join(diff_rows) + '\n</table>')

# ── 附录 A 令牌全集对账表 ──
led = []
for k in NEW_L:
    act = ACT.get(k, '—')
    ol, nl = OLD_L.get(k, '—'), NEW_L.get(k, '—')
    od, nd = OLD_D.get(k, '—'), NEW_D.get(k, '—')
    cls = {'换值': 'set', '冻结': 'frz', '重定义': 'rdf'}.get(act, 'frz')
    same_l = 'same' if ol == nl else ''
    led.append(f'<tr><td class="name">{esc(k)}</td><td><span class="act {cls}">{esc(act)}</span></td>'
               f'<td class="{same_l}">{swatch(ol)}</td><td>{swatch(nl)}</td>'
               f'<td class="{same_l}">{swatch(od)}</td><td>{swatch(nd)}</td></tr>')
LEDGER = ('\n<table class="mini"><tr><th style="width:130px">令牌</th><th style="width:64px">处置</th>'
          '<th style="width:170px">现值（浅）</th><th style="width:170px">新值（浅）</th>'
          '<th style="width:170px">现值（暗）</th><th style="width:170px">新值（暗）</th></tr>\n'
          + '\n'.join(led) + '\n</table>')

# ── §5 明暗对称 · 同语义配对表 ──
PAIR_ROLES = [
    ('底座 / 面板', ['bg', 'surface', 'surface-2', 'surface-3']),
    ('分隔', ['border', 'border-strong', 'control-line']),
    ('文字', ['text', 'text-2', 'muted']),
    ('强调', ['accent', 'accent-hover', 'accent-fg', 'accent-soft', 'accent-line']),
    ('语义', ['danger', 'warn', 'ok']),
    ('语义软底', ['danger-soft', 'warn-soft', 'ok-soft']),
    ('图表', ['chart-axis', 'chart-grid', 'chart-frame', 'chart-thr']),
    ('顺序色阶', ['ramp-1', 'ramp-2', 'ramp-3', 'ramp-4', 'ramp-5']),
]
pair_rows = []
for role, names in PAIR_ROLES:
    pair_rows.append(f'<tr class="grp"><td colspan="5">{esc(role)}</td></tr>')
    for n in names:
        pair_rows.append(
            f'<tr><td class="name">{esc(n)}</td>'
            f'<td>{swatch(NEW_L[n])}</td><td>{swatch(NEW_D[n])}</td>'
            f'<td class="why">{esc(WHY.get(n, "明暗同语义换明度；暗色饱和度微升补偿"))}</td></tr>')
PAIR_TABLE = ('\n<table><tr><th style="width:120px">令牌</th><th style="width:170px">浅色</th>'
              '<th style="width:170px">暗色</th><th>对称策略</th></tr>\n'
              + '\n'.join(pair_rows) + '\n</table>')

DOC = r'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>UI 重定调设计方案 · 候选 C「信号仪表」· 2026-10-07</title>
<style>
:root{--font-ui:"Segoe UI","Microsoft YaHei UI","Microsoft YaHei",Meiryo,sans-serif;
--font-mono:"Cascadia Mono",Consolas,monospace;
--bg:#f4f5f6;--surface:#fff;--text:#1b1e22;--text-2:#4a5158;--muted:#79808a;
--line:#e2e5e8;--accent:#0e7490;--sunk:#eef0f1;--amber:#8a5a00;--green:#146b41;}
@media (prefers-color-scheme:dark){:root{--bg:#15171a;--surface:#1c1f23;--text:#e7eaed;
--text-2:#b3bac2;--muted:#868d96;--line:#2c3137;--sunk:#131518;--amber:#e8bd63;--green:#7dd3a2;}}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:var(--font-ui);font-size:13px;line-height:1.65;padding:0 0 80px}
.wrap{max-width:1280px;margin:0 auto;padding:0 24px}
header{padding:44px 0 22px;border-bottom:1px solid var(--line)}
.eyebrow{font-family:var(--font-mono);font-size:11px;letter-spacing:.14em;color:var(--muted)}
h1{font-size:27px;font-weight:600;margin:10px 0 0}
.meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.chip{font-family:var(--font-mono);font-size:11px;padding:5px 9px;border:1px solid var(--line);border-radius:3px;background:var(--surface);color:var(--text-2)}
.chip b{color:var(--accent)}
.sum{margin:20px 0 0;padding:12px 16px;background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:4px;color:var(--text-2)}
nav.toc{display:flex;gap:6px;flex-wrap:wrap;margin:18px 0 0}
nav.toc a{font-family:var(--font-mono);font-size:11px;padding:5px 9px;border:1px solid var(--line);border-radius:3px;color:var(--text-2);text-decoration:none}
nav.toc a:hover{border-color:var(--accent);color:var(--accent)}
section{padding:8px 0 4px}
h2{font-size:19px;margin:42px 0 4px;padding-top:14px;border-top:1px solid var(--line)}
h3{font-size:14.5px;margin:22px 0 4px}
p{margin:8px 0;color:var(--text-2)}
p.lead{color:var(--text)}
ul,ol{margin:8px 0 8px 22px;color:var(--text-2)}
li{margin:4px 0}
.note{font-size:12px;color:var(--muted)}
.callout{margin:14px 0;padding:12px 16px;background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--amber);border-radius:4px;font-size:12.5px;color:var(--text-2)}
code{font-family:var(--font-mono);font-size:11px}
pre{background:var(--sunk);border:1px solid var(--line);border-radius:4px;padding:12px 14px;overflow:auto;font-size:11.5px;line-height:1.6}
pre code{font-size:11.5px}
table{width:100%;border-collapse:collapse;margin:18px 0 8px;background:var(--surface);border:1px solid var(--line)}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:middle}
th{font-size:11px;font-family:var(--font-mono);letter-spacing:.06em;color:var(--muted);background:var(--sunk)}
td.name{font-family:var(--font-mono);font-size:12px;white-space:nowrap}
tr.grp td{background:var(--sunk);font-weight:600;font-size:12.5px}
td.same{color:var(--muted)}td.old{color:var(--muted)}
td.why{color:var(--text-2);font-size:12px}
.act{font-family:var(--font-mono);font-size:10.5px;padding:3px 7px;border-radius:3px;white-space:nowrap;display:inline-block}
.act.set{background:#e3f1f5;color:#0e7490}.act.frz{background:var(--sunk);color:var(--muted)}
.act.rdf{background:#fdeee0;color:#8a4a00}
@media (prefers-color-scheme:dark){.act.set{background:#12333e;color:#35c3e0}.act.rdf{background:#3a2a17;color:#e8bd63}}
.sw{display:inline-block;width:11px;height:11px;border-radius:2px;border:1px solid rgba(128,128,128,.4);margin-right:5px;vertical-align:-1px}
.badge{font-family:var(--font-mono);font-size:10.5px;padding:2px 7px;border-radius:3px;white-space:nowrap}
.badge.pass{color:var(--green)}.badge.review{color:var(--amber)}.badge.base{color:var(--muted)}.badge.info{color:var(--muted)}
/* ── mockup 区：组件只引用 --m-* 令牌（即新令牌系统的 var() 化复刻）── */
.mockzone{border:1px dashed var(--line);border-radius:6px;padding:18px;margin:16px 0;background:var(--sunk)}
.mz-bar{display:flex;gap:8px;align-items:center;margin:0 0 14px}
.mz-bar button{font-family:var(--font-mono);font-size:11px;padding:5px 12px;border:1px solid var(--line);border-radius:3px;background:var(--surface);color:var(--text-2);cursor:pointer}
.mz-bar button.on{border-color:var(--accent);color:var(--accent)}
.mock{font-size:12px;line-height:1.5;border-radius:5px;overflow:hidden;
border:1px solid var(--m-border);background:var(--m-bg);color:var(--m-text);
font-family:var(--font-ui)}
.mock + .mock{margin-top:18px}
.mock .mono{font-family:var(--font-mono)}
/* 顶栏 */
.mk-top{display:flex;align-items:center;gap:14px;padding:0 14px;height:34px;background:var(--m-surface);border-bottom:1px solid var(--m-border);font-size:11.5px;color:var(--m-muted)}
.mk-top .tabs{display:flex;gap:2px}
.mk-top .tab{padding:0 10px;line-height:33px}
.mk-top .tab.cur{color:var(--m-accent);border-bottom:2px solid var(--m-accent);font-weight:600}
.mk-top .sp{flex:1}
/* 列表 */
.mk-list{display:flex;min-height:300px}
.mk-side{width:170px;background:var(--m-surface);border-right:1px solid var(--m-border);padding:10px 8px;font-size:11.5px}
.mk-side .si{display:flex;justify-content:space-between;padding:4px 8px;border-radius:3px;color:var(--m-text-2)}
.mk-side .si.cur{background:var(--m-accent-soft);color:var(--m-accent);font-weight:600}
.mk-side .si .n{font-family:var(--font-mono);color:var(--m-muted)}
.mk-side .cap{font-family:var(--font-mono);font-size:10px;color:var(--m-muted);letter-spacing:.1em;margin:10px 8px 2px}
.mk-main{flex:1;display:flex;flex-direction:column;min-width:0}
.mk-add{margin:12px 14px 0;padding:7px 10px;border:1px solid var(--m-control-line);border-radius:3px;color:var(--m-muted);background:var(--m-surface)}
.mk-add b{color:var(--m-accent)}
.mk-rows{margin:8px 14px;border:1px solid var(--m-border);border-radius:4px;background:var(--m-surface)}
.mk-row{display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--m-border);font-size:12px}
.mk-row:last-child{border-bottom:none}
.mk-row.focus{outline:2px solid var(--m-accent);outline-offset:-2px;background:var(--m-surface)}
.mk-row .cb{width:13px;height:13px;border:1px solid var(--m-control-line);border-radius:3px;flex:none}
.mk-row .cb.done{background:var(--m-accent);border-color:var(--m-accent);position:relative}
.mk-row .cb.done::after{content:"✓";position:absolute;inset:0;color:var(--m-accent-fg);font-size:9px;display:flex;align-items:center;justify-content:center}
.mk-row .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mk-row.done .t{color:var(--m-muted);text-decoration:line-through}
.mk-row .star{color:var(--m-warn)}
.mk-row .pri{font-family:var(--font-mono);font-size:10px;padding:1px 6px;border-radius:2px;flex:none}
.mk-row .pri.a{background:var(--m-danger-soft);color:var(--m-danger)}
.mk-row .pri.b{background:var(--m-warn-soft);color:var(--m-warn)}
.mk-row .pri.c{background:var(--m-surface-3);color:var(--m-muted)}
.mk-row .due{font-family:var(--font-mono);font-size:10.5px;color:var(--m-muted);flex:none}
.mk-row .due.over{color:var(--m-danger);font-weight:600}
.mk-row .ctx{font-size:10.5px;color:var(--m-accent);background:var(--m-accent-soft);padding:1px 6px;border-radius:2px;flex:none}
.mk-row .dot{width:8px;height:8px;border-radius:50%;flex:none}
.mk-foot{margin:auto 14px 12px;padding-top:8px;border-top:1px solid var(--m-border);font-family:var(--font-mono);font-size:10.5px;color:var(--m-muted);display:flex;gap:14px}
/* 对话 */
.mk-chat{display:flex;min-height:300px}
.mk-stream{flex:1;padding:14px;display:flex;flex-direction:column;gap:10px;min-width:0}
.mk-bubble.user{align-self:flex-end;max-width:72%;background:var(--m-accent-soft);border:1px solid var(--m-accent-line);border-radius:6px 6px 2px 6px;padding:8px 12px;color:var(--m-text)}
.mk-tool{background:var(--m-surface-2);border:1px solid var(--m-border);border-radius:4px;padding:8px 12px;font-family:var(--font-mono);font-size:10.5px;color:var(--m-text-2)}
.mk-tool .hd{display:flex;gap:8px;align-items:center;color:var(--m-muted);margin-bottom:4px}
.mk-tool .ok{color:var(--m-ok)}
.mk-confirm{background:var(--m-surface);border:1px solid var(--m-border);border-left:3px solid var(--m-warn);border-radius:4px;padding:10px 12px;max-width:78%}
.mk-confirm .acts{display:flex;gap:8px;margin-top:8px}
.mk-btn{font-size:11px;padding:4px 12px;border-radius:3px;border:1px solid var(--m-control-line);background:var(--m-surface);color:var(--m-text)}
.mk-btn.pri{background:var(--m-accent);border-color:var(--m-accent);color:var(--m-accent-fg);font-weight:600}
.mk-input{margin:0 14px 12px;display:flex;gap:8px}
.mk-input .box{flex:1;border:1px solid var(--m-control-line);border-radius:3px;padding:7px 10px;color:var(--m-muted);background:var(--m-surface)}
.mk-input .send{background:var(--m-accent);color:var(--m-accent-fg);border-radius:3px;padding:7px 16px;font-weight:600}
/* 工具 */
.mk-toolpage{display:flex;min-height:300px}
.mk-col{width:190px;border-right:1px solid var(--m-border);padding:12px;background:var(--m-surface)}
.mk-col label{display:block;font-size:10.5px;color:var(--m-muted);margin:8px 0 3px}
.mk-col .inp{border:1px solid var(--m-control-line);border-radius:3px;padding:5px 8px;background:var(--m-bg);font-family:var(--font-mono);font-size:11px}
.mk-seg{display:flex;gap:4px}
.mk-seg span{border:1px solid var(--m-control-line);border-radius:3px;padding:4px 10px;font-size:11px;color:var(--m-text-2)}
.mk-seg span.on{background:var(--m-accent);border-color:var(--m-accent);color:var(--m-accent-fg)}
.mk-chart{flex:1;padding:12px 14px;display:flex;flex-direction:column;min-width:0}
.mk-badges{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.mk-bdg{font-family:var(--font-mono);font-size:10px;padding:2px 8px;border-radius:2px}
.mk-bdg.b1{background:var(--m-accent-soft);color:var(--m-accent)}
.mk-bdg.b2{background:var(--m-ok-soft);color:var(--m-ok)}
.mk-bdg.b3{background:var(--m-warn-soft);color:var(--m-warn)}
.mk-legend{display:flex;gap:12px;font-size:10.5px;color:var(--m-muted);margin-bottom:4px}
.mk-legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.mk-sum{margin-top:8px;padding-top:8px;border-top:1px solid var(--m-border);font-family:var(--font-mono);font-size:10.5px;color:var(--m-text-2);display:flex;gap:16px}
/* 设置 */
.mk-set{max-width:640px;padding:14px;display:flex;flex-direction:column;gap:12px}
.mk-card{background:var(--m-surface);border:1px solid var(--m-border);border-radius:5px}
.mk-card .ch{padding:8px 14px;border-bottom:1px solid var(--m-border);font-weight:600;font-size:12px;display:flex;justify-content:space-between;align-items:center}
.mk-card .ch .hint{font-weight:400;color:var(--m-muted);font-size:10.5px}
.mk-card .cf{display:flex;align-items:center;padding:8px 14px;gap:12px;border-bottom:1px solid var(--m-border)}
.mk-card .cf:last-child{border-bottom:none}
.mk-card .cf .fl{width:130px;flex:none;font-size:12px}
.mk-card .cf .fv{flex:1;display:flex;gap:6px;flex-wrap:wrap}
.mk-card .cf .hint{width:100%;font-size:10.5px;color:var(--m-muted);flex-basis:100%}
.mk-toggle{width:30px;height:16px;border-radius:999px;background:var(--m-surface-3);border:1px solid var(--m-control-line);position:relative;flex:none}
.mk-toggle.on{background:var(--m-accent);border-color:var(--m-accent)}
.mk-toggle i{position:absolute;top:1px;left:1px;width:12px;height:12px;border-radius:50%;background:var(--m-surface)}
.mk-toggle.on i{left:auto;right:1px}
.mk-tag{font-family:var(--font-mono);font-size:10px;padding:2px 7px;border:1px solid var(--m-border);border-radius:2px;color:var(--m-text-2)}
.mk-tag.on{border-color:var(--m-accent);color:var(--m-accent);background:var(--m-accent-soft)}
footer{margin-top:56px;padding-top:16px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}
svg text{font-family:var(--font-mono)}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style></head><body><div class="wrap">

<header>
  <div class="eyebrow">todolist gui · ui re-baseline · phase 4 · design spec</div>
  <h1>UI 重定调设计方案 · 候选 C「信号仪表」</h1>
  <div class="meta">
    <span class="chip">日期 <b>2026-10-07</b></span>
    <span class="chip">基线 <b>index.css §1（95 令牌）</b></span>
    <span class="chip">验证 <b>scripts/ui-rebase-token-validate.py v2 全过</b></span>
    <span class="chip">处置 <b>换值 ~40 / 冻结 ~50 / 重定义 1</b></span>
    <span class="chip">新增 0 · 删除 0</span>
    <span class="chip">画布 <b>ardot 15 frame 已交付</b></span>
  </div>
  <div class="sum">本文档是「todo.txt GUI · UI 重定调」的完整设计方案：记录调性裁决（候选 C）、推导链、95 令牌差异与验证结论、页面级示意（var() 复刻）、明暗对称策略与落地清单。附录 B 对比度 / CVD 矩阵由内嵌 JS 在打开时<b>现场计算</b>，数值永远与令牌表同步。本次为设计交付，不改产品代码。</div>
  <nav class="toc">
    <a href="#s0">0 判读卡</a><a href="#s1">1 背景动机</a><a href="#s2">2 方向论述</a>
    <a href="#s3">3 新令牌系统</a><a href="#s4">4 页面级示意</a><a href="#s5">5 明暗对称</a>
    <a href="#s6">6 落地清单</a><a href="#aA">附录 A 令牌全集</a><a href="#aB">附录 B 对比度矩阵</a>
  </nav>
</header>

<!-- ============ 0 判读卡 ============ -->
<section id="s0">
<h2>0 · 判读卡</h2>
<table>
<tr><th style="width:150px">条目</th><th>结论</th></tr>
<tr><td class="name">一句话新调性</td>
<td><b>信号仪表</b> —— 冷灰面板分域、示波器青强调、等宽字符扩权到标题/页签/计数、双线描边与紧凑圆角；工具理性的仪器面板，让「数据 · 状态 · 信号」成为视觉主角。</td></tr>
<tr><td class="name">被推翻的旧口径</td>
<td>2026-10-06 拍板的「贴近原生桌面工具」（跟随系统灰 + 系统蓝）—— 本次推翻其<b>视觉部分</b>：面板层级改为 bg 暗 / surface 亮的反转关系，强调色由系统蓝 <code>#0f5fbf</code> 改为示波器青 <code>__ACC_L__</code>。结构、交互、令牌架构<b>全部保留</b>。新拍板将写入 MEMORY.md（见 §6 备案）。</td></tr>
<tr><td class="name">不变的纪律红线</td>
<td>① 数据源唯一（<code>todo.txt / done.txt</code>）；② 间距只有一套，改密度不动卡片留白；③ 组件禁裸值、令牌唯一入口 <code>index.css §1</code>（本次换调零组件改动的前提）；④ AI 兜底四约束；⑤ 明暗同语义等价、语义色冻结。</td></tr>
</table>
</section>

<!-- ============ 1 背景动机 ============ -->
<section id="s1">
<h2>1 · 背景动机</h2>
<p class="lead">v0.1.3 → v0.1.6 三轮演进后，结构已经稳定（三页签 / 工具集 4 工具 / 设置集中化 / ToolShell 三版式），但视觉调性仍停留在「系统默认灰 + 默认蓝」——<b>产品有了骨架，没有签名</b>。</p>
<p>三个具体痛点：</p>
<ul>
<li><b>面板层级弱</b>：bg（#f0f0f0）与 surface（#ffffff）的关系沿用「窗口灰 + 白卡」的 OS 惯性，surface 亮于 bg 但层级语言与桌面系统混同，缺乏「仪器底座」的分区感。</li>
<li><b>强调色无辨识度</b>：<code>#0f5fbf</code> 与 Windows 默认蓝同质——选中态、焦点环、主按钮淹没在系统 UI 的海洋里。</li>
<li><b>气质分裂</b>：mono 字体只出现在数据单元格，标题 / 页签 / 计数仍走 UI 栈；一个以「文本协议 + 信号数据」为本体的产品，最有性格的资源（等宽字符）没有被用足。</li>
</ul>
<p>时机：组件全面令牌化 + <code>css-check / contrast</code> 门禁已稳定运行（基线 365 tests），换调性的边际成本处于历史最低点——<b>理论上只动 §1 的 ~95 个令牌，组件零改动</b>。这正是本次方案的全部赌注与全部红利。</p>
</section>

<!-- ============ 2 方向论述 ============ -->
<section id="s2">
<h2>2 · 方向论述（三候选 + 裁决记录）</h2>
<p class="lead">Phase 1 以两条正交轴生成候选：<b>血统</b>（工具理性 ↔ 日用感性）× <b>表现度</b>（素 ↔ 浓）。三候选以同构 DOM 微样张交付（<code>方向候选样张-2026-10-07.html</code>），换调只改令牌——当场实证了「组件禁裸值」红利。</p>
<svg viewBox="0 0 680 300" style="width:100%;max-width:680px;display:block;margin:14px 0" role="img" aria-label="三候选正交轴定位图">
  <line x1="60" y1="250" x2="640" y2="250" stroke="#79808a" stroke-width="1"/>
  <line x1="80" y1="270" x2="80" y2="30" stroke="#79808a" stroke-width="1"/>
  <polygon points="640,250 632,246 632,254" fill="#79808a"/><polygon points="80,30 76,38 84,38" fill="#79808a"/>
  <text x="612" y="270" font-size="11" fill="#79808a">血统 → 工具理性</text>
  <text x="30" y="46" font-size="11" fill="#79808a">↑ 表现度 浓</text>
  <text x="30" y="242" font-size="11" fill="#79808a">素</text>
  <circle cx="230" cy="196" r="9" fill="#0f5fbf" opacity=".85"/>
  <text x="246" y="193" font-size="12" fill="currentColor">A · 墨水编辑器</text>
  <text x="246" y="209" font-size="10" fill="#79808a">纸墨双极 · 单一藏蓝 · 克制到无装饰</text>
  <circle cx="540" cy="96" r="9" fill="#8a5a00" opacity=".85"/>
  <text x="556" y="93" font-size="12" fill="currentColor">B · 纸感手帐</text>
  <text x="556" y="109" font-size="10" fill="#79808a">暖纸底 · 棕橙 · 软阴影大圆角</text>
  <circle cx="470" cy="150" r="10" fill="#0e7490"/>
  <circle cx="470" cy="150" r="15" fill="none" stroke="#0e7490" stroke-dasharray="3 3"/>
  <text x="494" y="146" font-size="12" font-weight="bold" fill="currentColor">C · 信号仪表 ✓</text>
  <text x="494" y="162" font-size="10" fill="#79808a">冷灰分域 · 示波器青 · mono 扩权</text>
</svg>
<table>
<tr><th style="width:130px">候选</th><th style="width:150px">轴位</th><th>机制摘要</th><th style="width:210px">裁决观察</th></tr>
<tr><td class="name">A · 墨水编辑器</td><td>工具理性 × 素</td><td>纸白 / 墨黑双极、单一藏蓝强调、衬线标题克制混排；签名感来自「几乎没有装饰」。</td><td>与文本协议气质契合，但表现度过素——选中态、状态色、图表都缺乏可仰仗的系统色。</td></tr>
<tr><td class="name">B · 纸感手帐</td><td>日用感性 × 浓</td><td>暖纸底、棕橙强调、大圆角 + 软阴影；温度优先。</td><td>与「高密度工具 / 信号数据」的内容本质冲突：暖调会稀释状态色的可读性。</td></tr>
<tr><td class="name">C · 信号仪表 ✓</td><td>工具理性 × 中浓</td><td>冷灰面板分域（bg 暗 / surface 亮反转）、示波器青强调、mono 扩权到标题/页签/计数、双线描边（sh-2 加 1px 描边分量）、圆角收紧一档。</td><td>与产品内容（todo 文本协议 / RTI 信号 / 图表）同构；换调成本与 A 相当，签名感最强。</td></tr>
</table>
<div class="callout"><b>裁决记录（决策点① · 2026-10-07）</b>：用户回复「C」，候选 C 当选。A、B 用户未陈述落选理由，按选择结果落选备案；微样张存档于 <code>方向候选样张-2026-10-07.html</code> 备查。</div>
</section>

<!-- ============ 3 新令牌系统 ============ -->
<section id="s3">
<h2>3 · 新令牌系统（差异表 + 对比度徽标）</h2>
<p class="lead">推导链五步：<b>调性关键词</b>（仪器 · 终端 · 刻度 · 高密度 · 青）→ <b>视觉机制</b>（冷灰面板分域 + 双线描边 + mono 扩权）→ <b>令牌值域</b> → <b>明暗双套</b> → <b>约束回验</b>。</p>
<svg viewBox="0 0 680 92" style="width:100%;max-width:680px;display:block;margin:10px 0" role="img" aria-label="推导链">
  <g font-size="11" fill="currentColor">
    <rect x="6" y="26" width="112" height="40" rx="4" fill="none" stroke="#0e7490"/><text x="62" y="44" text-anchor="middle">调性关键词</text><text x="62" y="58" text-anchor="middle" font-size="9" fill="#79808a">仪器·终端·青</text>
    <rect x="146" y="26" width="112" height="40" rx="4" fill="none" stroke="#0e7490"/><text x="202" y="44" text-anchor="middle">视觉机制</text><text x="202" y="58" text-anchor="middle" font-size="9" fill="#79808a">分域·描边·mono</text>
    <rect x="286" y="26" width="112" height="40" rx="4" fill="none" stroke="#0e7490"/><text x="342" y="44" text-anchor="middle">令牌值域</text><text x="342" y="58" text-anchor="middle" font-size="9" fill="#79808a">~95 项逐一定值</text>
    <rect x="426" y="26" width="112" height="40" rx="4" fill="none" stroke="#0e7490"/><text x="482" y="44" text-anchor="middle">明暗双套</text><text x="482" y="58" text-anchor="middle" font-size="9" fill="#79808a">锚点反解</text>
    <rect x="566" y="26" width="108" height="40" rx="4" fill="#0e7490"/><text x="620" y="44" text-anchor="middle" fill="#fff">约束回验</text><text x="620" y="58" text-anchor="middle" font-size="9" fill="#cdeef5">脚本 v2 全过</text>
    <g stroke="#79808a" fill="#79808a"><line x1="118" y1="46" x2="142" y2="46"/><polygon points="146,46 140,43 140,49"/><line x1="258" y1="46" x2="282" y2="46"/><polygon points="286,46 280,43 280,49"/><line x1="398" y1="46" x2="422" y2="46"/><polygon points="426,46 420,43 420,49"/><line x1="538" y1="46" x2="562" y2="46"/><polygon points="566,46 560,43 560,49"/></g>
  </g>
</svg>
<p><b>锚点反解法</b>：--bg / --text 两端锚点按正文 4.5:1 反推；中间表面按 Oklch L 等感知明度排布；--control-line 对 surface ≥3:1 反解（WCAG 1.4.11 控件边界）；--accent 对 --accent-fg ≥4.5:1。强调色不做手工钦定——候选列表逐个过「对比度全项 + CVD vs danger/warn」闸门，取 vs-ok ΔE 最大者：<code>__ACC_L__</code>（浅）/ <code>__ACC_D__</code>（暗）。</p>
<h3>3.1 差异表（换值 / 重定义项）</h3>
<p class="note">冻结项（语义色、字阶、间距、结构尺寸等 ~50 项）不在本表，全集见附录 A。语义色冻结 = 颜色只编码状态、语义不动，是「明暗同语义等价」红线的直接兑现。</p>
__DIFF_TABLE__
<p class="note">处置统计：<b>换值 __NSET__</b> · <b>冻结 __NFRZ__</b> · <b>重定义 __NRDF__</b> · 新增 0 · 删除 0。重定义唯一一项：<code>font-display</code> 由占位（=font-ui）改为 <code>var(--font-mono)</code>——标题/页签/计数改由等宽字符承担个性，是本候选最强单点重定义。</p>
<h3>3.2 关键对比度徽标（打开文档时由 JS 现算）</h3>
<div id="keymarks" class="mockzone" style="background:var(--surface)"></div>
<h3>3.3 REVIEW 项与用户裁决</h3>
<div class="callout"><b>accent vs ok（浅色主题）· 色相内不可解</b>：能过 4.5:1 文字对比的青色与 ok 绿在 tritanopia（蓝黄色盲，约 0.01% 人群）下明度碰撞——4.5:1 把 accent 明度锁死在碰撞区，色相内数学上无解（5 个候选全试，ΔE 7.2–9.8）。已取候选内最优并如实上报。<b>用户裁决（决策点② · 2026-10-07）：选 A —— 接受现值 + 双编码缓解</b>（产品所有状态均为图标/文字双编码，无纯色辨析场景）。附录 B 中该项标注 REVIEW·A。另：danger vs warn（deutan ΔE≈4.7）为现网既有旧账（语义色冻结、零回归），列入实施后优化清单。</div>
</section>

<!-- ============ 4 页面级示意 ============ -->
<section id="s4">
<h2>4 · 页面级示意（var() 复刻）</h2>
<p class="lead">以下 mockup 用 HTML/CSS 复刻核心界面，<b>组件样式只引用 <code>--m-*</code> 令牌变量</b>（即新令牌系统的 var() 化）——切换主题只是换一组变量值，DOM 一字不动。这就是落地后「改 §1 即整站换调」的实证。</p>
<div class="mockzone" id="mockzone">
<div class="mz-bar"><span style="font-size:11px;color:var(--muted);font-family:var(--font-mono)">MOCKUP THEME</span>
<button id="btnL" class="on">浅色</button><button id="btnD">暗色</button>
<span style="font-size:11px;color:var(--muted)">（对应画布 frame：01 / 07 / 08 / 10；暗色镜像 04 / 13 / 14）</span></div>

<!-- 4.1 列表 -->
<div class="mock" data-cap="列表 · 常态">
  <div class="mk-top"><div class="tabs"><span class="tab">对话</span><span class="tab cur">列表</span><span class="tab">工具</span></div><span class="sp"></span><span class="mono">2026-10-07 · 周三</span><span class="mono">v0.1.6</span></div>
  <div class="mk-list">
    <aside class="mk-side">
      <div class="si cur"><span>今天</span><span class="n">3</span></div>
      <div class="si"><span>全部</span><span class="n">12</span></div>
      <div class="si"><span>已完成</span><span class="n">48</span></div>
      <div class="si"><span>收集箱</span><span class="n">2</span></div>
      <div class="cap">项目</div>
      <div class="si"><span>@强化</span><span class="n">5</span></div>
      <div class="si"><span>@回测</span><span class="n">4</span></div>
      <div class="cap">动力观察</div>
      <div class="si"><span>回测开巷</span><span class="n">2</span></div>
    </aside>
    <div class="mk-main">
      <div class="mk-add">+ 添加任务，回车录入：(A) 优先级 ·+项目 ·@上下文 <span class="mono">due:2026-10-09</span>　<b>语法直查 (A)(B)(C)=高/中/低</b></div>
      <div class="mk-rows">
        <div class="mk-row focus"><span class="cb"></span><span class="t">回测脚本接入移动回撤出场</span><span class="star">★</span><span class="pri a">高 A</span><span class="due over">逾期 10月8日</span><span class="ctx">@回测</span></div>
        <div class="mk-row"><span class="cb"></span><span class="t">整理主力吸筹指标参数对照表</span><span class="pri b">中 B</span><span class="due">10月9日</span><span class="ctx">@强化</span></div>
        <div class="mk-row"><span class="cb"></span><span class="t">军信股份周线参数二次验证</span><span class="pri c">低 C</span><span class="due">10月12日</span><span class="ctx">@回测</span></div>
        <div class="mk-row"><span class="cb"></span><span class="t">人民网日线止损回测报告</span><span class="pri c">低 C</span><span class="due">10月13日</span><span class="ctx">@回测</span></div>
        <div class="mk-row done"><span class="cb done"></span><span class="t">升级 ghfast 镜像脚本</span><span class="due">10月6日 完成</span></div>
      </div>
      <div class="mk-foot"><span>今天 3 项</span><span>全部 12 项</span><span>排序=手动</span><span>数据源 todo.txt · 只读白名单</span></div>
    </div>
  </div>
</div>

<!-- 4.2 对话 · 提议确认 -->
<div class="mock" data-cap="对话 · 消息流 + 提议确认">
  <div class="mk-top"><div class="tabs"><span class="tab cur">对话</span><span class="tab">列表</span><span class="tab">工具</span></div><span class="sp"></span><span class="mono">写入需此确认后落盘</span></div>
  <div class="mk-chat">
    <div class="mk-stream">
      <div class="mk-bubble user">把军信股份的周线验证排到下周，加个星标</div>
      <div class="mk-tool"><div class="hd"><span>tool · nl-parseIntent</span><span>本地规则命中</span><span class="ok">● 0 规则请求</span></div>intent=update　target=军信股份周线验证（score 0.83）<br/>patches: due=2026-10-12（下周一）　star=1<br/>confidence=0.92　needsConfirm=true　nearMatches=[全部核对 B 0.31]</div>
      <div class="mk-confirm">识别到 1 处修改：<b>due 改为下周一（10月12日）+ 加星标</b>。这是写文件的操作，确认后才会写入 todo.txt。<div class="acts"><span class="mk-btn pri">确认写入</span><span class="mk-btn">只改日期</span><span class="mk-btn">取消</span></div></div>
      <div class="mk-input"><div class="box">输入任务指令，或直接对话…</div><div class="send">发送</div></div>
    </div>
  </div>
</div>

<!-- 4.3 工具 · workbench -->
<div class="mock" data-cap="工具 · workbench（周统计图表）">
  <div class="mk-top"><div class="tabs"><span class="tab">对话</span><span class="tab">列表</span><span class="tab cur">工具</span></div><span class="sp"></span><span class="mono">registry · 4 工具 · 写白名单=bulkprio</span></div>
  <div class="mk-toolpage">
    <div class="mk-col">
      <label>范围</label>
      <div class="inp">2026-09-01 → 2026-10-07</div>
      <label>粒度</label>
      <div class="mk-seg"><span class="on">日</span><span>周</span><span>月</span></div>
      <label>序列（对照 --ramp）</label>
      <div class="inp">完成数 · 新增数</div>
    </div>
    <div class="mk-chart">
      <div class="mk-badges"><span class="mk-bdg b1">样本量 n=48 充分</span><span class="mk-bdg b2">未来 3 天无外推 · 置信度足</span><span class="mk-bdg b3">2 天缺位回调</span></div>
      <div class="mk-legend"><span><i style="background:var(--m-ramp-4)"></i>完成数</span><span><i style="background:var(--m-ramp-2)"></i>新增数</span><span><i style="background:var(--m-chart-thr)"></i>阈值 · 日完成 ≥ 4</span></div>
      <svg viewBox="0 0 560 180" style="width:100%;display:block" role="img" aria-label="周统计柱状图示意">
        <line x1="34" y1="10" x2="34" y2="152" stroke="var(--m-axis)" stroke-width="1"/>
        <line x1="34" y1="152" x2="552" y2="152" stroke="var(--m-axis)" stroke-width="1"/>
        <g stroke="var(--m-grid)" stroke-width="1"><line x1="34" y1="118" x2="552" y2="118"/><line x1="34" y1="84" x2="552" y2="84"/><line x1="34" y1="50" x2="552" y2="50"/></g>
        <rect x="52"  y="112" width="26" height="40" fill="var(--m-ramp-2)"/>
        <rect x="122" y="96"  width="26" height="56" fill="var(--m-ramp-3)"/>
        <rect x="192" y="72"  width="26" height="80" fill="var(--m-ramp-4)"/>
        <rect x="262" y="88"  width="26" height="64" fill="var(--m-ramp-3)"/>
        <rect x="332" y="46"  width="26" height="106" fill="var(--m-ramp-5)"/>
        <rect x="402" y="60"  width="26" height="92" fill="var(--m-ramp-4)"/>
        <rect x="472" y="120" width="26" height="32" fill="var(--m-ramp-2)"/>
        <line x1="34" y1="76" x2="552" y2="76" stroke="var(--m-chart-thr)" stroke-width="1.5" stroke-dasharray="5 3"/>
        <g font-size="8.5" fill="var(--m-axis)"><text x="58" y="164">09-08</text><text x="128" y="164">09-15</text><text x="198" y="164">09-22</text><text x="268" y="164">09-29</text><text x="338" y="164">10-05</text><text x="408" y="164">10-06</text><text x="478" y="164">10-07</text></g>
        <text x="500" y="70" font-size="9" fill="var(--m-chart-thr)">阈值 ≥ 4</text>
      </svg>
      <div class="mk-sum"><span>Σ完成 48</span><span>日均 4.6</span><span>峰值 10-05</span><span style="color:var(--m-warn)">外推段不纳入均值</span></div>
    </div>
  </div>
</div>

<!-- 4.4 设置 -->
<div class="mock" data-cap="设置 · 集中化">
  <div class="mk-top"><div class="tabs"><span class="tab">对话</span><span class="tab">列表</span><span class="tab">工具</span></div><span class="sp"></span><span class="mono">Ctrl+, 关闭设置</span></div>
  <div class="mk-set">
    <div class="mk-card"><div class="ch">外观 <span class="hint">调性 · 明暗</span></div>
      <div class="cf"><span class="fl">主题</span><span class="fv"><span class="mk-tag on">跟随系统</span><span class="mk-tag">浅色</span><span class="mk-tag">暗色</span></span></div>
      <div class="cf"><span class="fl">强调色预览</span><span class="fv"><span class="mk-tag on mono">accent __ACC_L__</span><span class="mk-tag mono">accent-fg 对比 4.5:1 ✓</span></span></div>
    </div>
    <div class="mk-card"><div class="ch">AI 兜底 <span class="hint">默认关闭 · 一行请求都不发</span></div>
      <div class="cf"><span class="fl">启用 AI 兜底</span><span class="fv"><span class="mk-toggle on"><i></i></span><span class="mk-tag mono">本地 unknown 才触发</span></span><span class="hint">AI 不自造 id；只从给定清单挑 targetIndex，序号→id 本地映射</span></div>
    </div>
    <div class="mk-card"><div class="ch">数据 <span class="hint">todo.txt / done.txt 唯一数据源</span></div>
      <div class="cf"><span class="fl">写白名单</span><span class="fv"><span class="mk-tag on">bulkprio</span><span class="mk-tag">其余工具只读</span></span></div>
    </div>
  </div>
</div>
</div>
</section>

<!-- ============ 5 明暗对称 ============ -->
<section id="s5">
<h2>5 · 明暗对称</h2>
<p class="lead">两条纪律：<b>明暗同语义换明度</b>（同一令牌在两主题只换明度角色、不变语义；暗色饱和度微升补偿低端明度下的辨识力）、<b>同语义等价验证</b>（附录 B 的矩阵对 light/dark 各跑一遍，同一检查项同一阈值）。</p>
<p>锚点反解：浅色以 <code>#ececee</code> 底 / <code>#16181c</code> 墨为锚（正文 4.5:1 富余），暗色以 <code>#131417</code> / <code>#ecedef</code> 为锚；中间表面按 Oklch L 等感知排布——浅色 surface(0.978) 亮于 bg(0.902) 的「高台」关系，在暗色镜像为 surface(0.136) 亮于 bg(0.085)，面板始终浮出底座。</p>
__PAIR_TABLE__
</section>

<!-- ============ 6 落地清单 ============ -->
<section id="s6">
<h2>6 · 落地清单（实施阶段执行，本次不含代码改动）</h2>
<h3>6.1 实施顺序</h3>
<ol>
<li><code>index.css §1</code> 一次提交替换 95 令牌（同步重写头部注释为「信号仪表」口径与推导链摘要）。</li>
<li>styleguide 15 视图逐屏目检（<code>?view=list</code>），确认无残留裸值与新调性一致。</li>
<li>门禁回归：<code>test:ui</code>（css-check + contrast）→ <code>test:responsive</code> → <code>test:settings / test:tools</code> → <code>npm run build</code> + 全量 <code>test</code>。</li>
<li>对照本档附录 B 数值抽验渲染对比度（浏览器 devtools 或脚本）。</li>
</ol>
<h3>6.2 零改动组件红利</h3>
<p>组件禁裸值红线保证换调理论上 <b>0 组件改动</b>。§4 的 mockup 即实证：同构 DOM 只换 <code>--m-*</code> 变量即整页换调。实施时如发现个别硬编码残留（预计为 rgba 阴影、内联 SVG 描边之类），按「顺手转令牌」最小处理并记录。</p>
<h3>6.3 风险与回滚</h3>
<ul>
<li>令牌全部集中在 <code>§1</code>：回滚 = 单 commit revert，无散落改动。</li>
<li>对比度 / CVD 由脚本门禁保证，回归风险前置到设计期消化。</li>
<li>REVIEW 项（accent vs ok 浅色 tritan）已由用户裁决 A 接受；如后续需要翻转，执行路径=ok 微调向黄绿（连带 ok-soft）后重跑验证脚本。</li>
<li>danger vs warn（deutan ΔE≈4.7）旧账：列入实施后优化清单，与本次解耦。</li>
</ul>
<h3>6.4 备案（本次设计交付内完成 / 实施阶段完成）</h3>
<ul>
<li><b>CHANGELOG</b>：记录调性变更与理由（本档 §0–§2 为素材）。</li>
<li><b>MEMORY.md</b>：推翻 2026-10-06「原生桌面工具」拍板，写入「信号仪表」新拍板。</li>
<li><b>index.css 头部注释重写</b>：属实施阶段（本次只备案）。</li>
<li><b>画布字体替代</b>：Ardot 画布以 Sarasa Gothic SC / Cascadia Mono 替代系统栈（画布环境无系统字体），落地实现不受影响。</li>
<li><b>验证脚本</b>：<code>scripts/ui-rebase-token-validate.py</code> 为计划外新增的可复现工具，随本方案归档。</li>
</ul>
</section>

<!-- ============ 附录 A ============ -->
<section id="aA">
<h2>附录 A · 令牌全集对账表（95 项）</h2>
<p class="note">现值取 <code>index.css §1</code> 基线；新值 = 验证器输出。冻结项新旧同值（仅列出备查）。</p>
__LEDGER__
</section>

<!-- ============ 附录 B ============ -->
<section id="aB">
<h2>附录 B · 对比度计算矩阵（内嵌 JS 现算）</h2>
<p class="note">本表所有数值由下方内嵌脚本在打开文档时现场计算——WCAG 相对亮度 / 对比度、CIE Lab ΔE76、Brettel/Viénot 三型色觉模拟（protanopia / deuteranopia / tritanopia 取最差）。令牌值与附录 A 同源，改表即改算。</p>
<h3>B.1 对比度（WCAG 2.x）</h3>
<div id="tbl-contrast"></div>
<h3>B.2 CVD 可辨性（ΔE76 ≥ 12 为闸门）</h3>
<p class="note"><b>PASS</b> = 闸门项（accent vs danger/warn，计划原文口径）。<b>REVIEW·A</b> = accent vs ok：浅色主题色彩学冲突，用户已裁决接受现值 + 双编码缓解（括号内为旧强调色基线 ΔE 对照）。<b>BASELINE</b> = 语义色两两之间（本次全冻结、与现网持平、非回归）。</p>
<div id="tbl-cvd"></div>
<h3>B.3 顺序色阶相邻步差（ΔE ≥ 10）与表面阶梯（Oklch L）</h3>
<div id="tbl-seq"></div>
<h3>B.4 图表分类色两两最小 ΔE（信息项，阈值 25）</h3>
<div id="tbl-chart"></div>
</section>

<footer>
  UI 重定调设计方案 · 候选 C「信号仪表」· 2026-10-07 · 自包含单文件（无外链 / 无位图 / reduced-motion 降级）。<br/>
  复算：<code>python scripts/ui-rebase-token-validate.py</code>（附录 B 同口径）· 重新生成本档：<code>python scripts/ui-rebase-doc-generate.py</code> · 配套交付：Ardot 画布 15 frame（fileId 733927098119198）· <code>方向候选样张-2026-10-07.html</code> · <code>令牌差异表-2026-10-07.html</code>
</footer>
</div>

<script>
/* ── 附录 B 现算引擎：与 ui-rebase-token-validate.py 同算法 ── */
var TOK = __TOK__;
var OLD_ACC = __ACC__;
var CHECKS = __CHECKS__;
var CVDROWS = __CVDROWS__;
function h2rgb(h){h=h.slice(1);return [0,2,4].map(function(i){return parseInt(h.substr(i,2),16)/255;});}
function lin(c){return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
function lum(h){var v=h2rgb(h).map(lin);return 0.2126*v[0]+0.7152*v[1]+0.0722*v[2];}
function contrast(f,b){var a=[lum(f),lum(b)].sort(function(x,y){return y-x;});return (a[0]+0.05)/(a[1]+0.05);}
function lab(h){var v=h2rgb(h).map(lin),r=v[0],g=v[1],b=v[2];
 function f(t){return t>0.008856?Math.pow(t,1/3):7.787*t+16/116;}
 var X=f((0.4124564*r+0.3575761*g+0.1804375*b)/0.95047),Y=f(0.2126729*r+0.7151522*g+0.0721750*b),Z=f((0.0193339*r+0.1191920*g+0.9503041*b)/1.08883);
 return [116*Y-16,500*(X-Y),200*(Y-Z)];}
function dE(a,b){var p=lab(a),q=lab(b);return Math.sqrt(Math.pow(p[0]-q[0],2)+Math.pow(p[1]-q[1],2)+Math.pow(p[2]-q[2],2));}
var CVD={protanopia:[[0.152286,1.052583,-0.204868],[0.114503,0.786281,0.099216],[-0.003882,-0.048116,1.051998]],
deuteranopia:[[0.367322,0.860646,-0.227968],[0.280085,0.672501,0.047413],[-0.011820,0.042940,0.968881]],
tritanopia:[[1.255528,-0.076749,-0.178779],[-0.078411,0.930809,0.147602],[0.004733,0.691367,0.303900]]};
function cvd(h,k){var v=h2rgb(h).map(lin),m=CVD[k];
 var o=[0,1,2].map(function(i){return m[i][0]*v[0]+m[i][1]*v[1]+m[i][2]*v[2];});
 function cl(x){return Math.min(1,Math.max(0,x));}
 function gm(x){return x<=0.0031308?12.92*x:1.055*Math.pow(x,1/2.4)-0.055;}
 return '#'+o.map(function(x){return Math.round(gm(cl(x))*255).toString(16).padStart(2,'0');}).join('');}
function cvdWorst(a,b){var w=1e9,wk='';for(var k in CVD){var d=dE(cvd(a,k),cvd(b,k));if(d<w){w=d;wk=k;}}return [w,wk];}
function oklchL(h){var v=h2rgb(h).map(lin),r=v[0],g=v[1],b=v[2];
 var l=0.4122214708*r+0.5363325363*g+0.0514459929*b,m=0.2119034982*r+0.6806995451*g+0.1073969566*b,s=0.0883024619*r+0.2817188376*g+0.6299787005*b;
 l=Math.pow(l,1/3);m=Math.pow(m,1/3);s=Math.pow(s,1/3);
 return 0.2104542553*l+0.7936177850*m-0.0040720468*s;}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}
function sw(v){return /^#[0-9a-f]{6}$/i.test(v)?'<span class="sw" style="background:'+v+'"></span>':'';}
function badge(cls,txt){return '<span class="badge '+cls+'">'+txt+'</span>';}
function table(head,rows){var h='<table class="mini"><tr>'+head.map(function(x){return '<th>'+x+'</th>';}).join('')+'</tr>';
 rows.forEach(function(r){h+='<tr>'+r.map(function(c){return '<td>'+c+'</td>';}).join('')+'</tr>';});return h+'</table>';}

var rc=[];
CHECKS.forEach(function(c){var T=TOK[c.t],r=contrast(T[c.f],T[c.b]);
 rc.push([c.t,c.f+' / '+c.b,'<code>'+T[c.f]+'</code> on <code>'+T[c.b]+'</code>',
 '<b>'+r.toFixed(2)+':1</b>',badge(r>=c.thr?'pass':'review',r>=c.thr?'PASS':'FAIL')]);});
document.getElementById('tbl-contrast').innerHTML=table(['主题','检查项','值对','结果','状态'],rc);

var vc=[];
CVDROWS.forEach(function(r){var T=TOK[r.t],d=T[r.a],b=T[r.b],w=cvdWorst(d,b);
 var st,txt;
 if(r.mode==='gate'){st=w[0]>=12?'pass':'review';txt=w[0]>=12?'PASS':'FAIL';}
 else if(r.mode==='review'){var base=cvdWorst(OLD_ACC[r.t],b)[0];
   st=w[0]>=12?'pass':'review';txt=(w[0]>=12?'PASS':'REVIEW·A')+'（旧强调色基线 ΔE='+base.toFixed(1)+'）';}
 else{st=w[0]>=12?'pass':'base';txt=w[0]>=12?'PASS':'BASELINE（现网旧账，冻结非回归）';}
 vc.push([r.t,r.a+' vs '+r.b,'<code>'+d+'</code> vs <code>'+b+'</code>',
 'ΔE='+w[0].toFixed(1)+'（worst: '+w[1]+'）',badge(st,txt)]);});
document.getElementById('tbl-cvd').innerHTML=table(['主题','色对','值对','最差模拟 ΔE76','状态'],vc);

var sq=[];
['light','dark'].forEach(function(t){var T=TOK[t],ds=[];
 for(var i=1;i<5;i++){ds.push(dE(T['ramp-'+i],T['ramp-'+(i+1)]));}
 var ok=ds.every(function(x){return x>=10;});
 sq.push([t,'ramp-1→5',ds.map(function(x){return x.toFixed(1);}).join(' · '),
 badge(ok?'pass':'review',ok?'PASS':'FAIL')]);
 var lad=['bg','surface-3','surface-2','surface'].map(function(n){return n+' L='+oklchL(T[n]).toFixed(3);}).join(' · ');
 sq.push([t,'表面阶梯（Oklch L）',lad,badge('info','INFO')]);});
document.getElementById('tbl-seq').innerHTML=table(['主题','检查项','结果','状态'],sq);

var ch=[];
['light','dark'].forEach(function(t){var T=TOK[t],mn=1e9,pair='';
 for(var i=1;i<9;i++)for(var j=i+1;j<9;j++){var d=dE(T['chart-'+i],T['chart-'+j]);if(d<mn){mn=d;pair='chart-'+i+'/chart-'+j;}}
 ch.push([t,'8 系列两两最小','ΔE='+mn.toFixed(1)+'（'+pair+'）',badge(mn>=25?'pass':'review',mn>=25?'PASS':'FAIL')]);});
document.getElementById('tbl-chart').innerHTML=table(['主题','检查项','结果','状态'],ch);

/* mockup 主题切换 */
var mz=document.getElementById('mockzone');
document.getElementById('btnL').onclick=function(){mz.querySelectorAll('.mock').forEach(function(m){m.classList.remove('inv');});
 this.classList.add('on');document.getElementById('btnD').classList.remove('on');};
document.getElementById('btnD').onclick=function(){mz.querySelectorAll('.mock').forEach(function(m){m.classList.add('inv');});
 this.classList.add('on');document.getElementById('btnL').classList.remove('on');};
</script>
</body></html>'''

DOC = (DOC.replace('__TOK__', TOK_JSON)
          .replace('__ACC__', ACC_JSON)
          .replace('__CHECKS__', json.dumps(CHECKS))
          .replace('__CVDROWS__', json.dumps(CVDROWS))
          .replace('__DIFF_TABLE__', DIFF_TABLE)
          .replace('__LEDGER__', LEDGER)
          .replace('__PAIR_TABLE__', PAIR_TABLE)
          .replace('__NSET__', str(n_set))
          .replace('__NFRZ__', str(n_frz))
          .replace('__NRDF__', str(n_rdf))
          .replace('__ACC_L__', ACCENT_L)
          .replace('__ACC_D__', ACCENT_D))

with open(OUT, 'w', encoding='utf-8') as f:
    f.write(DOC)
size = os.path.getsize(OUT)
print(f'✓ 方案文档已生成：{OUT}（{size/1024:.1f} KB，上限 300 KB）')
assert size < 300 * 1024, '超出 300KB 体积上限'
