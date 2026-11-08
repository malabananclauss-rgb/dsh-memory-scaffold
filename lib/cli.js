// CLI front end: argument parsing, human-readable output and the --json envelope.
// The same parsing is reused by the Cordis slash commands / tools (via lib/plugin.js).

import path from 'node:path';

import {
  FORMAT_VERSION,
  TEMPLATE_VERSION,
  TOOL_VERSION,
} from './version.js';
import { CliError, UsageError } from './fsx.js';
import { stringifyLossless } from './json-safe.js';
import {
  handoffCommand,
  initCommand,
  judgeCommand,
  reviewCommand,
} from './core.js';

export const COMMANDS = Object.freeze(['init', 'judge', 'handoff', 'review']);

const PROGRAM = 'dsh-self';

const HELP = `dsh-self ${TOOL_VERSION} — 分层记忆脚手架（format v${FORMAT_VERSION} / template v${TEMPLATE_VERSION}）

用法：
  ${PROGRAM} <command> [options]

命令：
  init       初始化四层记忆结构（hot/state.md、index.md、judgments.md、judgments-cards.md）
             ＋模板＋QUICKSTART；重复运行只补缺失文件，不覆盖已写内容。
  judge      新增一条判断卡（结论/为什么/失败/未完成/来源），自动编号，同时写入 judgments 与 cards。
  handoff    读用户记忆，生成「接续包」文档＋8 个验证问题（换模型/换会话前用）。
  review     压缩审查：hot 大小（>800 字或 >2KB 告警）、上下文占比提示、待落盘项清单。

通用选项：
  -w, --workspace <dir>   工作区目录（默认：当前目录）
      --dir <name>        记忆目录名（默认：memory；也可给绝对路径）
      --json              输出 JSON（给其他插件/脚本对接，见 docs/ECOSYSTEM.md）
  -h, --help              帮助

示例：
  ${PROGRAM} init --lang zh
  ${PROGRAM} judge --conclusion "结论" --why "为什么" --failure "失败/反例" \\
      --unfinished "未完成" --source "来源指针" --boundary "边界"
  ${PROGRAM} handoff --json
  ${PROGRAM} review --json --context-budget 32000

退出码：0 成功；1 review --fail-on-warn 且有无告警；2 用法错误；3 运行/格式错误。
`;

const COMMAND_HELP = {
  init: `用法：${PROGRAM} init [--lang zh|en] [-w <workspace>] [--dir memory] [--json]
创建四层结构、模板、QUICKSTART 与 manifest；已存在的文件不覆盖。`,
  judge: `用法：${PROGRAM} judge --conclusion <结论> --why <为什么> --failure <失败/反例>
       --unfinished <未完成> --source <来源> [--boundary <边界>] [--scene <场景>]
       [--status candidate|common|instinct|refuted|archived] [--json]
所有文本会压成单行（换行→空格）；自动编号 J001、J002……`,
  handoff: `用法：${PROGRAM} handoff [--out <文件.md>] [-w <workspace>] [--dir memory] [--json]
读 hot/judgments/cards/index，生成接续包 .md ＋同名 .json 侧车文件（生态钩子）。`,
  review: `用法：${PROGRAM} review [--context-budget <字数>] [--fail-on-warn] [--json]
检查 hot 大小（默认 800 字 / 2048 B）、上下文占比估算、待落盘项与格式一致性。`,
};

function toCamel(name) {
  return name.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
}

/**
 * Minimal strict flag parser.
 * spec: { string: ['workspace', ...], boolean: ['json', ...] }
 * Unknown flags raise UsageError so typos never silently change behavior.
 */
