// Format lock v1 — the single source of truth for dsh-self memory files.
//
// Everything a third-party plugin needs to read or write the locked format lives
// here: file layout, column names, status enum, markers, parsers and serializers.
// docs/FORMAT.md is the human-readable contract; keep both in sync.

import { FormatError, UsageError } from './fsx.js';
import { FORMAT_VERSION, TEMPLATE_VERSION, TOOL_VERSION } from './version.js';

export { FORMAT_VERSION, TEMPLATE_VERSION };

/** Locked layout, relative to the memory root. */
export const LAYOUT = Object.freeze({
  hot: 'hot/state.md',
  index: 'index.md',
  judgments: 'judgments.md',
  cards: 'judgments-cards.md',
  decisions: 'decisions.md',
  handoffs: 'handoffs',
  meta: '.dsh-self/manifest.json',
  quickstart: 'QUICKSTART.md',
});

/** Locked judgment status enum. */
export const STATUSES = Object.freeze(['candidate', 'common', 'instinct', 'refuted', 'archived']);

/** 中文状态别名（宽进：老库/中文本地化用中文状态）。 */
export const STATUS_ALIASES = Object.freeze({
  '候选': 'candidate', '常用': 'common', '本能': 'instinct',
  '降级': 'refuted', '降级（限场景）': 'refuted', '降级（应为评估项）': 'refuted',
  '反驳': 'refuted', '归档': 'archived', '存档': 'archived',
});

/** 把中文/混写状态归一化到枚举；不认识的原样返回。 */
export function normalizeStatus(value) {
  const raw = String(value ?? '').trim();
  const first = raw.split(/[｜|]/)[0].trim();
  if (STATUSES.includes(first)) return first;
  const mapped = STATUS_ALIASES[first];
  if (mapped) return mapped;
  if (raw.startsWith('降级')) return 'refuted';
  return first;
}

export const SCHEMA = 'dsh-self/memory';

export const JUDGMENT_COLUMNS = Object.freeze([
  'id', 'conclusion', 'boundary', 'source', 'status', 'card', 'updated',
]);

// 5 列旧格式（中文表头）兼容：老用户的 judgments.md 只有 5 列，读进来时 card/updated 置空。
const JUDGMENT_COLUMNS_LEGACY = Object.freeze([
  'id', '判断', '边界/反例', '来源', '状态/上次用',
]);
export const INDEX_COLUMNS = Object.freeze(['trigger', 'pointer', 'note']);
export const INDEX_COLUMNS_LEGACY = Object.freeze(['触发', '指针', '说明']);

export const JUDGMENTS_BEGIN = '<!-- dsh-self:v1:judgments:begin -->';
export const JUDGMENTS_END = '<!-- dsh-self:v1:judgments:end -->';
export const CARDS_BEGIN = '<!-- dsh-self:v1:cards:begin -->';
export const CARDS_END = '<!-- dsh-self:v1:cards:end -->';

export const CARD_FIELDS = Object.freeze(['why', 'failure', 'unfinished', 'source', 'scene', 'created', 'updated']);
export const CARD_REQUIRED_FIELDS = Object.freeze(['why', 'failure', 'unfinished', 'source']);

/**
 * Card field aliases: canonical English name <- English or Chinese label.
 * Hand-written cards commonly use `- **为什么**：…`; the parser accepts both
 * the locked English form and these Chinese labels (宽进 / strict-out).
 */
export const CARD_FIELD_ALIASES = Object.freeze({
  why: 'why',
  '为什么': 'why',
  '原因': 'why',
  '理由': 'why',
  failure: 'failure',
  '失败': 'failure',
  '失败/反例': 'failure',
  '失败/边界': 'failure',
  '反例': 'failure',
  '边界': 'failure',
  unfinished: 'unfinished',
  '未完成': 'unfinished',
  '待完成': 'unfinished',
  source: 'source',
  '来源': 'source',
  '源': 'source',
  '来源指针': 'source',
  scene: 'scene',
  '场景': 'scene',
  created: 'created',
  '创建': 'created',
  '创建时间': 'created',
  updated: 'updated',
  '更新': 'updated',
  '更新时间': 'updated',
});

export const TEMPLATE_MARKER = /<!--\s*dsh-self template=v(\d+\.\d+\.\d+) format=(\d+)\s*-->/;

