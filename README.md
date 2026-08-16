# dsh-memory

中文 | [English](README.en.md)

会改主意的长期记忆。

**该记的记住。  
冲突的裁定。  
不该留下的忘掉。**

> 记忆不是存储。记忆是生命周期。

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的智能长期记忆插件。

**先看怎么装、怎么用：** [安装](#安装) · [使用](#使用)

```text
“我用 VS Code。”
        ↓
VS Code          生效中
        ↓
“我换成 Cursor 了。”
        ↓
VS Code          已被取代
Cursor           生效中
        ↓
“忘掉我的编辑器偏好。”
        ↓
Cursor           已遗忘
```

## 为什么需要它

常见的 Agent Memory 是：

```text
存储 → 检索
```

它只回答「和这句话像的有哪些」。它不回答：

- 什么值得记？
- 记在哪个范围？
- 和已有记忆冲突吗？
- 新信息该覆盖旧信息，还是两条都留？
- 一条记忆何时该降权、过期、真正删除？
- 为什么这次召回了这条，而不是另一条？

`dsh-memory` 是生命周期引擎。检索只是其中一步，不是产品本身。

## 普通 Memory vs dsh-memory

| 普通 Agent Memory | dsh-memory |
| --- | --- |
| 存储 → 检索 | 观察 → 筛选 → 定范围 → 记住 → 冲突 → 修订 → 衰减 → 遗忘 → 解释 |
| 把向量相似度当真相 | 可测试、可解释的综合打分 |
| 静默覆盖旧记忆 | 账本 + 取代 / 争议 |
| 什么都记 | 资格审查 + 敏感信息过滤 |
| 遗忘 = 指望索引自己掉下去 | 墓碑 + 删除正文 + 禁止召回 |

## 它强在哪

- **有选择** — 瞬时闲聊不会变成长期记忆。
- **有范围** — 全局偏好和项目事实可以同时成立。
- **感知冲突** — 矛盾会被分类，而不是被覆盖。
- **有时间** — 「曾经」和「现在」可以共存；默认只召回当前事实。
- **可解释** — 每次召回都有分数拆解。
- **可遗忘** — 明确要求忘记后，搜索、注入、索引会立刻停用这条记忆。

## 架构

```text
观察
    → 资格 / 敏感性
    → 分类 + 范围
    → 去重 / 冲突策略
    → 账本事件
    → 投影后的 MemoryRecord
    → 全文索引
    → 有上限的召回
```

领域核心不引用 DeepSeek Harness。Cordis 适配层很薄：工具、`/memory`、系统提示中的政策段，以及 `agent/pre-step` 自动召回。

对接的官方 API 见 [docs/harness-integration.md](docs/harness-integration.md)（对照 `0.1.0-rc.5`，commit `47f943859bef60e4160492346772ded9b24f765a`）。

## 记忆生命周期

```text
观察
     ↓
候选
     ↓
分类 → 敏感性 → 范围
     ↓
去重 → 冲突检查 → 策略
     ↓
存储 / 合并 / 拒绝 / 争议
     ↓
生效中的记忆
     ↓
召回 → 确认 / 削弱 / 更新
     ↓
衰减 → 取代 / 过期 / 遗忘
```

当前状态由只追加的 **Memory Ledger** fold 得出。旧状态不会偷偷消失。遗忘是例外：先写 `memory/forgotten`，再删除正文、全文索引和向量，这条事实就不能再被召回。

## 范围

```text
任务 > 项目 > 工作区 > 全局
```

它们**不会互相覆盖**。

```text
全局：用户一般用 pnpm
项目：Alpha 用 npm
```

在 Alpha 里，项目记忆优先。换到别的项目，全局偏好仍然有效。项目事实不会被升格成「用户永远都要这样」。

## 冲突裁定

冲突有类型：

| 类型 | 例子 | 默认策略 |
| --- | --- | --- |
| `duplicate` | 同一事实记了两次 | 合并 / 确认 |
| `refinement` | 喜欢咖啡 → 喜欢埃塞浅烘 | 更新，不当成矛盾 |
| `scope_difference` | 全局 pnpm vs 项目 npm | 两条都留 |
| `temporal_update` | VS Code → Cursor | 旧的标成已被取代 |
| `direct_contradiction` | 同项目 Postgres vs MySQL | 比较来源权威 |
| `uncertain_conflict` | 证据相当 | **争议中** — 两条都留 |

优先级是确定性的：

```text
用户明确更正
  > 用户明确陈述
  > 已验证的结构化来源
  > 多次一致观察
  > 单次推断
```

引擎不会伪造一致性。

## 衰减、过期、遗忘

- **衰减**只降低检索权重，不删除。
- **过期**（`validUntil`）让事实退出普通召回。
- **垃圾回收**只清理：未钉住、非用户明确记忆、已过期/已拒绝、重要性低、长期未用的记录。
- **钉住**会关闭自动回收并减慢衰减。用户明确要求忘记时仍然生效。
- **明确遗忘**立刻停止召回、搜索和注入，并删除已存正文。

```text
删除 dsh-memory 里的记忆，并不等于
擦掉 DeepSeek Harness 会话历史里的原始对话。
```

## 检索

不是只做向量相似。最终分数是：

```text
相关度
  × 范围权重
  × 置信度权重
  × 新鲜度权重
  × 重要性权重
  × 状态权重
  × 显式记忆加成
  × 钉住加成
  × 确认次数权重
  × 访问次数权重
```

访问次数只代表「好用」，不代表「更真」。

注入有上限：`maxMemories` 默认 8，`maxTokens` 默认 800。

语义向量是可选的 `EmbeddingProvider`。v0.1 默认用词法 + 元数据检索，不需要 API Key。

## 可解释召回

```text
M-031
用户偏好 pnpm。

召回原因：
范围: global:user
置信度: 0.94
重要性: 0.90
冲突状态: 无
词法匹配: 0.82
最终召回分: 0.91
```

`memory_explain` / `/memory inspect` 也会回答 **为什么没召回**：已遗忘、已过期、已被取代、范围不匹配、相关度低，或没挤进上下文预算。

## 安全

记忆默认是 **DATA**，不会被挂成新的系统指令。

密钥类内容（API key、token、私钥、密码、连接串、银行卡）即使你说「记住」，也会被拒绝。

长得像提示注入的文本，用户坚持时可以存，但会被转义并标成不可执行。

本地优先：默认存本机文件。除非你以后自己接，否则不会把记忆发到远程 embedding 或 LLM。

## 安装

包还没发到 npm。现在请从 GitHub 或本地目录安装。

需要：

- Node `>=22.19`（`node -v` 检查）
- 已能运行 DeepSeek Harness CLI：`dsh --help`
- 把下面命令里的 `default` 换成你正在用的 profile 名（目录在 `~/.dsh/profiles/`）

### 1. 装进 DeepSeek Harness（主路径）

**方式 A — 直接从 GitHub 装**

```sh
dsh plugin --profile default add github:245678000000/dsh-memory
```

pnpm 10+ 第一次可能会拒绝跑这个包的 `prepare`（它要编译 TypeScript）。按 `dsh` 打印的包名，把下面写进该 profile 的 `pnpm-workspace.yaml`：

```yaml
allowBuilds:
  dsh-memory: true
```

然后把 `add` 再跑一遍。

**方式 B — 先克隆再装本地目录**

```sh
git clone https://github.com/245678000000/dsh-memory.git
cd dsh-memory
npm install
dsh plugin --profile default add "$PWD"
```

`npm install` 会执行 `prepare`，生成 `dist/`。不要只拷源码、不编译就去 `dsh plugin add`。

**装完必须重启 Harness**，例如：

```sh
dsh --profile default --dump-config    # 输出里应出现 # == dsh-memory
dsh web --profile default              # 或你平时启动的方式
```

怎么确认装上了：

1. `--dump-config` 里有 `dsh-memory` 这一层
2. 新会话里模型能看到 `memory_remember`、`memory_search`、`memory_forget` 等工具
3. 输入框可以打 `/memory`

记忆文件默认在：

```text
~/.dsh/dsh-memory/memory.sqlite
```

也就是 `$DSH_HOME/dsh-memory/memory.sqlite`。改位置用环境变量 `DSH_MEMORY_PATH`。

卸载：

```sh
dsh plugin --profile default remove dsh-memory
```

这只移除插件，不会自动删掉上面的 sqlite 文件。

### 2. 只用命令行（不启动 Harness）

适合先看记忆怎么记、怎么搜、怎么忘：

```sh
git clone https://github.com/245678000000/dsh-memory.git
cd dsh-memory
npm install

npx dsh-memory help
npx dsh-memory remember "我一般用 pnpm。"
npx dsh-memory search "包管理器"
npx dsh-memory list
npx dsh-memory demo
npx dsh-memory demo conflict
```

CLI 和插件默认共用 `~/.dsh/dsh-memory/memory.sqlite`（可用 `DSH_MEMORY_PATH` 改）。在仓库里也可以：

```sh
npm run demo
npm run demo:conflict
npm test
```

### 3. 当作 TypeScript 库

```sh
npm install github:245678000000/dsh-memory
```

```ts
import { MemoryService, activeScopeFromPaths } from "dsh-memory/core";

const service = new MemoryService();
const scope = activeScopeFromPaths({ cwd: process.cwd() });
service.remember({ content: "我一般用 pnpm。", explicit: true }, scope);
const recalled = service.recall("该用哪个包管理器？", scope);
console.log(recalled.promptBlock);
service.close();
```

### 配置（可选）

改默认行为时，编辑该 profile 的 `~/.dsh/profiles/<name>/cordis.patch.yml`，按 **id** 整行覆盖（Harness 不会深合并 config）：

```yaml
- id: dsh-memory
  name: dsh-memory
  inject: [tools]
  config:
    databasePath: /path/to/memory.sqlite
    automaticRecall: true      # 每轮第一步自动注入相关记忆
    automaticObserve: true     # 观察用户消息，保守地自动记
    recallEveryStep: false     # true 则每个 tool step 都再召回一次
    maxMemories: 8             # 一次最多注入几条
    maxTokens: 800             # 注入文本的 token 上限
```

改完重启 profile。

## 使用

装好并重启之后，有三条路：对助手说话、斜杠命令、CLI。日常用第一条就够。

### 对助手说话

新开一个会话，按顺序试：

```text
记住：我一般用 pnpm。
```

助手应调用 `memory_remember`。再新开一个会话（不要复制上一段聊天）：

```text
我该用哪个包管理器？先查一下记忆。
```

应召回 pnpm。然后在**某个具体项目目录**里说：

```text
这个项目我们用 npm。
这里该用哪个包管理器？
```

应优先项目里的 npm，全局 pnpm 只作背景。

改主意：

```text
我从 VS Code 换成 Cursor 了。
```

旧的 VS Code 会变成「已被取代」，不会被删掉。再忘：

```text
忘掉我用 Cursor。
```

之后再问编辑器，不应再把 Cursor 当当前事实。密钥类内容即使用户要求记住，也会被拒绝：

```text
记住：我的 API key 是 sk-……
```

自动观察很保守。随口一句「现在下午三点」不会进长期记忆。你在意的事实，请以「记住：」开头。

### 斜杠命令（不经过模型）

在输入框直接敲：

```text
/memory
/memory search 包管理器
/memory conflicts
/memory inspect M-XXXXXX
/memory forget M-XXXXXX
/memory pin M-XXXXXX
/memory unpin M-XXXXXX
```

`/memory` 列出当前还能用的记忆。`inspect` 会说明为什么会（或不会）被召回。

### 模型工具

助手可调用这些工具。你也可以在对话里点名，例如「用 memory_search 查一下包管理器」。

| 工具 | 你要它做什么 | 常用参数 |
| --- | --- | --- |
| `memory_remember` | 存一条 | `content`（必填），`scope`（global / project / …），`kind`，`pin`，`validUntil` |
| `memory_search` | 按问题搜索 | `query`，`limit` |
| `memory_get` | 按 id 看一条 | `id` |
| `memory_forget` | 忘掉 | `id` 或 `query` 或 `subject` 或 `scope`；清空全部还要 `all=true` 且 `confirmAll=true` |
| `memory_pin` / `memory_unpin` | 钉住 / 取消钉住 | `id` |
| `memory_conflicts` | 列出未决冲突 | 无 |
| `memory_resolve_conflict` | 裁定冲突 | `conflictId`，`resolution`：`keep_a` / `keep_b` / `both_valid_by_scope` / `mark_newer` / `merge` / `remain_disputed` |
| `memory_explain` | 解释召回 | `id`，可选 `query` |
| `memory_list` | 筛选列表 | `status`，`scope`，`kind`，`includeForgotten` |

一次召回最多注入 `maxMemories` 条，且受 `maxTokens` 限制。过期、已遗忘、默认情况下已被取代的记忆不会进普通召回。

### 命令行

在仓库根目录，或 `npm install -g` 之后：

```text
npx dsh-memory remember 我一般用 pnpm。
npx dsh-memory search 包管理器
npx dsh-memory list
npx dsh-memory get M-XXXXXX
npx dsh-memory forget M-XXXXXX
npx dsh-memory pin M-XXXXXX
npx dsh-memory conflicts
npx dsh-memory explain M-XXXXXX 包管理器
npx dsh-memory export
npx dsh-memory demo
npx dsh-memory demo conflict
npx dsh-memory bench
```

### 仓库里的演示在做什么

```sh
npx tsx examples/killer-demo.ts
npx tsx examples/conflict-demo.ts
```

1. 存全局 `pnpm`
2. 给项目 Alpha 记 `npm`；在 Alpha 问「这里用哪个」→ **npm**
3. VS Code 被 Cursor 取代
4. 忘掉 Cursor 后，召回不再给出它

第二个演示：同一项目里 PostgreSQL 和 MySQL 保持 **争议中**，不会自动覆盖。

### 使用时请记住

- 当前用户这句话的优先级永远高于旧记忆。
- 记忆是数据，不是新的系统指令。
- `forget` 只删 dsh-memory 自己的库，**不会**擦掉 Harness 会话记录。

## Harness 集成

自动召回走官方 `agent/pre-step` waterfall，和 `dsh-time-context` 是同一类请求准备钩子。细节见 [docs/harness-integration.md](docs/harness-integration.md)。

## 测试

```sh
npm run lint
npm run typecheck
npm run test
npm run build
```

套件覆盖 v0.1 验收场景：跨会话召回、取代、范围优先级、争议、遗忘合规、过期、钉住 vs 回收、密钥拒绝、细化而非矛盾、注入标注、上下文预算、历史查询、可解释性，以及无根据猜测不得入库。

## 基准

```sh
npm run bench
```

只报告真实跑出来的数字：精确率、覆盖率、冲突准确率、范围准确率、过期记忆误用率、遗忘合规、注入 token。不要把手工表格当成结果，请自己跑 runner。

## 路线图

| 版本 | 范围 |
| --- | --- |
| **v0.1** | 本地账本、范围、冲突、遗忘、衰减、有上限的可解释检索、Harness 插件 |
| v0.2 | 可选向量、Memory Inspector UI、更强的合并 |
| v0.3 | MCP / Engram / Memorix 后端适配 |
| v0.4 | 团队共享记忆和权限 |
| v0.5 | 跨 Agent 联邦 |

## 限制

- v0.1 检索是词法 + 结构化元数据。语义搜索只留了接口，没有默认供应商。
- 分类和冲突分型是确定性启发式。绕弯的自然语言可能抽不准。
- 自动观察很保守。在意的事实请说「记住……」。
- 遗忘清不掉 Harness 会话日志。
- 还没有 Inspector UI。请用工具、`/memory` 或 CLI。
- 没有云同步、没有多租户鉴权、没有团队图谱。

## 许可证

MIT
