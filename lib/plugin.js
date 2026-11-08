// Cordis-facing registration layer: builds the 4 human slash commands and the
// 4 agent tools on top of the shared core. Kept free of Cordis imports so the
// selftest can exercise it with a small fake context.

import path from 'node:path';

import { buildEnvelope, humanText, parseOptions, tokenize } from './cli.js';
import { CliError, UsageError } from './fsx.js';
import { stringifyLossless, toLosslessJson } from './json-safe.js';
import {
  handoffCommand,
  initCommand,
  judgeCommand,
  reviewCommand,
  VERIFICATION_QUESTIONS,
} from './core.js';
import { FORMAT_VERSION, TEMPLATE_VERSION, TOOL_VERSION } from './version.js';

export const PLUGIN_DEFAULTS = Object.freeze({
  memoryDir: 'memory',
  hotMaxChars: 800,
  hotMaxBytes: 2048,
  contextBudgetChars: 32000,
  contextShareNoticePercent: 3,
  contextShareWarnPercent: 10,
  commands: true,
  tools: true,
});

export function normalizeConfig(config) {
  const source = config && typeof config === 'object' ? config : {};
  const merged = { ...PLUGIN_DEFAULTS, ...source };
  const numeric = ['hotMaxChars', 'hotMaxBytes', 'contextBudgetChars', 'contextShareNoticePercent', 'contextShareWarnPercent'];
  for (const key of numeric) {
    const value = Number(merged[key]);
    merged[key] = Number.isFinite(value) && value > 0 ? value : PLUGIN_DEFAULTS[key];
  }
  merged.memoryDir = typeof merged.memoryDir === 'string' && merged.memoryDir.trim() !== ''
    ? merged.memoryDir
    : PLUGIN_DEFAULTS.memoryDir;
  merged.commands = source.commands !== false;
  merged.tools = source.tools !== false;
  return merged;
}

// Slash-command option specs (no --workspace/--dir: the plugin uses the agent's own workspace).
const COMMAND_SPECS = {
  init: { string: ['lang'], boolean: ['json', 'help'] },
  judge: {
    string: ['conclusion', 'why', 'failure', 'unfinished', 'source', 'boundary', 'scene', 'status'],
    boolean: ['json', 'help'],
  },
  handoff: { string: ['out'], boolean: ['json', 'help'] },
  review: { string: ['context-budget'], boolean: ['json', 'help'] },
};

const COMMAND_HELP = {
  'self-init': '用法：/self-init [--lang zh|en] [--json]',
  'self-judge': '用法：/self-judge --conclusion <结论> --why <为什么> --failure <失败/反例> '
    + '--unfinished <未完成> --source <来源> [--boundary <边界>] [--scene <场景>] '
    + '[--status candidate|common|instinct|refuted|archived] [--json]',
  'self-handoff': '用法：/self-handoff [--out <文件.md>] [--json]',
  'self-review': '用法：/self-review [--context-budget <字数>] [--json]',
};

const COMMAND_NAMES = {
  init: 'self-init',
  judge: 'self-judge',
  handoff: 'self-handoff',
  review: 'self-review',
};

/** Remove an accidentally included command name from rawInput. */
export function stripCommandName(rawInput, command) {
  let text = String(rawInput ?? '').trim();
  const name = COMMAND_NAMES[command];
  if (!name) return text;
  const patterns = [`/${name}`, name];
  for (const pattern of patterns) {
    if (text === pattern) return '';
    if (text.startsWith(`${pattern} `) || text.startsWith(`${pattern}\t`)) {
      text = text.slice(pattern.length).trim();
    }
  }
  return text;
}

function errorText(error) {
  const code = error instanceof CliError ? error.code : 'INTERNAL';
  const message = error && error.message ? error.message : String(error);
  return `错误[${code}]：${message}`;
}

function warningsText(warnings) {
  if (!warnings || warnings.length === 0) return '';
  return `\n${warnings.map((warning) => `警告[${warning.code}]：${warning.message}`).join('\n')}\n`;
}

