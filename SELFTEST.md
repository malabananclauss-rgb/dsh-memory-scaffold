# SELFTEST — dsh-self 0.1.5

日期：2026-11-08（初版）／2026-11-09（写操作红线加固；0.1.5 工作目录解析）
包版本：0.1.5 · 格式：format v1 · 模板：template v1.0.0（模板无变更）
环境：Windows，DeepSeek Harness 自带 Node **v24.21.0**（`C:\Users\Lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`）
测试目录：`D:\DSH\products\dsh-self\test\.tmp`（测试结束已清理）

> 结论：**43/43 自动化用例通过**；四个命令 + `--json` 真实进程端到端通过；
> 在真实手写老库（323 判断 / 12 卡 / 28 索引，**只读**）上验证兼容修复：
> pending 从 269 条压成 3 组（267 条候选聚合成 1 条），JSON 输出 2972 B，
> 无 `undefined`/非 lossless 值，失效指针误报 0。
> 0.1.1 新增：老库 5 列表/中文状态/中文卡字段/多指针 index 兼容；pending 聚合；
> `LEGACY_FORMAT_READ_ONLY`；lossless JSON 兜底。
> 0.1.2 加固：写操作红线——文件写入用例只许跑在 test/.tmp，真实记忆目录（D:\DSH、D:\DSH\memory）被 guard 直接拒绝（见 §10）。
> 0.1.5 修复：workingDirectory 不再一次性 ctx.get、不再回退宿主 process.cwd；回退链 session.header.cwd → 向上找 memory/；DIRECTORY_UNAVAILABLE 与 NOT_INITIALIZED 分离（见 §2 工作目录解析）。
> 未做（按权限）：不装/不启用插件、不改 profile；Host 进程需重启才能加载 0.1.1/0.1.2 代码。

---

## 1. 验收反馈的 5 项修复对照

| # | 验收问题 | 修复 | 回归用例 |
| --- | --- | --- | --- |
| 1 | 无 manifest 时 `templateVersion: undefined` 触发 "not lossless JSON" | `manifest?.templateVersion ?? null`；新增 `lib/json-safe.js`，所有 JSON 输出/写入先消毒（丢 `undefined`、`NaN`→null、Date→ISO） | legacy 库 review + lossless 单测 |
| 2 | 5 列旧格式（中文表头）不可读 | `parseJudgmentsTable` 先 7 列再试 `id|判断|边界/反例|来源|状态/上次用`，`card/updated` 置空 | legacy 库 review |
| 3 | 中文状态不可读 | `STATUS_ALIASES`＋`normalizeStatus`（候选/常用/本能/降级/反驳/归档/存档；取 `｜` 前段；`降级*`→refuted） | legacy 库断言 5 种状态归一化 |
| 4 | index 中文表头不可读 | `parseIndex` 回退 `INDEX_COLUMNS_LEGACY = ['触发','指针','说明']` | legacy 库 index=4 行 |
| 5a | pending 300+ 条把 JSON 撑爆 | `aggregatePending`：单类型 >10 条聚合为 1 条（`count`/`sample`），原始数量 `pendingTotal` | 聚合用例（阈值+15 条候选；review JSON < 8 KB） |
| 5b | 中文卡字段 `- **为什么**：…` 被判空 | 卡解析支持中文标签映射 + 中文冒号；卡缺 `source` 时从对应判断行继承 | legacy 库卡片断言 |
| 5c | index pointer 用 `；` 分隔被整串判失效 | 多指针拆分逐个校验；相对路径先工作区根后记忆根；去括注/`第 N–M 行`；通配符查父目录；非路径 token 不误报 | legacy 库（只报 1 个真失效，不误报"各自 RULES.md"） |
| 5d | 缺"真实老库"回归 | 新增 legacy 库 fixture（5 列表/中文状态/中文卡/多指针/无 manifest）＋聚合用例 | 见 §2 |

## 2. 自动化自测

```sh
node test/selftest.mjs        # EXIT=0
```

结果：`dsh-self selftest: 43/43 passed`，`SELFTEST_EXIT=0`。
测试在进程内调用 CLI（DSH 沙箱禁止带管道的子进程 stdio，见 §6），并直接单测
`lib/format.js`、`lib/core.js`、`lib/json-safe.js`、`lib/plugin.js`、`index.js`。