/** Lines in hot/state.md that count as "not yet flushed to disk". */
export const PENDING_PATTERNS = Object.freeze([
  { type: 'checkbox', re: /^\s*[-*]\s*\[\s*\]/ },
  { type: 'todo', re: /\bTODO\b/i },
  { type: 'fixme', re: /\bFIXME\b/i },
  { type: 'pending-en', re: /\bpending\b/i },
  { type: 'todo-zh', re: /待办/ },
  { type: 'next-zh', re: /下一步/ },
  { type: 'unfinished-zh', re: /未完成/ },
  { type: 'tbd-zh', re: /待定/ },
  { type: 'tbd2-zh', re: /待补/ },
]);

export const PLACEHOLDER_RE = /（空）|\(empty\)|待补|待定|TODO|FIXME/i;

export const ID_RE = /^J\d{3,}$/;

// ---------------------------------------------------------------------------
// text helpers
// ---------------------------------------------------------------------------

/** Remove HTML comments (single and multi line) from markdown. */
export function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

/** Normalize one human/JSON value into a single markdown-safe line. */
export function normalizeOneLine(value, { field, required = true, maxLength = 2000 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new UsageError(`缺少字段：${field}`);
    return undefined;
  }
  if (typeof value !== 'string') throw new UsageError(`${field} 必须是字符串`);
  const normalized = value.replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim();
  if (required && normalized === '') throw new UsageError(`${field} 不能为空`);
  if (normalized.length > maxLength) {
    throw new UsageError(`${field} 太长（${normalized.length} > ${maxLength} 字符）`);
  }
  return normalized;
}

export function assertStatus(status) {
  const value = normalizeOneLine(status ?? 'candidate', { field: 'status', maxLength: 32 }).toLowerCase();
  if (!STATUSES.includes(value)) {
    throw new UsageError(`status 只支持：${STATUSES.join(' / ')}（收到 ${value}）`);
  }
  return value;
}

export function escapeCell(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/** Split one markdown table row into raw cell values (backslash-aware). */
export function splitTableRow(row) {
  let text = row.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells = [];
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\\' && i + 1 < text.length && (text[i + 1] === '|' || text[i + 1] === '\\')) {
      current += text[i + 1];
      i += 1;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

export function renderRow(cells) {
  return `| ${cells.map(escapeCell).join(' | ')} |`;
}

function isSeparatorRow(row) {
  const cells = splitTableRow(row);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

/**
 * Locate a markdown table whose header equals `columns`.
 * Returns rows (raw cell arrays, separator skipped) with 1-based line numbers.
 */
export function parseTable(text, columns) {
  const lines = text.split(/\r?\n/);
  let headerLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim().startsWith('|')) continue;
    const cells = splitTableRow(lines[i]);
    if (cells.length === columns.length && cells.every((cell, index) => cell === columns[index])) {
      headerLine = i;
      break;
    }
  }
  if (headerLine < 0) return { headerLine: -1, rows: [], lines };
  let index = headerLine + 1;
  if (index < lines.length && isSeparatorRow(lines[index])) index += 1;
  const rows = [];
  let endLine = index;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      // Tolerate a blank line between rows (hand-edited files); only when the
      // next non-empty line continues the table.
      let lookahead = index + 1;
      while (lookahead < lines.length && lines[lookahead].trim() === '') lookahead += 1;
      if (lookahead < lines.length && lines[lookahead].trim().startsWith('|')) {
        index += 1;
        continue;
      }
      break;
    }
    if (!line.trim().startsWith('|')) break;
    if (!isSeparatorRow(line)) {
      rows.push({ cells: splitTableRow(line), line: index + 1 });
    }
    index += 1;
    endLine = index;
  }
  return { headerLine, rows, endLine, lines };
}

// ---------------------------------------------------------------------------
// judgments.md
// ---------------------------------------------------------------------------

