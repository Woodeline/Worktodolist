// P2-2 回归：AI 代理目标校验。开放转发器的两条防线——
//   1) 只接受绝对 http(s) URL；2) 拒绝回环/内网目标（可被 TODOLIST_AI_ALLOW_HOSTS 显式放行）。
// 被拒绝时返回 REJECT_TARGET（必拒绝端口），由 http-proxy 在连接阶段自然失败。
import { afterEach, describe, expect, it } from 'vitest';
import { REJECT_TARGET, resolveProxyTarget } from '../../vite.config.js';

const ENV_KEY = 'TODOLIST_AI_ALLOW_HOSTS';
const savedEnv = process.env[ENV_KEY];

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

describe('resolveProxyTarget（AI 代理硬化）', () => {
  it('公网 http(s) 目标原样放行', () => {
    expect(resolveProxyTarget('https://api.openai.com/v1')).toBe('https://api.openai.com/v1');
    expect(resolveProxyTarget('http://api.deepseek.com/v1')).toBe('http://api.deepseek.com/v1');
  });

  it('非法值（空 / 非URL / 非 http(s) 协议）一律拒绝', () => {
    expect(resolveProxyTarget(undefined)).toBe(REJECT_TARGET);
    expect(resolveProxyTarget('')).toBe(REJECT_TARGET);
    expect(resolveProxyTarget('not a url')).toBe(REJECT_TARGET);
    expect(resolveProxyTarget('ftp://example.com')).toBe(REJECT_TARGET);
    expect(resolveProxyTarget('file:///etc/passwd')).toBe(REJECT_TARGET);
  });

  it('回环与内网网段目标拒绝（防跳板）', () => {
    expect(resolveProxyTarget('http://localhost:11434/v1')).toBe(REJECT_TARGET);
    expect(resolveProxyTarget('http://127.0.0.1:9999')).toBe(REJECT_TARGET);
    expect(resolveProxyTarget('http://[::1]:11434')).toBe(REJECT_TARGET);
    expect(resolveProxyTarget('http://0.0.0.0')).toBe(REJECT_TARGET);
    expect(resolveProxyTarget('http://10.1.2.3/')).toBe(REJECT_TARGET);
    expect(resolveProxyTarget('http://192.168.1.5:8080')).toBe(REJECT_TARGET);
    expect(resolveProxyTarget('http://169.254.1.1/')).toBe(REJECT_TARGET);
    expect(resolveProxyTarget('http://172.16.0.2/')).toBe(REJECT_TARGET);
    expect(resolveProxyTarget('http://172.31.255.255/')).toBe(REJECT_TARGET);
  });

  it('172.16–31 之外的网络段不受影响', () => {
    expect(resolveProxyTarget('http://172.32.0.2/')).toBe('http://172.32.0.2/');
    expect(resolveProxyTarget('http://172.15.0.2/')).toBe('http://172.15.0.2/');
    expect(resolveProxyTarget('https://example.com/v1')).toBe('https://example.com/v1');
  });

  it('TODOLIST_AI_ALLOW_HOSTS 可显式放行内网主机（本地 Ollama 场景）', () => {
    process.env[ENV_KEY] = 'localhost, my-ollama.internal';
    expect(resolveProxyTarget('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
    expect(resolveProxyTarget('http://my-ollama.internal:11434/v1')).toBe(
      'http://my-ollama.internal:11434/v1'
    );
    // 白名单外仍拒绝
    expect(resolveProxyTarget('http://192.168.1.5:8080')).toBe(REJECT_TARGET);
  });
});
