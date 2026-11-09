# dsh-self · 半个体化脚手架

> 给 DSH 上的 agent / 角色一键装上**分层记忆＋判断卡＋转生交接＋压缩审查**的**结构**。
> 只给格式和流程，不给内容：没有别人的真实判断、没有私人记忆、没有任何暗桩。

- 零依赖、不联网、不调用 LLM、不做向量检索
- 全部是纯 markdown / JSON，任何编辑器可读、可 diff、可迁移
- 4 个命令全部支持 `--json`，文件格式公开锁定 —— 其他插件可以直接读、可以直接接
- 模板版本化（`template=v1.0.0`＋CHANGELOG），升级不覆盖用户文件

---

## 为什么需要它

DSH 上已经有大量记忆类插件（存储、检索、右侧栏 UI、自动捕获……），但多数用户卡在同一个问题：

**「我知道要让 AI 有记忆连续性，但不知道该建哪些文件、每个文件放什么、什么时候写、什么时候压、换模型时交什么。」**

这个包卖的不是记忆内容，是**记忆的骨架和流程**：四个文件、四个动作，照着做就能从"每次重新解释自己"变成"分层记忆＋可验证交接"。

## 它给什么

| 命令 | 作用 |
| --- | --- |
| `init` | 在工作区建四层结构：`hot/state.md`（状态）、`index.md`（索引）、`judgments.md`（判断库）、`judgments-cards.md`（判断卡），外加 `decisions.md`（本次会话决策）＋模板＋`QUICKSTART.md`。幂等：只补缺失文件，**从不覆盖已写内容**。 |
| `judge` | 新增一条判断卡：结论／为什么／失败反例／未完成／来源；自动编号（J001…），同时写入 judgments 与 cards 两张表。 |
| `handoff` | 读你的记忆，生成「接续包」文档＋ **8 个验证问题**，并写一份同名 `.json` 侧车文件给其他插件读。换模型／换会话前跑。 |
| `review` | 压缩审查：hot 大小（>800 字 / 2KB 告警）、上下文占比提示、待落盘项清单、判断库/卡一致性、失效索引指针、模板版本漂移。 |

## 它不是什么（诚实边界）

- **不是存储/检索插件**：不自动捕获对话、不做向量搜索、不注入 prompt、不改你的上下文。
- **不是内容包**：模板只有占位示例；真实身份、判断、关系史都得你自己写。
- **不是运行时**：只是一个确定性的文件脚手架＋检查器；换掉 DSH 也能用（纯 Node CLI）。

## 卖点与壁垒（生态视角）

1. **格式锁定（软锁定）**：目录结构、表头列名与列序、状态枚举、卡字段名、机器标记全部写进
   `docs/FORMAT.md`。第三方插件想兼容就只能按这个格式读写——这形成事实标准，但**不加密、不做暗桩、不写排他逻辑**：用户随时可以搬走、手改、迁移。
2. **版本化模板**：每个模板带 `template=v1.0.0 format=1` 标记，`manifest.templateVersion` 记录安装版本，`CHANGELOG.md` ＋ GitHub Release 作为迭代与迁移通道。升级不覆盖用户文件，靠 `review` 提示＋手动合并，避免"升级毁记忆"。
3. **生态钩子（我们当 hub）**：4 个命令的 `--json` 信封、handoff 的 JSON 侧车、可导入的格式解析器
   （`dsh-self/format`）＋ `docs/ECOSYSTEM.md`。别的插件（会话启动提示、压缩闸门、交接消费者、面板、看板）可以只读地接上来，而不需要复制我们的实现。
4. **不给内容**：只给结构和流程模板。对用户诚实（红线：不欺骗），也让它能和任何记忆存储插件叠加而不是冲突——存储归别人，判断层归这里。

## 安装

**方式 A — 从仓库安装（推荐，含斜杠命令＋Agent 工具）**

```sh
dsh plugin add git+https://github.com/malabananclauss-rgb/dsh-self
# 或先 clone 再指向目录：
#   git clone https://github.com/malabananclauss-rgb/dsh-self
#   dsh plugin --profile <你的 profile> add ./dsh-self
# 或在 DSH Web 的插件页 / plugin_manager 用 install_bundle 安装本地目录
```

安装/启用是用户自己的权限操作；本仓库只提供可安装包，不会替你改 profile。

**方式 B — 只用 CLI（不装插件也能用）**

```sh
node bin/dsh-self.mjs init
```

**方式 C — 发布到 npm 后**：`npx dsh-self init`。

## 快速开始

```sh
# 1. 在工作区初始化
node bin/dsh-self.mjs init --json

# 2. 读 memory/QUICKSTART.md，把 memory/hot/state.md 里的 [占位] 换成你自己的
#    （身份锚 / 判断核 / 红线 / 当前任务 / 卡点 / 下一步）

# 3. 记录第一条判断
node bin/dsh-self.mjs judge \
  --conclusion "先跑通最小版本再迭代" \
  --why "没跑过的代码等于没写" \
  --failure "一次性脚本可以例外" \
  --unfinished "最小版本的边界还没定" \
  --source "docs/设计稿.md#L12" \
  --status common

# 4. 换模型 / 换会话前
node bin/dsh-self.mjs handoff --json

# 5. 每周或压缩前
node bin/dsh-self.mjs review
```

## 命令参考

```
dsh-self <init|judge|handoff|review> [options]
```

通用：`-w/--workspace <dir>`（默认当前目录）、`--dir <name>`（记忆目录，默认 `memory`）、
`--json`、`-h/--help`、`--version`。