export function parseJudgmentsTable(text) {
  let table = parseTable(text, JUDGMENT_COLUMNS);
  let cols = JUDGMENT_COLUMNS;
  if (table.headerLine < 0) {
    table = parseTable(text, JUDGMENT_COLUMNS_LEGACY);
    if (table.headerLine >= 0) cols = JUDGMENT_COLUMNS_LEGACY;
  }
  if (table.headerLine < 0) return { rows: [], headerLine: -1, endLine: -1, issues: [] };
  const rows = [];
  const issues = [];
  for (const entry of table.rows) {
    if (entry.cells.length !== cols.length) {
      issues.push({ kind: 'bad_columns', line: entry.line, detail: `列数 ${entry.cells.length} != ${cols.length}` });
      continue;
    }
    const [id, conclusion, boundary, source, rawStatus, card = '', updated = ''] = entry.cells;
    if (!ID_RE.test(id)) {
      issues.push({ kind: 'bad_id', line: entry.line, detail: `id 不是 J### 形式：${id}` });
      continue;
    }
    const status = normalizeStatus(rawStatus);
    if (!STATUSES.includes(status)) {
      issues.push({ kind: 'bad_status', line: entry.line, detail: `status 不在枚举内：${rawStatus}` });
    }
    rows.push({ id, conclusion, boundary, source, status, card, updated, rawStatus, line: entry.line });
  }
  return { rows, headerLine: table.headerLine, endLine: table.endLine, issues };
}

export function renderJudgmentRow(judgment) {
  return renderRow([
    judgment.id,
    judgment.conclusion,
    judgment.boundary,
    judgment.source,
    judgment.status,
    judgment.card,
    judgment.updated,
  ]);
}

export function nextJudgmentId(rows) {
  let max = 0;
  for (const row of rows) {
    const number = Number.parseInt(row.id.slice(1), 10);
    if (Number.isFinite(number) && number > max) max = number;
  }
  const next = max + 1;
  return `J${String(next).padStart(3, '0')}`;
}

function insertBeforeMarker(text, marker, block, { tableRow = false } = {}) {
  const index = text.indexOf(marker);
  const before = text.slice(0, index).replace(/\s+$/, '');
  const after = text.slice(index);
  const separator = tableRow ? '\n' : '\n\n';
  return `${before}${separator}${block.trim()}\n\n${after}`;
}

export function appendJudgmentRow(text, judgment) {
  const block = renderJudgmentRow(judgment);
  if (text.includes(JUDGMENTS_END)) {
    return insertBeforeMarker(text, JUDGMENTS_END, block, { tableRow: true });
  }
  const table = parseTable(text, JUDGMENT_COLUMNS);
  if (table.headerLine < 0) {
    if (parseTable(text, JUDGMENT_COLUMNS_LEGACY).headerLine >= 0) {
      throw new FormatError(
        '检测到 5 列旧格式表头（id/判断/边界/来源/状态）；写入需要 7 列锁定表头。'
        + ' 请先把表头升级为 7 列（补 card、updated 两列，旧行补空单元格），'
        + '或运行 init 生成新结构后再迁移。读取与 review 不受影响。',
        'LEGACY_FORMAT_READ_ONLY',
      );
    }
    throw new FormatError(
      'judgments.md 里找不到锁定的表头。请先运行 init（或手动恢复表头）：'
      + `| ${JUDGMENT_COLUMNS.join(' | ')} |`,
    );
  }
  const lines = text.split(/\r?\n/);
  const at = table.endLine ?? table.headerLine + 2;
  lines.splice(at, 0, block);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// judgments-cards.md
// ---------------------------------------------------------------------------

export function parseCards(text) {
  const lines = text.split(/\r?\n/);
  const cards = [];
  let current = null;
  let inComment = false;
  const close = () => {
    if (current) {
      cards.push(current);
      current = null;
    }
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!inComment && trimmed.includes('<!--')) inComment = true;
    if (inComment) {
      if (trimmed.includes('-->')) inComment = false;
      continue;
    }
    const heading = /^##\s+(J\d{3,})\s*(.*)$/.exec(line);
    if (heading) {
      close();
      current = { id: heading[1], title: heading[2].trim(), fields: {}, line: i + 1 };
      continue;
    }
    if (/^#{1,2}\s+/.test(line)) {
      close();
      continue;
    }
    if (!current) continue;
    // Accept `- why: …`, `- **why**: …`, `- **为什么**：…`, `- 失败/反例：…` etc.
    const field = /^\s*[-*]\s*(?:\*\*)?\s*([^:*：|]+?)\s*(?:\*\*)?\s*[:：]\s*(.*)$/.exec(line);
    if (!field) continue;
    const label = field[1].replace(/\*\*/g, '').trim();
    const canonical = CARD_FIELD_ALIASES[label] || CARD_FIELD_ALIASES[label.toLowerCase()] || null;
    if (canonical) current.fields[canonical] = field[2].trim();
  }
  close();
  return cards;
}

