# 更新日志

## v0.1.2 · 2026-10-06

对话「反问确认」按钮化：听懂了一句待办但不确定时，不再要求手打「是/不是」。

### 体验

- **提议按钮（新建 / 修改… / 跳过）**：隐式新增的反问消息下方直接挂三个按钮，一键确认或放弃（复用 readConfirm 状态机，确认前仍不改动文件）。按钮只挂当前存活的提议消息上——被回复或新命令消费后随之消失，刷新回放的历史消息不出现按钮（与澄清态不持久化的语义一致）。
- **修改弹窗 ProposalModal**：点「修改…」在弹窗里改标题 / 截止日 / 优先级 / 分类 / 标签（复用 EditDrawer 的字段样式体系），确认后走与「是」完全同一条 add 执行路径（工具卡片、事件日志、Ctrl+Z 撤销全兼容），日志记为「修改后新建「标题」」可读事件。空标题双保险拦截（弹窗禁用 + hook 兜底）。
- **Esc 分层**：修改弹窗打开时先关弹窗，否则照旧清空输入框。
- **favicon**：新增 `public/todolist.ico` 并在 index.html 引用，浏览器标签页不再显示默认图标。

### 质量

- 测试基线 208 → **215 例全绿**（新增 7 例：confirmCreate 直建路径、proposal 生命周期绑定、空标题拦截）。
- 生产构建 226.25 KB → 229.86 KB JS（gzip 78.20 → 79.23 KB）。

## v0.1.1 · 2026-10-06

AI 兜底接入检测工具 + preview 模式下代理缺口的修复。

### 修复

- **preview 模式下 AI 兜底绕过本地代理**：`resolveEndpoint` 原本只看 `import.meta.env.DEV` 标志，而构建产物里 DEV 恒为 false——日常双击跑的 preview 会直连上游、被 CORS 拦截，代理在 preview 里配了也白配。改为「DEV 或本机回环来源」即走代理（`isLocalOrigin()`），与"应用永远由启动器服务在 localhost"的部署模型一致。

### 新增：AI 接入检测（双层）

- **应用内「测试连接」按钮**（对话页 → AI 兜底设置面板）：用 `callAiFallback` 的真实请求路径发一条测试句，分档报告诊断结果——`config` 未配置 / `proxy` 代理拒绝内网目标（提示 TODOLIST_AI_ALLOW_HOSTS）/ `timeout` / `auth` Key 失效 / `model` 模型名或地址错误 / `request` / `upstream` 服务商 5xx / `network` 不可达（含 CORS 提示）/ `format` 返回无法解析为有效意图 / `success` 成功并展示模型解析出的意图。测的是表单当前值，未保存也能测。
- **命令行回归 `npm run test:ai`**（`scripts/qa-ai-link.mjs`）：不需要真实 API Key——自动起 mock OpenAI 上游 + 生产 preview，断言六件事：转发到达上游、路径拼接正确、Authorization 透传、`x-ai-target` 不泄漏、未放行内网目标 403、缺失目标头 403。这条脚本的存在理由：router 存量 bug 已证明「全绿测试 + 成功构建」发现不了配置层静默失效。

### 质量

- 测试基线 199 → **208 例全绿**（testAiConnection 九个分档用例）。
- 生产构建 226.25 KB JS（gzip 78.20 KB）。

## v0.1.0 · 2026-10-06

首个对外版本。基于 2026-10-06 两轮代码评审（自评 + 外部评审建议）合并落地。

### 数据安全（P0）

- **转后台/关窗前即时刷盘**（评审 P0-1）：监听 `visibilitychange`/`pagehide`，未保存改动立即写入 todo.txt；保存防抖 500ms → 200ms。修掉「点完就关、改动丢失」的主路径缺口。附回归测试 C9/C10。
- **原子写入口径修正**（评审 P0-2）：方案文档原声称「tmp+rename」与代码不符。实测确认依赖的是 Chromium `createWritable()` 交换文件 + `close()` 原子提交语义（FSA 对用户目录无 rename 原语），文档与代码注释均改为如实描述。
- **git 版本化落地**（自评补充）：`git init` + 每次启动后台自动提交数据变更（`scripts/git_autocommit.py`，只提交 todo.txt/done.txt/backup，失败静默）。方案 D2 承诺的「git 版本化 = 免费备份+历史」自此生效。

### 架构与运维（P1/P2）

- **默认跑生产构建**（评审 P1-1）：启动器默认用 `vite preview` 服务 `dist/`（不再把 dev server 长驻用户机器），dist 缺失自动构建；`--dev` 强制开发模式。端口不变，已授权的目录句柄不受影响。
- **服务身份探针**（自评补充）：`is_our_server` 从「进程映像名是否 node.exe」改为 HTTP 内容探针（检查页面标题标记），关闭「另一个 node 程序占端口导致浏览器被开到别人页面」的 B5 盲区。踩坑记录：urllib 必须禁用系统代理、IPv6 地址要加方括号。
- **端口失败换端口重试**（评审 P2-1）：`--strictPort` 失败后自动换下一个候选端口（最多 2 次）；失败文案区分「被占用」「被系统保留」「其他」三种，不再把误占用误诊成 Hyper-V 保留。
- **AI 代理修复 + 硬化**（评审 P2-2 + 存量 bug）：实测发现原实现的 `router` 选项在 vite/http-proxy 中**根本不存在**，AI 兜底代理自始至终返回 500（从未真正转发过）。已改为 `configure` 包装 `proxy.web` 按请求注入目标（读 http-proxy 源码确认每请求覆盖能力），dev/preview 共用。同时加固：只放行公网 http(s) 目标，回环/内网网段一律 403，可用 `TODOLIST_AI_ALLOW_HOSTS` 显式放行本地大模型。附回归测试 proxyTarget.test.js（5 例）。
- **孤儿进程清扫**（自评补充）：stop 脚本按命令行特征（node.exe + vite.js + 本应用目录）扫描并结束残留 vite 进程，不再只杀 pid 文件里记录的最后一个。
- **仓库清理**（评审 P2-3）：删除 40+ 个 vite timestamp 临时文件、dist-qa/dist-check-3 历史构建、23MB vitest 临时目录；新增根 .gitignore。

### 体验（P1）

- **对话页顶部今日概览**（评审 P1-2，B 方案）：常驻摘要条显示「逾期 N 条 · 今日到期 M 条」，有逾期时升为警告色，点击直达列表页。对话页仍是默认页签。
- **每日提醒脚本**（评审 P1-3）：`scripts/daily_reminder.py` 扫描今天到期/逾期的任务并弹窗（WScript.Shell.Popup，消息经环境变量传递防注入）；`scripts/register_reminder_task.py` 一键注册 schtasks 每天 09:00 运行。注：受限/沙箱环境可能拦截 schtasks，需真实环境验证。

### 质量

- 测试基线 192 → **199 例全绿**（vitest，11 个文件）。
- 生产构建：223.64 KB JS（gzip 76.78 KB）+ 37.07 KB CSS。

### 暂缓项（下版本评估）

- 评审 P0-3（动作事件流重放撤销栈）：改动面大，且 git 版本化落地后紧迫性下降，单独确认口径后再启动。
