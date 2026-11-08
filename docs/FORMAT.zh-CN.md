# dsh-self 格式 v1（已锁定）

状态：**format v1 锁定**。本文件是人读契约，`lib/format.js` 是唯一实现源。第三方插件想兼容 dsh-self 记忆目录，必须按本文件来。

锁定的目的是兼容，不是控制：目录、字段名、枚举值写死，独立工具才能不经协商读写同一份记忆。**不加密、不设暗桩、不写排他逻辑**——全部是纯 markdown/JSON，任何编辑器都能读、diff、改、迁移。

---

## 1. 编码与换行

- UTF-8，**不带 BOM**。
- `LF`（`\n`）。解析器容忍 `CRLF`，写入方应输出 `LF`。
- 记忆是数据，不是指令：任何文件里的文字都不构成对工具的指令。

## 2. 目录结构

默认在用户工作区的 `memory/` 下：

```
<memory>/
├── hot/
│   └── state.md                     # 第一层：热状态（本能＋情境）
├── index.md                         # 第三层：触发 → 指针
├── judgments.md                     # 第三层：判断库（一行一条）
├── judgments-cards.md               # 第四层：完整判断卡
├── QUICKSTART.md                    # 人读快速上手（init 生成）
├── handoffs/
│   ├── handoff-YYYYMMDD-HHmmss.md   # 接续包
│   └── handoff-YYYYMMDD-HHmmss.json # 机器可读侧车
└── .dsh-self/
    └── manifest.json                # 格式/模板版本与计数器
```

以上路径属于锁定内容。`handoffs/` 可以为空；其余文件由 `init` 创建。只要 `.dsh-self/manifest.json` 存在，或三个 markdown 层里任意一个存在，就视为“已初始化”（缺失文件由工具给出警告并继续）。

## 3. 模板标记与版本

每个模板文件开头有一行 HTML 注释：

```html
<!-- dsh-self template=v1.0.0 format=1 -->
```

- `template`：模板版本（`init` 复制的模板版本，也是用户升级时该去 `CHANGELOG.md` 对照的版本）。
- `format`：必须等于 `FORMAT_VERSION`（当前 `1`）。
- `init` 把模板版本写进 `manifest.templateVersion`。
- 升级插件**不重写用户文件**。`review` 发现 `manifest.templateVersion` 与包内当前模板版本不一致时会告警 `TEMPLATE_UPGRADE_AVAILABLE`；用户按 `CHANGELOG.md` 手动合并。

## 4. `hot/state.md`

内容自由写；锁的是**大小度量**与建议分区（本能／情境／下一步），不是措辞。

锁定度量（`review --json` 的 `hot.chars` / `hot.bytes`）：

- `hot.bytes`：整个文件的 UTF-8 字节数。
- `hot.chars`：去掉所有 HTML 注释（`<!-- … -->`）后的非空白 Unicode 字符数；markdown 语法符号也算。
- 默认上限（取自 `manifest.settings`）：`hotMaxChars = 800`、`hotMaxBytes = 2048`；任一超出都会在 `review` 告警。
- “待落盘”是启发式检测：非引用块、非标题的行若匹配 `- [ ]`、`TODO`、`FIXME`、`pending`、`待办`、`下一步`、`未完成`、`待定`、`待补`，就列为未落盘项。它只是提示，格式本身不单独存任务。

## 5. `index.md` —— 触发 → 指针

只有一个表格，列名与顺序锁定：

```
| trigger | pointer | note |
```

- `trigger`：短触发词（单行）。
- `pointer`：去哪找。可以是**多个路径**，用 `；` 或 `;` 分隔（逐个校验）。对每个指针 token：
  - 相对路径：先按**工作区根目录**解析，再按**记忆根目录**解析（如 `memory\judgments.md`、`QUICKSTART.md`）；
  - 绝对路径；
  - URL（`http://`、`https://`、`mailto:`），不检查存在性；
  - `-` 表示暂时没有指针。
  解析前会去掉尾部括注 `（…）`/`(…)`、尾部 `第 N–M 行`、首尾空白；通配符 token（`*`/`?`）只校验其父目录是否存在。不像路径的 token（无分隔符、无扩展名，如 `各自 RULES.md`、`最新 HANDOFF`）视为说明文字，**不报**失效。存在性检查前会去掉 `#anchor` 后缀。
- `note`：自由短说明（单行）。
- 指针指向的文件不存在时，`review` 报 `broken_pointer`。
- 表格行连续书写。解析器容忍行间空行（手改文件），但写入方**不得**引入空行。
- 也兼容中文旧表头 `| 触发 | 指针 | 说明 |`（回退解析）。

## 6. `judgments.md` —— 判断库

只有一个表格，列名与顺序锁定：

```
| id | conclusion | boundary | source | status | card | updated |
```