async function runCommand(command, options, context) {
  const { resolveWorkspace, agent, signal, now } = context;
  const resolved = await resolveWorkspace(agent, signal);
  const workspaceRoot = options.workspace
    ? path.resolve(resolved.workspaceRoot, options.workspace)
    : resolved.workspaceRoot;
  const memoryDir = options.dir ?? resolved.memoryDir;
  const timestamp = now();
  switch (command) {
    case 'init':
      return initCommand({
        workspaceRoot,
        memoryDir,
        lang: options.lang ?? 'zh',
        now: timestamp,
      });
    case 'judge':
      return judgeCommand({
        workspaceRoot,
        memoryDir,
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
        now: timestamp,
      });
    case 'handoff':
      return handoffCommand({ workspaceRoot, memoryDir, out: options.out, now: timestamp });
    case 'review': {
      const budget = options.contextBudget === undefined ? undefined : Number(options.contextBudget);
      if (budget !== undefined && (!Number.isFinite(budget) || budget <= 0)) {
        throw new UsageError('--context-budget 必须是正数（字符数）');
      }
      return reviewCommand({ workspaceRoot, memoryDir, contextBudgetChars: budget, now: timestamp });
    }
    default:
      throw new UsageError(`未知命令：${command}`);
  }
}

/**
 * Build the four human slash-command definitions.
 * @returns {Array<object>} CommandDefinition-compatible objects.
 */
export function createCommandDefinitions({ resolveWorkspace, now = () => new Date() } = {}) {
  const definitions = [];
  for (const command of Object.keys(COMMAND_SPECS)) {
    const name = COMMAND_NAMES[command];
    definitions.push({
      name,
      description: ({
        init: 'Initialize the dsh-self layered memory scaffold in this workspace.',
        judge: 'Add one judgment card (conclusion/why/failure/unfinished/source) to the memory scaffold.',
        handoff: 'Build a handoff package plus 8 verification questions from the current memory.',
        review: 'Compression review: hot size, context-share hint and not-yet-persisted items.',
      })[command],
      input: {
        hint: ({
          init: '[--lang zh|en] [--json]',
          judge: '--conclusion ... --why ... --failure ... --unfinished ... --source ...',
          handoff: '[--out <file.md>] [--json]',
          review: '[--context-budget <chars>] [--json]',
        })[command],
      },
      handler: async (invocation) => {
        try {
          const raw = stripCommandName(invocation.rawInput, command);
          const { options, positionals } = parseOptions(tokenize(raw), COMMAND_SPECS[command]);
          if (options.help) return { kind: 'success', text: COMMAND_HELP[name] };
          if (positionals.length > 0) {
            throw new UsageError(`多余的位置参数：${positionals.join(' ')}（用 --flag value）`);
          }
          const resolved = await resolveWorkspace(invocation.agent, invocation.signal);
          const result = await runCommand(command, options, {
            resolveWorkspace: async () => resolved,
            agent: invocation.agent,
            signal: invocation.signal,
            now,
          });
          if (options.json) {
            const envelope = buildEnvelope({
              command,
              data: result.data,
              warnings: result.warnings,
              workspaceRoot: resolved.workspaceRoot,
              memoryRoot: result.data.memoryRoot,
              now: now(),
            });
            return { kind: 'success', text: stringifyLossless(envelope) };
          }
          const text = humanText(command, result.data, result.warnings)
            + (command === 'review' ? '' : warningsText(result.warnings));
          return { kind: 'success', text: text.replace(/\s+$/, '') };
        } catch (error) {
          return { kind: 'error', text: errorText(error) };
        }
      },
    });
  }
  return definitions;
}

function toolOutputSchema() {
  return {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        ok: { type: 'boolean' },
        command: { type: 'string' },
        data: { type: 'object', additionalProperties: true },
        warnings: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
      required: ['ok', 'command'],
    },
    render: (_args, value) => [{ type: 'text', text: stringifyLossless(value) }],
  };
}

