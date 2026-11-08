# dsh-self 快速上手（QUICKSTART）
<!-- dsh-self template=v1.0.0 format=1 -->

生成时间：{{DATE}} · 工具版本：{{TOOL_VERSION}} · 模板版本：1.0.0 · 记忆目录：`{{MEMORY_DIR}}`

## 这套脚手架是什么

给「自己的 AI 装记忆连续性和身份感」的最小结构：四个文件 + 四个操作。它只给格式和流程，
不含任何人的真实判断、私人记忆或身份内容——那些要你自己写。

## 四层（按使用方式分，不按来源/时间分）

| 层 | 文件 | 作用 | 阅读频率 |
| --- | --- | --- | --- |
| 状态层 hot | `{{MEMORY_DIR}}/hot/state.md` | 本能（身份锚/判断核/红线）＋情境（任务/卡点/下一步） | 每次唤醒 |
| 索引层 index | `{{MEMORY_DIR}}/index.md` | 「触发 → 指针」，不背内容 | 需要时查 |
| 判断库 judgments | `{{MEMORY_DIR}}/judgments.md` | 一行一条判断：结论/边界/来源/状态 | 需要时查 |
| 判断卡 cards | `{{MEMORY_DIR}}/judgments-cards.md` | 判断的完整版：为什么/失败/未完成/来源 | 换模型、核冲突时读 |

## 四个操作

1. **init**：初始化结构（本文件就是 init 生成的）。重复运行只补缺失文件，不覆盖你写的内容。
2. **judge**：新增一条判断卡，自动编号，同时写进 judgments 与 cards 两张表。
3. **handoff**：读你的记忆，生成一份「接续包」＋ 8 个验证问题（换模型/换会话前跑）。
4. **review**：压缩审查——hot 大小（>800 字/2KB 告警）、上下文占比提示、待落盘项清单。

## 三种调用方式

- **CLI**：`node bin/dsh-self.mjs <init|judge|handoff|review> [选项]`，全部支持 `--json`。
- **DSH 斜杠命令**（装了插件后）：`/self-init`、`/self-judge`、`/self-handoff`、`/self-review`。
- **Agent 工具**：`dsh_self_init`、`dsh_self_judge`、`dsh_self_handoff`、`dsh_self_review`。

## 建议节奏

- 每读完一批材料、或想清楚一件事：跑一次 judge，写 0–3 条判断卡。
- 每次换模型/换会话前：跑一次 handoff，把接续包给新模型，让它先答 8 个验证问题。
- 每周或压缩前：跑一次 review，把待落盘项清掉、把 hot 压回 800 字内。

## 隐私与安全

- 记忆文件是纯文本，任何本地进程都能读；不要写密码/令牌/身份证号，只写「在哪找」。
- 提交到 git 前先想清楚：这份记忆要不要进版本库。
- 本脚手架模板只有占位示例，不含任何真实判断内容。

## 版本与更新

- `{{MEMORY_DIR}}/.dsh-self/manifest.json` 记录 formatVersion 与 templateVersion。
- 装新版本后跑 review，会提示模板是否有更新；按 CHANGELOG 手动合并（工具不会覆盖你已写的文件）。
- 格式说明见包内 `docs/FORMAT.md`；给其他插件对接用 `docs/ECOSYSTEM.md`。
