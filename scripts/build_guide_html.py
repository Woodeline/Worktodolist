"""把 topydo 安装配置指南.md 转成一份可直接在浏览器阅读的单文件 HTML。"""
import os
import re

import markdown

# 文档统一收在仓库根的 docs/guide/ 下。用脚本自身位置反推，
# 不写死绝对路径 —— 否则换个 worktree / 克隆到别的机器就失效。
HERE = os.path.dirname(os.path.abspath(__file__))
GUIDE_DIR = os.path.normpath(os.path.join(HERE, os.pardir, 'docs', 'guide'))
MD_PATH = os.path.join(GUIDE_DIR, 'topydo-安装配置指南.md')
HTML_PATH = os.path.join(GUIDE_DIR, 'topydo-安装配置指南.html')

with open(MD_PATH, encoding="utf-8") as f:
    md_text = f.read()

body = markdown.markdown(
    md_text,
    extensions=["tables", "fenced_code", "toc", "sane_lists", "attr_list"],
    extension_configs={"toc": {"toc_depth": "2-3", "anchorlink": True}},
)

# 从生成的 h2/h3 里抽取目录
toc_items = re.findall(r'<h([23]) id="([^"]+)">(.*?)</h[23]>', body)
toc_html = []
for level, anchor, title in toc_items:
    title = re.sub(r'<[^>]+>', '', title)
    toc_html.append(
        f'<a class="l{level}" href="#{anchor}">{title}</a>'
    )
toc_block = "\n".join(toc_html)

CSS = """
:root{
  --bg:#ffffff; --panel:#f7f8fa; --border:#e3e6ea; --text:#1f2328;
  --muted:#5b6472; --accent:#0b6bcb; --accent-soft:#eaf2fd;
  --warn-bg:#fff8e6; --warn-bd:#f0c36d; --code-bg:#f4f6f8;
  --ok:#1a7f37; --bad:#b3261e;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0; background:var(--bg); color:var(--text);
  font-family:"Segoe UI","Microsoft YaHei",system-ui,-apple-system,"PingFang SC",sans-serif;
  font-size:15px; line-height:1.75;
}
header.top{
  position:sticky; top:0; z-index:20; background:rgba(255,255,255,.94);
  backdrop-filter:saturate(180%) blur(8px); border-bottom:1px solid var(--border);
  padding:14px 32px;
}
header.top .t{font-size:15px;font-weight:600;color:var(--text)}
header.top .s{font-size:12.5px;color:var(--muted);margin-top:2px}
.wrap{display:flex;gap:28px;max-width:1240px;margin:0 auto;padding:24px 24px 64px}
nav.toc{
  flex:0 0 250px; position:sticky; top:78px; align-self:flex-start;
  max-height:calc(100vh - 110px); overflow:auto;
  border:1px solid var(--border); border-radius:10px; background:var(--panel);
  padding:14px 12px; font-size:13.5px;
}
nav.toc .h{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 8px 6px}
nav.toc a{display:block;text-decoration:none;color:var(--text);padding:3px 6px;border-radius:6px}
nav.toc a:hover{background:var(--accent-soft);color:var(--accent)}
nav.toc a.l3{padding-left:18px;color:var(--muted);font-size:13px}
main{flex:1 1 auto;min-width:0;max-width:900px}
h1{font-size:26px;line-height:1.35;margin:8px 0 18px;font-weight:700}
h2{font-size:20px;margin:38px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--border);font-weight:650}
h3{font-size:16.5px;margin:26px 0 8px;font-weight:650}
h4{font-size:15px;margin:20px 0 6px;font-weight:650;color:var(--muted)}
p{margin:10px 0}
a{color:var(--accent)}
code{
  background:var(--code-bg); border:1px solid var(--border); border-radius:5px;
  padding:1.5px 5px; font-family:"Cascadia Mono",Consolas,"Courier New",monospace;
  font-size:13px; word-break:break-all;
}
pre{
  background:var(--code-bg); border:1px solid var(--border); border-left:3px solid var(--accent);
  border-radius:8px; padding:13px 15px; overflow:auto; margin:12px 0;
}
pre code{background:none;border:none;padding:0;font-size:12.8px;line-height:1.6;word-break:normal;white-space:pre}
table{border-collapse:collapse;width:100%;margin:14px 0;font-size:13.8px;display:block;overflow:auto}
th,td{border:1px solid var(--border);padding:8px 10px;text-align:left;vertical-align:top}
th{background:var(--panel);font-weight:650;white-space:nowrap}
tbody tr:nth-child(even){background:#fbfcfd}
blockquote{
  margin:14px 0; padding:10px 16px; background:var(--panel);
  border-left:3px solid var(--muted); border-radius:0 8px 8px 0; color:var(--muted);
}
blockquote strong{color:var(--text)}
ul,ol{padding-left:24px;margin:10px 0}
li{margin:5px 0}
hr{border:none;border-top:1px solid var(--border);margin:32px 0}
.anchor{color:var(--border);text-decoration:none;margin-left:6px;font-weight:400}
.anchor:hover{color:var(--accent)}
@media (max-width:900px){nav.toc{display:none}.wrap{padding:16px}}
@media print{nav.toc,header.top{display:none}pre,table{page-break-inside:avoid}}
"""

HTML = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>topydo 本地安装与配置指南</title>
<style>{CSS}</style>
</head>
<body>
<header class="top">
  <div class="t">topydo 本地安装与配置指南</div>
  <div class="s">topydo 0.16 · Windows 10 + Python 3.13.14 全流程实测（2026-09-28）</div>
</header>
<div class="wrap">
  <nav class="toc">
    <p class="h">目录</p>
    {toc_block}
  </nav>
  <main>
{body}
  </main>
</div>
</body>
</html>
"""

with open(HTML_PATH, "w", encoding="utf-8") as f:
    f.write(HTML)

print("HTML 已生成:", HTML_PATH)
print("大小: %.1f KB" % (os.path.getsize(HTML_PATH) / 1024))
print("目录条目数:", len(toc_items))
