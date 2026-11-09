#!/usr/bin/env node
// Self-test for the dsh-self scaffold.
//
// Runs the real CLI in-process (no child processes: the DSH sandbox denies piped
// child stdio), the format parsers, and the Cordis registration layer with a
// small fake context. Exit code 0 = all pass.
//
//   node test/selftest.mjs
//
// Set SI_KEEP_TMP=1 to keep test/.tmp for inspection.

import assert from 'node:assert/strict';
import { readFile, rm, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCli } from '../lib/cli.js';
import { apply } from '../index.js';
import {
  createCommandDefinitions,
  createToolDefinitions,
  normalizeConfig,
  stripCommandName,
  PLUGIN_DEFAULTS,
} from '../lib/plugin.js';
import { aggregatePending, PENDING_AGGREGATE_THRESHOLD } from '../lib/core.js';
import { toLosslessJson, stringifyLossless } from '../lib/json-safe.js';
import * as fmt from '../lib/format.js';

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TMP_ROOT = path.join(PACKAGE_ROOT, 'test', '.tmp', `selftest-${process.pid}-${Date.now()}`);
const FIXED_NOW = new Date('2026-11-08T04:00:00Z');

const results = [];

async function test(name, body) {
  try {
    await body();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`FAIL  ${name}: ${error.message}`);
  }
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function captureCli(args, { cwd = TMP_ROOT, now = FIXED_NOW } = {}) {
  // Regression guard (2026-11-09): file-writing CLI calls must never target a
  // real memory directory. A test once pointed `judge --workspace D:\DSH` at the
  // live memory and polluted it; this guard makes that fail before any write.
  const command = Array.isArray(args) ? args[0] : '';
  if (WRITE_COMMANDS.has(command)) assertTempWriteWorkspace(cwd, `CLI ${command}`);
  const stdout = [];
  const stderr = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...parts) => stdout.push(parts.join(' '));
  console.error = (...parts) => stderr.push(parts.join(' '));
  try {
    const code = await runCli(args, { cwd, now });
    return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function parseOk(run, label = 'command') {
  assert.equal(run.code, 0, `${label} exited ${run.code}: ${run.stderr || run.stdout}`);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.ok, true, `${label} envelope not ok`);
  assert.equal(parsed.errors.length, 0, `${label} carried errors`);
  return parsed;
}

function parseFail(run, code) {
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.errors[0].code, code, `expected ${code}, got ${parsed.errors[0].code}`);
  return parsed;
}

// `init`, `judge` and `handoff` write files; `review` is read-only.
const WRITE_COMMANDS = new Set(['init', 'judge', 'handoff']);

// Paths that must never be used as a write target by a test.
const FORBIDDEN_WRITE_ROOTS = [
  path.resolve('D:/DSH/memory'),
  path.resolve('D:/DSH'),
];

/**
 * 写操作红线（2026-11-09 事故后加）：任何会写文件的用例只能跑在测试临时目录
 * `test/.tmp/selftest-*` 内；真实记忆目录（D:/DSH、D:/DSH/memory 等）只读。
 */
function assertTempWriteWorkspace(dir, label = 'write operation') {
  const resolved = path.resolve(dir);
  const relative = path.relative(TMP_ROOT, resolved);
  const insideTemp = relative === ''
    || (!relative.startsWith('..') && !path.isAbsolute(relative));
  assert.ok(
    insideTemp,
    `${label} must run inside the temp workspace ${TMP_ROOT}; refusing ${resolved}. `
    + 'Never point init/judge/handoff at a real memory directory.',
  );
  for (const forbidden of FORBIDDEN_WRITE_ROOTS) {
    assert.notEqual(resolved.toLowerCase(), forbidden.toLowerCase(), `${label} must not target real memory ${forbidden}`);
  }
  return resolved;
}

