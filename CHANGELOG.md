# Changelog

## [0.1.2]

- **fix(tools): workspace discovery after a host restart.** When the `workingDirectory`
  service is unavailable, the agent tools used the host process cwd and reported
  `NOT_INITIALIZED`. They now walk upwards from that cwd to the first directory owning
  `memory/`; a resolved workspace is never re-pointed.
- **fix(review):** `CARD_COUNT_MISMATCH` compared the total judgment count with the card
  count. It now reports only *common/instinct* judgments that lack a card; candidates need
  no card.


All notable changes to the dsh-self package and its scaffold templates.

Version scheme:

- **package version** (semver): this tool's code and CLI/plugin surfaces.
- **`templateVersion`**: the scaffold templates in `templates/v1/<lang>/` and the
  `template=v…` marker inside every template file. Recorded in
  `memory/.dsh-self/manifest.json` at init time.
- **`FORMAT_VERSION`** (locked): the on-disk data format. Backwards-incompatible
  changes bump the major and ship a migration note in this file; the tools refuse
  to read a manifest whose `formatVersion` they do not know.

Releases are published as GitHub Releases tagged `v<packageVersion>`; users
install/upgrade through their DSH profile (`dsh plugin --profile web add …`).

## [0.1.1] — 2026-11-08

Compatibility and real-library fixes, validated against a hand-written library
with 323 judgments / 12 cards / 28 index entries. No format change:
`FORMAT_VERSION` stays `1`, `templateVersion` stays `1.0.0`.

### Fixed

- **Lossless JSON.** `review` produced `templateVersion: undefined` when the
  memory directory has no manifest, which DSH rejects as non-lossless tool
  output. It is now `null`, and every emitted/written JSON payload passes
  through a sanitizer (`lib/json-safe.js`) that drops optional `undefined`
  values, maps `NaN` → `null` and Dates to ISO strings.
- **5-column legacy judgment tables** (`id | 判断 | 边界/反例 | 来源 | 状态/上次用`)
  are readable: rows load with empty `card`/`updated`. Writing (`judge`) into
  such a table fails with the dedicated `LEGACY_FORMAT_READ_ONLY` code and an
  upgrade hint; `review`/`handoff` read normally.
- **Chinese status aliases** (`候选`/`常用`/`本能`/`降级`/`反驳`/`归档`…) are
  normalized to the locked enum; a status cell with `｜`-suffixed notes resolves
  from its first segment.
- **Legacy Chinese card field labels** (`- **为什么**：…`, `- **失败/反例**：…`,
  `- **场景**：…`) are parsed and mapped to the canonical fields. A card without
  its own `source` is complete when the matching judgment row carries one
  (hand-written libraries keep the source in `judgments.md`).
- **Legacy Chinese index headers** (`| 触发 | 指针 | 说明 |`) are accepted.
- **Multi-pointer index cells** (`；`/`;` separated) are split and each token is
  validated separately. Relative pointers resolve against the workspace root
  first, then the memory root; trailing `（…）` annotations, `第 N–M 行` suffixes
  and wildcards (`*`) are handled; informal pointers that do not look like paths
  are not reported as broken.
- **Pending aggregation.** A pending group with more than 10 items of one type
  (for example 267 candidate judgments) collapses into a single
  `{ aggregated: true, count, detail, sample }` entry; the raw count is exposed
  as `pendingTotal`. Review/handoff JSON no longer grows with the library.

### Changed

- New error code `LEGACY_FORMAT_READ_ONLY`.
- `review` data adds `pendingTotal` and `counts.pendingGroups`; `handoff` data
  and its JSON sidecar add `pendingTotal`; `stats.pending` stays the raw count.
- Self-test grows with a legacy-library regression fixture (5-column table,
  Chinese statuses/labels, multi-pointer index, no manifest, aggregated
  pending).

## [0.1.0] — 2026-11-08

### Added

- Four commands — `init`, `judge`, `handoff`, `review` — exposed as:
  - CLI: `dsh-self <command> [options]`
  - DSH slash commands: `/self-init`, `/self-judge`, `/self-handoff`, `/self-review`
  - DSH agent tools: `dsh_self_init`, `_judge`, `_handoff`, `_review`
- Every command supports `--json` with the documented envelope (see
  `docs/ECOSYSTEM.md`).
- Format lock v1: locked directory layout, table column names, status enum,
  card field names and machine markers (see `docs/FORMAT.md`).
- Versioned templates under `templates/v1/{zh,en}` with
  `template=v1.0.0 format=1` markers, copied by `init` and recorded in the
  workspace manifest.
- `handoff` writes a continuation package (`.md`) plus a machine-readable
  `.json` sidecar (`schema: "dsh-self/handoff"`).
- `review` checks: hot size >800 chars / >2 KB, context-share estimate,
  pending-to-persist list, judgments/cards consistency, broken index pointers,
  template-version drift.
- `./format` and `./core` subpath exports so other Node plugins can reuse the
  parsers and command implementations.
- Zero runtime dependencies, no network calls, no telemetry; user files are
  never overwritten (`init` only adds missing files).

### Template v1.0.0

- Initial scaffold: `hot/state.md`, `index.md`, `judgments.md`,
  `judgments-cards.md`, `QUICKSTART.md` in Chinese and English.
- Placeholders only — no real judgments, identities, or private memory content.
