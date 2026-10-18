// 词表一致性检查：TRIGGERS 与 COMMAND_RULES 是否漂移。
//
// 为什么值得单独立一道门：detectAction 只认 COMMAND_RULES，stripAction 才回落 TRIGGERS。
// 两份表不同步的结果是「能剥掉却认不出」—— 用户说一句「把旧手机扔掉」，
// 引擎剥得出"扔掉"，却判不出这是 delete，最后回一句"没听懂"。
// 这类缺陷不会让任何单测变红（两边各自都"对"），只有对着比才看得见。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/lib/nlRules.js'), 'utf8');

// 这两张表不是导出物（导出只是为了测试而放宽可见性，不划算），直接从源码里抠。
const trigBlock = src.match(/const TRIGGERS = \{([\s\S]*?)\n\};/);
const rulesBlock = src.match(/const COMMAND_RULES = \[([\s\S]*?)\n\];/);
if (!trigBlock || !rulesBlock) {
  console.error('[nl-drift] 读不到 TRIGGERS / COMMAND_RULES，源码结构变了？');
  process.exit(2);
}

const TRIGGERS = eval(`({${trigBlock[1]}})`);
const RULES = [...rulesBlock[1].matchAll(/intent:\s*'(\w+)',\s*re:\s*\/([\s\S]*?)\/([a-z]*)/g)].map((m) => ({
  intent: m[1],
  re: new RegExp(m[2], m[3]),
}));

// 有意不收进 COMMAND_RULES 的条目，写清理由，免得下一个人当成 bug 又"修"回去。
const ALLOWED = new Map([
  // 裸单字「记」歧义面太大（标记 / 日记 / 记性 / 记录都在里面），
  // 只收 记一下 / 记一条 / 记个 / 帮我记 这类明确组合。
  ['add:记', '裸单字歧义面过大，只认「记一下/记一条/记个/帮我记」等组合'],
]);

// query / undo 有自己的判定通道（QUERY_PREFIXES、句首 ^撤销$），本就不经 COMMAND_RULES。
const NO_RULE_INTENTS = new Set(['query', 'undo']);

// addContext 要真带 @、addProject 要真带 +（rule.when），造样本时得满足前置条件。
const sampleFor = (intent) => (intent === 'addContext' ? '@x ' : intent === 'addProject' ? '+x ' : '');

const problems = [];
for (const [intent, list] of Object.entries(TRIGGERS)) {
  if (NO_RULE_INTENTS.has(intent)) continue;
  const rule = RULES.find((r) => r.intent === intent);
  if (!rule) {
    problems.push(`意图 ${intent} 在 COMMAND_RULES 里没有规则`);
    continue;
  }
  const sample = sampleFor(intent);
  for (const trig of list) {
    if (ALLOWED.has(`${intent}:${trig}`)) continue;
    // 同一意图允许有多条规则（如 complete：词表一条 + 结果补语结构一条），
    // 口径与 stripAction 一致：任一规则能认就算没漂移。
    if (!RULES.filter((r) => r.intent === intent).some((r) => r.re.test(sample + trig))) {
      problems.push(`${intent}: 触发词「${trig}」COMMAND_RULES 匹配不到（能剥不能认）`);
    }
  }
}

const checked = Object.entries(TRIGGERS)
  .filter(([i]) => !NO_RULE_INTENTS.has(i))
  .reduce((n, [, l]) => n + l.length, 0);

console.log(`[nl-drift] 比对 ${checked} 条触发词 / ${RULES.length} 条命令规则`);
if (problems.length) {
  console.log(`[nl-drift] ✗ ${problems.length} 处漂移：`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('[nl-drift] ✓ 两份词表一致');
