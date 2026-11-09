// Cordis Host plugin for the dsh-self scaffold.
//
// Surfaces (both share lib/core.js and lib/plugin.js):
//   - 4 human slash commands: /self-init /self-judge /self-handoff /self-review
//   - 4 agent tools:          dsh_self_init / _judge / _handoff / _review
//
// The tool rows cost a little prompt space; set `tools: false` in the row config
// if you only want the human commands (the CLI keeps working either way).

import fs from 'node:fs';
import path from 'node:path';

import {
  createCommandDefinitions,
  createToolDefinitions,
  normalizeConfig,
} from './lib/plugin.js';

/**
 * Fallback workspace discovery: the `workingDirectory` service can be unavailable
 * right after a host restart, and `process.cwd()` is then the host's own directory
 * rather than the user's workspace. Walk upwards from a candidate until a directory
 * containing `memory/` is found, so the tools keep working instead of reporting
 * NOT_INITIALIZED. Returns null when nothing plausible is found.
 */
function findWorkspaceWithMemory(start) {
  let dir = path.resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(dir, 'memory'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function apply(ctx, config = {}) {
  const settings = normalizeConfig(config);
  const workingDirectory = ctx.get('workingDirectory');

  const resolveWorkspace = async (agent, signal) => {
    let workspaceRoot = settings.workspace
      ? path.resolve(settings.workspace)
      : process.cwd();
    let fromFallback = !settings.workspace;
    if (workingDirectory && agent) {
      try {
        const directory = await workingDirectory.ensure(agent, signal);
        if (directory) {
          workspaceRoot = directory;
          fromFallback = false;
        }
      } catch {
        // Fall back to the configured/process directory; the command will report
        // a clear NOT_INITIALIZED error if that is the wrong place.
      }
    }
    // Discovery is only for the true fallback path (no configured workspace and
    // an unavailable workingDirectory service): the host process cwd is not the
    // user's workspace, so walk up until a directory that already owns memory/
    // is found. A resolved workspace is never re-pointed.
    if (fromFallback) {
      const discovered = findWorkspaceWithMemory(workspaceRoot);
      if (discovered) workspaceRoot = discovered;
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