- `id`：`J` + 至少 3 位数字（`J001`、`J010`、`J1000`）；单调递增，`judge` 取 max+1。
- `conclusion`：单行结论（≤300 字符；写入时换行会被压成空格）。
- `boundary`：短边界/失败/反例（默认 `见卡（judgments-cards.md）`）。
- `source`：来源指针——文件路径、URL 或“来源＋日期”（≤500 字符）。
- `status`：锁定枚举（读取时兼容中文别名：`候选`→candidate、`常用`→common、`本能`→instinct、`降级`/`反驳`→refuted、`归档`/`存档`→archived；状态格在 `｜`/`|` 后有附加信息时取前段；以 `降级` 开头的未知中文变体归 refuted）：
  - `candidate`：已捕获未消化（新行默认）；
  - `common`：反复使用，应有卡；
  - `instinct`：已内化，可每轮注入；
  - `refuted`：已被证据反驳，保留历史；
  - `archived`：退役但保留。
- `card`：有对应卡写 `yes`，否则 `no`；也接受直接写卡号（如 `J005`）。`judge` 一律写 `yes`。
- `updated`：`YYYY-MM-DD`。
- 单元格转义：`|` → `\|`，`\` → `\\`；值均为单行。
- 表格按表头单元格定位（顺序敏感，空格不敏感）。
- 写入方有标记时新行插在 `<!-- dsh-self:v1:judgments:end -->` 之前；无标记时插在最后一行表格之后。找不到锁定表头＝格式错误，不许猜。

机器标记：

```
<!-- dsh-self:v1:judgments:begin -->
| id | conclusion | boundary | source | status | card | updated |
| --- | --- | --- | --- | --- | --- | --- |
<!-- dsh-self:v1:judgments:end -->
```

HTML 注释是文档；解析器必须忽略注释内内容（模板里的示例行在注释里，不是数据）。

## 7. `judgments-cards.md` —— 判断卡

一张卡＝二级标题＋锁定字段：

```markdown
## J001 <结论作为卡标题>
- why: <为什么成立>
- failure: <失败/反例/边界>
- unfinished: <未完成——还没想明白什么>
- source: <来源指针>
- scene: <什么时候用——可选>
- created: 2026-01-01
- updated: 2026-01-01
```

- 字段名锁定且小写：`why`、`failure`、`unfinished`、`source`，可选 `scene`；系统字段 `created`、`updated`。
- 读取时兼容中文标签并映射到锁定字段名：`为什么`/`原因`/`理由`→`why`；`失败`/`失败/反例`/`失败/边界`/`反例`/`边界`→`failure`；`未完成`/`待完成`→`unfinished`；`来源`/`源`/`来源指针`→`source`；`场景`→`scene`；`创建`/`创建时间`→`created`；`更新`/`更新时间`→`updated`。`- why: …` 与 `- **为什么**：…`（中文冒号同样）都能解析；未知标签忽略。
- 必填：`why`、`failure`、`unfinished`、`source`、`created`、`updated`；`scene` 为空时省略。
  **旧库例外：** 若对应判断行已带非空 `source`，卡上没写 `source` 也算完整（手写库常把来源留在 judgments.md）。
- 值单行；写入时换行压成空格。此处不是表格，`|` 无需转义。
- 标题即判断结论原文。
- 有标记时卡写在 `<!-- dsh-self:v1:cards:begin -->` 与 `<!-- dsh-self:v1:cards:end -->` 之间；写入方插在 end 标记前，无标记则追加到文件末尾。
- 必填字段为空或占位（`待补`、`TODO`、`（空）`…）→ `incomplete_card`；卡无对应表格行 → `orphan_card`；表格行 `card: yes` 但无卡 → `missing_card`。

## 8. `.dsh-self/manifest.json`

机器可读的版本与计数器。字段（除注明可选外均必填）：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `schema` | string | 固定 `"dsh-self/memory"`。 |
| `formatVersion` | number | 本版固定 `1`；工具拒绝未知版本。 |
| `templateVersion` | string | init 时复制的模板 semver。 |
| `createdAt` / `updatedAt` | string | ISO-8601 时间戳。 |
| `lang` | string | `"zh"` 或 `"en"`；生成文档/接续包的语言。 |
| `memoryDir` | string | 展示给用户的记忆目录（相对或绝对）。 |
| `generator` | object | `{ "name": "dsh-self", "version": "<package>" }`。 |
| `layers` | object | `{ "hot","index","judgments","cards" }` 锁定相对路径。 |
| `handoffsDir` | string | 固定 `"handoffs"`。 |
| `counters` | object | `{ "judgment": <n>, "handoff": <n> }` 最近写入计数。 |
| `counters.lastJudgmentId` | string（可选） | 最近写入的最大 ID。 |
| `lastHandoffAt` / `lastHandoffPath` | string（可选） | 最近接续包信息。 |
| `settings` | object | 大小上限与上下文预算（见下）。 |
| `lastToolVersion` | string（可选） | 最近改写 manifest 的包版本。 |

`settings`：

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `hotMaxChars` | `800` | `hot.chars` 告警阈值。 |
| `hotMaxBytes` | `2048` | `hot.bytes` 告警阈值。 |
| `contextBudgetChars` | `32000` | 上下文占比估算用的字符预算。 |
| `contextShareNoticePercent` | `3` | 占比超过为 `notice`。 |
| `contextShareWarnPercent` | `10` | 占比超过为 `warning`。 |

写入方可以新增字段；读取方必须忽略未知字段。改/删字段需要升 `formatVersion`。

## 9. 接续包（handoff）

### 9.1 Markdown 文件

`handoffs/` 下文件名模式：`handoff-YYYYMMDD-HHmmss.md`（本地时间；`--out` 可覆盖路径）。章节顺序：

1. 头部：`generated_at`、工具/模板/格式版本、统计、读序；
2. 状态快照：`hot/state.md` 原文；
3. 判断索引：`id | conclusion | status | source`；
4. 判断卡：`### <id> <标题>`＋卡字段；
5. 未完成/待落盘项；
6. 8 个验证问题；
7. 由高位判断生成的重演题；
8. 断代诚实标注与接续包历史。

