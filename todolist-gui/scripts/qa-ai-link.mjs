#!/usr/bin/env node
// AI 兜底代理链路回归检测（不需要真实 API Key）。
//
// 本脚本存在的理由是 2026-10-06 的发现：vite/http-proxy 没有 router 选项，
// 旧配置的动态转发从未生效过（每次 /ai-proxy 都 500），而 vitest 全绿、
// 构建成功都发现不了这种「配置层静默失效」。这类问题只能用真发请求的
// 端到端检测来抓。
//
// 做什么：
//   1. 起一个本地 mock 上游（OpenAI 兼容 /chat/completions，返回固定 JSON）
//   2. 用 vite preview 起生产构建（与日常双击同一服务路径），
//      并带 TODOLIST_AI_ALLOW_HOSTS=127.0.0.1 放行 mock 上游
//   3. 断言五件事：
//      a) /ai-proxy 请求真的转发到达 mock 上游（200 + 合法 JSON）
//      b) 转发后的路径正确（baseUrl 的路径 + /chat/completions 拼接）
//      c) Authorization 头透传（Bearer sk-test）
//      d) x-ai-target 头不泄漏给上游
//      e) 未放行的内网目标与缺失目标头 → 403
//
// 用法：npm run test:ai   （dist 缺失时会先自动 build）
// 退出码：0 = 全部通过；1 = 有断言失败或环境异常。
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GUI_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VITE_JS = path.join(GUI_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
const DIST_INDEX = path.join(GUI_DIR, 'dist', 'index.html');

const results = [];
function check(name, cond, extra = '') {
  results.push({ name, ok: Boolean(cond), extra });
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : `  —— ${extra}`}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  if (!existsSync(VITE_JS)) {
    console.error('找不到 vite，请先在 todolist-gui/ 执行 npm install');
    process.exit(1);
  }
  if (!existsSync(DIST_INDEX)) {
    console.log('dist/ 缺失，先执行 vite build ...');
    await mkdir(path.join(GUI_DIR, 'dist'), { recursive: true }).catch(() => {});
    const build = spawn(process.execPath, [VITE_JS, 'build'], { cwd: GUI_DIR, stdio: 'inherit' });
    await new Promise((resolve) => build.on('close', resolve));
  }

  // —— mock 上游：记录收到的请求头与路径，返回合法的 OpenAI 格式响应 ——
  const seen = { auth: null, aiTarget: null, urlPath: '' };
  const mock = createServer((req, res) => {
    seen.auth = req.headers.authorization || null;
    seen.aiTarget = req.headers['x-ai-target'] || null;
    seen.urlPath = req.url || '';
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      choices: [{ message: { content: '{"intent":"add","title":"测试任务"}' } }],
    }));
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const mockPort = mock.address().port;

  // —— vite preview（生产服务路径）——
  const port = await freePort();
  const preview = spawn(process.execPath, [VITE_JS, 'preview', '--port', String(port), '--strictPort'], {
    cwd: GUI_DIR,
    env: { ...process.env, TODOLIST_AI_ALLOW_HOSTS: '127.0.0.1' },
    stdio: 'ignore',
  });

  try {
    let up = false;
    for (let i = 0; i < 40 && !up; i += 1) {
      await sleep(250);
      try {
        const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(800) });
        up = res.ok;
      } catch { /* 未就绪，继续等 */ }
    }
    if (!up) throw new Error('vite preview 启动超时');

    const base = `http://localhost:${port}`;

    // a/b/c/d：带目标头的正常转发
    const res1 = await fetch(`${base}/ai-proxy/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer sk-test',
        'x-ai-target': `http://127.0.0.1:${mockPort}/v1`,
      },
      body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'ping' }] }),
      signal: AbortSignal.timeout(8000),
    });
    const body1 = await res1.json().catch(() => null);
    check('转发到达上游（HTTP 200 + 合法 JSON）', res1.status === 200 && body1?.choices?.[0]?.message?.content, `status=${res1.status}`);
    check('路径拼接正确（baseUrl 路径 + /chat/completions）', seen.urlPath === '/v1/chat/completions', `实际 ${seen.urlPath}`);
    check('Authorization 头透传', seen.auth === 'Bearer sk-test', `实际 ${seen.auth}`);
    check('x-ai-target 头不泄漏给上游', seen.aiTarget === null, `实际 ${seen.aiTarget}`);

    // e：未放行的内网目标 / 缺失目标头 → 403
    const res2 = await fetch(`${base}/ai-proxy/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ai-target': 'http://10.9.9.9:1/v1' },
      body: '{}',
      signal: AbortSignal.timeout(8000),
    });
    check('未放行的内网目标被 403 拒绝', res2.status === 403, `status=${res2.status}`);

    const res3 = await fetch(`${base}/ai-proxy/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(8000),
    });
    check('缺失目标头被 403 拒绝', res3.status === 403, `status=${res3.status}`);
  } finally {
    preview.kill();
    mock.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过${failed.length ? '  ✗ 存在失败项' : '  全部通过'}`);
  process.exit(failed.length ? 1 : 0);
}

run().catch((err) => {
  console.error('检测环境异常：', err && err.message ? err.message : err);
  process.exit(1);
});
