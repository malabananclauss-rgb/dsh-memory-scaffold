// Cordis Host plugin for the dsh-self scaffold.
//
// Surfaces (both share lib/core.js and lib/plugin.js):
//   - 4 human slash commands: /self-init /self-judge /self-handoff /self-review
//   - 4 agent tools:          dsh_self_init / _judge / _handoff / _review
//
// The tool rows cost a little prompt space; set `tools: false` in the row config
// if you only want the human commands (the CLI keeps working either way).

import path from 'node:path';

import {
  createCommandDefinitions,
  createToolDefinitions,
  normalizeConfig,
} from './lib/plugin.js';

export function apply(ctx, config = {}) {
  const settings = normalizeConfig(config);
  const workingDirectory = ctx.get('workingDirectory');

  const resolveWorkspace = async (agent, signal) => {
    let workspaceRoot = settings.workspace
      ? path.resolve(settings.workspace)
      : process.cwd();
    if (workingDirectory && agent) {
      try {
        const directory = await workingDirectory.ensure(agent, signal);
        if (directory) workspaceRoot = directory;
      } catch {
        // Fall back to the configured/process directory; the command will report
        // a clear NOT_INITIALIZED error if that is the wrong place.
      }
    }
    return { workspaceRoot, memoryDir: settings.memoryDir };
  };

  const commands = ctx.get('commands');
  if (settings.commands && commands) {
    for (const definition of createCommandDefinitions({ resolveWorkspace })) {
      ctx.effect(() => commands.register(definition));
    }
  }

  const tools = ctx.get('tools');
  if (settings.tools && tools) {
    for (const definition of createToolDefinitions({ resolveWorkspace })) {
      ctx.effect(() => tools.register(definition));
    }
  }
}