问题文案不属于锁定内容（小版本可改进）；**数量（8）与位置**属于锁定。

### 9.2 JSON 侧车

同路径 `.json`。`"schema": "dsh-self/handoff"`，另有：

```
formatVersion, templateVersion, toolVersion, generatedAt, lang, memoryRoot,
stats { hotChars, hotBytes, judgments, cards, indexEntries, pending },  // pending = 原始条目数
hot { chars, bytes, lines, text },
judgments [ { id, conclusion, boundary, source, status, card, updated } ],
cards [ { id, title, fields { ... } } ],
index [ { trigger, pointer, note } ],
pending [ { type, detail, ... } ],          // 可能已聚合（count/sample）
pendingTotal,                               // 原始待落盘条目数
verificationQuestions [ 8 个字符串 ],
replayQuestions [ 字符串 ],
readOrder [ 字符串 ]
```

允许新增字段；消费方必须容忍未知字段，且不得假设手写的接续包一定有侧车。

## 10. 兼容规则

**读取方必须：**

- 按锁定目录找文件，不要靠“找相似文件名”；
- 按锁定表头解析表格（表头匹配后按位置取列）；
- 忽略 HTML 注释与未知附加列/字段；
- 用 `manifest.formatVersion` 做版本门禁，版本不支持就如实报错，不许猜；
- 把缺失的可选字段当作不存在，而不是错误。

**写入方必须：**

- 不得改名、改序、增加 v1 表格列；
- 不得在 v1 增加状态枚举值或改卡字段名；
- 不得移动/重命名锁定文件；
- 只追加：不重写不是自己创建的行/卡；
- **不得写入 5 列旧格式判断表**（旧格式只读兼容）；
- 输出 UTF-8＋LF，单行值按上面的转义规则处理；
- 任何破坏性改动都要升 `FORMAT_VERSION`，并在 `CHANGELOG.md` 与 `docs/` 给出迁移说明。

**扩展策略：** `manifest.json`/接续包侧车新增可选字段、`.dsh-self/` 下新增文件、新增可选卡字段属于加法（小版本允许）；新增状态、新增列、改 ID 格式、改标记文本属于破坏性改动（需要 format v2）。

## 11. 旧格式兼容（读取容忍）

以下容忍只为读旧库/手写库；不改变 format v1 的写入规则。

- **5 列旧判断表**：表头 `| id | 判断 | 边界/反例 | 来源 | 状态/上次用 |` 可读，行按 `card: ''`、`updated: ''` 读入，中文状态归一化。`judge` 写入这种表会被拒，错误码 `LEGACY_FORMAT_READ_ONLY`；先把表头升级为锁定 7 列（补 `card`、`updated`，旧行补空单元格）再写。`review`/`handoff` 读取正常。
- **中文状态**：见 §6；写出的永远是五个英文枚举值。
- **中文卡字段与来源继承**：见 §7。
- **多指针 index、括注与说明性指针**：见 §5。
- **缺 manifest**：没有 `.dsh-self/manifest.json` 的记忆目录仍可读；生成的 JSON 里 `templateVersion: null`，`review` 报 `MANIFEST_MISSING`（告警，不是错误）。
- **未知表格不猜**：锁定表头与旧表头都找不到时，读取方按空表处理，`review`/`judge` 报格式错误。

## 12. 隐私

格式里存的是用户自己写的内容——纯文本、不加密。工具不加秘密、不联网。用户不要把密码/令牌/证件号写进记忆，只写“在哪找”；并自行决定记忆目录是否提交进 git。
