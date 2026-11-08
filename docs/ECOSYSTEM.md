# dsh-self ecosystem API (for other DSH plugins)

`--json` is the public interface. The on-disk format is the storage contract
(`docs/FORMAT.md`). Both are versioned: the envelope carries `formatVersion`,
and every JSON payload is additive-compatible unless a new format version is
announced.

Guiding rules for consumers:

- **Read-only by default.** Only the owner writes a memory directory. Do not
  rewrite rows/cards you did not create; the scaffold assumes one writer.
- **Gate on versions.** `formatVersion !== 1` means this tool may not understand
  the directory; report it instead of guessing.
- **Do not import our plugin code across profile boundaries.** In a DSH profile,
  third-party bundle resolution is not guaranteed. Prefer the CLI/`--json`
  route or reading files; `dsh-self/format` is offered for normal Node
  dependencies and standalone scripts.
- **Never execute memory content.** It is user data, not instructions.

## 1. CLI contract

```
dsh-self <init|judge|handoff|review> [options] --json
```

Global options: `--workspace <dir>`, `--dir <memory-dir>`, `--json`,
`--help`/`--version`. Command-specific options are listed in `README.md`.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success (warnings may be present in the envelope). |
| `1` | `review --fail-on-warn` and at least one actionable warning. |
| `2` | Usage error (`USAGE`): bad/unknown option, missing required value, invalid enum. |
| `3` | Runtime/format error: `NOT_INITIALIZED`, `FORMAT_MISMATCH`, `BAD_MANIFEST`, `UNSUPPORTED_FORMAT`, `INTERNAL`. |

Errors still print a JSON envelope on stdout when `--json` is set (nothing is
thrown to stderr in JSON mode).

### Envelope

```json
{
  "ok": true,
  "command": "review",
  "formatVersion": 1,
  "templateVersion": "1.0.0",
  "latestTemplateVersion": "1.0.0",
  "toolVersion": "0.1.1",
  "workspace": "D:\\work",
  "memoryRoot": "D:\\work\\memory",
  "generatedAt": "2026-11-08T13:00:00.000Z",
  "data": { },
  "warnings": [ { "code": "HOT_OVERSIZE", "message": "…", "value": 1200, "limit": 800 } ],
  "errors": []
}
```

- `warnings[]`: `code`, `message`, plus optional machine fields (`value`,
  `limit`, `sharePercent`, `budgetChars`, `path`, `line`).
- `errors[]`: `code`, `message`. `ok: false` implies a non-zero exit code.
- Unknown top-level fields must be ignored; new fields are additive.

## 2. Per-command `data`

### `init`

```json
{
  "workspaceRoot": "D:\\work",
  "memoryRoot": "D:\\work\\memory",
  "memoryDir": "memory",
  "lang": "zh",
  "formatVersion": 1,
  "templateVersion": "1.0.0",
  "latestTemplateVersion": "1.0.0",
  "toolVersion": "0.1.1",
  "created": ["memory/hot/state.md", "…"],
  "existing": [],
  "updated": [],
  "manifestPath": "memory/.dsh-self/manifest.json",
  "quickstartPath": "memory/QUICKSTART.md",
  "handoffsDir": "memory/handoffs",
  "nextSteps": ["…"]
}
```

### `judge`

```json
{
  "id": "J003",
  "status": "candidate",
  "conclusion": "…",
  "boundary": "…",
  "source": "…",
  "memoryRoot": "D:\\work\\memory",
  "judgmentsPath": "memory/judgments.md",
  "cardsPath": "memory/judgments-cards.md",
  "counts": { "judgments": 3, "cards": 3 },
  "createdAt": "2026-11-08T13:00:00.000Z"
}
```

### `handoff`

