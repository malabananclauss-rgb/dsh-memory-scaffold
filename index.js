// Cordis Host plugin for the dsh-memory-scaffold package (CLI binary: dsh-self).
//
// Surfaces (both share lib/core.js and lib/plugin.js):
//   - 5 human slash commands: /self-init /self-judge /self-handoff /self-review /self-ruler
//   - 5 agent tools:          dsh_self_init / _judge / _handoff / _review / _ruler
//
// The tool rows cost a little prompt space; set `tools: false` in the row config
// if you only want the human commands (the CLI keeps working either way).
//
// Workspace resolution (0.1.5):
//   DSH's `workingDirectory` service is an optional Cordis service that itself
//   injects fs/sessionProjections/systemPrompt (dsh-working-directory 0.2.2-rc.1,
//   lib/index.js:12-17). It can still be unactivated right after a host restart or
//   under HMR, and its ensure() throws when both the current and the original
//   project directory are gone (Same package README "Known Limitations"). The old
//   code read this service once during apply() and, on any failure, fell back to
//   process.cwd() — which is the HOST directory, not the user's workspace — so
//   memory/ was not found and the command reported NOT_INITIALIZED.
//
//   New policy:
//     1. resolve the service on EVERY call (a late-mounted service is picked up);
//     2. use workingDirectory.ensure(agent) when it yields an existing directory;
//     3. otherwise fall back to the Session's recorded original project
//        (agent.session.header.cwd), then to an explicitly configured workspace;
//     4. inside either candidate, walk upward to the first directory owning the
//        configured memory/ directory;
//     5. only when no candidate resolves report DIRECTORY_UNAVAILABLE — a
//        directory problem, never NOT_INITIALIZED, and never process.cwd().
//        A resolved directory without a memory scaffold still yields the core's
//        NOT_INITIALIZED, which now means exactly that.

import fs from 'node:fs';
import path from 'node:path';

import { CliError } from './lib/fsx.js';
import {
  createCommandDefinitions,
  createToolDefinitions,
  normalizeConfig,
} from './lib/plugin.js';

const WORKSPACE_SEARCH_DEPTH = 12;

/** Synchronous directory check used only by the fallback chain (no writes). */
function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** Whether a workspace root already owns the configured memory directory. */
function ownsMemory(workspaceRoot, memoryDir) {
  const memoryRoot = path.isAbsolute(memoryDir)
    ? memoryDir
    : path.join(workspaceRoot, memoryDir);
  return isDirectory(memoryRoot);
}

/**
 * Walk upward from `start` and return the first ancestor that owns the memory
 * directory. The starting directory itself is included; null means none found.
 */
function findWorkspaceWithMemory(start, memoryDir) {
  let dir = path.resolve(start);
  for (let depth = 0; depth < WORKSPACE_SEARCH_DEPTH; depth += 1) {
    if (ownsMemory(dir, memoryDir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Directory-unavailable error: distinct from NOT_INITIALIZED by design. */
function directoryUnavailable(reason) {
  return new CliError(
    '工作目录不可用（DIRECTORY_UNAVAILABLE）：workingDirectory 服务不可用或原项目目录已不存在，'
    + '且从候选目录向上找不到包含记忆目录的工程。请确认服务已加载，或 cd 回原项目/用 '
    + 'working_directory 工具设置一个已存在的目录后重试。'
    + (reason ? `（服务错误：${reason}）` : ''),
    { code: 'DIRECTORY_UNAVAILABLE', exitCode: 3 },
  );
}

export function apply(ctx, config = {}) {
  const settings = normalizeConfig(config);
  const memoryDir = settings.memoryDir;

  /**
   * Optional service access, re-read per call on purpose: a one-shot ctx.get()
   * during apply() permanently loses a service that mounts later.
   */
  const getWorkingDirectory = () => {
    try {
      return ctx.get('workingDirectory');
    } catch {
      return undefined;
    }
  };

  /**
   * Ordered fallback: Session header cwd (the original project) → configured
   * workspace → first ancestor owning memory/. Never process.cwd().
   */
  const fallbackWorkspace = (agent, serviceError) => {
    const candidates = [];
    const header = agent && agent.session ? agent.session.header : undefined;
    const headerCwd = header ? header.cwd : undefined;
    if (typeof headerCwd === 'string' && headerCwd.trim() !== '') candidates.push(headerCwd);
    if (settings.workspace) candidates.push(settings.workspace);

    for (const candidate of candidates) {
      const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(candidate);
      if (!isDirectory(absolute)) continue;
      const discovered = findWorkspaceWithMemory(absolute, memoryDir);
      if (discovered !== null) {
        return { workspaceRoot: discovered, memoryDir, source: 'fallback' };
      }
    }
    throw directoryUnavailable(serviceError);
  };

  const resolveWorkspace = async (agent, signal) => {
    const workingDirectory = getWorkingDirectory();
    let serviceError;
    if (workingDirectory && agent) {
      try {
        const directory = await workingDirectory.ensure(agent, signal);
        if (typeof directory === 'string' && directory !== '') {
          const absolute = path.resolve(directory);
          if (isDirectory(absolute)) {
            return { workspaceRoot: absolute, memoryDir, source: 'service' };
          }
          serviceError = `ensure() returned a non-directory: ${absolute}`;
        } else {
          serviceError = 'ensure() returned no directory';
        }
      } catch (error) {
        serviceError = error && error.message ? error.message : String(error);
      }
    } else {
      serviceError = workingDirectory
        ? 'workingDirectory.ensure() needs a live agent'
        : 'workingDirectory service unavailable';
    }
    return fallbackWorkspace(agent, serviceError);
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
