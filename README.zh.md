# dsh-memory

会改主意的长期记忆。

**该记的记住。  
冲突的裁定。  
不该留下的忘掉。**

> 记忆不是存储。记忆是生命周期。

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的智能长期记忆插件。

[English](README.md) | 中文

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

需要 Node `>=22.19`（与 DeepSeek Harness 相同，因为用了 `node:sqlite`）。

### 作为 Harness 插件

```sh
dsh plugin --profile default add /absolute/path/to/dsh-memory
# 发布到 npm 之后：
dsh plugin --profile default add dsh-memory
```

bundle 会插入插件 id `dsh-memory`。重启 profile 后生效。

默认数据库：

```text
$DSH_HOME/dsh-memory/memory.sqlite
```

可用 `DSH_MEMORY_PATH` 或下面的配置覆盖：

```yaml
config:
  databasePath: /path/to/memory.sqlite
  automaticRecall: true
  automaticObserve: true
  maxMemories: 8
  maxTokens: 800
```

### 作为库使用

```sh
npm install dsh-memory
```

```ts
import { MemoryService, activeScopeFromPaths } from "dsh-memory/core";

const service = new MemoryService();
const scope = activeScopeFromPaths({ cwd: process.cwd() });
service.remember({ content: "我一般用 pnpm。", explicit: true }, scope);
const recalled = service.recall("该用哪个包管理器？", scope);
```

## 用法

直接对 Agent 说：

```text
记住：我一般用 pnpm。
这个项目我们用 npm。
我从 VS Code 换成 Cursor 了。
忘掉我用 Cursor。
```

也可以直接调工具或 `/memory`。

### 核心演示

```sh
npm install
npx tsx examples/killer-demo.ts
npx tsx examples/conflict-demo.ts
```

第 1 段：存一条全局 `pnpm` 偏好。  
第 2 段：给项目 Alpha 记下 `npm`。在 Alpha 里问「这里该用哪个」会得到 **npm**，全局偏好只作背景。  
第 3 段：VS Code 被 Cursor 取代。  
第 4 段：忘掉 Cursor。下一次召回不会再给出它。

第二个演示：同一项目里 PostgreSQL 和 MySQL 会保持 **争议中**，不会自动覆盖。

## 工具

| 工具 | 作用 |
| --- | --- |
| `memory_remember` | 明确写入（仍走策略） |
| `memory_search` | 可解释搜索 |
| `memory_get` | 按 id 读取一条 |
| `memory_forget` | 按 id / 查询 / 主题 / 范围遗忘 |
| `memory_pin` / `memory_unpin` | 钉住，避免被回收 |
| `memory_conflicts` | 列出争议 |
| `memory_resolve_conflict` | 留 A / 留 B / 合并 / 保持争议 / … |
| `memory_explain` | 为什么召回 / 为什么没召回 |
| `memory_list` | 按状态、范围、类型列出 |

`forget all` 必须带 `confirmAll: true`。

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