| 组 | 数量 | 覆盖 |
| --- | --- | --- |
| 包/bundle 完整性 | 4 | package.json 可安装 bundle；icon+locale+CHANGELOG；zh/en 模板版本标记；模板无真实内容 |
| init | 5 | 四层+QUICKSTART+manifest；幂等不覆盖；`--lang en`；非法 lang；`--dir` |
| judge | 6 | 必填/非法 status/未初始化/自动编号双表/转义与多行/坏表头 |
| handoff | 3 | .md+8 问+.json 侧车；`--out`；未初始化 |
| review | 6 | 健康结构；hot >800 字/2KB 双告警＋`--fail-on-warn`；上下文占比；失效指针；formatVersion 拒绝；未初始化 |
| CLI 表面 | 3 | 人类输出；help/version/未知项；四命令 `--json` 信封一致性 |
| 格式工具 | 2 | 表格转义往返；字符数/ID/枚举/日期戳 |
| **老库兼容（0.1.1）** | 2 | 5 列旧表＋中文状态＋中文卡字段＋多指针 index＋无 manifest；大 pending 聚合 |
| **lossless JSON（0.1.1）** | 1 | undefined 丢弃、NaN→null、Date→ISO、可往返 |
| **版本/文档一致性（0.1.1）** | 1 | package=0.1.1=version.js=CHANGELOG，FORMAT 文档含旧格式说明 |
| 插件注册层 | 3 | apply 注册 4 命令+4 工具并持有 effect；斜杠命令实跑核心；Agent 工具 execute/render；config 关单侧 |
| **写操作红线（0.1.2 加固）** | 1 | `captureCli` 对 init/judge/handoff 强制 cwd 在 `test/.tmp`；`D:/DSH`、`D:/DSH/memory`、产品 `memory/` 被 guard 拒绝；只读 review 不受限 |
| **工作目录解析（0.1.5）** | 6 | 无服务+无候选→DIRECTORY_UNAVAILABLE（断言不回退宿主 cwd）；session.header.cwd 回退；ensure 抛错回退；服务目录优先；延迟挂载服务重试（非一次性 ctx.get）；已解析目录无 scaffold→NOT_INITIALIZED（错误码分离） |

## 3. 真实老库验证（只读）

来源：`D:\DSH\memory`（用户真实手写库；只运行 `review`，不写入、不 handoff、不 judge）。

```sh
node bin/dsh-self.mjs review --workspace D:\DSH --json   # EXIT=0
```

| 指标 | 结果 |
| --- | --- |
| 判断解析 | **323** 条（7 列英文表头 + 中文状态值，0 解析 issue） |
| 判断卡解析 | **12** 张（`- **为什么**：` 中文加粗字段；source 从判断行继承，0 张误判"字段为空"） |
| index 解析 | **28** 行；多指针 `；` 拆分逐个校验，失效指针 **0**（"各自 RULES.md"/"最新 HANDOFF" 等说明性 token 不误报） |
| pending | 原始 **269** 条 → 聚合为 **3** 组：267 条候选判断（1 条聚合项）+ 1 hot_todo + 1 no_handoff |
| JSON 体积 | **2972 B**（聚合前会随 300+ 条候选线性膨胀） |
| 非 lossless 值 | 无；`templateVersion = null`（无 manifest，按约定；告警 `MANIFEST_MISSING`） |
| 其他告警 | `CARD_COUNT_MISMATCH`（323 判断 vs 12 卡，符合"常用及以上必须有卡"的提示） |
| hot | 694 字 / 1752 B（在 800/2048 上限内，`status=ok`） |

## 4. 真实进程端到端（0.1.1）

用真实 `bin/dsh-self.mjs` 进程跑（PowerShell 直接调用；测试目录已清理）：

| 步骤 | 退出码 | 结果 |
| --- | --- | --- |
| `--version` | 0 | `dsh-self 0.1.1 (format v1, template v1.0.0)` |
| `init --json` | 0 | created=6，template=1.0.0 |
| `judge ... --json` ×2 | 0 | J001/J002，双表同步 |
| `handoff --json` | 0 | stats `{hotChars:280,hotBytes:747,judgments:2,cards:2,indexEntries:1,pending:4}`，8 问，`pendingTotal=4`；侧车 `schema=dsh-self/handoff`、`toolVersion=0.1.1`、`pendingTotal=4` |
| `review --json` | 0 | `status=ok`，counts `{judgments:2,cards:2,indexEntries:1,handoffs:1,pending:3,pendingGroups:3}` |
| `review --context-budget 2000 --json` | 0 | share=14%，level=warn，`CONTEXT_SHARE_HIGH` |
| 用法错误 `judge --conclusion only --json` | 2 | `USAGE` |
| 未初始化 `review --json`（空目录） | 3 | `NOT_INITIALIZED` |

## 5. JSON 接口抽样（聚合后）

`review --json` 在真实老库上的 `pending`（节选）：

```json
{
  "ok": true,
  "command": "review",
  "formatVersion": 1,
  "templateVersion": null,
  "toolVersion": "0.1.1",
  "data": {
    "counts": { "judgments": 323, "cards": 12, "indexEntries": 28, "handoffs": 0,
                "pending": 269, "pendingGroups": 3 },
    "pending": [
      { "type": "hot_todo", "path": "hot/state.md", "line": 12, "text": "…" },
      { "type": "candidate_judgment", "aggregated": true, "count": 267,
        "detail": "267 条候选判断待消化", "sample": ["J001", "J011", "J013"] },
      { "type": "no_handoff", "detail": "还没有接续包；换模型/换会话前跑一次 handoff" }
    ],
    "pendingTotal": 269
  },
  "warnings": [ { "code": "MANIFEST_MISSING", "message": "…" },
                { "code": "CARD_COUNT_MISMATCH", "message": "…" } ],
  "errors": []
}
```