export function renderCard(card) {
  const lines = [`## ${card.id} ${card.title}`.trimEnd()];
  for (const field of CARD_FIELDS) {
    if (field === 'scene' && (card.scene === undefined || card.scene === '')) continue;
    const value = card[field];
    if (value === undefined) continue;
    lines.push(`- ${field}: ${value}`);
  }
  return lines.join('\n');
}

export function appendCard(text, card) {
  const block = renderCard(card);
  if (text.includes(CARDS_END)) return insertBeforeMarker(text, CARDS_END, block);
  if (text.trim() === '') return `${block}\n`;
  return `${text.replace(/\s+$/, '')}\n\n${block}\n`;
}

/**
 * A card is complete when why/failure/unfinished are present and non-placeholder.
 * `source` is required too, unless the matching judgment row already carries a
 * non-empty source pointer (legacy cards keep the source only in judgments.md).
 */
export function cardIsComplete(card, row) {
  const rowSource = row && typeof row.source === 'string' ? row.source.trim() : '';
  const inheritedSource = rowSource !== '' && rowSource !== '-';
  return CARD_REQUIRED_FIELDS.every((field) => {
    if (field === 'source' && inheritedSource) return true;
    const value = card.fields[field];
    return typeof value === 'string' && value.trim() !== '' && !PLACEHOLDER_RE.test(value);
  });
}

// ---------------------------------------------------------------------------
// index.md
// ---------------------------------------------------------------------------

export function parseIndex(text) {
  let table = parseTable(text, INDEX_COLUMNS);
  let cols = INDEX_COLUMNS;
  if (table.headerLine < 0) {
    table = parseTable(text, INDEX_COLUMNS_LEGACY);
    if (table.headerLine >= 0) cols = INDEX_COLUMNS_LEGACY;
  }
  if (table.headerLine < 0) return { rows: [], headerLine: -1, endLine: -1, issues: [] };
  const rows = [];
  const issues = [];
  for (const entry of table.rows) {
    if (entry.cells.length !== cols.length) {
      issues.push({ kind: 'bad_columns', line: entry.line, detail: `列数 ${entry.cells.length} != ${cols.length}` });
      continue;
    }
    const [trigger, pointer, note = ''] = entry.cells;
    rows.push({ trigger, pointer, note, line: entry.line });
  }
  return { rows, headerLine: table.headerLine, endLine: table.endLine, issues };
}

/** Split a pointer cell that contains several paths (；/; separated). */
export function splitPointers(raw) {
  const text = String(raw ?? '').trim();
  if (text === '' || text === '-') return [];
  return text
    .split(/[；;]/)
    .map((part) => part.trim())
    .filter((part) => part !== '' && part !== '-');
}

/**
 * Candidate paths for one pointer token (宽进):
 *   raw -> strip trailing annotations `（…）`/`(…)` -> strip "第 N–M 行" -> first token.
 * Existence is checked for each candidate; the first that resolves wins.
 */
export function pointerPathCandidates(pointer) {
  const candidates = [];
  const push = (value) => {
    const text = String(value ?? '').trim();
    if (text !== '' && !candidates.includes(text)) candidates.push(text);
  };
  let text = String(pointer ?? '').trim();
  push(text);
  while (/[（(][^（）()]*[）)]\s*$/u.test(text)) {
    text = text.replace(/[（(][^（）()]*[）)]\s*$/u, '').trim();
    push(text);
  }
  const withoutLineRef = text.replace(/\s+第\s*\d+\s*[–—\-~～]\s*\d+\s*行\s*$/u, '').trim();
  push(withoutLineRef);
  push(withoutLineRef.split(/\s+/)[0]);
  return candidates;
}

/** Table layout of judgments.md: 'v1' (7 columns) | 'legacy' (5 Chinese columns) | null. */
export function detectJudgmentsLayout(text) {
  if (parseTable(text, JUDGMENT_COLUMNS).headerLine >= 0) return 'v1';
  if (parseTable(text, JUDGMENT_COLUMNS_LEGACY).headerLine >= 0) return 'legacy';
  return null;
}

// ---------------------------------------------------------------------------
// hot/state.md
// ---------------------------------------------------------------------------

