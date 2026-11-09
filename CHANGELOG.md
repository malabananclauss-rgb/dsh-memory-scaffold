# Changelog

## [0.4.0]

- **New command `diff`**: compare two score JSON files (`{"total":…,"items":[{name,score,weight}]}`) and report total delta/difference rate, per-item difference rate (`|b−a|/weight×100`), focused loss, and the A→B direction. Direction is asymmetric; run with A/B swapped for the reverse. Read-only, no model calls.
- **New command `recall`**: rank judgments from `judgments.md` by relevance (query terms matching conclusion + boundary), recency (`hits.jsonl` latest time/count) and importance (status + card existence); returns top N with the three component scores. Read-only, no model calls.
- **New command `check`**: validate the fixed 7-column judgment schema, status enum (Chinese statuses or canonical candidate/common/instinct), cards required for common/instinct, and pointer format for J616+ rows; reports violation count and line numbers. Read-only; exits 1 on violations.
- All three commands support `--json`, are exposed as `/self-*` slash commands and `dsh_self_*` agent tools; 8 commands + 8 tools total. No network, no writes, no model calls.

## [0.3.0]

- **Renamed again:** `dsh-self` → `dsh-memory-scaffold` (v0.2.0) → **`qing-self`** (v0.3.0). The npm name `qing-self` is available; `qing` is occupied.
- Package/repository/import names are now `qing-self`. **Compatibility is unchanged:** CLI binary `dsh-self`, slash commands, agent tools, `.dsh-self/` paths, template markers and format schemas stay as-is.
- README/docs/install commands use the new repository and tag `v0.3.0`; GitHub redirects old URLs.
- Rolls up 0.2.0 (rename + release content) and 0.1.7 (unique two-question ruler) / 0.1.6 (compact handoff, `--focus`).

## [0.2.0]

- **Renamed the package and repository** from `dsh-self` to **`dsh-memory-scaffold`**
  (the npm name `dsh-self` is occupied by an unrelated project; the new name was
  available). Version 0.2.0 is a breaking release because the package name and
  repository URL changed.
- **Compatibility is unchanged:** the CLI binary is still `dsh-self`, the slash
  commands (`/self-init`, `/self-judge`, `/self-handoff`, `/self-review`,
  `/self-ruler`), agent tools (`dsh_self_*`), `.dsh-self/` directory, template
  markers and format schemas (`dsh-self/memory`, `dsh-self/handoff`) are kept as-is.
- README/docs/install commands now use the new repository and tag `v0.2.0`;
  GitHub redirects the old URLs. Install: `dsh plugin --profile web add git+https://github.com/malabananclauss-rgb/dsh-memory-scaffold#v0.2.0`.
- This release rolls up the unreleased 0.1.7 ruler work (unique two-question ruler:
  transferability × continuability) and the 0.1.6 compact handoff / `--focus` work.

## [0.1.7]

- **`ruler`: the two-question ruler (`/self-ruler` + `dsh_self_ruler`).**
  Give it a judgment or situation and it returns two questions made concrete for
  that input — (1) **transferability**: would this judgment still hold if another
  version of me used it (resources / time / environment / model conditions; if it
  only holds for "me at that moment", it is a situation, not a judgment), and
  (2) **continuability**: if I forgot everything tomorrow, could it be picked up
  again (written down and recoverable by the next version, or only "I remember"?
  memory disappears with the body) — plus one line for the biggest risk and a
  copyable prompt to paste into any AI. It is a local template + keyword heuristic:
  **zero model calls, zero network, no file writes**, and needs no memory directory.
  Localized `zh`/`en`. (0.1.7 was not released separately; its content ships in 0.2.0.)

- CLI: `dsh-self ruler [--situation <text>] [--context <text>] [--lang zh|en] [--json]`,
  or pass the situation positionally (`dsh-self ruler 我该不该换模型`).
- DSH: `/self-ruler` slash command and `dsh_self_ruler` agent tool; both accept
  the same situation/context/language fields. The plugin now registers **five**
  slash commands and **five** agent tools.
- `ruler` data/envelope: `questions` (2 × title + follow-ups), `prompt`, `risk`,
  `risks`, `keywords`, `modelCalls: 0`; input longer than 4,000 characters is
  truncated with the `RULER_INPUT_TRUNCATED` warning.
- Docs: README/README.zh-CN (how to use, scenarios), SELFTEST and
  `docs/ECOSYSTEM.md` (envelope + DSH surfaces table) updated; the command-count
  wording moves from four to five.

## [0.1.6]

- **`handoff --compact`: a 6–10 KB continuation package.** The full handoff keeps
  growing with the judgment library (≈38 KB on the live library); compact mode
  renders only what a successor needs to continue the *direction*: the key
  sections of `memory/my-direction.md` (what I want to become / do / refuse,
  接续者怎么用), the `hot/state.md` snapshot, common/instinct judgments condensed
  to `id · conclusion · boundary`, focus-selected judgment cards, unfinished
  items, and the 8 verification questions. It is capped at 10 KB (target start
  6 KB); when the budget is tight it drops judgment rows/cards and says so in
  the document. Full mode is unchanged.
