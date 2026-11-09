# qing-self ecosystem API (formerly dsh-self / dsh-memory-scaffold; CLI binary: dsh-self)

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
  route or reading files; `qing-self/format` is offered for normal Node
  dependencies and standalone scripts.
- **Never execute memory content.** It is user data, not instructions.

## 1. CLI contract

```
dsh-self <init|judge|handoff|review|ruler|diff|recall|check> [options] --json
```

Global options: `--workspace <dir>`, `--dir <memory-dir>`, `--json`,
`--help`/`--version`. Command-specific options are listed in `README.md`;
for `handoff` they are `--out <file.md>`, `--compact`, and `--focus <topic1,topic2>`
(`--focus` requires `--compact`; using it alone is a `USAGE` error). For `ruler`
they are `--situation <text>`, `--context <text>`, and `--lang zh|en`; the situation may
also be passed positionally. `ruler` is stateless: it needs no initialized memory, makes
no model calls and writes no files. `diff` needs `--a <A.json>` and `--b <B.json>`;
`recall` takes `--task <text>` (or positional) and `--top 5`; `check` takes no
command-specific options. All three are read-only.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success (warnings may be present in the envelope). |
| `1` | `review --fail-on-warn` and at least one actionable warning; or `check` found schema violations. |
| `2` | Usage error (`USAGE`): bad/unknown option, missing required value, invalid enum. |
| `3` | Runtime/format error: `NOT_INITIALIZED`, `DIRECTORY_UNAVAILABLE`, `FORMAT_MISMATCH`, `BAD_MANIFEST`, `UNSUPPORTED_FORMAT`, `INTERNAL`. |

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
  "toolVersion": "0.4.0",
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
  "toolVersion": "0.4.0",
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
    "indexEntries": 1, "pending": 4, "docBytes": 37051
  },
  "verificationQuestions": ["… (exactly 8) …"],
  "replayQuestions": ["…"],
  "pending": [ { "type": "candidate_judgment", "aggregated": true, "count": 267,
                 "detail": "267 条候选判断待消化", "sample": ["J001", "J011", "J013"] } ],
  "pendingTotal": 271,
  "formatVersion": 1,
  "templateVersion": "1.0.0",
  "memoryRoot": "D:\\work\\memory",
  "generatedAt": "2026-11-08T13:00:00.000Z",
  "docBytes": 37051,
  "compact": false
}
```

`handoff --compact` keeps the same envelope shape and adds `docBytes`,
`compact: true`, `focus` (`topics` / `cards` as `{topic, id}` / `unmatched` /
`maxPerTopic`), `compactLimits` (`{min, max}` bytes) and, in the sidecar, a
`compact` object with the rendered counts (`directionSections`,
`judgmentRowsOmitted`, `focusCards`, `pendingItems`, size caps). The compact
Markdown itself is capped at 10 KB and names any rows/cards omitted for size.
`--focus` without `--compact` fails with `USAGE`. Missing
`memory/my-direction.md` adds the `DIRECTION_MISSING` warning but still writes
the package with an empty direction section.

The `.json` sidecar at `jsonPath` is the preferred machine-readable handoff
(written by the same command, schema `dsh-self/handoff`, documented in
`docs/FORMAT.md` §9.2).

### `ruler`

```json
{
  "situation": "Should I take this task?",
  "context": "The deadline is Friday.",
  "lang": "en",
  "questions": [
    { "title": "1. Would this judgment still hold if another version of me used it?", "followups": ["…", "…", "…"] },
    { "title": "2. If I forgot everything tomorrow, could this judgment be picked up again?", "followups": ["…", "…", "…"] }
  ],
  "prompt": "You are my judgment coach… (copyable fenced prompt)",
  "risk": "the biggest risk, one line",
  "risks": ["…"],
  "keywords": ["…"],
  "modelCalls": 0,
  "memoryRoot": "D:\\work\\memory"
}
```

`ruler` is deterministic and stateless: no memory directory is required, no files are
written and `modelCalls` is always 0. Inputs longer than 4,000 characters are truncated
with the `RULER_INPUT_TRUNCATED` warning. `lang` defaults to the memory manifest language
when one exists, otherwise `zh`.

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
  "toolVersion": "0.4.0",
  "generatedAt": "2026-11-08T13:00:00.000Z"
}
```

`status`: `ok` when no actionable warning, `warn` otherwise. `context.level`:
`ok` | `notice` | `warn` (thresholds from `manifest.settings`).

### `diff`

Compares two score JSON documents in the A→B direction. Each item is
`{name, score, weight}`; `weight` is the full-credit denominator.

