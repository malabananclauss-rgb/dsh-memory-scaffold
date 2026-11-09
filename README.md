# dsh-self

> A scaffold that gives a DSH agent or role **layered memory + judgment cards +
> model handoff + compression review** in one command — structure only, no content.
> No third-party judgments, no private memories, no hidden behavior.

- Zero dependencies, no network, no LLM calls, no embeddings
- Plain markdown + JSON that any editor can read, diff and migrate
- Every command supports `--json`; the on-disk format is published and locked,
  so other plugins can read it and build on it
- Versioned templates (`template=v1.0.0` + CHANGELOG); upgrades never overwrite
  user files

---

## Why it exists

The DSH ecosystem already has many memory plugins (storage, retrieval, sidebars,
automatic capture). What most users still lack is a **decision about structure**:
which files to keep, what goes in each, when to write, when to compact, and what
to hand over when switching models.

This package is not another store. It is the **skeleton and ritual**: four files,
five operations, and a machine-readable contract that other plugins can integrate
with.

## What you get

| Command | What it does |
| --- | --- |
| `init` | Creates the four-layer structure — `hot/state.md`, `index.md`, `judgments.md`, `judgments-cards.md`, `decisions.md` — plus templates and a `QUICKSTART.md`. Idempotent: adds missing files, **never overwrites** what you wrote. |
| `judge` | Adds one judgment card: conclusion / why / failure-counterexample / unfinished / source. Auto-numbered (J001…), written to both the index table and the card file. |
| `handoff` | Reads your memory, writes a continuation package plus **8 verification questions**, and a machine-readable `.json` sidecar for other plugins. Run it before switching model or session. `--compact` emits a 6–10 KB package (direction + hot + condensed live judgments + `--focus` cards + pending + questions); `--focus` selects judgment cards by topic. |
| `review` | Compression review: hot size (>800 chars / >2 KB warning), context-share estimate, not-yet-persisted items, judgments/cards consistency, broken index pointers, template drift. |
| `ruler` | The two-question ruler: turns a judgment into two concrete follow-ups — would it survive another version of me (transferability), and could it be recovered if I forgot everything tomorrow (continuability) — plus a copyable prompt for any AI and the biggest risk. Local template + keyword heuristic — **zero model calls, no network, no writes**. |

### Two-question ruler: transferability × continuability (no model calls)

Use the ruler before turning an insight into a judgment. It turns **your** wording into two concrete
follow-ups instead of repeating borrowed wisdom:

1. **Transferability**: would this judgment still hold if another version of me used it? Which resources / time /
   environment / model conditions does it depend on? If it only holds for "me at that moment", it is a situation,
   not a judgment.
2. **Continuability**: if I forgot everything tomorrow, could this judgment be picked up again — written down and
   recoverable by the next version, or only "I remember"? Memory disappears with the body.

```bash
dsh-self ruler --situation "我该不该把发布交给青决定？" --context "本周内要给答复。"
dsh-self ruler 我该不该换模型                # positional form
```

It also returns one line for the biggest risk and a fenced **copyable prompt** you can paste into
any AI (or answer yourself). DSH users get the same through `/self-ruler` and `dsh_self_ruler`.

Use it for: irreversible decisions, promises with a cost, evaluating someone, spending money or
asking someone to bear a consequence. It deliberately does **not** call a model, use the network or
write any memory file — the judgment stays yours (or the AI you paste it into).

## What it is not

- **Not a store/retrieval plugin**: no auto-capture, no embeddings, no prompt
  injection, no context manipulation.
- **Not a content pack**: templates contain placeholders only. Identity,
  judgments and relationship history are yours to write.
- **Not a runtime**: a deterministic file scaffold and checker; the CLI works
  without DSH (plain Node).

## Positioning and moat

1. **Format lock (soft)**: directory layout, table columns, status enum, card
   field names and machine markers are fixed in `docs/FORMAT.md`. Third-party
   plugins that want compatibility must follow the format — this creates a
   de facto standard, but there is **no encryption, no hidden marker, no
   exclusivity logic**: users can move, edit and migrate their memory freely.
2. **Versioned templates**: every template carries
   `template=v1.0.0 format=1`; `manifest.templateVersion` records what was
   installed; `CHANGELOG.md` + GitHub Releases are the upgrade path. Upgrades
   never overwrite user files — `review` reports drift and the user merges.