- **`--focus <主题1,主题2>`: topic-selected judgment cards.** Comma-separated
  topics; for each topic, the first matches by card title, then judgment
  conclusion, then any card body field are selected; at most 2 cards per topic,
  de-duplicated across topics, with unmatched topics reported. Only valid with
  `--compact` (full mode already contains every card). This replaces the need to
  hand-map topics to card ids (the `bench_material.py` TOPIC_CARDS map was the
  experiment record; the plugin now matches by keywords generically).
- The compact package and its JSON sidecar record `docBytes`, `compact.focus`
  (topics / selected card ids / unmatched), size caps and omission counts;
  `handoff` data now always carries `docBytes`.
- Commands/tools: `handoff` accepts `--compact` / `--focus`; the CLI human
  output shows the compact size and selected cards; `dsh_self_handoff` gained
  `compact` and `focus` parameters.
- Docs: README/README.zh-CN, SELFTEST and `docs/ECOSYSTEM.md` describe compact
  mode, the focus matcher and the new JSON fields.

## [0.1.5]

- **fix(workspace): workingDirectory resolution no longer falls back to the host
  process cwd.** `index.js` used to read `ctx.get('workingDirectory')` once during
  `apply()`; when DSH's optional `workingDirectory` service was not yet activated
  after a host restart/HMR, or `ensure()` threw because the current and original
  project directories were both gone (`dsh-working-directory` 0.2.2-rc.1
  `lib/index.js:12-17, 91-107`; README "Missing original project"), the plugin fell
  back to `process.cwd()` — the host directory — and reported `NOT_INITIALIZED`.
  New chain: `workingDirectory.ensure()` (re-resolved on every call) →
  `agent.session.header.cwd` → configured workspace → first ancestor owning the
  memory directory → otherwise a distinct `DIRECTORY_UNAVAILABLE` error. A resolved
  directory without a memory scaffold still reports `NOT_INITIALIZED`, so the two
  failure classes stay distinguishable.
- Regression tests (+6, selftest 43/43): absent service with a header cwd,
  `ensure()` throwing, service-directory precedence, late-mounted service retry,
  `DIRECTORY_UNAVAILABLE` classification, and resolved-but-uninitialized
  classification. The "no candidate" case asserts the plugin never consults the
  host process cwd (the package lives under `D:\DSH`, which owns `memory/`).

## [0.1.4]

- **decisions.md: session decisions in the handoff.** New fifth file `memory/decisions.md`
  records what *this session* settled (decision / why / status). `handoff` now carries those
  entries into the package as section 4, so a model swap keeps the session-level choices as
  well as the long-lived judgments. Without entries the section says so explicitly instead of
  silently omitting them.
- Section numbering is now 1 state → 2 judgments → 3 cards → 4 decisions → 5 pending →
  6 verification → 7 replay → 8 validation → 9 honesty.
- `init` creates `decisions.md` (idempotent, never overwrites), stats include `decisions`.
- The JSON sidecar gains `decisions` entries.


## [0.1.3]

- **handoff: validation record.** Every package now includes a machine-check section
  (hot size vs limits, judgment/card parse status, format issues, warnings, unverified note)
  so the next session knows what was checked and what must be re-checked with `review`.
- **handoff: UNKNOWN rule.** The discontinuity note now requires unread/unverified content to be
  marked `UNKNOWN` and filled in from the source, never invented.
- **handoff: capacity governance.** Warning `HANDOFF_LARGE` when the package exceeds 64 KB and
  `HANDOFF_HISTORY_LARGE` when `handoffs/` holds more than 10 packages (keep the recent ones,
  archive the rest). Mirrors the bounded-snapshot rule used by project handoff skills.
- JSON sidecar gains a `validation` block.


## [0.1.2]

- **fix(tools): workspace discovery after a host restart.** When the `workingDirectory`
  service is unavailable, the agent tools used the host process cwd and reported
  `NOT_INITIALIZED`. They now walk upwards from that cwd to the first directory owning
  `memory/`; a resolved workspace is never re-pointed.
- **fix(review):** `CARD_COUNT_MISMATCH` compared the total judgment count with the card
  count. It now reports only *common/instinct* judgments that lack a card; candidates need
  no card.
- **test(write-guard):** added `assertTempWriteWorkspace()` and a regression case: every
  file-writing CLI call (`init`/`judge`/`handoff`) and the plugin working directory must
  stay inside `test/.tmp`; `D:/DSH`, `D:/DSH/memory` and the package `memory/` are refused.
  Reason: a 2026-11-09 debugging session pointed `judge --workspace D:\DSH` at the live
  memory; the accidental row/card was removed and the guard prevents a repeat.


All notable changes to the qing-self package (formerly `dsh-self` / `dsh-memory-scaffold`) and its scaffold templates.

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
