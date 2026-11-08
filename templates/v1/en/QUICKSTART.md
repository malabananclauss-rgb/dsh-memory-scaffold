# dsh-self QUICKSTART
<!-- dsh-self template=v1.0.0 format=1 -->

Generated: {{DATE}} · tool {{TOOL_VERSION}} · template 1.0.0 · memory dir: `{{MEMORY_DIR}}`

## What this scaffold is

The smallest structure for giving your AI memory continuity and a sense of identity:
four files plus four operations. It ships format and process only — no real judgments,
private memories or identity content. You write those yourself.

## The four layers (split by how they are used, not by source or time)

| Layer | File | Purpose | Read frequency |
| --- | --- | --- | --- |
| Hot state | `{{MEMORY_DIR}}/hot/state.md` | Instinct (identity/judgment core/red lines) + situation (task/blocker/next step) | every wake-up |
| Index | `{{MEMORY_DIR}}/index.md` | trigger -> pointer; no content | on demand |
| Judgments | `{{MEMORY_DIR}}/judgments.md` | one line per judgment: conclusion/boundary/source/status | on demand |
| Cards | `{{MEMORY_DIR}}/judgments-cards.md` | full judgment: why/failure/unfinished/source | model switch, conflict check |

## The four operations

1. **init** — create the structure (this file was created by init). Re-running only adds missing files;
   it never overwrites what you wrote.
2. **judge** — add one judgment card; auto-numbered and written to both judgments and cards.
3. **handoff** — read your memory and generate a continuation package plus 8 verification questions.
4. **review** — compression review: hot size (>800 chars / 2 KB warning), context-share hint,
   list of items not yet persisted.

## Three ways to call it

- **CLI**: `node bin/dsh-self.mjs <init|judge|handoff|review> [options]`; every command supports `--json`.
- **DSH slash commands** (with the plugin installed): `/self-init`, `/self-judge`, `/self-handoff`, `/self-review`.
- **Agent tools**: `dsh_self_init`, `dsh_self_judge`, `dsh_self_handoff`, `dsh_self_review`.

## Suggested rhythm

- After a material or a clear thought: run judge and write 0-3 cards.
- Before switching model/session: run handoff, give the package to the new model and make it answer the 8 questions.
- Weekly or before compaction: run review, clear pending items, bring hot back under 800 chars.

## Privacy and safety

- Memory files are plain text that any local process can read. Never write passwords, tokens or ID numbers;
  write a pointer to where the secret lives instead.
- Decide deliberately whether this memory belongs in git.
- The shipped templates contain placeholders only, never anyone's real judgments.

## Versioning and updates

- `{{MEMORY_DIR}}/.dsh-self/manifest.json` records formatVersion and templateVersion.
- After upgrading the package, run review to see whether templates changed; merge manually per CHANGELOG
  (the tool never overwrites files you already wrote).
- Format contract: `docs/FORMAT.md`; ecosystem integration: `docs/ECOSYSTEM.md`.