export function parseOptions(argv, spec = {}) {
  const stringFlags = new Set(spec.string ?? []);
  const booleanFlags = new Set(spec.boolean ?? []);
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!arg.startsWith('-') || arg === '-') {
      positionals.push(arg);
      continue;
    }
    const isLong = arg.startsWith('--');
    const body = isLong ? arg.slice(2) : arg.slice(1);
    const eq = body.indexOf('=');
    const rawName = eq >= 0 ? body.slice(0, eq) : body;
    const inlineValue = eq >= 0 ? body.slice(eq + 1) : undefined;
    const name = rawName;
    const key = toCamel(name);
    if (stringFlags.has(name)) {
      let value = inlineValue;
      if (value === undefined) {
        index += 1;
        if (index >= argv.length) throw new UsageError(`--${name} 缺少值`);
        value = argv[index];
      }
      options[key] = value;
      continue;
    }
    if (booleanFlags.has(name)) {
      options[key] = inlineValue === undefined
        ? true
        : !/^(false|0|no)$/i.test(inlineValue);
      continue;
    }
    throw new UsageError(`未知选项：${isLong ? '--' : '-'}${name}（--help 看用法）`);
  }
  return { options, positionals };
}

/**
 * Split a command line into tokens, honoring single/double quotes and backslash
 * escapes. Shared by the DSH slash commands, which receive one raw string.
 */
export function tokenize(input) {
  const text = String(input ?? '');
  const tokens = [];
  let current = '';
  let quote = null;
  let hasToken = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\' && index + 1 < text.length) {
        const next = text[index + 1];
        if (next === quote || next === '\\') {
          current += next;
          index += 1;
          continue;
        }
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      hasToken = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }
    current += char;
    hasToken = true;
  }
  if (quote) throw new UsageError(`引号没有闭合：${quote}`);
  if (hasToken) tokens.push(current);
  return tokens;
}