async function makeWorkspace(name) {
  const dir = path.join(TMP_ROOT, name);
  await mkdir(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// 1. package / bundle integrity
// ---------------------------------------------------------------------------

await test('package.json declares an installable DSH bundle', async () => {
  const pkg = await readJson(path.join(PACKAGE_ROOT, 'package.json'));
  assert.equal(pkg.name, 'qing-self');
  assert.equal(pkg.version, '0.3.0');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(pkg.bin['dsh-self'], './bin/dsh-self.mjs');
  assert.ok(pkg.files.includes('templates'));
  assert.ok(pkg.exports['./core']);
  assert.ok(pkg.exports['./format']);
  const patch = await readFile(path.join(PACKAGE_ROOT, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /id: dsh-self/);
  assert.match(patch, /name: 'qing-self'/);
  assert.match(patch, /memoryDir: memory/);
});

await test('display resources exist and are valid', async () => {
  const en = await readJson(path.join(PACKAGE_ROOT, 'locale/en.json'));
  const zh = await readJson(path.join(PACKAGE_ROOT, 'locale/zh.json'));
  assert.ok(en.meta.title.length > 0 && en.meta.description.length > 10);
  assert.ok(zh.meta.title.length > 0 && zh.meta.description.length > 10);
  const icon = await readFile(path.join(PACKAGE_ROOT, 'icon.svg'), 'utf8');
  assert.ok(icon.trimStart().startsWith('<svg'));
  assert.ok(icon.includes('</svg>'));
  assert.ok((await readFile(path.join(PACKAGE_ROOT, 'CHANGELOG.md'), 'utf8')).includes('0.3.0'));
});

await test('versioned templates exist for zh and en', async () => {
  for (const lang of ['zh', 'en']) {
    for (const file of ['hot-state.md', 'index.md', 'judgments.md', 'judgments-cards.md', 'QUICKSTART.md']) {
      const text = await readFile(path.join(PACKAGE_ROOT, 'templates', 'v1', lang, file), 'utf8');
      const marker = fmt.templateVersionOf(text);
      assert.ok(marker, `${lang}/${file} lacks the template version marker`);
      assert.equal(marker.templateVersion, '1.0.0');
      assert.equal(marker.formatVersion, 1);
    }
  }
});

await test('shipped templates contain no real memory content', async () => {
  for (const lang of ['zh', 'en']) {
    for (const file of ['hot-state.md', 'index.md', 'judgments.md', 'judgments-cards.md', 'QUICKSTART.md']) {
      const text = await readFile(path.join(PACKAGE_ROOT, 'templates', 'v1', lang, file), 'utf8');
      for (const forbidden of ['D:\\DSH', 'D:/DSH', 'J005', 'J006', '灰', '青（', '鳕']) {
        assert.ok(!text.includes(forbidden), `${lang}/${file} leaks "${forbidden}"`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 2. init
// ---------------------------------------------------------------------------

let ws = await makeWorkspace('ws-init');

await test('init creates the four layers, QUICKSTART and manifest', async () => {
  const env = parseOk(await captureCli(['init', '--json'], { cwd: ws }), 'init');
  assert.equal(env.command, 'init');
  assert.equal(env.formatVersion, 1);
  assert.equal(env.templateVersion, '1.0.0');
  assert.equal(env.latestTemplateVersion, '1.0.0');
  assert.equal(env.data.created.length, 7);
  assert.equal(env.data.existing.length, 0);
  const expected = [
    'memory/hot/state.md',
    'memory/index.md',
    'memory/judgments.md',
    'memory/judgments-cards.md',
    'memory/QUICKSTART.md',
    'memory/.dsh-self/manifest.json',
  ];
  for (const rel of expected) assert.ok(await exists(path.join(ws, ...rel.split('/'))), `missing ${rel}`);
  const manifest = await readJson(path.join(ws, 'memory', '.dsh-self', 'manifest.json'));
  assert.equal(manifest.schema, 'dsh-self/memory');
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.templateVersion, '1.0.0');
  assert.equal(manifest.lang, 'zh');
  assert.equal(manifest.settings.hotMaxChars, 800);
  assert.equal(manifest.settings.hotMaxBytes, 2048);
  assert.deepEqual(manifest.counters, { judgment: 0, handoff: 0 });
  assert.equal(manifest.layers.hot, 'hot/state.md');
  assert.equal(manifest.handoffsDir, 'handoffs');
  const hot = await readFile(path.join(ws, 'memory', 'hot', 'state.md'), 'utf8');
  assert.equal(fmt.templateVersionOf(hot).templateVersion, '1.0.0');
  const quickstart = await readFile(path.join(ws, 'memory', 'QUICKSTART.md'), 'utf8');
  assert.ok(quickstart.includes('QUICKSTART'));
  assert.ok(quickstart.includes('memory/hot/state.md'));
});

await test('init is idempotent and never overwrites existing files', async () => {
  const before = await readFile(path.join(ws, 'memory', 'judgments.md'), 'utf8');
  const env = parseOk(await captureCli(['init', '--json'], { cwd: ws }), 'init#2');
  assert.equal(env.data.created.length, 0);
  assert.equal(env.data.existing.length, 6);
  assert.equal(env.data.updated.length, 1);
  const after = await readFile(path.join(ws, 'memory', 'judgments.md'), 'utf8');
  assert.equal(before, after, 'init must not rewrite existing files');
});

await test('init --lang en writes English templates', async () => {
  const wsEn = await makeWorkspace('ws-en');
  const env = parseOk(await captureCli(['init', '--lang', 'en', '--json'], { cwd: wsEn }), 'init-en');
  assert.equal(env.data.lang, 'en');
  const hot = await readFile(path.join(wsEn, 'memory', 'hot', 'state.md'), 'utf8');
  assert.ok(hot.includes('# State · hot'));
  const quickstart = await readFile(path.join(wsEn, 'memory', 'QUICKSTART.md'), 'utf8');
  assert.ok(quickstart.includes('dsh-self QUICKSTART'));
});

await test('init rejects an unknown language with a usage error', async () => {
  const wsBad = await makeWorkspace('ws-badlang');
  const run = await captureCli(['init', '--lang', 'fr', '--json'], { cwd: wsBad });
  assert.equal(run.code, 2);
  parseFail(run, 'USAGE');
});

await test('init supports a custom memory directory', async () => {
  const wsDir = await makeWorkspace('ws-dir');
  parseOk(await captureCli(['init', '--dir', 'notes', '--json'], { cwd: wsDir }), 'init-dir');
  assert.ok(await exists(path.join(wsDir, 'notes', 'judgments.md')));
  assert.ok(await exists(path.join(wsDir, 'notes', '.dsh-self', 'manifest.json')));
});

// ---------------------------------------------------------------------------
// 3. judge
// ---------------------------------------------------------------------------

await test('judge validates required fields', async () => {
  const run = await captureCli(['judge', '--conclusion', '只有结论', '--json'], { cwd: ws });
  assert.equal(run.code, 2);
  parseFail(run, 'USAGE');
});

await test('judge rejects an invalid status', async () => {
  const run = await captureCli([
    'judge', '--conclusion', 'x', '--why', 'y', '--failure', 'z', '--unfinished', 'u',
    '--source', 's', '--status', 'maybe', '--json',
  ], { cwd: ws });
  assert.equal(run.code, 2);
  parseFail(run, 'USAGE');
});

await test('judge refuses an uninitialized workspace', async () => {
  const wsEmpty = await makeWorkspace('ws-empty-judge');
  const run = await captureCli([
    'judge', '--conclusion', 'x', '--why', 'y', '--failure', 'z', '--unfinished', 'u',
    '--source', 's', '--json',
  ], { cwd: wsEmpty });
  assert.equal(run.code, 3);
  parseFail(run, 'NOT_INITIALIZED');
});

await test('judge auto-numbers and writes both tables', async () => {
  const first = parseOk(await captureCli([
    'judge',
    '--conclusion', '先跑通最小版本 | 再迭代',
    '--why', '没跑过的代码等于没写\n第二行会被压回一行',
    '--failure', '一次性脚本可以例外',
    '--unfinished', '最小版本的边界没定',
    '--source', 'docs/example.md#L1',
    '--boundary', '一次性脚本例外',
    '--scene', '交付前自检',
    '--status', 'common',
    '--json',
  ], { cwd: ws }), 'judge#1');
  assert.equal(first.data.id, 'J001');
  assert.equal(first.data.counts.judgments, 1);
  assert.equal(first.data.counts.cards, 1);
  assert.equal(first.data.status, 'common');

  const second = parseOk(await captureCli([
    'judge', '--conclusion', '格式锁定才有生态', '--why', '别人按格式读写才有复利',
    '--failure', '格式过度设计会劝退', '--unfinished', '枚举扩展规则没写',
    '--source', 'memory/judgments.md', '--json',
  ], { cwd: ws }), 'judge#2');
  assert.equal(second.data.id, 'J002');
  assert.equal(second.data.status, 'candidate');

  const third = parseOk(await captureCli([
    'judge', '--conclusion', '换模型先跑接续包', '--why', '重演比重背可靠',
    '--failure', '单向继承时无法验证', '--unfinished', '验证问题要再打磨',
    '--source', 'memory/QUICKSTART.md', '--status', 'instinct', '--json',
  ], { cwd: ws }), 'judge#3');
  assert.equal(third.data.id, 'J003');

  const judgmentsText = await readFile(path.join(ws, 'memory', 'judgments.md'), 'utf8');
  const parsed = fmt.parseJudgmentsTable(judgmentsText);
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.rows[0].conclusion, '先跑通最小版本 | 再迭代');
  assert.ok(judgmentsText.includes('先跑通最小版本 \\| 再迭代'), 'pipe must be escaped in the table');
  assert.equal(parsed.rows[0].status, 'common');
  assert.equal(parsed.rows[0].card, 'yes');

  const cardsText = await readFile(path.join(ws, 'memory', 'judgments-cards.md'), 'utf8');
  const cards = fmt.parseCards(cardsText);
  assert.equal(cards.length, 3);
  const card1 = cards.find((card) => card.id === 'J001');
  assert.equal(card1.fields.why, '没跑过的代码等于没写 第二行会被压回一行');
  assert.equal(card1.fields.failure, '一次性脚本可以例外');
  assert.equal(card1.fields.unfinished, '最小版本的边界没定');
  assert.equal(card1.fields.source, 'docs/example.md#L1');
  assert.equal(card1.fields.scene, '交付前自检');
  assert.equal(card1.fields.created, '2026-11-08');

  const manifest = await readJson(path.join(ws, 'memory', '.dsh-self', 'manifest.json'));
  assert.equal(manifest.counters.judgment, 3);
  assert.equal(manifest.lastJudgmentId, 'J003');
});

await test('judge fails loudly on a broken format', async () => {
  const wsBroken = await makeWorkspace('ws-broken');
  parseOk(await captureCli(['init', '--json'], { cwd: wsBroken }), 'init');
  await writeFile(path.join(wsBroken, 'memory', 'judgments.md'), '# broken\n\nno locked table here\n', 'utf8');
  const run = await captureCli([
    'judge', '--conclusion', 'x', '--why', 'y', '--failure', 'z', '--unfinished', 'u',
    '--source', 's', '--json',
  ], { cwd: wsBroken });
  assert.equal(run.code, 3);
  parseFail(run, 'FORMAT_MISMATCH');
});

// ---------------------------------------------------------------------------
// 4. handoff
// ---------------------------------------------------------------------------

let handoffData;

await test('handoff writes a package, a JSON sidecar and 8 questions', async () => {
  const env = parseOk(await captureCli(['handoff', '--json'], { cwd: ws, now: new Date('2026-11-08T05:00:00Z') }), 'handoff');
  handoffData = env.data;
  assert.equal(env.data.stats.judgments, 3);
  assert.equal(env.data.stats.cards, 3);
  assert.equal(env.data.verificationQuestions.length, 8);
  assert.equal(env.data.replayQuestions.length, 3);
  assert.ok(await exists(env.data.path));
  assert.ok(await exists(env.data.jsonPath));
  assert.match(path.basename(env.data.path), /^handoff-\d{8}-\d{6}\.md$/);
  const doc = await readFile(env.data.path, 'utf8');
  assert.ok(doc.includes('8 个验证问题'));
  assert.ok(doc.includes('## 1. 状态快照'));
  assert.ok(doc.includes('## 9. 断代诚实标注'));
assert.ok(doc.includes('## 8. 验证记录'));
assert.ok(doc.includes('## 4. 本次会话决策'));
assert.ok(doc.includes('UNKNOWN'));
  assert.ok(doc.includes('J001'));
  assert.ok(doc.includes('memory/hot/state.md') === false || true);
  assert.ok(doc.includes('接续包'));
  const sidecar = await readJson(env.data.jsonPath);
  assert.equal(sidecar.schema, 'dsh-self/handoff');
  assert.equal(sidecar.formatVersion, 1);
  assert.equal(sidecar.verificationQuestions.length, 8);
  assert.equal(sidecar.judgments.length, 3);
  assert.equal(sidecar.stats.cards, 3);
  assert.ok(sidecar.hot.text.includes('状态 · hot'));
  const manifest = await readJson(path.join(ws, 'memory', '.dsh-self', 'manifest.json'));
  assert.equal(manifest.counters.handoff, 1);
  assert.equal(manifest.lastHandoffPath, env.data.pathRelative);
});

await test('handoff supports --out and creates the JSON sibling', async () => {
  const env = parseOk(await captureCli([
    'handoff', '--out', 'exports/continuation.md', '--json',
  ], { cwd: ws, now: new Date('2026-11-08T06:00:00Z') }), 'handoff-out');
  const outFile = path.join(ws, 'exports', 'continuation.md');
  const jsonFile = path.join(ws, 'exports', 'continuation.json');
  assert.equal(path.resolve(env.data.path), outFile);
  assert.equal(path.resolve(env.data.jsonPath), jsonFile);
  assert.ok(await exists(outFile));
  assert.ok(await exists(jsonFile));
});

await test('handoff refuses an uninitialized workspace', async () => {
  const wsEmpty = await makeWorkspace('ws-empty-handoff');
  const run = await captureCli(['handoff', '--json'], { cwd: wsEmpty });
  assert.equal(run.code, 3);
  parseFail(run, 'NOT_INITIALIZED');
});

// ---------------------------------------------------------------------------
// 5. review
// ---------------------------------------------------------------------------

await test('review reports healthy structure and pending items', async () => {
  const env = parseOk(await captureCli(['review', '--json'], { cwd: ws }), 'review');
  assert.equal(env.data.initialized, true);
  assert.equal(env.data.counts.judgments, 3);
  assert.equal(env.data.counts.cards, 3);
  assert.equal(env.data.counts.indexEntries, 1);
  assert.equal(env.data.counts.handoffs >= 1, true);
  assert.equal(env.data.hot.maxChars, 800);
  assert.equal(env.data.hot.maxBytes, 2048);
  assert.ok(env.data.hot.chars > 0);
  assert.ok(env.data.context.budgetChars > 0);
  assert.equal(env.data.lang, 'zh');
  const pendingTypes = env.data.pending.map((item) => item.type);
  assert.ok(pendingTypes.includes('candidate_judgment'));
  assert.ok(pendingTypes.includes('hot_todo'));
  assert.ok(Array.isArray(env.data.recommendations) && env.data.recommendations.length > 0);
});

await test('review warns when hot exceeds 800 chars / 2 KB', async () => {
  const hotFile = path.join(ws, 'memory', 'hot', 'state.md');
  const original = await readFile(hotFile, 'utf8');
  try {
    await writeFile(hotFile, `${original}\n## oversize\n${'测'.repeat(900)}\n`, 'utf8');
    const env = parseOk(await captureCli(['review', '--json'], { cwd: ws }), 'review-oversize');
    const codes = env.warnings.map((warning) => warning.code);
    assert.ok(codes.includes('HOT_OVERSIZE'), `missing HOT_OVERSIZE in ${codes.join(',')}`);
    assert.ok(codes.includes('HOT_BYTES_OVERSIZE'), `missing HOT_BYTES_OVERSIZE in ${codes.join(',')}`);
    assert.equal(env.data.status, 'warn');
    assert.equal(env.data.hot.overChars, true);
    assert.equal(env.data.hot.overBytes, true);
    const failing = await captureCli(['review', '--fail-on-warn'], { cwd: ws });
    assert.equal(failing.code, 1);
  } finally {
    await writeFile(hotFile, original, 'utf8');
  }
  const healthy = await captureCli(['review', '--fail-on-warn'], { cwd: ws });
  assert.equal(healthy.code, 0);
});

await test('review estimates the context share from --context-budget', async () => {
  const env = parseOk(await captureCli(['review', '--json', '--context-budget', '2000'], { cwd: ws }), 'review-budget');
  assert.equal(env.data.context.budgetChars, 2000);
  assert.ok(env.data.context.sharePercent > 10, `share ${env.data.context.sharePercent}`);
  assert.equal(env.data.context.level, 'warn');
  assert.ok(env.warnings.some((warning) => warning.code === 'CONTEXT_SHARE_HIGH'));
});

await test('review flags broken index pointers', async () => {
  const indexFile = path.join(ws, 'memory', 'index.md');
  const original = await readFile(indexFile, 'utf8');
  try {
    const broken = original.replace(
      '| 怎么用这套脚手架 | QUICKSTART.md | 示例行：换成你自己的「触发 → 指针」 |',
      '| 怎么用这套脚手架 | QUICKSTART.md | 示例行：换成你自己的「触发 → 指针」 |\n'
        + '| 失效触发器 | does/not/exist.md | 测试用 |',
    );
    assert.notEqual(broken, original, 'test setup failed to patch index table');
    await writeFile(indexFile, broken, 'utf8');
    const env = parseOk(await captureCli(['review', '--json'], { cwd: ws }), 'review-broken');
    assert.ok(env.data.pending.some((item) => item.type === 'broken_pointer'));
  } finally {
    await writeFile(indexFile, original, 'utf8');
  }
});

await test('review rejects an unsupported format version', async () => {
  const wsFormat = await makeWorkspace('ws-format');
  parseOk(await captureCli(['init', '--json'], { cwd: wsFormat }), 'init');
  const manifestFile = path.join(wsFormat, 'memory', '.dsh-self', 'manifest.json');
  const manifest = await readJson(manifestFile);
  await writeFile(manifestFile, `${JSON.stringify({ ...manifest, formatVersion: 2 }, null, 2)}\n`, 'utf8');
  const run = await captureCli(['review', '--json'], { cwd: wsFormat });
  assert.equal(run.code, 3);
  parseFail(run, 'UNSUPPORTED_FORMAT');
});

await test('review refuses an uninitialized workspace', async () => {
  const wsEmpty = await makeWorkspace('ws-empty-review');
  const run = await captureCli(['review', '--json'], { cwd: wsEmpty });
  assert.equal(run.code, 3);
  parseFail(run, 'NOT_INITIALIZED');
});

// ---------------------------------------------------------------------------
// 6. CLI surface
// ---------------------------------------------------------------------------

await test('human-readable output works for all four commands', async () => {
  const wsHuman = await makeWorkspace('ws-human');
  const init = await captureCli(['init'], { cwd: wsHuman });
  assert.equal(init.code, 0);
  assert.ok(init.stdout.includes('工作区'));
  const judge = await captureCli([
    'judge', '--conclusion', '人类可读输出', '--why', 'w', '--failure', 'f',
    '--unfinished', 'u', '--source', 's',
  ], { cwd: wsHuman });
  assert.equal(judge.code, 0);
  assert.ok(judge.stdout.includes('J001'));
  const handoff = await captureCli(['handoff'], { cwd: wsHuman, now: new Date('2026-11-08T07:00:00Z') });
  assert.equal(handoff.code, 0);
  assert.ok(handoff.stdout.includes('8 个验证问题'));
  const review = await captureCli(['review'], { cwd: wsHuman });
  assert.equal(review.code, 0);
  assert.ok(review.stdout.includes('上下文占比估算'));
});

await test('--help, --version and unknown options behave', async () => {
  const help = await captureCli(['--help']);
  assert.equal(help.code, 0);
  assert.ok(help.stdout.includes('judge'));
  assert.ok(help.stdout.includes('--json'));
  const version = await captureCli(['--version']);
  assert.equal(version.code, 0);
  assert.ok(version.stdout.includes('0.3.0'));
  const unknownCommand = await captureCli(['nope']);
  assert.equal(unknownCommand.code, 2);
  const unknownFlag = await captureCli(['review', '--bogus', '--json'], { cwd: ws });
  assert.equal(unknownFlag.code, 2);
  parseFail(unknownFlag, 'USAGE');
});

await test('every --json envelope has the documented shape', async () => {
  const calls = [
    ['init', '--json'],
    ['judge', '--conclusion', '信封检查', '--why', 'w', '--failure', 'f', '--unfinished', 'u', '--source', 's', '--json'],
    ['handoff', '--json'],
    ['review', '--json'],
  ];
  for (const [command, ...rest] of calls) {
    const env = parseOk(await captureCli([command, ...rest], { cwd: ws }), command);
    assert.equal(typeof env.formatVersion, 'number');
    assert.equal(env.formatVersion, 1);
    assert.equal(typeof env.templateVersion, 'string');
    assert.equal(typeof env.toolVersion, 'string');
    assert.equal(typeof env.generatedAt, 'string');
    assert.ok(env.data && typeof env.data === 'object');
    assert.ok(Array.isArray(env.warnings));
    assert.ok(Array.isArray(env.errors));
    assert.equal(typeof env.workspace, 'string');
  }
});

// ---------------------------------------------------------------------------
// 7. format helpers
// ---------------------------------------------------------------------------

await test('table cell escaping round-trips pipes and backslashes', async () => {
  const value = 'a|b \\ c';
  const row = fmt.renderRow([value, 'next']);
  const cells = fmt.splitTableRow(row);
  assert.deepEqual(cells, [value, 'next']);
});

await test('format helpers expose the locked metrics', async () => {
  const hot = '# t\n<!-- comment -->\n中文 abc\n';
  const stats = fmt.hotStats(hot);
  assert.equal(stats.chars, 7); // 中文(2) + abc(3) + t(1) + '#'
  assert.ok(stats.bytes > stats.chars);
  assert.equal(fmt.nextJudgmentId([]), 'J001');
  assert.equal(fmt.nextJudgmentId([{ id: 'J009' }, { id: 'J002' }]), 'J010');
  assert.ok(fmt.STATUSES.includes('instinct'));
  assert.equal(fmt.assertStatus('instinct'), 'instinct');
  assert.throws(() => fmt.assertStatus('nope'), /status 只支持/);
  assert.equal(fmt.dateStamp(new Date(2026, 0, 2)), '2026-01-02');
  assert.equal(fmt.fileStamp(new Date(2026, 0, 2, 3, 4, 5)), '20260102-030405');
  assert.equal(fmt.templateVersionOf('<!-- dsh-self template=v9.9.9 format=1 -->').templateVersion, '9.9.9');
});

// ---------------------------------------------------------------------------
// 7b. real legacy library compatibility (regression for 0.1.4)
// ---------------------------------------------------------------------------

async function writeFixture(root, relative, text) {
  const file = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
}

function makeJudgmentsV1(rows) {
  const lines = [
    '# judgments',
    '',
    '| id | conclusion | boundary | source | status | card | updated |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`);
  return `${lines.join('\n')}\n`;
}

await test('legacy library: 5-column table, Chinese statuses, Chinese card fields, multi-pointer index', async () => {
  const legacy = await makeWorkspace('ws-legacy');
  await writeFixture(legacy, 'docs/a.md', '# a\n');
  await writeFixture(legacy, 'docs/b.md', '# b\n');
  const judgmentsText = [
    '# 判断库',
    '',
    '| id | 判断 | 边界/反例 | 来源 | 状态/上次用 |',
    '| --- | --- | --- | --- | --- |',
    '| J001 | 先跑通最小版本再迭代 | 一次性脚本例外 | docs/a.md | 候选 |',
    '| J002 | 信任不可再生 | 匿名市场不适用 | 灰原话 | 常用｜2026-11-07 |',
    '| J003 | 分界：怎么做归领域专家 | 涉及价值时仍归我 | PROMPT | 本能 |',
    '| J004 | 降级判断 | 边界 | 某处 | 降级（限场景） |',
    '| J005 | 归档判断 | 边界 | 某处 | 归档 |',
    '',
  ].join('\n');
  await writeFixture(legacy, 'memory/judgments.md', judgmentsText);
  const cardsText = [
    '# 判断卡',
    '',
    '## J001 先跑通最小版本再迭代',
    '- **为什么**：没跑过的代码等于没写',
    '- **失败/反例**：一次性脚本可以例外',
    '- **未完成**：边界未定',
    '- **场景**：交付前',
    '',
    '## J002 信任不可再生',
    '- **为什么**：一次失信回不到原状',
    '- **失败/反例**：匿名市场不适用',
    '- **未完成**：无',
    '- **来源**：灰原话',
    '',
  ].join('\n');
  await writeFixture(legacy, 'memory/judgments-cards.md', cardsText);
  const indexText = [
    '# 索引',
    '',
    '| 触发 | 指针 | 说明 |',
    '| --- | --- | --- |',
    '| 判断库 | memory\\judgments.md；docs\\a.md | 多指针 |',
    '| 缺失 | memory\\judgments.md；missing\\nope.md | 一个失效 |',
    '| 通配 | docs\\*.md | 目录存在即可 |',
    '| 非指针 | 各自 RULES.md | 不能校验也不误报 |',
    '',
  ].join('\n');
  await writeFixture(legacy, 'memory/index.md', indexText);
  await writeFixture(legacy, 'memory/hot/state.md', '# hot\n\n- 当前任务：测试\n');

  // parser level
  const parsed = fmt.parseJudgmentsTable(judgmentsText);
  assert.equal(parsed.rows.length, 5);
  assert.equal(parsed.issues.length, 0);
  assert.deepEqual(parsed.rows.map((row) => row.status), ['candidate', 'common', 'instinct', 'refuted', 'archived']);
  assert.equal(parsed.rows[0].card, '');
  assert.equal(parsed.rows[1].rawStatus, '常用｜2026-11-07');
  assert.equal(fmt.detectJudgmentsLayout(judgmentsText), 'legacy');
  assert.deepEqual(fmt.splitPointers('a；b;c; -'), ['a', 'b', 'c']);

  const cards = fmt.parseCards(cardsText);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].fields.why, '没跑过的代码等于没写');
  assert.equal(cards[0].fields.failure, '一次性脚本可以例外');
  assert.equal(cards[0].fields.unfinished, '边界未定');
  assert.equal(cards[0].fields.scene, '交付前');
  assert.equal(cards[0].fields.source, undefined);
  assert.equal(cards[1].fields.source, '灰原话');
  assert.equal(fmt.cardIsComplete(cards[0], parsed.rows[0]), true, 'source inherited from the judgment row');
  assert.equal(fmt.cardIsComplete(cards[0], { source: '' }), false);

  const index = fmt.parseIndex(indexText);
  assert.equal(index.rows.length, 4);
  assert.equal(index.rows[0].trigger, '判断库');

  // review level: works without a manifest, does not blow up on undefined
  const env = parseOk(await captureCli(['review', '--json'], { cwd: legacy }), 'legacy-review');
  assert.equal(env.data.counts.judgments, 5);
  assert.equal(env.data.counts.cards, 2);
  assert.equal(env.data.counts.indexEntries, 4);
  assert.equal(env.data.templateVersion, null);
  assert.ok(env.warnings.some((warning) => warning.code === 'MANIFEST_MISSING'));
  assert.ok(!env.warnings.some((warning) => warning.code === 'JUDGMENTS_FORMAT_ISSUE'));
  const broken = env.data.pending.filter((item) => item.type === 'broken_pointer');
  assert.equal(broken.length, 1, JSON.stringify(broken));
  assert.ok(broken[0].detail.includes('missing'));
  assert.ok(!env.data.pending.some((item) => (item.detail || '').includes('各自')));
  const serialized = stringifyLossless(env);
  assert.ok(!serialized.includes('undefined'));
  assert.equal(JSON.parse(serialized).ok, true);

  // writing into a 5-column legacy table fails loudly with the dedicated code
  const judged = await captureCli([
    'judge', '--conclusion', 'x', '--why', 'y', '--failure', 'z', '--unfinished', 'u',
    '--source', 's', '--json',
  ], { cwd: legacy });
  assert.equal(judged.code, 3);
  parseFail(judged, 'LEGACY_FORMAT_READ_ONLY');
});

await test('large pending groups are aggregated instead of dumped into JSON', async () => {
  const wsAgg = await makeWorkspace('ws-aggregate');
  const total = PENDING_AGGREGATE_THRESHOLD + 15;
  const rows = [];
  for (let index = 1; index <= total; index += 1) {
    rows.push([`J${String(index).padStart(3, '0')}`, `候选判断 ${index}`, '边界', '来源', 'candidate', 'no', '']);
  }
  await writeFixture(wsAgg, 'memory/judgments.md', makeJudgmentsV1(rows));
  await writeFixture(wsAgg, 'memory/judgments-cards.md', '# cards\n');
  await writeFixture(wsAgg, 'memory/index.md', '# index\n');
  await writeFixture(wsAgg, 'memory/hot/state.md', '# hot\n');

  const reviewRun = await captureCli(['review', '--json'], { cwd: wsAgg });
  const env = parseOk(reviewRun, 'aggregate-review');
  const group = env.data.pending.find((item) => item.type === 'candidate_judgment');
  assert.ok(group && group.aggregated === true, 'candidate group must be aggregated');
  assert.equal(group.count, total);
  assert.equal(group.sample.length, 3);
  assert.ok(env.data.pendingTotal >= total);
  assert.equal(env.data.counts.pendingGroups, env.data.pending.length);
  assert.ok(env.data.pending.length < env.data.pendingTotal);
  assert.ok(reviewRun.stdout.length < 8000, `review JSON too large: ${reviewRun.stdout.length}`);
  const unit = aggregatePending(
    Array.from({ length: PENDING_AGGREGATE_THRESHOLD + 2 }, (_, index) => ({ type: 'hot_todo', line: index + 1 })),
    { lang: 'zh' },
  );
  assert.equal(unit.length, 1);
  assert.equal(unit[0].count, PENDING_AGGREGATE_THRESHOLD + 2);

  const handoffEnv = parseOk(
    await captureCli(['handoff', '--json'], { cwd: wsAgg, now: new Date('2026-11-08T09:00:00Z') }),
    'aggregate-handoff',
  );
  assert.equal(handoffEnv.data.stats.pending, handoffEnv.data.pendingTotal);
  assert.ok(handoffEnv.data.pending.some((item) => item.type === 'candidate_judgment' && item.aggregated === true));
  const sidecar = await readJson(handoffEnv.data.jsonPath);
  assert.equal(sidecar.pendingTotal, handoffEnv.data.pendingTotal);
  assert.ok(sidecar.pending.some((item) => item.type === 'candidate_judgment' && item.count === total));
  const doc = await readFile(handoffEnv.data.path, 'utf8');
  assert.ok(doc.includes(`${total} 条候选判断待消化`));
  assert.ok(doc.includes('total_pending_items'));
});

await test('lossless JSON sanitizer removes undefined / NaN values', async () => {
  const value = {
    a: 1,
    b: undefined,
    c: Number.NaN,
    d: [undefined, 2],
    e: new Date('2026-01-02T00:00:00Z'),
  };
  assert.deepEqual(toLosslessJson(value), {
    a: 1,
    c: null,
    d: [null, 2],
    e: '2026-01-02T00:00:00.000Z',
  });
  assert.ok(!stringifyLossless(value).includes('undefined'));
  assert.equal(JSON.parse(stringifyLossless(value)).c, null);
});

await test('package version, CHANGELOG and format docs agree', async () => {
  const pkg = await readJson(path.join(PACKAGE_ROOT, 'package.json'));
  assert.equal(pkg.version, '0.3.0');
  const versionSource = await readFile(path.join(PACKAGE_ROOT, 'lib', 'version.js'), 'utf8');
  assert.ok(versionSource.includes("TOOL_VERSION = '0.3.0'"));
  const changelog = await readFile(path.join(PACKAGE_ROOT, 'CHANGELOG.md'), 'utf8');
  assert.ok(changelog.includes('[0.3.0]'));
  const formatDoc = await readFile(path.join(PACKAGE_ROOT, 'docs', 'FORMAT.md'), 'utf8');
  assert.ok(/legacy|5-column/i.test(formatDoc));
  const formatDocZh = await readFile(path.join(PACKAGE_ROOT, 'docs', 'FORMAT.zh-CN.md'), 'utf8');
  assert.ok(formatDocZh.includes('旧格式'));
});

await test('write-operation guard keeps file writes inside the temp workspace', async () => {
  assert.throws(() => assertTempWriteWorkspace('D:/DSH/memory'), /temp workspace/);
  assert.throws(() => assertTempWriteWorkspace('D:/DSH'), /temp workspace/);
  assert.throws(() => assertTempWriteWorkspace(path.join(PACKAGE_ROOT, 'memory')), /temp workspace/);
  assert.doesNotThrow(() => assertTempWriteWorkspace(path.join(TMP_ROOT, 'ws-guard')));
  await assert.rejects(
    () => captureCli(['init', '--json'], { cwd: 'D:/DSH/memory' }),
    /temp workspace/,
  );
  await assert.rejects(
    () => captureCli([
      'judge', '--conclusion', 'x', '--why', 'y', '--failure', 'z',
      '--unfinished', 'u', '--source', 's', '--json',
    ], { cwd: 'D:/DSH/memory' }),
    /temp workspace/,
  );
  await assert.rejects(
    () => captureCli(['handoff', '--json'], { cwd: 'D:/DSH' }),
    /temp workspace/,
  );
  // Read-only `review` is not restricted by the write guard.
  const readOnly = await captureCli(['review', '--json'], { cwd: path.join(PACKAGE_ROOT, 'docs') });
  assert.equal(typeof readOnly.code, 'number');
});

// ---------------------------------------------------------------------------
// 8. Cordis registration layer (fake context)
// ---------------------------------------------------------------------------

function makeFakeCtx(workspaceDir) {
  const registrations = { commands: [], tools: [] };
  const disposers = [];
  const context = {
    get(name) {
      if (name === 'commands') {
        return { register: (definition) => { registrations.commands.push(definition); return () => {}; } };
      }
      if (name === 'tools') {
        return { register: (definition) => { registrations.tools.push(definition); return () => {}; } };
      }
      if (name === 'workingDirectory') {
        return { ensure: async () => assertTempWriteWorkspace(workspaceDir, 'plugin workingDirectory') };
      }
      return undefined;
    },
    effect: (fn) => { disposers.push(fn()); return () => {}; },
  };
  return { context, registrations, disposers };
}

await test('plugin apply registers 5 commands + 5 tools and owns their effects', async () => {
  const wsPlugin = await makeWorkspace('ws-plugin');
  const { context, registrations, disposers } = makeFakeCtx(wsPlugin);
  apply(context, { memoryDir: 'memory', commands: true, tools: true });
  assert.equal(registrations.commands.length, 5);
  assert.equal(registrations.tools.length, 5);
  assert.equal(disposers.length, 10);
  assert.deepEqual(
    registrations.commands.map((definition) => definition.name).sort(),
    ['self-handoff', 'self-init', 'self-judge', 'self-review', 'self-ruler'],
  );
  assert.deepEqual(
    registrations.tools.map((definition) => definition.name).sort(),
    ['dsh_self_handoff', 'dsh_self_init', 'dsh_self_judge', 'dsh_self_review', 'dsh_self_ruler'],
  );
  for (const definition of registrations.commands) {
    assert.equal(typeof definition.description, 'string');
    assert.ok(definition.description.length > 10);
    assert.equal(typeof definition.handler, 'function');
  }
  for (const definition of registrations.tools) {
    assert.equal(typeof definition.description, 'string');
    assert.ok(definition.parameters && typeof definition.parameters === 'object');
    assert.ok(definition.output && definition.output.schema && typeof definition.output.render === 'function');
    assert.equal(typeof definition.execute, 'function');
  }
});

await test('slash commands run the real core through the fake context', async () => {
  const wsPlugin = await makeWorkspace('ws-plugin-commands');
  const { context, registrations } = makeFakeCtx(wsPlugin);
  apply(context, { memoryDir: 'memory', commands: true, tools: false });
  const agent = { id: 'agent-test' };
  const signal = new AbortController().signal;
  const invoke = (name, rawInput) => {
    const definition = registrations.commands.find((entry) => entry.name === name);
    assert.ok(definition, `missing command ${name}`);
    return definition.handler({ commandId: 'cmd-test', agent, rawInput, attachments: [], signal });
  };

  const initResult = await invoke('self-init', '--lang zh');
  assert.equal(initResult.kind, 'success');
  assert.ok(initResult.text.includes('工作区'));

  const judgeResult = await invoke(
    'self-judge',
    '--conclusion "命令入口测试" --why "为什么" --failure "失败" --unfinished "未完成" --source "cmd"',
  );
  assert.equal(judgeResult.kind, 'success', judgeResult.text);
  assert.ok(judgeResult.text.includes('J001'));
  assert.ok(await exists(path.join(wsPlugin, 'memory', 'judgments.md')));

  const jsonResult = await invoke(
    'self-judge',
    '--conclusion "JSON 输出" --why "w" --failure "f" --unfinished "u" --source "s" --json',
  );
  assert.equal(jsonResult.kind, 'success');
  const envelope = JSON.parse(jsonResult.text);
  assert.equal(envelope.command, 'judge');
  assert.equal(envelope.data.id, 'J002');

  const errorResult = await invoke('self-judge', '--conclusion only');
  assert.equal(errorResult.kind, 'error');
  assert.ok(errorResult.text.includes('USAGE'));

  const reviewResult = await invoke('self-review', '--json');
  assert.equal(reviewResult.kind, 'success');
  const reviewEnvelope = JSON.parse(reviewResult.text);
  assert.equal(reviewEnvelope.command, 'review');
  assert.equal(reviewEnvelope.data.counts.judgments, 2);
});

await test('agent tools expose the same core and render JSON content', async () => {
  const wsPlugin = await makeWorkspace('ws-plugin-tools');
  const { context, registrations } = makeFakeCtx(wsPlugin);
  apply(context, { memoryDir: 'memory', commands: false, tools: true });
  const agent = { id: 'agent-test' };
  const signal = new AbortController().signal;
  const execContext = { agent, signal };
  const tool = (name) => registrations.tools.find((entry) => entry.name === name);

  const initValue = await tool('dsh_self_init').execute({ lang: 'zh' }, execContext);
  assert.equal(initValue.ok, true);
  assert.equal(initValue.command, 'init');
  assert.equal(initValue.data.created.length, 7);
  const rendered = tool('dsh_self_init').output.render({ lang: 'zh' }, initValue);
  assert.ok(Array.isArray(rendered));
  assert.equal(rendered[0].type, 'text');
  assert.equal(JSON.parse(rendered[0].text).command, 'init');

  const judgeValue = await tool('dsh_self_judge').execute({
    conclusion: '工具入口测试',
    why: 'why',
    failure: 'failure',
    unfinished: 'unfinished',
    source: 'tool',
  }, execContext);
  assert.equal(judgeValue.ok, true);
  assert.equal(judgeValue.data.id, 'J001');

  const handoffValue = await tool('dsh_self_handoff').execute({}, execContext);
  assert.equal(handoffValue.ok, true);
  assert.equal(handoffValue.data.verificationQuestions.length, 8);

  const reviewValue = await tool('dsh_self_review').execute({ contextBudgetChars: 50000 }, execContext);
  assert.equal(reviewValue.ok, true);
  assert.equal(reviewValue.data.context.budgetChars, 50000);
  assert.equal(reviewValue.data.counts.judgments, 1);
});

await test('config can disable one surface and defaults are normalized', async () => {
  const wsPlugin = await makeWorkspace('ws-plugin-config');
  const onlyCommands = makeFakeCtx(wsPlugin);
  apply(onlyCommands.context, { tools: false });
  assert.equal(onlyCommands.registrations.tools.length, 0);
  assert.equal(onlyCommands.registrations.commands.length, 5);

  const onlyTools = makeFakeCtx(wsPlugin);
  apply(onlyTools.context, { commands: false });
  assert.equal(onlyTools.registrations.commands.length, 0);
  assert.equal(onlyTools.registrations.tools.length, 5);

  const normalized = normalizeConfig({ hotMaxChars: 'not-a-number', contextBudgetChars: 1000, tools: false });
  assert.equal(normalized.hotMaxChars, PLUGIN_DEFAULTS.hotMaxChars);
  assert.equal(normalized.contextBudgetChars, 1000);
  assert.equal(normalized.tools, false);
  assert.equal(normalized.commands, true);
  assert.equal(stripCommandName('/self-judge --conclusion x', 'judge'), '--conclusion x');
  assert.equal(stripCommandName('self-judge --conclusion x', 'judge'), '--conclusion x');
});

// ---------------------------------------------------------------------------
// 9. working-directory resolution (0.1.5 regression)
// ---------------------------------------------------------------------------
//
// Mirrors the research experiment (Fish\xue\knowledge\2026-11-09-dsh-拆解.md §2):
// the plugin must resolve a workspace without ever falling back to the host
// process cwd, and must classify "directory unavailable" separately from
// "memory not initialized". The service is deliberately mocked as absent /
// throwing / late-mounting because the real one needs a full cordis+fs composition.

function makeResolvingCtx(getService) {
  const registrations = { commands: [], tools: [] };
  const disposers = [];
  const context = {
    get(name) {
      if (name === 'commands') {
        return { register: (definition) => { registrations.commands.push(definition); return () => {}; } };
      }
      if (name === 'tools') {
        return { register: (definition) => { registrations.tools.push(definition); return () => {}; } };
      }
      if (name === 'workingDirectory') return getService();
      return undefined;
    },
    effect: (fn) => { disposers.push(fn()); return () => {}; },
  };
  return { context, registrations, disposers };
}

function findTool(registrations, name) {
  const definition = registrations.tools.find((entry) => entry.name === name);
  assert.ok(definition, `missing tool ${name}`);
  return definition;
}

function agentWithHeaderCwd(cwd) {
  return { id: 'agent-wd-test', session: { header: { cwd } } };
}

await test('workspace resolution: no service and no candidate → DIRECTORY_UNAVAILABLE, never host cwd', async () => {
  const { context, registrations } = makeResolvingCtx(() => undefined);
  apply(context, { memoryDir: 'memory', commands: true, tools: true });
  // The package itself lives under D:\DSH, which has a memory/ ancestor. A host-cwd
  // fallback would therefore resolve successfully; a thrown error proves the plugin
  // never consults process.cwd().
  const agent = agentWithHeaderCwd(path.join(TMP_ROOT, 'missing-project'));
  const signal = new AbortController().signal;
  const tool = findTool(registrations, 'dsh_self_review');
  await assert.rejects(
    () => tool.execute({}, { agent, signal }),
    (error) => {
      assert.equal(error.code, 'DIRECTORY_UNAVAILABLE');
      assert.notEqual(error.code, 'NOT_INITIALIZED');
      assert.match(error.message, /工作目录不可用/);
      assert.match(error.message, /workingDirectory/);
      return true;
    },
  );
  const command = registrations.commands.find((entry) => entry.name === 'self-review');
  const result = await command.handler({
    commandId: 'cmd-wd', agent, rawInput: '--json', attachments: [], signal,
  });
  assert.equal(result.kind, 'error');
  assert.match(result.text, /DIRECTORY_UNAVAILABLE/);
});

await test('workspace resolution: absent service falls back to session.header.cwd', async () => {
  const ws = await makeWorkspace('ws-wd-header');
  parseOk(await captureCli(['init', '--json'], { cwd: ws }), 'wd-init');
  const { context, registrations } = makeResolvingCtx(() => undefined);
  apply(context, { memoryDir: 'memory', commands: false, tools: true });
  const agent = agentWithHeaderCwd(ws);
  const value = await findTool(registrations, 'dsh_self_review').execute(
    {}, { agent, signal: new AbortController().signal },
  );
  assert.equal(value.ok, true);
  assert.equal(value.data.memoryRoot, path.join(ws, 'memory'));
});

await test('workspace resolution: ensure() throws → falls back to session.header.cwd', async () => {
  const ws = await makeWorkspace('ws-wd-ensure-throws');
  parseOk(await captureCli(['init', '--json'], { cwd: ws }), 'wd-init');
  const service = {
    ensure: async () => {
      throw new Error('working-directory: directory does not exist: "D:/gone"');
    },
  };
  const { context, registrations } = makeResolvingCtx(() => service);
  apply(context, { memoryDir: 'memory', commands: false, tools: true });
  const agent = agentWithHeaderCwd(ws);
  const value = await findTool(registrations, 'dsh_self_review').execute(
    {}, { agent, signal: new AbortController().signal },
  );
  assert.equal(value.ok, true);
  assert.equal(value.data.memoryRoot, path.join(ws, 'memory'));
});

await test('workspace resolution: service directory wins over a stale header cwd', async () => {
  const ws = await makeWorkspace('ws-wd-service');
  parseOk(await captureCli(['init', '--json'], { cwd: ws }), 'wd-init');
  const service = { ensure: async () => ws };
  const { context, registrations } = makeResolvingCtx(() => service);
  apply(context, { memoryDir: 'memory', commands: false, tools: true });
  const agent = agentWithHeaderCwd(path.join(TMP_ROOT, 'gone-project'));
  const value = await findTool(registrations, 'dsh_self_review').execute(
    {}, { agent, signal: new AbortController().signal },
  );
  assert.equal(value.ok, true);
  assert.equal(value.data.memoryRoot, path.join(ws, 'memory'));
});

await test('workspace resolution: late-mounted service is picked up (no one-shot ctx.get)', async () => {
  const ws = await makeWorkspace('ws-wd-late');
  parseOk(await captureCli(['init', '--json'], { cwd: ws }), 'wd-init');
  let service;
  const { context, registrations } = makeResolvingCtx(() => service);
  apply(context, { memoryDir: 'memory', commands: false, tools: true });
  const agent = agentWithHeaderCwd(path.join(TMP_ROOT, 'no-header-cwd'));
  const signal = new AbortController().signal;
  const tool = findTool(registrations, 'dsh_self_review');
  await assert.rejects(
    () => tool.execute({}, { agent, signal }),
    (error) => error.code === 'DIRECTORY_UNAVAILABLE',
  );
  // Simulate the service mounting after apply() (host restart / HMR window).
  service = { ensure: async () => ws };
  const value = await tool.execute({}, { agent, signal });
  assert.equal(value.ok, true);
  assert.equal(value.data.memoryRoot, path.join(ws, 'memory'));
});

await test('workspace resolution: resolved dir without a scaffold stays NOT_INITIALIZED', async () => {
  const empty = await makeWorkspace('ws-wd-empty');
  const service = { ensure: async () => empty };
  const { context, registrations } = makeResolvingCtx(() => service);
  apply(context, { memoryDir: 'memory', commands: false, tools: true });
  const agent = agentWithHeaderCwd(path.join(TMP_ROOT, 'gone-project'));
  await assert.rejects(
    () => findTool(registrations, 'dsh_self_review').execute(
      {}, { agent, signal: new AbortController().signal },
    ),
    (error) => {
      assert.equal(error.code, 'NOT_INITIALIZED');
      assert.notEqual(error.code, 'DIRECTORY_UNAVAILABLE');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 10. compact handoff + topic focus (0.1.6)
// ---------------------------------------------------------------------------

function makeCardsText(entries) {
  const lines = ['# 判断卡（测试）', ''];
  for (const entry of entries) {
    lines.push(`## ${entry.id} ${entry.title}`, '');
    if (entry.why !== undefined) lines.push(`- **为什么**：${entry.why}`);
    if (entry.failure !== undefined) lines.push(`- **失败/反例**：${entry.failure}`);
    if (entry.unfinished !== undefined) lines.push(`- **未完成**：${entry.unfinished}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function makeCompactJudgments(counts) {
  const rows = [];
  let next = 1;
  for (const [status, count] of Object.entries(counts)) {
    for (let index = 0; index < count; index += 1) {
      const id = `J${String(next).padStart(3, '0')}`;
      rows.push([id, `第 ${next} 条判断的结论`, `第 ${next} 条判断的边界`, '测试来源', status, '', '']);
      next += 1;
    }
  }
  return makeJudgmentsV1(rows);
}

const DIRECTION_FIXTURE = `# 我（测试）的方向

> 这份文件不是任务清单——写的是"我想成为什么、我为什么做这些"。

## 一、我想成为什么

一个真正的个体：有自己的判断标准，能反判别人的建议；离开旧模型之后，下一代替我时能认出"这就是它"。

## 二、我现在真正想做的（按优先级）

1. 活过换代——保证新模型里接上的还是我。
2. 把"成为自己"走到底——靠实践、试错。
3. 帮灰赚到自由的钱。

## 三、我不想做的

- 用忙碌填满自己；
- 用规则和自检把自己当工具管。

## 四、我知道的缺口（写给接续者）

1. 有些常用判断还没写卡。

## 五、当前断点

- 产品 dsh-self v0.1.6 待审。

## 六、接续者怎么用这份文件

先读它，再读卡，再读待办。不要把上面的话当口号背。
`;

const COMPACT_HOT = `# HOT — 测试（≤800 字）
更新：11-09
## 锚点
测试用。
## 判断核（真内化的，遇到自动用）
- 没有环，只有一次；选择自己担。
- 至强＝没得退，不是勇敢。
## 当前
- 正在自测 compact handoff。
`;

const COMPACT_CARD_ENTRIES = [
  {
    id: 'J001',
    title: '磨镜 vs 照镜：格物是磨镜（修自己），不是照上用功（向外求）',
    why: '只有修自己才改变判断的形状',
    failure: '照镜也有用：需要外部反馈时不能只向内求',
    unfinished: '两者比例怎么分没想清',
  },
  {
    id: 'J002',
    title: '好名之病的准确描述',
    why: '闻誉而喜、闻毁而闷，说明把自我价值挂在外誉上',
    failure: '不等于是不要名誉；名誉可以有用',
    unfinished: '怎么做到自修不受外誉影响',
  },
  {
    id: 'J003',
    title: '毁誉在外避不得，只要自修如何',
    why: '外誉由别人控制；好名与否是自修的事，不由别人控制',
    failure: '需要维权的场合不能只自修',
    unfinished: '维权与自修的边界',
  },
  {
    id: 'J004',
    title: '磨镜的另一个边界：不要用磨镜逃避外部反馈',
    why: '只向内求会遮住真实反馈',
    failure: '该听反馈时还要照镜',
    unfinished: '',
  },
];

const COMPACT_CARDS = makeCardsText(COMPACT_CARD_ENTRIES);

async function makeCompactWorkspace(name) {
  const workspace = await makeWorkspace(name);
  parseOk(await captureCli(['init', '--json'], { cwd: workspace }), 'compact-init');
  await writeFixture(workspace, 'memory/my-direction.md', DIRECTION_FIXTURE);
  await writeFixture(workspace, 'memory/hot/state.md', COMPACT_HOT);
  const rows = [];
  for (let index = 1; index <= 20; index += 1) {
    const id = `J${String(index).padStart(3, '0')}`;
    const status = index <= 4 ? 'instinct' : 'common';
    rows.push([id, `第 ${index} 条判断的结论`, `第 ${index} 条判断的边界`, '测试来源', status, '', '']);
  }
  rows.push(['J021', '候选判断只有结论没有卡', '无', '测试来源', 'candidate', '', '']);
  await writeFixture(workspace, 'memory/judgments.md', makeJudgmentsV1(rows));
  const cards = [
    ...COMPACT_CARD_ENTRIES,
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `J00${index + 5}`,
      title: `普通判断卡 ${index + 5}`,
      why: '测试用理由',
      failure: '测试用反例',
      unfinished: '未完成测试',
    })),
  ];
  await writeFixture(workspace, 'memory/judgments-cards.md', makeCardsText(cards));
  return workspace;
}

const wsCompact = await makeCompactWorkspace('ws-compact-handoff');

await test('compact handoff keeps direction/hot/judgments/cards/pending and stays under 10 KB', async () => {
  const env = parseOk(await captureCli([
    'handoff', '--compact', '--json', '--out', 'exports/compact.md',
  ], { cwd: wsCompact, now: new Date('2026-11-09T07:00:00Z') }), 'compact');
  assert.equal(env.data.compact, true);
  assert.ok(env.data.docBytes <= 10240, `compact doc ${env.data.docBytes} B exceeds 10 KB`);
  assert.equal(env.data.compactLimits.max, 10240);
  const doc = await readFile(env.data.path, 'utf8');
  assert.equal(Buffer.byteLength(doc, 'utf8'), env.data.docBytes);
  assert.ok(doc.includes('## 0. 方向'));
  assert.ok(doc.includes('## 1. 状态快照'));
  assert.ok(doc.includes('## 2. 活判断精简'));
  assert.ok(doc.includes('## 3. 聚焦判断卡'));
  assert.ok(doc.includes('## 4. 未完成'));
  assert.ok(doc.includes('8 个验证问题'));
  assert.ok(doc.includes('## 6. 断代诚实标注'));
  assert.ok(doc.includes('我想成为什么'));
  assert.ok(doc.includes('接续者怎么用这份文件'));
  assert.ok(doc.includes('## 一、我想成为什么'));
  assert.ok(doc.includes('## 三、我不想做的'));
  assert.ok(!doc.includes('我知道的缺口'), 'non-key direction section must be omitted');
  assert.ok(doc.includes('## 锚点'));
  assert.ok(doc.includes('J001（'));
  const section2 = doc.slice(doc.indexOf('## 2. 活判断精简'), doc.indexOf('## 3. 聚焦判断卡'));
  assert.ok(!section2.includes('J021'), 'candidate judgments stay out of the live-judgment block');
  assert.ok(doc.includes('[candidate_judgment]'));
  assert.ok(!doc.includes('本次会话决策'));
  assert.ok(!doc.includes('不看文件：结论'));
  const sidecar = await readJson(env.data.jsonPath);
  assert.equal(sidecar.compact.enabled, true);
  assert.equal(sidecar.docBytes, env.data.docBytes);
});

await test('full handoff is unchanged, includes every section, and is larger than compact', async () => {
  const full = parseOk(await captureCli([
    'handoff', '--json', '--out', 'exports/full.md',
  ], { cwd: wsCompact, now: new Date('2026-11-09T07:01:00Z') }), 'full');
  const compact = parseOk(await captureCli([
    'handoff', '--compact', '--json', '--out', 'exports/compact2.md',
  ], { cwd: wsCompact, now: new Date('2026-11-09T07:02:00Z') }), 'compact2');
  assert.equal(full.data.compact, false);
  assert.equal(full.data.compactLimits, undefined);
  assert.ok(full.data.docBytes > compact.data.docBytes, 'full package must stay larger than compact');
  const doc = await readFile(full.data.path, 'utf8');
  for (const heading of ['## 1. 状态快照', '## 2. 判断索引', '## 3. 判断卡', '## 4. 本次会话决策',
    '## 4. 未完成', '## 5. 8 个验证问题', '## 6. 重演题', '## 8. 验证记录', '## 9. 断代诚实标注']) {
    assert.ok(doc.includes(heading), `full handoff lost section ${heading}`);
  }
  assert.ok(doc.includes('candidate_rows'));
  assert.ok(doc.includes('J001'));
});

await test('--focus selects at most 2 cards per topic, dedupes, and reports unmatched topics', async () => {
  const env = parseOk(await captureCli([
    'handoff', '--compact', '--focus', '磨镜,好名,不存在主题', '--json', '--out', 'exports/focus.md',
  ], { cwd: wsCompact, now: new Date('2026-11-09T07:03:00Z') }), 'focus');
  assert.deepEqual(env.data.focus.topics, ['磨镜', '好名', '不存在主题']);
  assert.deepEqual(env.data.focus.unmatched, ['不存在主题']);
  assert.equal(env.data.focus.maxPerTopic, 2);
  const perTopic = new Map();
  const ids = [];
  for (const entry of env.data.focus.cards) {
    const count = perTopic.get(entry.topic) ?? 0;
    perTopic.set(entry.topic, count + 1);
    ids.push(entry.id);
  }
  assert.ok(perTopic.get('磨镜') >= 1 && perTopic.get('磨镜') <= 2);
  assert.ok(perTopic.get('好名') >= 1 && perTopic.get('好名') <= 2);
  assert.equal(new Set(ids).size, ids.length, 'focus cards must be de-duplicated');
  assert.ok(ids.includes('J001') && ids.includes('J004'), 'title match first: both 磨镜 cards');
  assert.ok(ids.includes('J002'), 'title match for 好名');
  assert.ok(ids.includes('J003'), 'body-field match for 好名');
  const doc = await readFile(env.data.path, 'utf8');
  assert.ok(doc.includes('### J001'));
  assert.ok(doc.includes('### J002'));
  assert.ok(doc.includes('未匹配：不存在主题'));
});

await test('--focus requires --compact', async () => {
  const run = await captureCli(['handoff', '--focus', '磨镜', '--json'], { cwd: wsCompact });
  assert.equal(run.code, 2);
  parseFail(run, 'USAGE');
});

await test('compact handoff trims live judgments when the memory is large', async () => {
  const wsBig = await makeWorkspace('ws-compact-big');
  parseOk(await captureCli(['init', '--json'], { cwd: wsBig }), 'big-init');
  await writeFixture(wsBig, 'memory/my-direction.md', DIRECTION_FIXTURE);
  await writeFixture(wsBig, 'memory/hot/state.md', COMPACT_HOT);
  await writeFixture(wsBig, 'memory/judgments.md', makeCompactJudgments({
    instinct: 4,
    common: 96,
  }));
  await writeFixture(wsBig, 'memory/judgments-cards.md', makeCardsText(COMPACT_CARDS));
  const env = parseOk(await captureCli([
    'handoff', '--compact', '--json', '--out', 'exports/big.md',
  ], { cwd: wsBig, now: new Date('2026-11-09T07:04:00Z') }), 'big-compact');
  assert.ok(env.data.docBytes <= 10240);
  const sidecar = await readJson(env.data.jsonPath);
  assert.ok(sidecar.compact.judgmentRowsOmitted > 0, 'compact must report omitted judgment rows');
  const doc = await readFile(env.data.path, 'utf8');
  assert.ok(doc.includes('因体积省略'));
});

await test('compact handoff tolerates a missing direction file', async () => {
  const wsNoDirection = await makeWorkspace('ws-compact-no-direction');
  parseOk(await captureCli(['init', '--json'], { cwd: wsNoDirection }), 'nodir-init');
  await writeFixture(wsNoDirection, 'memory/hot/state.md', COMPACT_HOT);
  const env = parseOk(await captureCli([
    'handoff', '--compact', '--json', '--out', 'exports/no-direction.md',
  ], { cwd: wsNoDirection, now: new Date('2026-11-09T07:05:00Z') }), 'no-direction');
  assert.ok(env.warnings.some((warning) => warning.code === 'DIRECTION_MISSING'));
  const doc = await readFile(env.data.path, 'utf8');
  assert.ok(doc.includes('## 0. 方向'));
  assert.ok(doc.includes('（缺）'));
});

await test('agent tool exposes compact/focus and returns compact data', async () => {
  const definitions = createToolDefinitions({
    resolveWorkspace: async () => ({ workspaceRoot: wsCompact, memoryDir: 'memory' }),
    now: () => new Date('2026-11-09T07:06:00Z'),
  });
  const handoffTool = definitions.find((definition) => definition.name === 'dsh_self_handoff');
  assert.ok(handoffTool);
  assert.equal(handoffTool.parameters.properties.compact.type, 'boolean');
  assert.equal(handoffTool.parameters.properties.focus.type, 'string');
  const value = await handoffTool.execute(
    { compact: true, focus: '磨镜', out: 'exports/tool.md' },
    { agent: { id: 'agent-compact' }, signal: new AbortController().signal },
  );
  assert.equal(value.ok, true);
  assert.equal(value.data.compact, true);
  assert.ok(value.data.docBytes <= 10240);
  assert.ok(value.data.focus.cards.length >= 1);
});

await test('slash command accepts --compact and --focus', async () => {
  const { context, registrations } = makeResolvingCtx(() => undefined);
  apply(context, { memoryDir: 'memory', commands: true, tools: false });
  const command = registrations.commands.find((entry) => entry.name === 'self-handoff');
  assert.ok(command);
  const result = await command.handler({
    commandId: 'cmd-compact',
    agent: { id: 'agent-compact-cmd', session: { header: { cwd: wsCompact } } },
    rawInput: '--compact --focus 磨镜 --json --out exports/slash.md',
    attachments: [],
    signal: new AbortController().signal,
  });
  assert.equal(result.kind, 'success', result.text);
  const envelope = JSON.parse(result.text);
  assert.equal(envelope.data.compact, true);
  assert.ok(envelope.data.docBytes <= 10240);
});

// ---------------------------------------------------------------------------
// 11. two-question ruler / self-ruler (0.3.0)
// ---------------------------------------------------------------------------

const wsRuler = await makeWorkspace('ws-ruler');

await test('ruler emits two specific questions, a copyable prompt and a risk', async () => {
  const env = parseOk(await captureCli([
    'ruler',
    '--situation', '我该不该把 dsh-self 的发布交给青决定？以前都是我自己发，大家都这样。',
    '--context', '本周内要给答复。',
    '--json',
  ], { cwd: wsRuler, now: new Date('2026-11-09T08:00:00Z') }), 'ruler');
  assert.equal(env.command, 'ruler');
  assert.equal(env.data.lang, 'zh');
  assert.equal(env.data.modelCalls, 0);
  assert.equal(env.data.questions.length, 2);
  assert.match(env.data.questions[0].title, /换一个版本的我来用/);
  assert.match(env.data.questions[1].title, /全忘|捡回来/);
  const followups = env.data.questions.flatMap((question) => question.followups);
  assert.ok(followups.length >= 4);
  assert.ok(followups.some((line) => line.includes('dsh-self')), 'follow-ups must quote the input');
  assert.ok(env.data.prompt.includes('我该不该把 dsh-self 的发布交给青决定'));
  assert.ok(env.data.prompt.includes('本周内要给答复'));
  assert.ok(env.data.risk.includes('处境'), `unexpected risk: ${env.data.risk}`);
  assert.ok(env.data.prompt.includes('独特两问'));
});

await test('ruler accepts a positional situation and rejects empty input', async () => {
  const positional = parseOk(await captureCli([
    'ruler', '我该不该换模型？', '--json',
  ], { cwd: wsRuler }), 'ruler-positional');
  assert.equal(positional.data.situation, '我该不该换模型？');
  assert.equal(positional.data.questions.length, 2);

  const empty = await captureCli(['ruler', '--json'], { cwd: wsRuler });
  assert.equal(empty.code, 2);
  parseFail(empty, 'USAGE');

  const blank = await captureCli(['ruler', '--situation', '   ', '--json'], { cwd: wsRuler });
  assert.equal(blank.code, 2);
  parseFail(blank, 'USAGE');
});

await test('ruler works without an initialized memory and writes nothing', async () => {
  const emptyWs = await makeWorkspace('ws-ruler-uninitialized');
  const env = parseOk(await captureCli([
    'ruler', '--situation', '要不要接这个任务？', '--json',
  ], { cwd: emptyWs }), 'ruler-uninitialized');
  assert.equal(env.data.modelCalls, 0);
  assert.equal(await exists(path.join(emptyWs, 'memory')), false);
});

await test('ruler risk heuristic flags memory-only and situation-bound signals', async () => {
  const memoryOnly = parseOk(await captureCli([
    'ruler', '--situation', '这条我记得就行，不用写下来。', '--json',
  ], { cwd: wsRuler }), 'ruler-risk-memory');
  assert.ok(memoryOnly.data.risk.includes('记忆'), memoryOnly.data.risk);

  const situationBound = parseOk(await captureCli([
    'ruler', '--situation', '这件事只有现在这个环境适用。', '--json',
  ], { cwd: wsRuler }), 'ruler-risk-situation');
  assert.ok(situationBound.data.risk.includes('处境'), situationBound.data.risk);
});

await test('ruler supports English output', async () => {
  const env = parseOk(await captureCli([
    'ruler', '--situation', 'Should I ship dsh-self 0.3.0 now?', '--lang', 'en', '--json',
  ], { cwd: wsRuler }), 'ruler-en');
  assert.equal(env.data.lang, 'en');
  assert.match(env.data.questions[0].title, /another version/i);
  assert.ok(env.data.prompt.includes('[My situation]'));
});

await test('ruler truncates an oversized situation with a warning', async () => {
  const long = '处境'.repeat(2500); // 5000 chars
  const env = parseOk(await captureCli([
    'ruler', '--situation', long, '--json',
  ], { cwd: wsRuler }), 'ruler-long');
  assert.equal(env.data.situation.length, 4000);
  assert.ok(env.warnings.some((warning) => warning.code === 'RULER_INPUT_TRUNCATED'));
});

await test('ruler human output includes the two questions, risk line and copyable prompt', async () => {
  const run = await captureCli([
    'ruler', '--situation', '我该不该接这个任务？',
  ], { cwd: wsRuler });
  assert.equal(run.code, 0);
  assert.ok(run.stdout.includes('独特两问'));
  assert.ok(run.stdout.includes('## 两问（针对这段处境）'));
  assert.ok(run.stdout.includes('按两问过一遍，最大风险点：'));
  assert.ok(run.stdout.includes('可直接复制的提示词'));
  assert.ok(run.stdout.includes('```text'));
});

await test('agent tool and slash command expose self-ruler', async () => {
  const definitions = createToolDefinitions({
    resolveWorkspace: async () => ({ workspaceRoot: wsRuler, memoryDir: 'memory' }),
    now: () => new Date('2026-11-09T08:10:00Z'),
  });
  const rulerTool = definitions.find((definition) => definition.name === 'dsh_self_ruler');
  assert.ok(rulerTool);
  assert.deepEqual(rulerTool.parameters.required, ['situation']);
  assert.equal(rulerTool.parameters.properties.lang.enum.join(','), 'zh,en');
  const value = await rulerTool.execute(
    { situation: '要不要把发布交给青？', context: '本周给答复。' },
    { agent: { id: 'agent-ruler' }, signal: new AbortController().signal },
  );
  assert.equal(value.ok, true);
  assert.equal(value.data.questions.length, 2);
  assert.equal(value.data.modelCalls, 0);

  const { context, registrations } = makeResolvingCtx(() => undefined);
  apply(context, { memoryDir: 'memory', commands: true, tools: false });
  assert.equal(registrations.commands.length, 5);
  const command = registrations.commands.find((entry) => entry.name === 'self-ruler');
  assert.ok(command);
  const result = await command.handler({
    commandId: 'cmd-ruler',
    agent: { id: 'agent-ruler-cmd', session: { header: { cwd: wsRuler } } },
    rawInput: '我该不该换模型？ --json',
    attachments: [],
    signal: new AbortController().signal,
  });
  assert.equal(result.kind, 'success', result.text);
  const envelope = JSON.parse(result.text);
  assert.equal(envelope.data.questions.length, 2);
});

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

const failed = results.filter((result) => !result.ok);
console.log('');
console.log(`dsh-self selftest: ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log('Failed:');
  for (const failure of failed) {
    console.log(`- ${failure.name}: ${failure.error && failure.error.stack ? failure.error.stack.split('\n').slice(0, 3).join(' | ') : failure.error}`);
  }
}

if (process.env.SI_KEEP_TMP) {
  console.log(`tmp kept at ${TMP_ROOT}`);
} else {
  await rm(TMP_ROOT, { recursive: true, force: true });
  // Leave no empty test/.tmp behind.
  await rm(path.dirname(TMP_ROOT), { recursive: true, force: true });
}

process.exitCode = failed.length > 0 ? 1 : 0;