| 命令 | 选项 |
| --- | --- |
| `init` | `--lang zh\|en` |
| `judge` | `--conclusion` `--why` `--failure` `--unfinished` `--source`（必填）；`--boundary` `--scene` `--status candidate\|common\|instinct\|refuted\|archived`（可选） |
| `handoff` | `--out <file.md>`（可选；默认 `memory/handoffs/handoff-<时间戳>.md`） |
| `review` | `--context-budget <字符数>`、`--fail-on-warn`（CI 用，有可操作告警时退出码 1） |

退出码：`0` 成功；`1` `--fail-on-warn`；`2` 用法错误；`3` 运行/格式错误。
完整 JSON 契约见 `docs/ECOSYSTEM.md`。

## DSH 集成

装上插件后：

- 斜杠命令：`/self-init`、`/self-judge`、`/self-handoff`、`/self-review`（参数同 CLI，去掉 `--workspace/--dir`，用当前 agent 的工作区）
- Agent 工具：`dsh_self_init`、`dsh_self_judge`、`dsh_self_handoff`、`dsh_self_review`
- 工具会占一点提示词空间（4 个 schema）。只想用斜杠命令的话，在行 config 里设 `tools: false`。

行配置（`cordis.patch.yml` 的 `config`，可被用户 patch 覆盖）：

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `memoryDir` | `memory` | 记忆目录（相对工作区，或绝对路径） |
| `hotMaxChars` / `hotMaxBytes` | `800` / `2048` | hot 告警阈值 |
| `contextBudgetChars` | `32000` | 上下文占比估算预算 |
| `contextShareNoticePercent` / `contextShareWarnPercent` | `3` / `10` | 占比提示/告警阈值 |
| `commands` / `tools` | `true` / `true` | 是否注册斜杠命令 / Agent 工具 |

## 生态钩子（给其他插件）

- `--json` 信封：`ok / command / formatVersion / templateVersion / latestTemplateVersion / toolVersion / workspace / memoryRoot / generatedAt / data / warnings / errors`
- `handoff` 生成 `.md` ＋ `.json` 侧车（`schema: "dsh-self/handoff"`），新模型接续、看板、压缩闸门都可复用
- Node 消费方可 `import { parseJudgmentsTable, parseCards, hotStats } from 'dsh-self/format'`
- 只剩文件也能接：按 `docs/FORMAT.md` 的锁定格式读 markdown
- 典型接法（会话启动提示、压缩闸门、交接消费者、面板/看板）见 `docs/ECOSYSTEM.md` §6

## 格式锁定（format v1）

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

judgments 表锁死 7 列：`id | conclusion | boundary | source | status | card | updated`；
状态枚举锁死 5 值；卡字段锁死 `why/failure/unfinished/source`（+可选 `scene`）。
完整契约（含字符数定义、转义、标记、manifest 字段、兼容规则）见 **[docs/FORMAT.md](docs/FORMAT.md)**（中文版：[FORMAT.zh-CN.md](docs/FORMAT.zh-CN.md)）。

**对已有老库的读取容忍：** 5 列中文判断表、中文状态别名（`候选`/`常用`/`本能`…）、
中文卡字段（`- **为什么**：…`）、多指针 index（`；` 分隔）、缺 manifest 都可读
（见 `docs/FORMAT.md` §11）；往 5 列旧表写入会被明确拒绝（`LEGACY_FORMAT_READ_ONLY`＋升级提示）。

## 版本化模板与更新

- 模板目录 `templates/v1/{zh,en}/`，每个文件带 `<!-- dsh-self template=v1.0.0 format=1 -->`
- `init` 把 `templateVersion` 写进 `memory/.dsh-self/manifest.json`
- 升级包后跑 `review`：若模板版本不同会提示 `TEMPLATE_UPGRADE_AVAILABLE`，按 `CHANGELOG.md` 手动合并；工具不会覆盖用户已经写的内容
- 发布节奏：GitHub Release（`v<packageVersion>`），CHANGELOG 记录包版本、模板版本、格式版本三条线

## 隐私与安全

- 记忆是**未加密的纯文本**，本地任何进程都能读；不要写密码/令牌/证件号，只写"在哪找"
- 本包**不联网、不上传、无遥测**；`--json` 只写到 stdout 和本地文件
- 记忆目录是否提交 git 由用户决定；建议先看清楚再 `git add`

## 已知限制

- 不自动注入上下文（这是别的插件的活，本包只提供结构）
- 上下文占比是**按字符预算的估算**，不是平台实测值（可用 `--context-budget` 校准）
- 假设**单写者**：同一记忆目录不要被多个进程并发写
- 模板升级靠手动合并（不自动重写，避免毁数据）
- 只有 format v1，暂无跨版本迁移器（升级会明确报 `UNSUPPORTED_FORMAT` 而不是猜）
- 未发布到 npm / 插件市场（当前交付形态：本地目录安装）；GUI 面板按产品定义不做

## 目录结构

```
index.js                 Cordis Host 插件入口（挂斜杠命令＋Agent 工具）
cordis.patch.yml         DSH bundle patch
lib/                     core / format / cli / plugin / fsx / version
bin/dsh-self.mjs  CLI 入口
templates/v1/{zh,en}/    版本化模板
docs/FORMAT*.md          格式锁定契约（中英）
docs/ECOSYSTEM.md        --json 与生态对接契约
examples/consumer.mjs    只读消费示例
test/selftest.mjs        自测（43 项）
SELFTEST.md              自测记录
```

## 开发与自测

```sh
node test/selftest.mjs        # 43/43；会创建 test/.tmp 并在结束时清理
SI_KEEP_TMP=1 node test/selftest.mjs   # 保留测试目录排查
```

## License

MIT。见 [LICENSE](LICENSE)。