3. **Ecosystem hook (we are the hub)**: the `--json` envelope on all five
   commands, the handoff JSON sidecar, importable format parsers
   (`dsh-self/format`) and `docs/ECOSYSTEM.md`. Other plugins (session-start
   pointer, compaction gate, handoff consumer, panels, dashboards) can read
   without copying the implementation.
4. **Content-free**: structure and process templates only. That keeps it honest
   and lets it stack with any memory store instead of competing — storage stays
   with storage plugins; the judgment layer lives here.

## Install

**A — install from the repository (recommended; slash commands + agent tools)**

```sh
dsh plugin add git+https://github.com/malabananclauss-rgb/dsh-self
# or clone and point at the directory:
#   git clone https://github.com/malabananclauss-rgb/dsh-self
#   dsh plugin --profile <your profile> add ./dsh-self
# or install the local directory from the Web Plugins page / plugin_manager install_bundle
```

Installing/enabling is the user's own permission step; this repository only ships
an installable bundle and never edits your profile.

**B — CLI only (no plugin required)**

```sh
node bin/dsh-self.mjs init
```

**C — once published to npm**: `npx dsh-self init`.

## Quick start

```sh
# 1. initialize in your workspace
node bin/dsh-self.mjs init --json

# 2. read memory/QUICKSTART.md and replace the [placeholder] lines in
#    memory/hot/state.md (identity anchor / judgment core / red lines /
#    current task / blocker / next step)

# 3. record the first judgment
node bin/dsh-self.mjs judge \
  --conclusion "Ship the smallest working version first" \
  --why "Code that never ran is code that was never written" \
  --failure "One-off scripts can be exempt" \
  --unfinished "The boundary of 'smallest' is still undefined" \
  --source "docs/design.md#L12" \
  --status common

# 4. before switching model/session
node bin/dsh-self.mjs handoff --json
node bin/dsh-self.mjs handoff --compact --focus "磨镜,好名"

# 5. before a hard decision: two concrete questions, zero model calls
node bin/dsh-self.mjs ruler --situation "Should I take this task? Who bears the cost?"

# 6. weekly or before compaction
node bin/dsh-self.mjs review
```

## Command reference

```
dsh-self <init|judge|handoff|review|ruler> [options]
```

Common: `-w/--workspace <dir>` (default: cwd), `--dir <name>` (memory directory,
default `memory`), `--json`, `-h/--help`, `--version`.

| Command | Options |
| --- | --- |
| `init` | `--lang zh\|en` |
| `judge` | required: `--conclusion` `--why` `--failure` `--unfinished` `--source`; optional: `--boundary` `--scene` `--status candidate\|common\|instinct\|refuted\|archived` |
| `handoff` | `--out <file.md>` (default `memory/handoffs/handoff-<timestamp>.md`); `--compact` compact package (target 6–10 KB); `--focus topic1,topic2` matches card titles → judgment conclusions → card bodies, max 2 cards per topic, requires `--compact` |
| `review` | `--context-budget <chars>`, `--fail-on-warn` (CI: exit 1 on actionable warnings) |
| `ruler` | `--situation <text>` (or pass it positionally), `--context <text>`, `--lang zh|en` |

Exit codes: `0` success; `1` `--fail-on-warn`; `2` usage; `3` runtime/format.
The full JSON contract is in `docs/ECOSYSTEM.md`.

## DSH integration

With the bundle installed:

- slash commands: `/self-init`, `/self-judge`, `/self-handoff`, `/self-review`, `/self-ruler`
  (same options as the CLI minus `--workspace`/`--dir`; they use the agent's
  workspace)
- agent tools: `dsh_self_init`, `dsh_self_judge`,
  `dsh_self_handoff`, `dsh_self_review`, `dsh_self_ruler`
- tools cost a little prompt space (five schemas). For slash-commands-only use,
  set `tools: false` in the row config.

