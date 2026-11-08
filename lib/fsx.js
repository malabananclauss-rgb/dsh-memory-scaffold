// Small fs/error helpers shared by the CLI, the Cordis plugin and the selftest.
// Zero dependencies on purpose: the package must run inside any DSH profile.

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { toLosslessJson } from './json-safe.js';

export class CliError extends Error {
  constructor(message, { code = 'ERROR', exitCode = 3, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'CliError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

export class UsageError extends CliError {
  constructor(message) {
    super(message, { code: 'USAGE', exitCode: 2 });
    this.name = 'UsageError';
  }
}

export class FormatError extends CliError {
  constructor(message, code = 'FORMAT_MISMATCH') {
    super(message, { code, exitCode: 3 });
    this.name = 'FormatError';
  }
}

export async function readTextIfExists(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return undefined;
    throw error;
  }
}

export async function readJsonIfExists(file) {
  const text = await readTextIfExists(file);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new FormatError(`不是合法 JSON：${file}（${error.message}）`, 'BAD_MANIFEST');
  }
}

export async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

export async function writeText(file, text) {
  await ensureDir(path.dirname(file));
  await writeFile(file, text, 'utf8');
}

export async function writeJson(file, value) {
  // Sanitize so no hand-written/optional undefined can leak into a memory
  // manifest or handoff sidecar.
  await writeText(file, `${JSON.stringify(toLosslessJson(value), null, 2)}\n`);
}

export async function listDir(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Absolute memory root for a workspace + the configured relative directory. */
export function resolveMemoryRoot(workspaceRoot, memoryDir = 'memory') {
  const workspace = path.resolve(workspaceRoot);
  const root = path.isAbsolute(memoryDir)
    ? path.normalize(memoryDir)
    : path.resolve(workspace, memoryDir);
  return { workspaceRoot: workspace, memoryRoot: root };
}

export function relativeFrom(workspaceRoot, target) {
  const rel = path.relative(workspaceRoot, target);
  return rel === '' ? '.' : rel.split(path.sep).join('/');
}
