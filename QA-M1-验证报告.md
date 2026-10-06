# M1 交付物独立验证报告

- 项目：`todolist-gui`（Vite + React 18 + plain JS，数据源 todo.txt / done.txt）
- 验证人：QA 工程师 严过关（独立于工程师范刚）
- 验证日期：2026-09-30

## 1. 验证结论

**PASS（含 1 处重要源码 Bug、2 处次要 Bug，已定位并修复）**。工程师范刚报告“37 单测全绿 + 构建通过”均能独立复现、属实；但撤销链路存在真实竞态缺陷，已修复并重跑全绿。若无本轮攻击测试，37 个单测无法暴露这些缺陷（现有单测仅覆盖纯函数，未覆盖 useTodoStore）。

## 2. 独立复现结果（真实命令输出摘要）

| 项目 | 命令 | 结果 |
|---|---|---|
| 单测 | `npx vitest run` | **37 passed (2 files)**，与报告一致 |
| 构建 | `npx vite build --outDir dist-qa` | **通过**，44 modules transformed，`index-*.js 177.89 kB` |
| 独立攻击脚本 | `node --import ./scripts/register-qa-loader.mjs scripts/qa-independent.mjs` | 修复前 **40/43**，修复后 **43/43** |
| 互操作 | topydo 0.16 + `.qa-tmp` 副本 | **双向全部通过** |

互操作要点：
- GUI 序列化行 `(A) 2026-09-30 复核季报 @财务 +季报 due:2026-10-15` 等，`topydo ls` 正确识别优先级 / due / @ / +。
- `topydo add "(B) 从命令行添加的任务 @cli +集成 due:2026-12-01"` 写入行被本解析器正确解析（priority=B、自动创建日期、due、@cli、+集成）。
- 二次 `topydo ls` 仍稳定列出 GUI 生成行。

## 3. 缺陷清单

### D1〔重要〕fade 窗口内“撤销”被抵消 → 幽灵任务  [源码 Bug → 已修复]
- 位置：`src/hooks/useTodoStore.js` `toggleComplete` / `undo`（原 195–206 / 143–163）
- 复现：完成任务 A 后，在 `FADE_MS=180ms` 内点击 Toast「撤销」。
- 实际：`undo` 先把 `revive(A)` 插回 todo；随后挂起的 `setTimeout` 又执行 `todo.filter(id!==A)`，把 A 及副本一并删除、并把 A 写入 done → todo −1、done +1，**撤销完全失效**。
- 期望：撤销后 A 留在 todo，done 不变。
- 证据：`[C1] todo=2(期望3) done=1(期望0)`；`[C5] 撤销后同 id 条目数=2`。
- 修复：新增 `pendingCompleteRef = useRef(new Map())`；`undo` 中若该完成尚未提交则 `clearTimeout` 取消提交（源码 150–157）。

### D2〔重要〕fade 窗口内连点两次完成 → done 重复条目  [源码 Bug → 已修复]
- 位置：同上 `toggleComplete`
- 复现：180ms 内对同一任务连点两次完成。
- 实际：`done.txt` 写入两条完全相同的完成行（同 id / 同内容）。
- 期望：只完成一次。
- 证据：`[C2] done=2 重复id=true 内容=["x 2026-09-30 … 任务A","x 2026-09-30 … 任务A"]`。
- 修复：`toggleComplete` 增加防重入守卫 `if (pendingCompleteRef.current.has(task.id)) return;`（源码 205）。

### D3〔次要〕完成与删除竞态  [源码 Bug → 已修复]
- 位置：`toggleComplete` 定时器回调
- 复现：完成 A（尚未提交）后 180ms 内删除 A。
- 实际：定时器仍把 `doneTask` 写入 done，已被删除的 A 出现在 done。
- 修复：提交回调加 `if (!todo.some(e => e.id === task.id)) return { todo, done };`（源码 213）。

### D4〔次要〕`todayGroups` 把未来到期任务归入 `noDate`  [无需修／观察]
- 位置：`src/lib/sortFilter.js` `todayGroups`（74–84）
- 说明：`dueDate > today` 落入 `noDate`。但调用前已被 `isVisibleToday` 过滤未来任务，实际不产生错误展示；仅命名/语义建议改为 `future` 组。

### D5〔次要〕制表符被归一化为空格  [无需修／观察]
- 位置：`src/lib/todoParser.js` `tokenizeRest`（`split(/\s+/)`）
- 说明：含 tab 的行序列化后 tab→空格，属语义等价归一化，与 topydo 行为一致。

### D6〔次要〕未使用的 CSS 类 `.topbar-right`  [无需修／建议清理]
- 位置：`src/index.css` 61–65，JSX 中未使用，无功能影响。

### 确认无问题的项
- `resolveConflictKeepLocal` 在 `handle===null` 时被 `try/catch` 兜住，**不抛未捕获异常**（提示“写入失败”toast）`[C4]`。
- `searchMatch` 用 `includes` 实现，对 `.*` `(` `[` `\` 等正则特殊字符**安全不抛异常**。
- `compareAuto` 对 priority/due/createdAt 全 `null` 组合**稳定且确定**（`a,b,c,d` 保序）。
- 序列化器对真实 9+2 行**逐字节无损往返**。
- 畸形输入（空行、`#注释`、`x`、`(A)`、`x 2026-09-30`、20000 字符超长行、emoji、制表符、CRLF、BOM、`@工作`、`+项目`、`due:…`、反斜杠引号）**均不崩、不丢关键字段、不产生异常字段**。