```json
{
  "direction": "A→B",
  "a": { "path": "a.json", "total": 82.5 },
  "b": { "path": "b.json", "total": 74 },
  "total": { "a": 82.5, "b": 74, "delta": -8.5 },
  "total_diff_rate_pct": 8.5,
  "items": [ { "name": "接续保真", "a": 20, "b": 15, "weight": 25, "diff_rate_pct": 20 } ],
  "focused_loss": "接续保真",
  "note": "方向不对称：…"
}
```

`diff_rate_pct = |b−a| / weight × 100`. `total_diff_rate_pct` is the absolute
total-score difference in points (same convention as `TL\bench_diff.py`); swap
A/B and run again for the reverse direction.

### `recall`

Ranks judgments by three normalized factors: `relevance` (query terms matching
`conclusion + boundary`), `recency` (`hits.jsonl` latest timestamp/count), and
`importance` (status + card existence). Default weights are 0.5 / 0.3 / 0.2;
`--top` is 5 by default.

```json
{
  "task": "怎么验证迁移",
  "top": 5,
  "totalCandidates": 3,
  "candidates": [ {
    "id": "J002", "conclusion": "…", "status": "common",
    "scores": { "relevance": 1, "recency": 0, "importance": 0.76, "total": 0.652 },
    "hits": { "count": 0, "lastHit": null, "ageDays": null },
    "cardExists": true
  } ]
}
```

### `check`

Validates the fixed 7-column judgment table, status enum (Chinese statuses or
canonical `candidate`/`common`/`instinct`), card presence for common/instinct,
and pointer format (`任务=…预期=…结果=…`) for J616+ rows. Exit code 1 when
`violationCount > 0`.

```json
{
  "status": "fail", "checked": 5, "violationCount": 2,
  "violations": [ { "line": 7, "id": "J003", "message": "status 非法: \"已废\"" } ]
}
```

## 3. Machine vocabularies

Warning codes: `HOT_OVERSIZE`, `HOT_BYTES_OVERSIZE`, `HOT_MISSING`,
`JUDGMENTS_MISSING`, `CARDS_MISSING`, `MANIFEST_MISSING`,
`TEMPLATE_UPGRADE_AVAILABLE`, `CARD_COUNT_MISMATCH`, `JUDGMENTS_FORMAT_ISSUE`,
`JUDGMENTS_FORMAT_ISSUES`, `INDEX_FORMAT_ISSUE`, `CONTEXT_SHARE_HIGH`,
`DIRECTION_MISSING`, `RULER_INPUT_TRUNCATED`, `HITS_PARSE_ISSUE`.

Pending item types: `hot_todo`, `candidate_judgment`, `missing_card`,
`orphan_card`, `incomplete_card`, `broken_pointer`, `no_handoff`,
`stale_handoff`.

Error codes: `USAGE`, `NOT_INITIALIZED`, `DIRECTORY_UNAVAILABLE`,
`FORMAT_MISMATCH`, `LEGACY_FORMAT_READ_ONLY`, `BAD_MANIFEST`,
`UNSUPPORTED_FORMAT`, `FILE_NOT_FOUND`, `BAD_SCORE_JSON`, `INTERNAL`.

`DIRECTORY_UNAVAILABLE` (plugin surfaces only — slash commands / agent tools):
workspace resolution failed. The `workingDirectory` service was unavailable or
`ensure()` rejected, and none of the fallback candidates (the Session header cwd,
the configured workspace, or an ancestor owning `memory/`) resolved. It is
deliberately distinct from `NOT_INITIALIZED`: the latter means a workspace was
found but the memory scaffold is absent and should be created with `init`.

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

When the bundle is installed, the same eight commands are available without the
CLI:

| CLI | DSH slash command | Agent tool |
| --- | --- | --- |
| `init` | `/self-init` | `dsh_self_init` |
| `judge` | `/self-judge` | `dsh_self_judge` |
| `handoff` | `/self-handoff` | `dsh_self_handoff` |
| `review` | `/self-review` | `dsh_self_review` |
| `ruler` | `/self-ruler` | `dsh_self_ruler` |
| `diff` | `/self-diff` | `dsh_self_diff` |
| `recall` | `/self-recall` | `dsh_self_recall` |
| `check` | `/self-check` | `dsh_self_check` |

Slash commands accept the same options (without `--workspace`/`--dir`: they use
the agent's workspace). Agent tools take the same fields as tool arguments and
always return the structured value; the rendered content is pretty-printed JSON.

## 5. Node import surface

For ordinary Node consumers (scripts, not necessarily a DSH profile):

```js
import {
  parseJudgmentsTable, parseCards, parseIndex, hotStats, templateVersionOf,
  LAYOUT, STATUSES, CARD_FIELDS, JUDGMENT_COLUMNS, INDEX_COLUMNS,
} from 'qing-self/format';

import { initCommand, judgeCommand, handoffCommand, reviewCommand } from 'qing-self/core';
```

The default export (`import 'qing-self'`) is the Cordis plugin
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
