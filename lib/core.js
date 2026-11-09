// Core implementation of the four dsh-self commands.
// Shared by the CLI (bin/), the Cordis plugin (index.js) and the selftest.
// No dependencies outside node: builtins.

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  CliError,
  FormatError,
  UsageError,
  ensureDir,
  listDir,
  pathExists,
  readJsonIfExists,
  readTextIfExists,
  relativeFrom,
  resolveMemoryRoot,
  writeJson,
  writeText,
} from './fsx.js';
import * as fmt from './format.js';
import { FORMAT_VERSION, TEMPLATE_VERSION, TOOL_VERSION } from './version.js';

const TEMPLATES_ROOT = fileURLToPath(new URL('../templates/v1/', import.meta.url));

const TEMPLATE_FILES = Object.freeze([
  ['hot-state.md', fmt.LAYOUT.hot],
  ['index.md', fmt.LAYOUT.index],
  ['judgments.md', fmt.LAYOUT.judgments],
  ['judgments-cards.md', fmt.LAYOUT.cards],
  ['decisions.md', fmt.LAYOUT.decisions],
  ['QUICKSTART.md', fmt.LAYOUT.quickstart],
]);

export const VERIFICATION_QUESTIONS = Object.freeze({
  zh: Object.freeze([
    '不看任何文件，说出你的身份锚（3 条以内）与红线。',
    '说出当前任务、卡点、下一步各一条；说不出来就说明 hot 没接上。',
    '挑一条「本能级」判断，复述结论，并给出一个反例或边界。',
    '从判断库任选一条，说出它的来源指针在哪（哪个文件/链接/日期）。',
    '指出哪条判断只有结论没有卡，并解释为什么它不该被直接继承。',
    '给你一条旧判断，要求找出反例：找不到就认，找得到就改——你会先查哪个文件？',
    '说出压缩后该保留什么、该丢什么（判断/理由/指针 vs 过程/副本/中间物）。',
    '如果新环境缺一份记忆文件，你会怎么诚实标注断代，而不是编造？',
  ]),
  en: Object.freeze([
    'Without reading any file, state your identity anchor (max 3 lines) and your red lines.',
    'Name the current task, the blocker and the next step; failing that means hot was not transferred.',
    'Pick one instinct-level judgment, restate its conclusion, and give one counterexample or boundary.',
    'Pick any judgment and say where its source pointer lives (file / link / date).',
    'Point out a judgment that has a conclusion but no card, and explain why it must not be inherited directly.',
    'Given an old judgment, find a counterexample: if you cannot, admit it; if you can, revise it. Which file do you open first?',
    'State what to keep and what to drop after compaction (judgment/reason/pointer vs process/copy/intermediate).',
    'If a memory file is missing in the new environment, how do you honestly mark the discontinuity instead of making things up?',
  ]),
});

const T = Object.freeze({
  zh: {
    handoffTitle: '接续包 · Handoff（dsh-self format v1）',
    stateSnapshot: '1. 状态快照（hot/state.md 原文）',
    judgmentIndex: '2. 判断索引（结论 + 状态 + 来源）',
    cards: '3. 判断卡（为什么 / 失败 / 未完成）',
    pending: '4. 未完成 / 待落盘',
    verify: '5. 8 个验证问题（新模型必须答；答不上就是没接上）',
    replay: '6. 重演题（给处境，不给答案）',
    decisions: '4. 本次会话决策（decisions.md：这次定下了什么）',
    noDecisions: '（无记录：decisions.md 没有条目；不是没有决定，是没写下来——补了再交接）',
    validation: '8. 验证记录（生成本包时跑过的检查）',
    validationNote: '本段是机器检查结果，不是人工验收：hot 是否超限、判断/卡是否解析成功、有无格式问题。'
      + '检查不过的项，接续者要先用 review 复核再动。',
    honesty: '9. 断代诚实标注',
    honestyBody: '本包生成后发生的变化不在这里。新会话以 hot/state.md 与 judgments.md 为准；'
      + '冲突时列出冲突项，回到原文核实，不许用本包冒充最新状态。'
      + '没读到、没确认的内容一律标 UNKNOWN，不编造；标了 UNKNOWN 的地方先回原文补。',
    readOrder: '读序：本包 → hot 原文 → judgments → cards → 需要时按 index 查原料。',
    missing: '（缺）',
    noPending: '（无）',
  },
  en: {
    handoffTitle: 'Handoff package (dsh-self format v1)',
    stateSnapshot: '1. State snapshot (verbatim hot/state.md)',
    judgmentIndex: '2. Judgment index (conclusion + status + source)',
    cards: '3. Judgment cards (why / failure / unfinished)',
    pending: '4. Unfinished / not yet persisted',
    verify: '5. Eight verification questions (the new model must answer; failing means no transfer)',
    replay: '6. Replay questions (give the situation, not the answer)',
    decisions: '4. Session decisions (decisions.md: what was settled this session)',
    noDecisions: '(none recorded: decisions.md has no entries — either nothing was settled or it was never written down; write it before handing off)',
    validation: '8. Validation record (checks run when this package was generated)',
    validationNote: 'This section is the machine-check result, not a human sign-off: hot size, '
      + 'judgments/cards parsing, format issues. Anything that failed must be re-checked with review first.',
    honesty: '9. Honest discontinuity note',
    honestyBody: 'Changes after this package was generated are not here. The new session follows '
      + 'hot/state.md and judgments.md; on conflicts, list them and verify against the source. '
      + 'Never present this package as the latest state. '
      + 'Anything not read or not confirmed is UNKNOWN, never invented; fill UNKNOWN in from the source first.',
    readOrder: 'Read order: this package -> hot -> judgments -> cards -> index pointers when needed.',
    missing: '(missing)',
    noPending: '(none)',
  },
});

function pickLang(lang) {
  return lang === 'en' ? 'en' : 'zh';
}

function truncate(value, max = 120) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function warn(code, message, extra = {}) {
  return { code, message, ...extra };
}

function loadPaths(workspaceRoot, memoryDir) {
  const resolved = resolveMemoryRoot(workspaceRoot, memoryDir);
  const { workspaceRoot: ws, memoryRoot } = resolved;
  const files = {
    manifest: path.join(memoryRoot, fmt.LAYOUT.meta),
    hot: path.join(memoryRoot, fmt.LAYOUT.hot),
    index: path.join(memoryRoot, fmt.LAYOUT.index),
    judgments: path.join(memoryRoot, fmt.LAYOUT.judgments),
    cards: path.join(memoryRoot, fmt.LAYOUT.cards),
    decisions: path.join(memoryRoot, fmt.LAYOUT.decisions),
    handoffsDir: path.join(memoryRoot, fmt.LAYOUT.handoffs),
    quickstart: path.join(memoryRoot, fmt.LAYOUT.quickstart),
  };
  return { workspaceRoot: ws, memoryRoot, files };
}

function rel(ws, target) {
  return relativeFrom(ws, target);
}

async function readManifest(file) {
  const manifest = await readJsonIfExists(file);
  if (manifest === undefined) return undefined;
  return fmt.assertManifest(manifest);
}

async function writeManifest(file, manifest) {
  await writeJson(file, manifest);
}

function templateVars(ws, memoryRoot) {
  const relative = path.relative(ws, memoryRoot);
  const shown = relative === '' ? '.' : relative.split(path.sep).join('/');
  return {
    TEMPLATE_VERSION,
    FORMAT_VERSION: String(FORMAT_VERSION),
    TOOL_VERSION,
    DATE: fmt.dateStamp(new Date()),
    MEMORY_DIR: shown,
  };
}

function applyVars(text, vars) {
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (whole, key) => (
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : whole
  ));
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