/** Locked size metric: non-whitespace chars of the file with HTML comments removed. */
export function hotStats(text) {
  const stripped = stripComments(text);
  let chars = 0;
  for (const char of stripped) {
    if (!/\s/.test(char)) chars += 1;
  }
  return {
    chars,
    bytes: Buffer.byteLength(text, 'utf8'),
    lines: text.split(/\r?\n/).length,
  };
}

export function findHotTodos(text) {
  const stripped = stripComments(text).split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < stripped.length; i += 1) {
    const line = stripped[i];
    const trimmedLine = line.trim();
    // Skip blockquotes and headings: they explain the format, they are not tasks.
    if (trimmedLine.startsWith('>') || trimmedLine.startsWith('#')) continue;
    const match = PENDING_PATTERNS.find((pattern) => pattern.re.test(line));
    if (match) hits.push({ line: i + 1, type: match.type, text: trimmedLine });
    if (hits.length >= 100) break;
  }
  return hits;
}

export function isPlaceholder(value) {
  if (value === undefined || value === null) return true;
  const text = String(value).trim();
  return text === '' || PLACEHOLDER_RE.test(text);
}

// ---------------------------------------------------------------------------
// manifest
// ---------------------------------------------------------------------------

export function defaultSettings() {
  return {
    hotMaxChars: 800,
    hotMaxBytes: 2048,
    contextBudgetChars: 32000,
    contextShareNoticePercent: 3,
    contextShareWarnPercent: 10,
  };
}

export function createManifest({ lang = 'zh', now = new Date(), memoryDir = 'memory' } = {}) {
  const iso = now.toISOString();
  return {
    schema: SCHEMA,
    formatVersion: FORMAT_VERSION,
    templateVersion: TEMPLATE_VERSION,
    createdAt: iso,
    updatedAt: iso,
    lang,
    memoryDir,
    generator: { name: 'dsh-self', version: TOOL_VERSION },
    layers: {
      hot: LAYOUT.hot,
      index: LAYOUT.index,
      judgments: LAYOUT.judgments,
      cards: LAYOUT.cards,
    },
    handoffsDir: LAYOUT.handoffs,
    counters: { judgment: 0, handoff: 0 },
    settings: defaultSettings(),
  };
}

export function assertManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new FormatError('manifest.json 不是对象', 'BAD_MANIFEST');
  }
  if (manifest.schema !== SCHEMA) {
    throw new FormatError(`manifest.schema 应为 ${SCHEMA}，收到 ${String(manifest.schema)}`, 'BAD_MANIFEST');
  }
  if (manifest.formatVersion !== FORMAT_VERSION) {
    throw new FormatError(
      `manifest.formatVersion=${manifest.formatVersion}，本工具只支持 format v${FORMAT_VERSION}。`
      + ' 请升级插件或按 docs/FORMAT.md 的迁移说明处理。',
      'UNSUPPORTED_FORMAT',
    );
  }
  return manifest;
}

export function mergeSettings(manifest) {
  return { ...defaultSettings(), ...(manifest && manifest.settings ? manifest.settings : {}) };
}

// ---------------------------------------------------------------------------
// time stamps
// ---------------------------------------------------------------------------

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

export function dateStamp(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function fileStamp(now = new Date()) {
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function templateVersionOf(text) {
  const match = TEMPLATE_MARKER.exec(text || '');
  if (!match) return undefined;
  return { templateVersion: match[1], formatVersion: Number.parseInt(match[2], 10) };
}


/**
 * Parse session decisions (decisions.md): every `## <title>` heading starts one
 * decision, and `- key: value` bullet lines become its fields. Free-form body
 * lines are ignored, so a half-written decision never breaks the handoff.
 */
export function parseDecisions(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const decisions = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('<!--')) break; // template instructions end here for parsing
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      if (current) decisions.push(current);
      current = { title: heading[1].trim(), fields: {} };
      continue;
    }
    if (!current) continue;
    const field = /^\s*[-*]\s*(?:\*\*)?\s*([^:*：|]+?)\s*(?:\*\*)?\s*[:：]\s*(.*)$/.exec(line);
    if (field) current.fields[field[1].replace(/\*\*/g, '').trim()] = field[2].trim();
  }
  if (current) decisions.push(current);
  return decisions;
}