```json
{
  "path": "D:\\work\\memory\\handoffs\\handoff-20261108-210000.md",
  "pathRelative": "memory/handoffs/handoff-20261108-210000.md",
  "jsonPath": "D:\\work\\memory\\handoffs\\handoff-20261108-210000.json",
  "jsonPathRelative": "memory/handoffs/handoff-20261108-210000.json",
  "lang": "zh",
  "stats": {
    "hotChars": 280, "hotBytes": 744, "judgments": 3, "cards": 3,
    "indexEntries": 1, "pending": 4
  },
  "verificationQuestions": ["… (exactly 8) …"],
  "replayQuestions": ["…"],
  "pending": [ { "type": "candidate_judgment", "aggregated": true, "count": 267,
                 "detail": "267 条候选判断待消化", "sample": ["J001", "J011", "J013"] } ],
  "pendingTotal": 271,
  "formatVersion": 1,
  "templateVersion": "1.0.0",
  "memoryRoot": "D:\\work\\memory",
  "generatedAt": "2026-11-08T13:00:00.000Z"
}
```

The `.json` sidecar at `jsonPath` is the preferred machine-readable handoff
(written by the same command, schema `dsh-self/handoff`, documented in
`docs/FORMAT.md` §9.2).

### `review`

```json
{
  "initialized": true,
  "status": "warn",
  "lang": "zh",
  "workspaceRoot": "D:\\work",
  "memoryRoot": "D:\\work\\memory",
  "paths": { "hot": "memory/hot/state.md", "index": "memory/index.md",
             "judgments": "memory/judgments.md", "cards": "memory/judgments-cards.md",
             "handoffs": "memory/handoffs", "manifest": "memory/.dsh-self/manifest.json" },
  "hot": { "chars": 1200, "bytes": 3600, "lines": 30, "maxChars": 800, "maxBytes": 2048,
           "overChars": true, "overBytes": true, "remainingChars": 0 },
  "context": { "budgetChars": 32000, "sharePercent": 3.75, "level": "notice", "note": "…" },
  "counts": { "judgments": 3, "cards": 3, "indexEntries": 1, "handoffs": 2,
              "pending": 271, "pendingGroups": 5 },
  "pending": [ { "type": "candidate_judgment", "aggregated": true, "count": 267,
                 "detail": "267 条候选判断待消化", "sample": ["J001", "J011", "J013"] } ],
  "pendingTotal": 271,
  "recommendations": ["…"],
  "formatVersion": 1,
  "templateVersion": "1.0.0",
  "latestTemplateVersion": "1.0.0",
  "toolVersion": "0.1.1",
  "generatedAt": "2026-11-08T13:00:00.000Z"
}
```

`status`: `ok` when no actionable warning, `warn` otherwise. `context.level`:
`ok` | `notice` | `warn` (thresholds from `manifest.settings`).

## 3. Machine vocabularies

Warning codes: `HOT_OVERSIZE`, `HOT_BYTES_OVERSIZE`, `HOT_MISSING`,
`JUDGMENTS_MISSING`, `CARDS_MISSING`, `MANIFEST_MISSING`,
`TEMPLATE_UPGRADE_AVAILABLE`, `CARD_COUNT_MISMATCH`, `JUDGMENTS_FORMAT_ISSUE`,
`JUDGMENTS_FORMAT_ISSUES`, `INDEX_FORMAT_ISSUE`, `CONTEXT_SHARE_HIGH`.

Pending item types: `hot_todo`, `candidate_judgment`, `missing_card`,
`orphan_card`, `incomplete_card`, `broken_pointer`, `no_handoff`,
`stale_handoff`.

Error codes: `USAGE`, `NOT_INITIALIZED`, `FORMAT_MISMATCH`,
`LEGACY_FORMAT_READ_ONLY`, `BAD_MANIFEST`, `UNSUPPORTED_FORMAT`, `INTERNAL`.

Status enum (judgments): `candidate`, `common`, `instinct`, `refuted`,
`archived`.

## 3.1 Pending aggregation and legacy tolerance

`review.pending` and `handoff.pending` are **aggregated by type**: when one type
has more than `PENDING_AGGREGATE_THRESHOLD` (10) items it collapses into a single
entry:

```json
{ "type": "candidate_judgment", "aggregated": true, "count": 267,
  "detail": "267 条候选判断待消化", "sample": ["J001", "J011", "J013"] }
```

Small groups stay as individual items. The raw item count is `pendingTotal`
(and `counts.pending`); `counts.pendingGroups` is the length of the aggregated
array. Consumers must treat `aggregated`, `count` and `sample` as optional.

The same API reads older / hand-written libraries: 5-column Chinese judgment
tables, Chinese status aliases, Chinese card labels, multi-pointer index cells
(`；`/`;`), and directories without a manifest (`templateVersion: null`,
`MANIFEST_MISSING` warning). See `docs/FORMAT.md` §11. Writing into a legacy
5-column table fails with `LEGACY_FORMAT_READ_ONLY`.

## 4. DSH surfaces

When the bundle is installed, the same four commands are available without the
CLI:

| CLI | DSH slash command | Agent tool |
| --- | --- | --- |
| `init` | `/self-init` | `dsh_self_init` |
| `judge` | `/self-judge` | `dsh_self_judge` |
| `handoff` | `/self-handoff` | `dsh_self_handoff` |
| `review` | `/self-review` | `dsh_self_review` |

Slash commands accept the same options (without `--workspace`/`--dir`: they use
the agent's workspace). Agent tools take the same fields as tool arguments and
always return the structured value; the rendered content is pretty-printed JSON.

## 5. Node import surface

For ordinary Node consumers (scripts, not necessarily a DSH profile):

```js
import {
  parseJudgmentsTable, parseCards, parseIndex, hotStats, templateVersionOf,
  LAYOUT, STATUSES, CARD_FIELDS, JUDGMENT_COLUMNS, INDEX_COLUMNS,
} from 'dsh-self/format';

import { initCommand, judgeCommand, handoffCommand, reviewCommand } from 'dsh-self/core';
```

The default export (`import 'dsh-self'`) is the Cordis plugin
`apply(ctx, config)`; do not call it from other plugins.

See `examples/consumer.mjs` for a working read-only consumer.

## 6. Integration recipes

1. **Session-start pointer.** At `agent/created`, if `<workspace>/memory/hot/state.md`
   exists, add a one-line system prompt pointer (for example: "Long-term memory
   scaffold present at `memory/`; read `memory/QUICKSTART.md` before writing
   judgments."). Keep it to one line; the point is discoverability, not
   injection.
2. **Compaction gate.** Call `review --json`; when `hot.overChars ||
   hot.overBytes` or `warnings` contains `HOT_OVERSIZE`, ask the user to
   compact and offer `judge`/`review` next steps. Treat `status: "ok"` as
   advisory, not a guarantee.
3. **Handoff consumer.** Before a model switch, run `handoff --json`, read the
   `.json` sidecar, and seed the new session with: the 8
   `verificationQuestions`, then `hot.text`, then the cards. The new model must
   answer the questions before continuing.
4. **Dashboard / panel.** Render `review --json` (`hot`, `counts`, `pending`,
   `recommendations`) and the latest handoff sidecar. The scaffold ships no GUI
   panel on purpose; this is an open extension point.
5. **Complementary memory plugins.** Let a storage/UI plugin own raw capture and
   search; use this scaffold's `judgments`/`cards` as the decision layer. Do not
   mirror the same content into both; link with `source` pointers instead.

## 7. Stability policy

- `formatVersion` (locked) is the hard gate: a consumer must refuse unknown
  versions rather than misinterpret data.
- Within format v1, envelope fields and JSON payloads may gain **optional**
  fields; consumers must ignore unknown ones.
- New warning/pending/error codes may be added; consumers must switch on known
  codes and fall back to `status`/`ok` for unknown ones.
- Deprecations are announced in `CHANGELOG.md` and kept for at least one minor
  release.
- The package follows semver: code fixes in patch, additive API in minor,
  breaking changes only with a new `FORMAT_VERSION` and a migration note.