错误码：`USAGE`(2) / `NOT_INITIALIZED`(3) / `FORMAT_MISMATCH`(3) /
`LEGACY_FORMAT_READ_ONLY`(3) / `BAD_MANIFEST`(3) / `UNSUPPORTED_FORMAT`(3)。

## 6. 插件注册层验证（fake context）

0.1.1 的插件层与 0.1.0 相同（未改注册代码，只改核心/格式/JSON），仍以 fake Cordis context 验证：

- `apply(ctx, config)` 注册 **4 斜杠命令** + **4 Agent 工具**，8 个 effect disposer；
- 命令 handler 实跑核心（含引号参数、`--json`、错误路径）；工具 execute/render 正常；
- `{tools:false}` / `{commands:false}` 可分别关闭；`normalizeConfig` 兜底非法数字。
- 真实 profile 状态：0.1.0 已由青安装并在会话中生效（工具可见）；**0.1.1 是同一目录的代码更新，
  需要重启 Host / 重新加载 bundle 才是新代码**（HMR 是否拾取取决于安装形态）。本次自测在 CLI 进程内验证，
  未调用已安装工具（避免测到旧代模块）。

## 7. 测试环境的已知限制

- DSH 沙箱（workspace-write）下 Node 子进程带管道 stdio 会 EPERM；自动化自测用进程内 `runCli()`，
  真实 bin 由 PowerShell 直接调用验证（§4）。两者共用同一 `runCli` 代码路径。
- 真实老库只做只读 review；未在其上执行 handoff/judge/init（避免写入用户真实记忆目录）。
- 运行时零网络；开发期只读取过参考页面，无大文件下载、无包安装。

## 8. 任务要求对照（含 0.1.1 增量）

| 要求 | 状态 |
| --- | --- |
| init/judge/handoff/review 四命令 + `--json` | ✅ 36/36 + 真实进程 e2e |
| 格式锁定 + 版本化模板 + 生态钩子 + 不含真实内容 | ✅（0.1.1 未改 format v1 / template v1.0.0） |
| 验收反馈 1–4（已由青现场修） | ✅ 已并入产品代码并有回归用例 |
| 验收反馈 5a pending 聚合 | ✅ 单类型 >10 条聚合；`pendingTotal` 保留原始数；真实库 269→3 组 |
| 验收反馈 5b 中文卡字段 | ✅ 中文标签/中文冒号可解析；source 从判断行继承 |
| 验收反馈 5c 多指针 index | ✅ `；`/`;` 拆分逐个校验；真实库失效误报 0 |
| 验收反馈 5d 老库回归用例 | ✅ legacy fixture（5 列表/中文状态/中文卡/多指针/无 manifest） |
| CHANGELOG 升到 0.1.1、自测全绿 | ✅ 0.1.1；36/36 |
| 不改 profile / 不启用停用插件 / 只写产品目录 | ✅ 见 §10 |

## 9. 复现

```sh
node test/selftest.mjs
SI_KEEP_TMP=1 node test/selftest.mjs        # 保留 test/.tmp
node bin/dsh-self.mjs review --workspace D:\DSH --json   # 只读真实库
```

## 10. 越界检查（本轮）

- 写入：仅 `D:\DSH\products\dsh-self\`；测试临时目录已清理。未写 `D:\DSH\memory`、
  未写 `C:\Users\Lenovo\.dsh` profile、未改计划任务/服务/注册表。
- 真实用户记忆：只读（`review` 不写文件）；**例外/事故与加固见下一条**。
- **2026-11-09 写操作事故（已自查清理，青已抽查通过）**：调试时误把
  `dsh-self judge --workspace D:\DSH` 指向真实记忆，写入 1 行 judgments＋1 张卡；
  cards 残留已用精确脚本删除（28,452→28,339 B，64 卡，无 `J585 x`/`- why: y` 痕迹），
  judgments 行已被并发写入覆盖、无残留。加固：`assertTempWriteWorkspace()` 强制
  所有写命令的 cwd 在 `test/.tmp` 内，`D:/DSH`、`D:/DSH/memory`、产品 `memory/`
  直接拒绝；新增回归用例（§2 写操作红线）。**规则：任何会写文件的测试（judge/init/handoff/publish）
  必须跑临时目录，严禁指向真实记忆目录；真实记忆只读。**
- 插件状态：未安装/未启用/未停用任何插件（`plugin_manager` 未调用）；未重启 Host。
- 网络/子体：无下载、无安装、未开子智能体。

## 11. 遗留 / 交给青

1. **重启/重载 Host** 让 0.1.5 代码在真实 profile 生效（插件目录未变，仍是 `D:\DSH\products\dsh-self`）。
2. 重启后在真实 profile 再跑一次 `/self-review` 或 `dsh_self_review`，确认工具层同样不再报
   "not lossless JSON"、pending 输出为聚合后的短 JSON。
3. 发布：npm/GitHub Release `v0.1.2` 与 CHANGELOG 对齐（市场提交由青决定）。
4. 已知限制不变：无自动注入、占比为估算、单写者、手动模板合并、仅 format v1；老库 5 列表只读（写入需手工升级表头）。
