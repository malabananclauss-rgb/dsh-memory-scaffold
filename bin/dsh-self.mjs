#!/usr/bin/env node
// Thin CLI entry so the package can also be used without the DSH plugin:
//   node bin/dsh-self.mjs init --json
import { runCli } from '../lib/cli.js';

const exitCode = await runCli(process.argv.slice(2));
process.exitCode = exitCode;