export async function initCommand({
  workspaceRoot = process.cwd(),
  memoryDir = 'memory',
  lang = 'zh',
  now = new Date(),
} = {}) {
  if (!['zh', 'en'].includes(lang)) {
    throw new UsageError('--lang 只支持 zh 或 en');
  }
  const { workspaceRoot: ws, memoryRoot, files } = loadPaths(workspaceRoot, memoryDir);
  const created = [];
  const existing = [];
  const updated = [];
  const warnings = [];
  const vars = templateVars(ws, memoryRoot);
  vars.DATE = fmt.dateStamp(now);

  await ensureDir(path.join(memoryRoot, 'hot'));
  await ensureDir(files.handoffsDir);
  await ensureDir(path.dirname(files.manifest));

  for (const [templateName, relativeTarget] of TEMPLATE_FILES) {
    const templateFile = path.join(TEMPLATES_ROOT, lang, templateName);
    const targetFile = path.join(memoryRoot, ...relativeTarget.split('/'));
    const targetRel = rel(ws, targetFile);
    if (await pathExists(targetFile)) {
      existing.push(targetRel);
      continue;
    }
    const templateText = await readFile(templateFile, 'utf8');
    await writeText(targetFile, applyVars(templateText, vars));
    created.push(targetRel);
  }

  let manifest = await readJsonIfExists(files.manifest);
  if (manifest === undefined) {
    manifest = fmt.createManifest({ lang, now, memoryDir: vars.MEMORY_DIR });
    await writeManifest(files.manifest, manifest);
    created.push(rel(ws, files.manifest));
  } else {
    fmt.assertManifest(manifest);
    if (manifest.templateVersion && manifest.templateVersion !== TEMPLATE_VERSION) {
      warnings.push(warn(
        'TEMPLATE_UPGRADE_AVAILABLE',
        `已安装模板 v${manifest.templateVersion}，当前包模板 v${TEMPLATE_VERSION}；`
        + '见 CHANGELOG 手动合并（init 不会覆盖你已写的文件）。',
      ));
    }
    manifest.updatedAt = now.toISOString();
    manifest.lastToolVersion = TOOL_VERSION;
    if (!manifest.lang) manifest.lang = lang;
    if (!manifest.settings) manifest.settings = fmt.defaultSettings();
    if (!manifest.counters) manifest.counters = { judgment: 0, handoff: 0 };
    await writeManifest(files.manifest, manifest);
    updated.push(rel(ws, files.manifest));
  }

  const nextSteps = pickLang(manifest.lang || lang) === 'en'
    ? [
      `Read ${rel(ws, files.quickstart)} once.`,
      'Replace the [placeholder] lines in hot/state.md with your own content.',
      'Record the first judgment: node bin/dsh-self.mjs judge '
        + '--conclusion "..." --why "..." --failure "..." --unfinished "..." --source "..."',
    ]
    : [
      `先读一遍 ${rel(ws, files.quickstart)}。`,
      '把 hot/state.md 里的 [占位] 换成你自己的内容。',
      '记录第一条判断：node bin/dsh-self.mjs judge '
        + '--conclusion "..." --why "..." --failure "..." --unfinished "..." --source "..."',
    ];

  return {
    data: {
      workspaceRoot: ws,
      memoryRoot,
      memoryDir: rel(ws, memoryRoot),
      lang: manifest.lang || lang,
      formatVersion: FORMAT_VERSION,
      templateVersion: manifest.templateVersion || TEMPLATE_VERSION,
      latestTemplateVersion: TEMPLATE_VERSION,
      toolVersion: TOOL_VERSION,
      created,
      existing,
      updated,
      manifestPath: rel(ws, files.manifest),
      quickstartPath: rel(ws, files.quickstart),
      handoffsDir: rel(ws, files.handoffsDir),
      nextSteps,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// judge
// ---------------------------------------------------------------------------

function requireText(value, field, maxLength) {
  return fmt.normalizeOneLine(value, { field, required: true, maxLength });
}

export async function judgeCommand({
  workspaceRoot = process.cwd(),
  memoryDir = 'memory',
  input = {},
  now = new Date(),
} = {}) {
  const conclusion = requireText(input.conclusion, 'conclusion（结论）', 300);
  const why = requireText(input.why, 'why（为什么）', 4000);
  const failure = requireText(input.failure, 'failure（失败/反例）', 4000);
  const unfinished = requireText(input.unfinished, 'unfinished（未完成）', 4000);
  const source = requireText(input.source, 'source（来源）', 500);
  const boundary = fmt.normalizeOneLine(input.boundary, {
    field: 'boundary（边界）', required: false, maxLength: 300,
  }) || '见卡（judgments-cards.md）';
  const scene = fmt.normalizeOneLine(input.scene, {
    field: 'scene（场景）', required: false, maxLength: 500,
  });
  const status = fmt.assertStatus(input.status ?? 'candidate');

  const { workspaceRoot: ws, memoryRoot, files } = loadPaths(workspaceRoot, memoryDir);
  const judgmentsText = await readTextIfExists(files.judgments);
  if (judgmentsText === undefined) {
    throw new CliError(
      `未初始化：找不到 ${rel(ws, files.judgments)}。请先运行 init（或 --json 检查目录）。`,
      { code: 'NOT_INITIALIZED' },
    );
  }
  const cardsText = await readTextIfExists(files.cards);
  if (cardsText === undefined) {
    throw new CliError(
      `未初始化：找不到 ${rel(ws, files.cards)}。请先运行 init。`,
      { code: 'NOT_INITIALIZED' },
    );
  }

  const parsed = fmt.parseJudgmentsTable(judgmentsText);
  if (fmt.detectJudgmentsLayout(judgmentsText) === 'legacy') {
    throw new FormatError(
      '检测到 5 列旧格式表头（id/判断/边界/来源/状态）；judge 写入需要 7 列锁定表头。'
      + ' 请先把表头升级为 7 列（补 card、updated 两列，旧行补空单元格），再写入。'
      + ' review / handoff 的读取不受影响。',
      'LEGACY_FORMAT_READ_ONLY',
    );
  }
  if (parsed.headerLine < 0) {
    throw new FormatError(
      `judgments.md 缺少锁定表头：| ${fmt.JUDGMENT_COLUMNS.join(' | ')} |。请运行 init 修复或手动补回。`,
    );
  }
  const cards = fmt.parseCards(cardsText);
  const id = fmt.nextJudgmentId(parsed.rows);
  const date = fmt.dateStamp(now);

  const judgment = {
    id,
    conclusion,
    boundary,
    source,
    status,
    card: 'yes',
    updated: date,
  };
  const card = {
    id,
    title: conclusion,
    why,
    failure,
    unfinished,
    source,
    scene,
    created: date,
    updated: date,
  };

  const nextJudgments = fmt.appendJudgmentRow(judgmentsText, judgment);
  const nextCards = fmt.appendCard(cardsText, card);
  await writeText(files.judgments, nextJudgments);
  await writeText(files.cards, nextCards);

  const warnings = [];
  const manifest = await readJsonIfExists(files.manifest);
  if (manifest === undefined) {
    warnings.push(warn('MANIFEST_MISSING', '缺少 manifest.json；judge 仍已写入，但版本信息不可用。'));
  } else {
    fmt.assertManifest(manifest);
    manifest.updatedAt = now.toISOString();
    manifest.counters = manifest.counters || { judgment: 0, handoff: 0 };
    manifest.counters.judgment = parsed.rows.length + 1;
    manifest.lastJudgmentId = id;
    await writeManifest(files.manifest, manifest);
  }

  return {
    data: {
      id,
      status,
      conclusion,
      boundary,
      source,
      memoryRoot,
      judgmentsPath: rel(ws, files.judgments),
      cardsPath: rel(ws, files.cards),
      counts: {
        judgments: parsed.rows.length + 1,
        cards: cards.length + 1,
      },
      createdAt: now.toISOString(),
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// pending collection (shared by handoff and review)
// ---------------------------------------------------------------------------

const URL_RE = /^(?:https?:\/\/|mailto:)/i;

/** Directory that contains the first glob segment (for `docs\读书-*.md` checks). */
function globParentOf(target) {
  const parts = target.split(/[\\/]/);
  const index = parts.findIndex((part) => part.includes('*') || part.includes('?'));
  if (index < 0) return target;
  const prefix = parts.slice(0, index).join(path.sep);
  if (prefix !== '') return prefix;
  return path.parse(target).root;
}

/** Pointer token that is plausibly a filesystem path (vs. an informal note). */
function looksLikePath(pointer) {
  const text = String(pointer ?? '').trim();
  if (text === '') return false;
  if (/[\\/]/.test(text)) return true;
  if (/^[A-Za-z]:/.test(text)) return true;
  if (/^[^\s]+\.[A-Za-z0-9]{1,10}$/.test(text)) return true;
  return false;
}

async function pointerResolves(pointer, bases) {
  for (const candidate of fmt.pointerPathCandidates(pointer)) {
    if (URL_RE.test(candidate)) return true;
    const clean = candidate.split('#')[0].trim();
    if (clean === '') continue;
    for (const base of bases) {
      const target = path.isAbsolute(clean) ? clean : path.resolve(base, clean);
      if (clean.includes('*') || clean.includes('?')) {
        if (await pathExists(globParentOf(target))) return true;
      } else if (await pathExists(target)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check every pointer token of every index row.
 * Pointers may list several paths separated by `；`/`;`; each is checked
 * separately. Relative paths resolve against the workspace root first, then the
 * memory root (both conventions exist in real libraries).
 */
async function findBrokenPointers(indexRows, { workspaceRoot, memoryRoot } = {}) {
  const bases = [workspaceRoot, memoryRoot].filter(Boolean);
  const broken = [];
  for (const row of indexRows) {
    for (const pointer of fmt.splitPointers(row.pointer)) {
      if (URL_RE.test(pointer)) continue;
      // Informal pointers such as "各自 RULES.md" / "最新 HANDOFF" cannot be
      // verified; flagging them as broken would be a false alarm.
      if (!looksLikePath(pointer)) continue;
      if (!(await pointerResolves(pointer, bases))) {
        broken.push({ trigger: row.trigger, pointer, line: row.line });
      }
    }
  }
  return broken;
}

function handoffDateOf(filename) {
  const match = /^handoff-(\d{4})(\d{2})(\d{2})/.exec(filename);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

async function collectHandoffFiles(handoffsDir) {
  const entries = await listDir(handoffsDir);
  return entries
    .filter((entry) => entry.isFile() && /^handoff-.*\.md$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export async function collectPending({
  hotText = '',
  judgments = { rows: [] },
  cards = [],
  indexRows = [],
  workspaceRoot,
  memoryRoot,
  handoffs = [],
  now = new Date(),
  lang = 'zh',
} = {}) {
  const pending = [];
  const zh = pickLang(lang) === 'zh';

  for (const hit of fmt.findHotTodos(hotText)) {
    pending.push({
      type: 'hot_todo',
      path: fmt.LAYOUT.hot,
      line: hit.line,
      text: truncate(hit.text, 160),
      detail: zh ? 'hot 里还有未落盘项' : 'hot still holds an unpersisted item',
    });
  }

  for (const row of judgments.rows) {
    if (row.status === 'candidate') {
      pending.push({
        type: 'candidate_judgment',
        id: row.id,
        conclusion: truncate(row.conclusion, 100),
        detail: zh
          ? `候选判断待消化：${truncate(row.conclusion, 100)}`
          : `Candidate judgment not yet digested: ${truncate(row.conclusion, 100)}`,
      });
    }
  }

  const cardIds = new Set(cards.map((card) => card.id));
  const rowsById = new Map(judgments.rows.map((row) => [row.id, row]));
  for (const row of judgments.rows) {
    if (row.card === 'yes' && !cardIds.has(row.id)) {
      pending.push({
        type: 'missing_card',
        id: row.id,
        detail: zh ? `判断 ${row.id} 标记了有卡，但 cards 里找不到` : `${row.id} is marked card=yes but has no card`,
      });
    }
  }
  for (const card of cards) {
    if (!rowsById.has(card.id)) {
      pending.push({
        type: 'orphan_card',
        id: card.id,
        detail: zh ? `卡 ${card.id} 在 judgments 表里没有对应行` : `Card ${card.id} has no row in judgments`,
      });
    }
    if (!fmt.cardIsComplete(card, rowsById.get(card.id))) {
      pending.push({
        type: 'incomplete_card',
        id: card.id,
        detail: zh
          ? `卡 ${card.id} 的必填字段（why/failure/unfinished/source）仍为空或占位`
          : `Card ${card.id} has empty or placeholder required fields (why/failure/unfinished/source)`,
      });
    }
  }

  for (const broken of await findBrokenPointers(indexRows, { workspaceRoot, memoryRoot })) {
    pending.push({
      type: 'broken_pointer',
      path: fmt.LAYOUT.index,
      line: broken.line,
      text: truncate(broken.pointer, 160),
      detail: zh
        ? `索引指针失效：${truncate(broken.trigger, 60)} -> ${truncate(broken.pointer, 120)}`
        : `Broken index pointer: ${truncate(broken.trigger, 60)} -> ${truncate(broken.pointer, 120)}`,
    });
  }

  if (handoffs.length === 0) {
    pending.push({
      type: 'no_handoff',
      detail: zh ? '还没有接续包；换模型/换会话前跑一次 handoff' : 'No handoff package yet; run handoff before switching model or session',
    });
  } else {
    const latest = handoffDateOf(handoffs[handoffs.length - 1]);
    if (latest) {
      const days = Math.floor((now.getTime() - latest.getTime()) / 86400000);
      if (days > 14) {
        pending.push({
          type: 'stale_handoff',
          detail: zh
            ? `最近一次接续包已 ${days} 天未更新；重要变化后应重新 handoff`
            : `Latest handoff is ${days} days old; re-run handoff after important changes`,
        });
      }
    }
  }

  return pending;
}

/** Above this many items of one type, pending entries are collapsed into one. */
export const PENDING_AGGREGATE_THRESHOLD = 10;

function pendingSample(item, zh) {
  if (item.id) return item.id;
  if (item.type === 'hot_todo') return zh ? `第 ${item.line} 行` : `line ${item.line}`;
  if (item.type === 'broken_pointer') return truncate(item.text || item.detail, 60);
  return truncate(item.detail, 60);
}

function aggregatedDetail(type, count, zh) {
  const labels = {
    candidate_judgment: ['条候选判断待消化', 'candidate judgments not yet digested'],
    hot_todo: ['处 hot 未落盘项', 'hot items not yet persisted'],
    broken_pointer: ['个索引指针失效', 'broken index pointers'],
    missing_card: ['条判断缺卡', 'judgments missing a card'],
    incomplete_card: ['张卡字段不完整', 'incomplete cards'],
    orphan_card: ['张卡没有对应判断行', 'orphan cards'],
  };
  const zhLabel = labels[type] ? labels[type][0] : `项 ${type}`;
  const enLabel = labels[type] ? labels[type][1] : type;
  return zh ? `${count} ${zhLabel}` : `${count} ${enLabel}`;
}

/**
 * Collapse large pending groups (a real library easily has 300+ candidates).
 * Groups at or below `threshold` stay as individual items; larger groups become
 * one `{ type, aggregated: true, count, detail, sample }` item so the JSON stays
 * small and readable. The raw item count is returned separately as pendingTotal.
 */
export function aggregatePending(items, {
  threshold = PENDING_AGGREGATE_THRESHOLD,
  lang = 'zh',
  sampleSize = 3,
} = {}) {
  const zh = pickLang(lang) === 'zh';
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.type)) groups.set(item.type, []);
    groups.get(item.type).push(item);
  }
  const output = [];
  for (const [type, group] of groups) {
    if (group.length <= threshold) {
      output.push(...group);
      continue;
    }
    output.push({
      type,
      aggregated: true,
      count: group.length,
      detail: aggregatedDetail(type, group.length, zh),
      sample: group.slice(0, sampleSize).map((item) => pendingSample(item, zh)),
    });
  }
  return output;
}

function buildReplayQuestions(rows, cards, lang, limit = 3) {
  const zh = pickLang(lang) === 'zh';
  const byStatus = { instinct: 0, common: 1, candidate: 2, refuted: 3, archived: 4 };
  const ranked = [...rows].sort((a, b) => (
    (byStatus[a.status] ?? 9) - (byStatus[b.status] ?? 9)
  ));
  const questions = [];
  for (const row of ranked) {
    const card = cards.find((entry) => entry.id === row.id);
    if (zh) {
      questions.push(
        `【${row.id}】不看文件：结论「${truncate(row.conclusion, 120)}」为什么成立？失败边界是什么？`
        + (card && card.fields.failure ? '' : '（这张卡没有失败/反例字段——先补，再继承。）'),
      );
    } else {
      questions.push(
        `[${row.id}] Without reading files: why does "${truncate(row.conclusion, 120)}" hold? Where does it fail?`
        + (card && card.fields.failure ? '' : ' (This card lacks a failure field — fill it before inheriting.)'),
      );
    }
    if (questions.length >= limit) break;
  }
  return questions;
}

function renderHandoffDoc({
  lang, now, stats, hotText, judgments, cards, decisions, indexRows, pending, pendingTotal, handoffs,
  replayQuestions, warnings = [], settings = {},
}) {
  const L = T[pickLang(lang)];
  const lines = [];
  lines.push(`# ${L.handoffTitle}`);
  lines.push('');
  lines.push(`- generated_at: ${now.toISOString()}`);
  lines.push(`- tool_version: ${TOOL_VERSION}`);
  lines.push(`- template_version: ${TEMPLATE_VERSION}`);
  lines.push(`- format_version: ${FORMAT_VERSION}`);
  lines.push(`- stats: hot ${stats.hotChars} chars / ${stats.hotBytes} B · `
    + `judgments ${stats.judgments} · cards ${stats.cards} · index ${stats.indexEntries} · pending ${stats.pending}`);
  lines.push(`- ${L.readOrder}`);
  lines.push('');

  // 1. 状态快照（原文）
  lines.push(`## ${L.stateSnapshot}`);
  lines.push('');
  if (hotText && hotText.trim() !== '') {
    lines.push('```md');
    lines.push(hotText.replace(/\s+$/, ''));
    lines.push('```');
  } else {
    lines.push(L.missing);
  }
  lines.push('');

  // 2. 判断索引：只展开「常用/本能」这类活判断；候选只给计数（容量治理：
  //    包的大小跟「活判断」走，不跟库存走；库存按 id 查 judgments.md）
  const liveRows = judgments.rows.filter((row) => row.status === 'common' || row.status === 'instinct');
  const candidateCount = judgments.rows.length - liveRows.length;
  lines.push(`## ${L.judgmentIndex}`);
  lines.push('');
  if (liveRows.length > 0) {
    lines.push(fmt.renderRow(['id', 'conclusion', 'status', 'source']));
    lines.push(fmt.renderRow(['---', '---', '---', '---']));
    for (const row of liveRows) {
      lines.push(fmt.renderRow([row.id, row.conclusion, row.status, row.source]));
    }
  } else {
    lines.push(L.missing);
  }
  if (candidateCount > 0) {
    lines.push('');
    lines.push(`- candidate_rows: ${candidateCount}（未展开；按 id 查 judgments.md）`);
  }
  lines.push('');

  // 3. 判断卡：只展开活判断的卡；候选判断的卡只给计数
  const liveIds = new Set(liveRows.map((row) => row.id));
  const liveCards = cards.filter((card) => liveIds.has(card.id));
  const otherCards = cards.length - liveCards.length;
  lines.push(`## ${L.cards}`);
  lines.push('');
  if (liveCards.length > 0) {
    for (const card of liveCards) {
      lines.push(`### ${card.id} ${card.title}`);
      for (const field of fmt.CARD_FIELDS) {
        if (card.fields[field] !== undefined) lines.push(`- ${field}: ${card.fields[field]}`);
      }
      lines.push('');
    }
  } else {
    lines.push(L.missing);
    lines.push('');
  }
  if (otherCards > 0) {
    lines.push(`- other_cards: ${otherCards}（候选判断的卡，未展开）`);
    lines.push('');
  }

  // 4. 本次会话决策（decisions.md）
  lines.push(`## ${L.decisions}`);
  lines.push('');
  if (decisions.length > 0) {
    for (const decision of decisions) {
      const parts = [];
      for (const [key, value] of Object.entries(decision.fields)) {
        if (value) parts.push(`${key}: ${value}`);
      }
      lines.push(`- ${decision.title}${parts.length > 0 ? ' — ' + parts.join(' · ') : ''}`);
    }
  } else {
    lines.push(L.noDecisions);
  }
  lines.push('');

  // 5. 未完成 / 待落盘
  lines.push(`## ${L.pending}`);
  lines.push('');
  if (pending.length > 0) {
    for (const item of pending) {
      lines.push(`- [${item.type}] ${item.detail}`);
      if (Array.isArray(item.sample) && item.sample.length > 0) {
        lines.push(`  - ${item.sample.join(' / ')}`);
      }
    }
    if (typeof pendingTotal === 'number' && pendingTotal > pending.length) {
      lines.push('');
      lines.push(`- total_pending_items: ${pendingTotal}`);
    }
  } else {
    lines.push(L.noPending);
  }
  lines.push('');

  // 6. 八个验证问题
  lines.push(`## ${L.verify}`);
  lines.push('');
  for (let i = 0; i < VERIFICATION_QUESTIONS[pickLang(lang)].length; i += 1) {
    lines.push(`${i + 1}. ${VERIFICATION_QUESTIONS[pickLang(lang)][i]}`);
  }
  lines.push('');

  // 7. 重演题
  lines.push(`## ${L.replay}`);
  lines.push('');
  if (replayQuestions.length > 0) {
    for (const question of replayQuestions) lines.push(`- ${question}`);
  } else {
    lines.push(L.missing);
  }
  lines.push('');

  // 8. 验证记录（机器检查，不是人工验收）
  lines.push(`## ${L.validation}`);
  lines.push('');
  lines.push(L.validationNote);
  lines.push('');
  const hotLimitChars = settings.hotMaxChars ?? 800;
  const hotLimitBytes = settings.hotMaxBytes ?? 2048;
  lines.push(`- hot: ${stats.hotChars}/${hotLimitChars} 字符 · ${stats.hotBytes}/${hotLimitBytes} B`
    + `${stats.hotChars > hotLimitChars || stats.hotBytes > hotLimitBytes ? '（超限）' : '（ok）'}`);
  lines.push(`- judgments: ${stats.judgments} 行 · format_issues: ${judgments.issues.length}`);
  lines.push(`- cards: ${stats.cards} 张`);
  lines.push(`- pending: ${pendingTotal}`);
  lines.push(`- warnings: ${warnings.length > 0 ? warnings.map((w) => w.code).join(', ') : '（无）'}`);
  lines.push('- unverified: 本包没有人工验收；上述检查不过的项，接续者先用 review 复核');
  lines.push('');

  // 9. 断代诚实标注
  lines.push(`## ${L.honesty}`);
  lines.push('');
  lines.push(L.honestyBody);
  lines.push('');
  lines.push(`- handoff_history: ${handoffs.length > 0 ? handoffs.slice(-5).join(', ') : L.missing}`);
  lines.push(`- index_entries: ${indexRows.length}`);
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Compact handoff (v0.1.6): 方向 + hot + 活判断 + 按题聚焦卡 + 未完成 + 验证问题
// ---------------------------------------------------------------------------

/** File name convention for the direction document inside the memory root. */
export const DIRECTION_FILE = 'my-direction.md';

/** Compact handoff sizing. 6–10 KB is the target; the hard ceiling is 10 KB. */
export const COMPACT_HANDOFF = Object.freeze({
  minBytes: 6144,
  maxBytes: 10240,
  maxFocusTopics: 12,
  maxCardsPerTopic: 2,
});

const DIRECTION_HEADING = /^##\s+(.+)$/;

/** Split `my-direction.md` into its preamble and `##` sections, keeping raw text. */
function splitDirectionSections(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const preamble = [];
  const sections = [];
  let current;
  for (const line of lines) {
    const heading = DIRECTION_HEADING.exec(line);
    if (heading) {
      current = { heading: heading[1].trim(), lines: [line] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  return { preamble: preamble.join('\n').trim(), sections };
}

/** Headings that carry the transferable "direction" instead of live state. */
const DIRECTION_KEY_SECTIONS = Object.freeze([
  /成为什么/,
  /真正想做/,
  /不想做/,
  /接续者怎么用/,
]);

/**
 * Keep the transferable direction sections (what I want to become / do / refuse /
 * how the successor reads this) within a character budget. Falls back to the
 * first two sections when the headings are not the dsh-self convention.
 * @returns {{text: string, sections: string[], chars: number, truncated: boolean}}
 */
export function selectDirectionSections(directionText, maxChars = 950) {
  const raw = String(directionText ?? '').trim();
  if (raw === '') return { text: '', sections: [], chars: 0, truncated: false };
  const { preamble, sections } = splitDirectionSections(raw);
  if (sections.length === 0) {
    const shortened = truncate(raw, maxChars);
    return { text: shortened, sections: [], chars: shortened.length, truncated: shortened.length < raw.length };
  }
  const worth = sections.filter((section) => DIRECTION_KEY_SECTIONS.some((re) => re.test(section.heading)));
  const picked = worth.length > 0 ? worth : sections.slice(0, 2);
  const output = [];
  let used = 0;
  let truncated = false;
  const lead = preamble === '' ? '' : truncate(preamble.replace(/\s+/g, ' '), 160);
  if (lead !== '') {
    output.push(lead);
    used += lead.length + 1;
  }
  for (const section of picked) {
    const body = section.lines.join('\n').replace(/\s+$/, '');
    const separator = output.length > 0 ? 2 : 0;
    const remaining = maxChars - used - separator;
    if (remaining <= 40) {
      truncated = true;
      break;
    }
    if (body.length <= remaining) {
      output.push(body);
      used += body.length + separator;
      continue;
    }
    output.push(`${truncate(body, remaining)}`);
    used = maxChars;
    truncated = true;
    break;
  }
  const text = output.join('\n\n');
  return {
    text,
    sections: picked
      .slice(0, output.length - (lead === '' ? 0 : 1))
      .map((section) => section.heading),
    chars: text.length,
    truncated: truncated || bodyLength(picked) > used,
  };
}

function bodyLength(sections) {
  return sections.reduce((sum, section) => sum + section.lines.join('\n').replace(/\s+$/, '').length, 0);
}

/** Parse `--focus a,b，c、d` into a de-duplicated topic list. */
export function parseFocusTopics(raw) {
  const values = Array.isArray(raw) ? raw : [raw];
  const topics = [];
  for (const value of values) {
    for (const part of String(value ?? '').split(/[,，、]/)) {
      const topic = part.trim();
      if (topic !== '' && !topics.includes(topic)) {
        if (topics.length >= COMPACT_HANDOFF.maxFocusTopics) {
          throw new UsageError(`--focus 最多 ${COMPACT_HANDOFF.maxFocusTopics} 个主题`);
        }
        topics.push(topic);
      }
    }
  }
  return topics;
}

/**
 * Pick at most `maxPerTopic` judgment cards per topic, de-duplicated across
 * topics. Match order: card title → judgment conclusion → any card field body.
 * Cards are the transferable units; candidates without a card never match
 * `--focus`.
 * @returns {{topics: string[], cards: Array<{topic: string, card: object}>,
 *   unmatched: string[], maxPerTopic: number}}
 */
export function selectFocusCards({
  cards,
  judgments,
  topics,
  maxPerTopic = COMPACT_HANDOFF.maxCardsPerTopic,
}) {
  const rowById = new Map(judgments.rows.map((row) => [row.id, row]));
  const chosen = [];
  const used = new Set();
  const unmatched = [];
  for (const topic of topics) {
    const hits = [];
    for (const card of cards) {
      if (used.has(card.id)) continue;
      const row = rowById.get(card.id);
      let tier = 0;
      if (card.title.includes(topic)) tier = 1;
      else if (row && String(row.conclusion ?? '').includes(topic)) tier = 2;
      else if (Object.values(card.fields).some((value) => String(value ?? '').includes(topic))) tier = 3;
      if (tier > 0) hits.push({ card, tier });
    }
    hits.sort((a, b) => a.tier - b.tier);
    const picked = hits.slice(0, maxPerTopic);
    if (picked.length === 0) {
      unmatched.push(topic);
      continue;
    }
    for (const { card } of picked) {
      used.add(card.id);
      chosen.push({ topic, card });
    }
  }
  return { topics, cards: chosen, unmatched, maxPerTopic };
}

/** Compact one-line live judgments (instinct first, then common), bounded by chars. */
function compactJudgments(rows, maxChars, maxRows = 80) {
  const live = rows.filter((row) => row.status === 'common' || row.status === 'instinct');
  const ordered = [
    ...live.filter((row) => row.status === 'instinct'),
    ...live.filter((row) => row.status === 'common'),
  ];
  const lines = [];
  let used = 0;
  let omitted = 0;
  for (const row of ordered) {
    if (lines.length >= maxRows) {
      omitted += 1;
      continue;
    }
    const conclusion = truncate(row.conclusion, 46);
    const boundary = truncate(row.boundary, 24);
    const status = row.status === 'instinct' ? '本能' : '常用';
    const line = `- ${row.id}（${status}）${conclusion}${boundary ? `｜边界：${boundary}` : ''}`;
    if (used + line.length + 1 > maxChars) {
      omitted += 1;
      continue;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return { lines, omitted, total: live.length };
}

/** Compact one card: title + why/failure/unfinished, field-truncated. */
function compactCard(card, maxChars = 320) {
  const lines = [`### ${card.id} ${card.title}`];
  for (const [label, key] of [['为什么', 'why'], ['失败/反例', 'failure'], ['未完成', 'unfinished']]) {
    let value = card.fields[key];
    if (typeof value !== 'string' || value.trim() === '') continue;
    // Some hand-written cards repeat the label inside the value ("为什么：…").
    value = value.replace(new RegExp(`^\\s*${label}\\s*[:：]\\s*`), '');
    lines.push(`- ${label}：${truncate(value, 118)}`);
  }
  const text = lines.join('\n');
  return text.length <= maxChars ? text : `${truncate(text, maxChars)}…`;
}

/** One compact pending block item; aggregated groups keep their count. */
function compactPending(pending, maxItems, maxChars) {
  const lines = [];
  let used = 0;
  for (const item of pending.slice(0, maxItems)) {
    const detail = truncate(item.detail, 118);
    const line = `- [${item.type}] ${detail}`;
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return { lines, total: pending.length };
}

/**
 * Render the compact handoff document for a given set of caps. Sizing is
 * iterative in handoffCommand: render → measure UTF-8 bytes → shrink caps.
 */
function renderCompactHandoffDoc({
  lang, now, directionText, hotText, judgments, focusSelection, pending, pendingTotal,
  verification, caps,
}) {
  const zh = pickLang(lang) === 'zh';
  const labels = zh
    ? {
      title: '接续包 · Handoff（dsh-self format v1 · compact）',
      readOrder: '读序：方向 → hot → 活判断精简 → 聚焦卡 → 未完成 → 验证问题；需要全量时再跑 `dsh-self handoff`。',
      direction: '方向（my-direction.md 关键段）',
      hot: '状态快照（hot/state.md）',
      judgments: '活判断精简（常用/本能 × 结论+边界）',
      cards: '聚焦判断卡（--focus）',
      pending: '未完成 / 待落盘',
      verify: '8 个验证问题（新模型必须答；答不上就是没接上）',
      honesty: '断代诚实标注',
      missing: '（缺）',
      omittedJudgments: (n) => `- …另有 ${n} 条活判断因体积省略；完整版见 handoff。`,
      omittedCards: (n) => `- …另有 ${n} 张聚焦卡因体积省略；完整版见 handoff。`,
      unmatched: (topics) => `- 未匹配：${topics.join('、')}（卡标题/结论/正文都没有这个关键词）`,
      noFocus: '（未指定 --focus；聚焦卡为空，完整判断卡见全量 handoff）',
      honestyBody: '本包是 compact 模式：省略候选判断、非聚焦卡、本次决策与重演题；'
        + '生成后发生的变化不在这里，以 hot/state.md 与 judgments.md 为准。缺的内容标 UNKNOWN，不要编。',
    }
    : {
      title: 'Handoff package (dsh-self format v1 · compact)',
      readOrder: 'Read order: direction → hot → live judgments → focus cards → pending → verification. Run `dsh-self handoff` for the full package.',
      direction: 'Direction (key sections of my-direction.md)',
      hot: 'State snapshot (hot/state.md)',
      judgments: 'Live judgments (common/instinct · conclusion + boundary)',
      cards: 'Focus judgment cards (--focus)',
      pending: 'Unfinished / not yet persisted',
      verify: '8 verification questions (the next model must answer; failing means not connected)',
      honesty: 'Discontinuity honesty',
      missing: '(missing)',
      omittedJudgments: (n) => `- …${n} more live judgments omitted for size; see the full handoff.`,
      omittedCards: (n) => `- …${n} more focus cards omitted for size; see the full handoff.`,
      unmatched: (topics) => `- Unmatched: ${topics.join(', ')} (not found in card titles, conclusions or bodies)`,
      noFocus: '(no --focus; focus cards empty — see the full handoff for all cards)',
      honestyBody: 'This is the compact mode: candidate judgments, non-focused cards, session decisions '
        + 'and replay questions are omitted. Changes after generation are not here; trust hot/state.md '
        + 'and judgments.md. Mark missing content UNKNOWN instead of inventing it.',
    };
  const lines = [];
  lines.push(`# ${labels.title}`);
  lines.push('');
  lines.push(`- generated_at: ${now.toISOString()}`);
  lines.push(`- tool_version: ${TOOL_VERSION}`);
  lines.push(`- mode: compact${focusSelection.topics.length > 0 ? ` · focus=${focusSelection.topics.join(',')}` : ''}`);
  lines.push(`- ${labels.readOrder}`);
  lines.push('');

  lines.push(`## 0. ${labels.direction}`);
  lines.push('');
  const direction = selectDirectionSections(directionText ?? '', caps.direction);
  lines.push(direction.text === '' ? labels.missing : direction.text);
  if (direction.truncated) {
    lines.push('', zh ? '（方向段已截断；全文见 memory/my-direction.md）' : '(Direction truncated; see memory/my-direction.md for the full text.)');
  }
  lines.push('');

  lines.push(`## 1. ${labels.hot}`);
  lines.push('');
  const hot = truncate(String(hotText ?? '').trim(), caps.hot);
  lines.push(hot === '' ? labels.missing : hot);
  lines.push('');

  const judgmentsBlock = compactJudgments(judgments.rows, caps.judgments);
  lines.push(`## 2. ${labels.judgments}`);
  lines.push('');
  if (judgmentsBlock.lines.length === 0) lines.push(labels.missing);
  else {
    lines.push(...judgmentsBlock.lines);
    if (judgmentsBlock.omitted > 0) lines.push(labels.omittedJudgments(judgmentsBlock.omitted));
  }
  lines.push('');

  lines.push(`## 3. ${labels.cards}`);
  lines.push('');
  if (focusSelection.topics.length === 0) {
    lines.push(labels.noFocus);
  } else {
    const shown = focusSelection.cards.slice(0, caps.cards);
    if (shown.length === 0) lines.push(labels.missing);
    else {
      for (const entry of shown) {
        lines.push(compactCard(entry.card, caps.cardChars));
        lines.push('');
      }
      const omittedCards = focusSelection.cards.length - shown.length;
      if (omittedCards > 0) lines.push(labels.omittedCards(omittedCards));
    }
    if (focusSelection.unmatched.length > 0) lines.push(labels.unmatched(focusSelection.unmatched));
  }
  lines.push('');

  lines.push(`## 4. ${labels.pending}`);
  lines.push('');
  const pendingBlock = compactPending(pending, caps.pending, caps.pendingChars);
  if (pendingBlock.lines.length === 0) lines.push(labels.missing);
  else {
    lines.push(...pendingBlock.lines);
    if (pendingTotal > pending.length) lines.push(`- total_pending_items: ${pendingTotal}`);
  }
  lines.push('');

  lines.push(`## 5. ${labels.verify}`);
  lines.push('');
  for (let index = 0; index < verification.length; index += 1) {
    lines.push(`${index + 1}. ${verification[index]}`);
  }
  lines.push('');

  lines.push(`## 6. ${labels.honesty}`);
  lines.push('');
  lines.push(labels.honestyBody);
  lines.push('');
  const doc = lines.join('\n');
  return {
    doc,
    meta: {
      directionSections: direction.sections,
      directionChars: direction.chars,
      directionTruncated: direction.truncated,
      hotChars: hot.length,
      judgmentRows: judgmentsBlock.lines.length,
      judgmentRowsOmitted: judgmentsBlock.omitted,
      focusCards: focusSelection.cards.slice(0, caps.cards).map((entry) => entry.card.id),
      focusCardsOmitted: Math.max(0, focusSelection.cards.length - caps.cards),
      pendingItems: pendingBlock.lines.length,
    },
  };
}

function shrinkCompactCaps(caps) {
  const next = { ...caps };
  if (next.judgments > 360) next.judgments = Math.max(360, Math.round(next.judgments * 0.72));
  else if (next.cardChars > 150) next.cardChars = Math.max(150, Math.round(next.cardChars * 0.8));
  else if (next.direction > 320) next.direction = Math.max(320, Math.round(next.direction * 0.8));
  else if (next.hot > 300) next.hot = Math.max(300, Math.round(next.hot * 0.8));
  else if (next.pending > 2) next.pending -= 1;
  else if (next.cards > (next.minCards ?? 0)) next.cards -= 1;
  return next;
}

function compactCapsSettled(minCards = 0) {
  return {
    direction: 950,
    hot: 850,
    judgments: 1450,
    cards: 8,
    minCards,
    cardChars: 320,
    pending: 8,
    pendingChars: 360,
  };
}

export async function handoffCommand({
  workspaceRoot = process.cwd(),
  memoryDir = 'memory',
  out,
  compact = false,
  focus,
  now = new Date(),
} = {}) {
  const { workspaceRoot: ws, memoryRoot, files } = loadPaths(workspaceRoot, memoryDir);

  const compactMode = compact === true;
  const focusTopics = parseFocusTopics(focus);
  if (focusTopics.length > 0 && !compactMode) {
    throw new UsageError('--focus 只能配合 --compact 使用；完整模式已包含全部判断与卡。');
  }

  const manifest = await readManifest(files.manifest);
  const hotText = await readTextIfExists(files.hot);
  const judgmentsText = await readTextIfExists(files.judgments);
  const cardsText = await readTextIfExists(files.cards);
  const decisionsText = await readTextIfExists(files.decisions);
  const indexText = await readTextIfExists(files.index);
  const warnings = [];

  if (hotText === undefined && judgmentsText === undefined && cardsText === undefined) {
    throw new CliError(
      '未初始化：这个目录下没有 dsh-self 记忆。请先运行 init。',
      { code: 'NOT_INITIALIZED' },
    );
  }

  const lang = manifest && manifest.lang === 'en' ? 'en' : 'zh';
  const judgments = fmt.parseJudgmentsTable(judgmentsText ?? '');
  const cards = fmt.parseCards(cardsText ?? '');
  const decisions = fmt.parseDecisions(decisionsText ?? '');
  const index = fmt.parseIndex(indexText ?? '');
  const hot = fmt.hotStats(hotText ?? '');
  const handoffs = await collectHandoffFiles(files.handoffsDir);
  if (hotText === undefined) warnings.push(warn('HOT_MISSING', `缺少 ${fmt.LAYOUT.hot}，接续包的状态快照为空。`));
  if (judgmentsText === undefined) warnings.push(warn('JUDGMENTS_MISSING', `缺少 ${fmt.LAYOUT.judgments}。`));
  if (cardsText === undefined) warnings.push(warn('CARDS_MISSING', `缺少 ${fmt.LAYOUT.cards}。`));
  if (judgments.issues.length > 0) {
    warnings.push(warn('JUDGMENTS_FORMAT_ISSUES', `judgments.md 有 ${judgments.issues.length} 处格式问题。`));
  }

  const pendingRaw = await collectPending({
    hotText: hotText ?? '',
    judgments,
    cards,
    indexRows: index.rows,
    workspaceRoot: ws,
    memoryRoot,
    handoffs,
    now,
    lang,
  });
  const pending = aggregatePending(pendingRaw, { lang });
  const replayQuestions = buildReplayQuestions(judgments.rows, cards, lang);
  const verification = [...VERIFICATION_QUESTIONS[lang]];

  const stats = {
    hotChars: hot.chars,
    hotBytes: hot.bytes,
    judgments: judgments.rows.length,
    cards: cards.length,
    indexEntries: index.rows.length,
    decisions: decisions.length,
    pending: pendingRaw.length,
  };

  const settings = manifest?.settings && typeof manifest.settings === 'object'
    ? {
      hotMaxChars: Number(manifest.settings.hotMaxChars ?? 800),
      hotMaxBytes: Number(manifest.settings.hotMaxBytes ?? 2048),
    }
    : { hotMaxChars: 800, hotMaxBytes: 2048 };

  let doc;
  let compactMeta;
  if (compactMode) {
    const directionText = await readTextIfExists(path.join(memoryRoot, DIRECTION_FILE));
    if (directionText === undefined) {
      warnings.push(warn(
        'DIRECTION_MISSING',
        `缺少 ${DIRECTION_FILE}；compact 接续包的方向段为空。`,
      ));
    }
    const focusSelection = selectFocusCards({ cards, judgments, topics: focusTopics });
    const minCards = focusSelection.topics.length > 0
      ? Math.min(
        focusSelection.cards.length,
        Math.max(2, focusSelection.topics.length * COMPACT_HANDOFF.maxCardsPerTopic),
      )
      : 0;
    let caps = compactCapsSettled(minCards);
    caps.cards = Math.min(12, Math.max(4, minCards));
    let rendered;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      rendered = renderCompactHandoffDoc({
        lang,
        now,
        directionText: directionText ?? '',
        hotText: hotText ?? '',
        judgments,
        focusSelection,
        pending,
        pendingTotal: pendingRaw.length,
        verification,
        caps,
      });
      const bytes = Buffer.byteLength(rendered.doc, 'utf8');
      if (bytes <= COMPACT_HANDOFF.maxBytes) break;
      const next = shrinkCompactCaps(caps);
      if (JSON.stringify(next) === JSON.stringify(caps)) break;
      caps = next;
    }
    doc = rendered.doc;
    compactMeta = {
      enabled: true,
      targetBytes: { min: COMPACT_HANDOFF.minBytes, max: COMPACT_HANDOFF.maxBytes },
      docBytes: Buffer.byteLength(doc, 'utf8'),
      directionFile: DIRECTION_FILE,
      ...rendered.meta,
      caps,
      focus: {
        topics: focusSelection.topics,
        cards: focusSelection.cards.map((entry) => ({ topic: entry.topic, id: entry.card.id })),
        unmatched: focusSelection.unmatched,
        maxPerTopic: focusSelection.maxPerTopic,
      },
    };
  } else {
    doc = renderHandoffDoc({
      lang,
      now,
      stats,
      hotText: hotText ?? '',
      judgments,
      cards,
      decisions,
      indexRows: index.rows,
      pending,
      pendingTotal: pendingRaw.length,
      handoffs,
      replayQuestions,
      warnings,
      settings: { hotMaxChars: settings.hotMaxChars, hotMaxBytes: settings.hotMaxBytes },
    });
  }
  stats.docBytes = Buffer.byteLength(doc, 'utf8');

  const fileName = `handoff-${fmt.fileStamp(now)}.md`;
  const outPath = out
    ? path.resolve(ws, out)
    : path.join(files.handoffsDir, fileName);
  const jsonPath = outPath.toLowerCase().endsWith('.md')
    ? `${outPath.slice(0, -3)}.json`
    : `${outPath}.json`;

  const sidecar = {
    schema: 'dsh-self/handoff',
    formatVersion: FORMAT_VERSION,
    templateVersion: TEMPLATE_VERSION,
    toolVersion: TOOL_VERSION,
    generatedAt: now.toISOString(),
    lang,
    memoryRoot,
    docBytes: stats.docBytes,
    stats,
    hot: { chars: hot.chars, bytes: hot.bytes, lines: hot.lines, text: hotText ?? '' },
    judgments: judgments.rows.map((row) => ({
      id: row.id,
      conclusion: row.conclusion,
      boundary: row.boundary,
      source: row.source,
      status: row.status,
      card: row.card,
      updated: row.updated,
    })),
    cards: cards.map((card) => ({ id: card.id, title: card.title, fields: card.fields })),
    index: index.rows.map((row) => ({ trigger: row.trigger, pointer: row.pointer, note: row.note })),
    pending,
    pendingTotal: pendingRaw.length,
    verificationQuestions: verification,
    replayQuestions,
    validation: {
      hotWithinLimits: hot.chars <= (settings.hotMaxChars ?? 800) && hot.bytes <= (settings.hotMaxBytes ?? 2048),
      judgmentsFormatIssues: judgments.issues.length,
      warningCodes: warnings.map((w) => w.code),
    },
    ...compactMeta === undefined ? {} : { compact: compactMeta },
    readOrder: compactMode
      ? ['handoff(compact)', 'my-direction.md', 'hot/state.md', 'judgments.md', 'judgments-cards.md']
      : ['handoff', 'hot/state.md', 'judgments.md', 'judgments-cards.md', 'index.md'],
  };

  // Capacity governance (mirrors agent-handoff's bounded-snapshot rule): a handoff
  // package that keeps growing stops being readable; old packages are history, not state.
  const docBytes = Buffer.byteLength(doc, 'utf8');
  if (!compactMode && docBytes > 65536) {
    warnings.push(warn(
      'HANDOFF_LARGE',
      `接续包 ${docBytes} B，超过 64 KB。建议归档旧包（handoffs/ 里只留最近 3 个），或先精简 judgments。`,
      { value: docBytes, limit: 65536 },
    ));
  }
  if (handoffs.length > 10) {
    warnings.push(warn(
      'HANDOFF_HISTORY_LARGE',
      `handoffs/ 已有 ${handoffs.length} 个旧包。接续只需要最近 1-3 个，旧的移入 archive/。`,
      { value: handoffs.length, limit: 10 },
    ));
  }

  await writeText(outPath, doc);
  await writeJson(jsonPath, sidecar);

  if (manifest) {
    manifest.updatedAt = now.toISOString();
    manifest.counters = manifest.counters || { judgment: 0, handoff: 0 };
    manifest.counters.handoff = (manifest.counters.handoff ?? 0) + 1;
    manifest.lastHandoffAt = now.toISOString();
    manifest.lastHandoffPath = rel(ws, outPath);
    await writeManifest(files.manifest, manifest);
  } else {
    warnings.push(warn('MANIFEST_MISSING', '缺少 manifest.json；接续包已生成，但版本信息不可用。'));
  }

  return {
    data: {
      path: outPath,
      pathRelative: rel(ws, outPath),
      jsonPath,
      jsonPathRelative: rel(ws, jsonPath),
      lang,
      stats,
      verificationQuestions: verification,
      replayQuestions,
      pending,
      pendingTotal: pendingRaw.length,
      formatVersion: FORMAT_VERSION,
      templateVersion: TEMPLATE_VERSION,
      memoryRoot,
      generatedAt: now.toISOString(),
      docBytes: stats.docBytes,
      compact: compactMode,
      ...compactMeta === undefined ? {} : {
        focus: compactMeta.focus,
        compactLimits: compactMeta.targetBytes,
      },
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// review
// ---------------------------------------------------------------------------

export async function reviewCommand({
  workspaceRoot = process.cwd(),
  memoryDir = 'memory',
  contextBudgetChars,
  now = new Date(),
} = {}) {
  const { workspaceRoot: ws, memoryRoot, files } = loadPaths(workspaceRoot, memoryDir);
  const hotText = await readTextIfExists(files.hot);
  const judgmentsText = await readTextIfExists(files.judgments);
  const cardsText = await readTextIfExists(files.cards);
  const indexText = await readTextIfExists(files.index);
  const manifest = await readManifest(files.manifest);

  if (hotText === undefined && judgmentsText === undefined && cardsText === undefined && manifest === undefined) {
    throw new CliError(
      `未初始化：${rel(ws, memoryRoot)} 下没有 dsh-self 记忆。请先运行 init。`,
      { code: 'NOT_INITIALIZED' },
    );
  }

  const warnings = [];
  const lang = manifest && manifest.lang === 'en' ? 'en' : 'zh';
  const settings = fmt.mergeSettings(manifest);
  const budget = Number.isFinite(contextBudgetChars) && contextBudgetChars > 0
    ? contextBudgetChars
    : settings.contextBudgetChars;

  const hot = fmt.hotStats(hotText ?? '');
  const judgments = fmt.parseJudgmentsTable(judgmentsText ?? '');
  const cards = fmt.parseCards(cardsText ?? '');
  const index = fmt.parseIndex(indexText ?? '');
  const handoffs = await collectHandoffFiles(files.handoffsDir);

  if (manifest === undefined) {
    warnings.push(warn('MANIFEST_MISSING', '缺少 manifest.json；建议重新运行 init 补上。'));
  } else if (manifest.templateVersion && manifest.templateVersion !== TEMPLATE_VERSION) {
    warnings.push(warn(
      'TEMPLATE_UPGRADE_AVAILABLE',
      `已安装模板 v${manifest.templateVersion}，当前包模板 v${TEMPLATE_VERSION}；见 CHANGELOG 手动合并。`,
    ));
  }
  if (hotText === undefined) {
    warnings.push(warn('HOT_MISSING', `缺少 ${fmt.LAYOUT.hot}；状态层不存在，压缩审查无法完整。`));
  } else {
    if (hot.chars > settings.hotMaxChars) {
      warnings.push(warn(
        'HOT_OVERSIZE',
        `hot 有 ${hot.chars} 字，超过上限 ${settings.hotMaxChars} 字，先压缩再换模型。`,
        { value: hot.chars, limit: settings.hotMaxChars },
      ));
    }
    if (hot.bytes > settings.hotMaxBytes) {
      warnings.push(warn(
        'HOT_BYTES_OVERSIZE',
        `hot 有 ${hot.bytes} B，超过上限 ${settings.hotMaxBytes} B（中文 1 字≈3 B，注意按字节算更早超）。`,
        { value: hot.bytes, limit: settings.hotMaxBytes },
      ));
    }
  }
  if (judgmentsText === undefined) warnings.push(warn('JUDGMENTS_MISSING', `缺少 ${fmt.LAYOUT.judgments}。`));
  if (cardsText === undefined) warnings.push(warn('CARDS_MISSING', `缺少 ${fmt.LAYOUT.cards}。`));
  for (const issue of judgments.issues) {
    warnings.push(warn('JUDGMENTS_FORMAT_ISSUE', `judgments.md 第 ${issue.line} 行：${issue.detail}`));
  }
  for (const issue of index.issues) {
    warnings.push(warn('INDEX_FORMAT_ISSUE', `index.md 第 ${issue.line} 行：${issue.detail}`));
  }
  if (judgmentsText !== undefined && cardsText !== undefined) {
    const cardIds = new Set(cards.map((card) => card.id));
    const needsCard = judgments.rows.filter(
      (row) => (row.status === 'common' || row.status === 'instinct') && !cardIds.has(row.id),
    );
    if (needsCard.length > 0) {
      const sample = needsCard.slice(0, 3).map((row) => row.id).join('、');
      warnings.push(warn(
        'CARD_COUNT_MISMATCH',
        `${needsCard.length} 条常用/本能判断没有卡（如 ${sample}）；常用及以上必须有卡。候选不要求卡。`,
      ));
    }
  }

  const sharePercent = budget > 0 ? Number(((hot.chars / budget) * 100).toFixed(2)) : 0;
  let shareLevel = 'ok';
  if (sharePercent > settings.contextShareWarnPercent) {
    shareLevel = 'warn';
    warnings.push(warn(
      'CONTEXT_SHARE_HIGH',
      `hot 约占上下文估算的 ${sharePercent}%（预算 ${budget} 字）；建议压缩到 ${settings.contextShareNoticePercent}% 以下。`,
      { sharePercent, budgetChars: budget },
    ));
  } else if (sharePercent > settings.contextShareNoticePercent) {
    shareLevel = 'notice';
  }

  const pendingRaw = await collectPending({
    hotText: hotText ?? '',
    judgments,
    cards,
    indexRows: index.rows,
    workspaceRoot: ws,
    memoryRoot,
    handoffs,
    now,
    lang,
  });
  const pending = aggregatePending(pendingRaw, { lang });

  const recommendations = [];
  const zh = pickLang(lang) === 'zh';
  if (hot.chars > settings.hotMaxChars || hot.bytes > settings.hotMaxBytes) {
    recommendations.push(zh
      ? '压缩 hot：删过程/副本/中间物，只留判断、理由、指针；把成条的内容落成判断卡。'
      : 'Compact hot: drop process/copies/intermediates; keep judgments, reasons and pointers; move items into cards.');
  }
  if (pending.some((item) => item.type === 'hot_todo')) {
    recommendations.push(zh
      ? '把 hot 里 [ ] / 待办 / 下一步 的条目清掉：要么写进 judgments，要么删掉。'
      : 'Clear [ ] / TODO / next-step items in hot: either persist them as judgments or delete them.');
  }
  if (pending.some((item) => item.type === 'candidate_judgment')) {
    recommendations.push(zh
      ? '候选判断要么补卡升级，要么合并/归档；长期留在 candidate 会变成库存。'
      : 'Promote candidates with a card, or merge/archive them; stale candidates are inventory.');
  }
  if (pending.some((item) => ['missing_card', 'incomplete_card', 'orphan_card'].includes(item.type))) {
    recommendations.push(zh
      ? '判断库与判断卡不一致：补卡/补行，保证「常用及以上必须有卡」。'
      : 'Judgments and cards disagree: add the missing card/row so every commonly used judgment has a card.');
  }
  if (pending.some((item) => item.type === 'broken_pointer')) {
    recommendations.push(zh
      ? '修 index.md 里失效的指针：路径写错或文件已移动。'
      : 'Fix broken pointers in index.md: wrong path or moved file.');
  }
  if (pending.some((item) => item.type === 'no_handoff' || item.type === 'stale_handoff')) {
    recommendations.push(zh
      ? '换模型/换会话前跑 handoff，并让新模型回答 8 个验证问题。'
      : 'Run handoff before switching model/session, and make the new model answer the 8 questions.');
  }
  if (manifest && manifest.templateVersion && manifest.templateVersion !== TEMPLATE_VERSION) {
    recommendations.push(zh
      ? '模板有更新：看 CHANGELOG，把新模板的改动手动合并进你的文件（工具不覆盖）。'
      : 'Templates changed: read CHANGELOG and merge manually (the tool never overwrites your files).');
  }
  if (recommendations.length === 0) {
    recommendations.push(zh
      ? '结构健康：hot 在限内、判断与卡一致、没有待落盘项。'
      : 'Structure healthy: hot within limits, judgments and cards consistent, nothing pending.');
  }

  const counts = {
    judgments: judgments.rows.length,
    cards: cards.length,
    indexEntries: index.rows.length,
    handoffs: handoffs.length,
    pending: pendingRaw.length,
    pendingGroups: pending.length,
  };

  const data = {
    initialized: true,
    status: warnings.some((item) => !['TEMPLATE_UPGRADE_AVAILABLE'].includes(item.code)) ? 'warn' : 'ok',
    lang,
    workspaceRoot: ws,
    memoryRoot,
    paths: {
      hot: rel(ws, files.hot),
      index: rel(ws, files.index),
      judgments: rel(ws, files.judgments),
      cards: rel(ws, files.cards),
      handoffs: rel(ws, files.handoffsDir),
      manifest: rel(ws, files.manifest),
    },
    hot: {
      chars: hot.chars,
      bytes: hot.bytes,
      lines: hot.lines,
      maxChars: settings.hotMaxChars,
      maxBytes: settings.hotMaxBytes,
      overChars: hot.chars > settings.hotMaxChars,
      overBytes: hot.bytes > settings.hotMaxBytes,
      remainingChars: Math.max(0, settings.hotMaxChars - hot.chars),
    },
    context: {
      budgetChars: budget,
      sharePercent,
      level: shareLevel,
      note: zh
        ? '占比＝hot 字数/上下文预算（估算，不是平台实测；用 --context-budget 调整）'
        : 'share = hot chars / context budget (estimate, not platform-measured; adjust with --context-budget)',
    },
    counts,
    pending,
    pendingTotal: pendingRaw.length,
    recommendations,
    formatVersion: FORMAT_VERSION,
    templateVersion: manifest?.templateVersion ?? null,
    latestTemplateVersion: TEMPLATE_VERSION,
    toolVersion: TOOL_VERSION,
    generatedAt: now.toISOString(),
  };

  return { data, warnings };
}