function toolValue(command, result) {
  // Lossless JSON: the Harness rejects tool output containing undefined/NaN.
  return toLosslessJson({
    ok: true,
    command,
    toolVersion: TOOL_VERSION,
    formatVersion: FORMAT_VERSION,
    templateVersion: TEMPLATE_VERSION,
    data: result.data,
    warnings: result.warnings,
  });
}

/**
 * Build the four agent-tool definitions (raw ToolDefinition shape; no imports of
 * @deepseek-ai packages so the bundle stays resolvable in any profile).
 */
export function createToolDefinitions({ resolveWorkspace, now = () => new Date() } = {}) {
  const runTool = async (command, options, execContext) => {
    const resolved = await resolveWorkspace(execContext.agent, execContext.signal);
    const result = await runCommand(command, options, {
      resolveWorkspace: async () => resolved,
      agent: execContext.agent,
      signal: execContext.signal,
      now,
    });
    return toolValue(command, result);
  };

  return [
    {
      name: 'dsh_self_init',
      description: 'Initialize the dsh-self layered memory scaffold (hot/state.md, index.md, '
        + 'judgments.md, judgments-cards.md, QUICKSTART.md) in the current workspace memory directory. '
        + 'Idempotent: never overwrites existing files.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lang: { type: 'string', enum: ['zh', 'en'], description: 'Template language (default zh).' },
        },
      },
      output: toolOutputSchema(),
      async execute(args, execContext) {
        return runTool('init', { lang: args.lang ?? 'zh' }, execContext);
      },
    },
    {
      name: 'dsh_self_judge',
      description: 'Add one judgment to the dsh-self memory: conclusion, why, failure/counterexample, '
        + 'unfinished, source. Auto-numbered (J001...) and written to both judgments.md and judgments-cards.md.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          conclusion: { type: 'string', description: 'One-line conclusion (结论).' },
          why: { type: 'string', description: 'Why it holds (为什么).' },
          failure: { type: 'string', description: 'Failure / counterexample / boundary (失败/反例).' },
          unfinished: { type: 'string', description: 'What is still unresolved (未完成).' },
          source: { type: 'string', description: 'Source pointer: file / link / date (来源).' },
          boundary: { type: 'string', description: 'Short boundary shown in the index table (defaults to a card pointer).' },
          scene: { type: 'string', description: 'When to use this judgment (optional).' },
          status: {
            type: 'string',
            enum: ['candidate', 'common', 'instinct', 'refuted', 'archived'],
            description: 'Judgment status (default candidate).',
          },
        },
        required: ['conclusion', 'why', 'failure', 'unfinished', 'source'],
      },
      output: toolOutputSchema(),
      async execute(args, execContext) {
        return runTool('judge', args, execContext);
      },
    },
    {
      name: 'dsh_self_handoff',
      description: 'Read the dsh-self memory and generate a handoff package (.md + .json sidecar) '
        + 'plus 8 verification questions. Run before switching model or session.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          out: { type: 'string', description: 'Optional output path (relative to the workspace). Defaults to memory/handoffs/handoff-<timestamp>.md.' },
        },
      },
      output: toolOutputSchema(),
      async execute(args, execContext) {
        return runTool('handoff', { out: args.out }, execContext);
      },
    },
    {
      name: 'dsh_self_review',
      description: 'Compression review of the dsh-self memory: hot size (>800 chars / >2 KB warning), '
        + 'context-share estimate, pending-to-persist items and format consistency.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          contextBudgetChars: {
            type: 'integer',
            description: 'Context budget in characters for the share estimate (default 32000).',
          },
        },
      },
      output: toolOutputSchema(),
      async execute(args, execContext) {
        return runTool('review', { contextBudget: args.contextBudgetChars }, execContext);
      },
    },
  ];
}