Row config (the bundle patch's `config`; users can override it):

| Key | Default | Meaning |
| --- | --- | --- |
| `memoryDir` | `memory` | Memory directory (relative to the workspace, or absolute) |
| `hotMaxChars` / `hotMaxBytes` | `800` / `2048` | hot warning thresholds |
| `contextBudgetChars` | `32000` | Character budget for the context-share estimate |
| `contextShareNoticePercent` / `contextShareWarnPercent` | `3` / `10` | notice/warn thresholds |
| `commands` / `tools` | `true` / `true` | register slash commands / agent tools |

## Ecosystem

- `--json` envelope: `ok / command / formatVersion / templateVersion /
  latestTemplateVersion / toolVersion / workspace / memoryRoot / generatedAt /
  data / warnings / errors`
- `handoff` writes a `.md` package plus a `.json` sidecar
  (`schema: "dsh-self/handoff"`)
- Node consumers can
  `import { parseJudgmentsTable, parseCards, hotStats } from 'dsh-self/format'`
- File-only consumers follow the locked markdown format in `docs/FORMAT.md`
- Integration recipes (session-start pointer, compaction gate, handoff consumer,
  dashboards) are in `docs/ECOSYSTEM.md` §6

## Format lock (format v1)

```
memory/
├── hot/state.md
├── index.md
├── judgments.md
├── judgments-cards.md
├── decisions.md
├── QUICKSTART.md
├── handoffs/handoff-<ts>.md + .json
└── .dsh-self/manifest.json
```

The judgments table is locked to seven columns
(`id | conclusion | boundary | source | status | card | updated`), the status
enum to five values, and card fields to
`why/failure/unfinished/source` (+ optional `scene`). Full contract:
**[docs/FORMAT.md](docs/FORMAT.md)** (Chinese: [FORMAT.zh-CN.md](docs/FORMAT.zh-CN.md)).

**Read tolerance for existing libraries:** a 5-column Chinese judgment table,
Chinese status aliases (`候选`/`常用`/`本能`…), Chinese card labels
(`- **为什么**：…`), multi-pointer index cells (`；`-separated) and a missing
manifest are all readable (see `docs/FORMAT.md` §11). Writing into a legacy
5-column table is refused with `LEGACY_FORMAT_READ_ONLY` and an upgrade hint.

## Versioned templates

- `templates/v1/{zh,en}/`, each file marked
  `<!-- dsh-self template=v1.0.0 format=1 -->`
- `init` records `templateVersion` in `memory/.dsh-self/manifest.json`
- after upgrading the package, `review` reports
  `TEMPLATE_UPGRADE_AVAILABLE` when the installed template version differs; the
  user merges per `CHANGELOG.md` — the tool never rewrites user files
- release cadence: GitHub Release tagged `v<packageVersion>`; CHANGELOG tracks
  package version, template version and format version separately

## Privacy and security

- Memory is **plain, unencrypted text** readable by any local process. Never
  store passwords/tokens/ID numbers; store a pointer to where they live.
- The package makes **no network calls, no telemetry**; `--json` writes to
  stdout and local files only.
- Whether the memory directory belongs in git is the user's decision.

## Known limitations

- Does not inject context automatically (that is another plugin's job; this
  package provides the structure)
- Context share is a **character-budget estimate**, not a platform measurement
  (calibrate with `--context-budget`)
- Assumes a **single writer**; do not write one memory directory concurrently
  from several processes
- Template upgrades are manual by design (no automatic rewrite)
- Only format v1; no cross-version migrator yet (unknown versions fail loudly
  with `UNSUPPORTED_FORMAT`)
- Not published to npm / a plugin marketplace yet (delivery form: local directory
  install); the GUI panel is intentionally out of scope per the product spec

## Layout

```
index.js                 Cordis Host plugin entry (slash commands + agent tools)
cordis.patch.yml         DSH bundle patch
lib/                     core / format / cli / plugin / fsx / version
bin/dsh-self.mjs  CLI entry
templates/v1/{zh,en}/    versioned templates
docs/FORMAT*.md          format lock contract (EN + zh-CN)
docs/ECOSYSTEM.md        --json and ecosystem contract
examples/consumer.mjs    read-only consumer example
test/selftest.mjs        self-test (59 cases)
SELFTEST.md              self-test record
```

## Development

```sh
node test/selftest.mjs                 # 59/59; creates test/.tmp and cleans it up
SI_KEEP_TMP=1 node test/selftest.mjs   # keep the test directory
```

## License

MIT. See [LICENSE](LICENSE).