function words(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function printWarnings(warnings) {
  if (!warnings || warnings.length === 0) return;
  for (const warning of warnings) {
    console.log(`警告[${warning.code}]：${words(warning.message)}`);
  }
}

function humanLines(lines) {
  for (const line of lines) console.log(line);
}

export function buildEnvelope({ command, data, warnings = [], workspaceRoot, memoryRoot, now }) {
  return {
    ok: true,
    command,
    formatVersion: FORMAT_VERSION,
    templateVersion: TEMPLATE_VERSION,
    latestTemplateVersion: TEMPLATE_VERSION,
    toolVersion: TOOL_VERSION,
    workspace: workspaceRoot ?? null,
    memoryRoot: memoryRoot ?? (data ? data.memoryRoot : null) ?? null,
    generatedAt: now.toISOString(),
    data,
    warnings,
    errors: [],
  };
}

function errorEnvelope({ command, error, workspaceRoot, now }) {
  const code = error instanceof CliError ? error.code : 'INTERNAL';
  const message = error && error.message ? error.message : String(error);
  return {
    ok: false,
    command: command ?? null,
    formatVersion: FORMAT_VERSION,
    templateVersion: TEMPLATE_VERSION,
    toolVersion: TOOL_VERSION,
    workspace: workspaceRoot ?? null,
    memoryRoot: null,
    generatedAt: now.toISOString(),
    data: null,
    warnings: [],
    errors: [{ code, message }],
  };
}

async function runInit({ options, workspaceRoot, now }) {
  return initCommand({
    workspaceRoot,
    memoryDir: options.dir ?? 'memory',
    lang: options.lang ?? 'zh',
    now,
  });
}

async function runJudge({ options, workspaceRoot, now }) {
  return judgeCommand({
    workspaceRoot,
    memoryDir: options.dir ?? 'memory',
    input: {
      conclusion: options.conclusion,
      why: options.why,
      failure: options.failure,
      unfinished: options.unfinished,
      source: options.source,
      boundary: options.boundary,
      scene: options.scene,
      status: options.status,
    },
    now,
  });
}

async function runHandoff({ options, workspaceRoot, now }) {
  return handoffCommand({
    workspaceRoot,
    memoryDir: options.dir ?? 'memory',
    out: options.out,
    now,
  });
}

async function runReview({ options, workspaceRoot, now }) {
  const budget = options.contextBudget === undefined ? undefined : Number(options.contextBudget);
  if (budget !== undefined && (!Number.isFinite(budget) || budget <= 0)) {
    throw new UsageError('--context-budget 必须是正数（字符数）');
  }
  return reviewCommand({
    workspaceRoot,
    memoryDir: options.dir ?? 'memory',
    contextBudgetChars: budget,
    now,
  });
}

const SPECS = {
  init: { string: ['workspace', 'dir', 'lang'], boolean: ['json', 'help'] },
  judge: {
    string: ['workspace', 'dir', 'conclusion', 'why', 'failure', 'unfinished', 'source', 'boundary', 'scene', 'status'],
    boolean: ['json', 'help'],
  },
  handoff: { string: ['workspace', 'dir', 'out'], boolean: ['json', 'help'] },
  review: { string: ['workspace', 'dir', 'context-budget'], boolean: ['json', 'help', 'fail-on-warn'] },
};

const humanBuilders = {
  init(data) {
    const lines = [
      `${PROGRAM} · init`,
      `工作区： ${data.workspaceRoot}`,
      `记忆目录： ${data.memoryRoot}`,
      `模板版本： v${data.templateVersion}（format v${data.formatVersion}）`,
    ];
    if (data.created.length > 0) {
      lines.push('', '已创建：');
      for (const file of data.created) lines.push(`  ${file}`);
    }
    if (data.existing.length > 0) {
      lines.push('', '已存在（未覆盖）：');
      for (const file of data.existing) lines.push(`  ${file}`);
    }
    lines.push('', '下一步：');
    data.nextSteps.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
    return lines.join('\n');
  },
  judge(data) {
    return [
      `${PROGRAM} · judge`,
      `已新增判断 ${data.id}（status=${data.status}）`,
      `  conclusion: ${data.conclusion}`,
      `  judgments:  ${data.judgmentsPath}`,
      `  cards:      ${data.cardsPath}`,
      `  counts:     judgments=${data.counts.judgments} / cards=${data.counts.cards}`,
    ].join('\n');
  },
  handoff(data) {
    const lines = [
      `${PROGRAM} · handoff`,
      `接续包： ${data.path}`,
      `JSON：   ${data.jsonPath}`,
      `统计：   hot ${data.stats.hotChars} 字 / ${data.stats.hotBytes} B · `
        + `judgments ${data.stats.judgments} · cards ${data.stats.cards} · `
        + `index ${data.stats.indexEntries} · pending ${data.stats.pending}`,
      '',
      '8 个验证问题（让新模型先答，答不上就是没接上）：',
    ];
    data.verificationQuestions.forEach((question, index) => lines.push(`  ${index + 1}. ${question}`));
    if (data.replayQuestions.length > 0) {
      lines.push('', '重演题（给处境，不给答案）：');
      for (const question of data.replayQuestions) lines.push(`  - ${question}`);
    }
    return lines.join('\n');
  },
  review(data, warnings) {
    const level = data.status === 'ok' ? 'ok' : 'warn';
    const lines = [
      `${PROGRAM} · review`,
      `状态： ${level}`,
      `hot： ${data.hot.chars} 字 / ${data.hot.bytes} B（上限 ${data.hot.maxChars} 字 / ${data.hot.maxBytes} B，`
        + `剩余 ${data.hot.remainingChars} 字）`,
      `上下文占比估算： ${data.context.sharePercent}%（预算 ${data.context.budgetChars} 字，${data.context.level}）`,
      `计数： judgments=${data.counts.judgments} · cards=${data.counts.cards} · `
        + `index=${data.counts.indexEntries} · handoffs=${data.counts.handoffs} · `
        + `pending=${data.counts.pending}`
        + (data.counts.pendingGroups !== undefined && data.counts.pendingGroups !== data.counts.pending
          ? `（${data.counts.pendingGroups} 组）`
          : ''),
    ];
    if (warnings.length > 0) {
      lines.push('', '警告：');
      for (const warning of warnings) lines.push(`  [${warning.code}] ${warning.message}`);
    }
    if (data.pending.length > 0) {
      lines.push('', '待落盘项：');
      for (const item of data.pending.slice(0, 30)) lines.push(`  [${item.type}] ${item.detail}`);
      if (data.pending.length > 30) lines.push(`  ……（共 ${data.pending.length} 项，--json 看全部）`);
    }
    lines.push('', '建议：');
    for (const item of data.recommendations) lines.push(`  - ${item}`);
    return lines.join('\n');
  },
};

/** Plain-text rendering shared by the CLI and the DSH slash commands. */
export function humanText(command, data, warnings = []) {
  const builder = humanBuilders[command];
  return builder ? `${builder(data, warnings)}\n` : '';
}

function printHuman(command, data, warnings) {
  const text = humanText(command, data, warnings);
  if (text !== '') console.log(text.replace(/\n$/, ''));
}

/**
 * Run the CLI.
 * @returns {Promise<number>} exit code
 */
export async function runCli(argv, {
  cwd = process.cwd(),
  now = new Date(),
} = {}) {
  const args = [...argv];
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    console.log(HELP);
    return 0;
  }
  if (args[0] === '--version' || args[0] === '-v' || args[0] === 'version') {
    console.log(`${PROGRAM} ${TOOL_VERSION} (format v${FORMAT_VERSION}, template v${TEMPLATE_VERSION})`);
    return 0;
  }
  const command = args[0];
  if (!COMMANDS.includes(command)) {
    console.error(`未知命令：${command}`);
    console.error(`可用命令：${COMMANDS.join(' / ')}（--help 看用法）`);
    return 2;
  }
  const rest = args.slice(1);
  let json = rest.includes('--json');
  const spec = SPECS[command];
  let parsed;
  try {
    parsed = parseOptions(rest, spec);
  } catch (error) {
    return reportError({ command, error, cwd, now, json });
  }
  const { options } = parsed;
  json = options.json === true;
  if (options.help) {
    console.log(COMMAND_HELP[command]);
    return 0;
  }
  if (parsed.positionals.length > 0) {
    const error = new UsageError(`多余的位置参数：${parsed.positionals.join(' ')}（用 --flag value）`);
    return reportError({ command, error, cwd, now, json });
  }
  const workspaceRoot = options.workspace ? path.resolve(cwd, options.workspace) : path.resolve(cwd);
  const runners = {
    init: runInit,
    judge: runJudge,
    handoff: runHandoff,
    review: runReview,
  };

  try {
    const result = await runners[command]({ options, workspaceRoot, now });
    if (json) {
      console.log(stringifyLossless(buildEnvelope({
        command,
        data: result.data,
        warnings: result.warnings,
        workspaceRoot,
        memoryRoot: result.data.memoryRoot,
        now,
      })));
      return 0;
    }
    printHuman(command, result.data, result.warnings);
    if (result.warnings && result.warnings.length > 0 && command !== 'review') {
      printWarnings(result.warnings);
    }
    if (command === 'review' && options.failOnWarn && result.warnings.length > 0) {
      const actionable = result.warnings.filter((warning) => warning.code !== 'TEMPLATE_UPGRADE_AVAILABLE');
      if (actionable.length > 0) return 1;
    }
    return 0;
  } catch (error) {
    return reportError({ command, error, cwd, now, json, workspaceRoot });
  }
}

function reportError({ command, error, cwd, now, json, workspaceRoot }) {
  const workspace = workspaceRoot ?? path.resolve(cwd);
  const envelope = errorEnvelope({ command, error, workspaceRoot: workspace, now });
  if (json) {
    console.log(stringifyLossless(envelope));
  } else {
    const code = envelope.errors[0].code;
    console.error(`错误[${code}]：${envelope.errors[0].message}`);
  }
  if (error instanceof CliError) return error.exitCode;
  if (error && error.code === 'ENOENT') return 3;
  return 3;
}