## 4. 静态检查（part D）

- **App.jsx 接线（D.9）**：`useHotkeys` 6 个回调（onNew/onSearch/onToggle/onEdit/onEscape/onUndo）、Toast、`ConflictModal`、三视图（today/all/inbox/done）+ 搜索 + 排序、`EditDrawer` **全部接线，无空实现/未接线分支**。
  - 次要观察：App.jsx 内联箭头回调每次渲染都是新引用 → `useHotkeys` 每次都重新订阅 window 监听（性能小瑕疵，非 Bug）。
- **index.css 覆盖（D.10）**：脚本抓取全部 jsx 的 className 令牌与 CSS 选择器比对，**无缺失类名**。（自动比对报告的 `manual`/`auto` 系 `sortMode === 'manual'` 比较操作数的误报，非 className。）
  - 反向：CSS 定义但 JSX 未用：`topbar-right`（真实未用）；`dot-*`/`p-*`/`mark` 为动态/元素使用，非冗余。

## 5. 未能验证的部分

浏览器交互类 AC 无法在无头 Node 环境覆盖：真实 checkbox 点击的 fade 动画、`showDirectoryPicker` 授权弹窗、IndexedDB 句柄真实持久化、窗口 focus 触发的冲突弹层、拖拽排序手势。本轮已用 React hooks 替身驱动**真实未改动的 `useTodoStore`** 覆盖数据与撤销逻辑；DOM/浏览器 API 层建议在 Edge/Chrome 人工冒烟。

## 6. 数据文件完整性确认

- `todo.txt`：9 行，md5 `badc8ae687dbd8fd6f79cd27756bc0c5` —— 与备份一致。
- `done.txt`：2 行，md5 `0206793e439faef426f31273fa652ef1` —— 与备份一致。
- `topydo ls` 正常列出 8 条（第 5 行 `t:2026-10-05` 因阈值未到被 topydo 隐藏，属预期）。
- 互操作测试**全程只操作 `.qa-tmp` 副本**，真实文件只读未改。

## 7. 新增过程产物（QA 工具，不影响构建）

- `todolist-gui/scripts/qa-independent.mjs`（攻击脚本）
- `todolist-gui/scripts/qa-interop.mjs`（互操作，prepare/verify）
- `todolist-gui/scripts/qa-css-check.mjs`（CSS 覆盖检查）
- `todolist-gui/scripts/qa-react-shim.mjs` + `qa-react-loader.mjs` + `register-qa-loader.mjs`（真实 hook 的 React 替身）
- 备份 `todolist/.qa-backup/`、临时 `todolist/.qa-tmp/`、构建产物 `todolist-gui/dist-qa/`

## 8. 复核增补（工程师范刚追加加固 → QA 已独立复验）

工程师在本轮后于 `src/hooks/useTodoStore.js` 追加两道加固，QA 独立复验通过：
- `undo` complete 分支新增**幂等守卫**：若 todo 已存在同 id 任务，只清理 done 残留、不重复插入（源码 159–163）。
- `deleteTask` 新增**挂起完成清理**：删除前若存在挂起完成定时器，则 clearTimeout + 清 `pendingCompleteRef` + 清 fadingIds + 从 undo 栈移除对应 complete 动作（源码 234–244）。

新增组合用例（攻击脚本 43 → **46 项**，全部通过）：
- `[C6]` 完成(窗口内)→删除→撤销删除→再撤销完成：**不重复插入** T（T 出现 1 次、todo=3、done=0）。
- `[C7]` 完成(窗口内)→删除：done **不残留**被删任务。
- `[C8]` 正常完成（已提交）后撤销：仍正确移回 todo（回归保护）。

复核结论：原 37 单测全绿、攻击测试 **46/46**、`vite build` 通过。工程师加固正确、无回归，**予以确认合并**。§1 结论维持 **PASS**。

## 9. 回归用例归档（已落地，零新增依赖）

应工程师范刚请求，把撤销/竞态攻击用例**沉淀为仓库级回归测试**，无需 jsdom / @testing-library：

- 新增 `todolist-gui/src/hooks/useTodoStore.test.js`（8 条：C1–C8）。
- 机制：`vi.mock('react', () => import('../../scripts/qa-react-shim.mjs'))` 注入极简 hooks 替身，在 vitest 的 **node 环境**直接驱动**真实 useTodoStore**；配套浏览器 API 替身（目录句柄 / 文件 / IndexedDB）内联在用例中。
- 命名**不含 `.test.` 的 `scripts/qa-react-shim.mjs` 不会被 vitest 误采集**；替身文件由 loader 与测试共用，单一来源。

门禁结果（真实输出）：
- `npx vitest run` → **Test Files 3 passed / Tests 45 passed（37 原有 + 8 新增）**。
- `npx vite build --outDir dist-qa` → 通过。
- 独立攻击脚本 `node --import ./scripts/register-qa-loader.mjs scripts/qa-independent.mjs` → 46/46，退出码 0（已加 `process.exitCode`，可入 CI）。

给工程师的接线建议（供其决定）：
- 无需新增依赖；`npm test` 已自动包含 `useTodoStore.test.js`。
- 若希望 CI 也跑一次性攻击脚本，可加：`"test:attack": "node --import ./scripts/register-qa-loader.mjs ./scripts/qa-independent.mjs"`。
- 若坚持用 jsdom/@testing-library 路线再评估（非必要，本方案已覆盖数据/竞态层）。


