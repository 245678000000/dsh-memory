# DeepSeek Harness integration

Researched against the official repository, not against memory or stale tutorials.

| Field | Value |
| --- | --- |
| Repository | https://github.com/deepseek-ai/deepseek-harness |
| Version | `0.1.0-rc.5` (`@deepseek-ai/dsh-root`) |
| Branch | `master` |
| Commit | `47f943859bef60e4160492346772ded9b24f765a` |
| Date inspected | 2026-08-16 |

## What official Memory can do today

Harness does **not** ship a first-party long-term memory engine.

`examples/mcp-memory` is an interoperability pack. It starts one of three external MCP servers through `@deepseek-ai/dsh-mcp-client` and exposes their tools as `mcp__<serverName>__<tool>`:

| Overlay | Upstream | What it stores |
| --- | --- | --- |
| `memorix.cordis.yml` | Memorix 1.3.0 | Vendor-owned local heuristic memory |
| `mcp-reference-memory.cordis.yml` | `@modelcontextprotocol/server-memory@2026.7.4` | Local JSONL knowledge graph |
| `engram.cordis.yml` | Engram 1.20.0 | Vendor-owned project memory |

Official documentation for the MCP reference server is explicit:

> Search is case-insensitive substring matching over entity names, types, and observations, not semantic retrieval. The server does not add embeddings, automatic summarization, conflict resolution, or a forgetting policy.

DSH itself only:

- parses a Cordis overlay
- starts or connects to the MCP process
- discovers tools
- does **not** own storage, decay, conflicts, scope precedence, or forget semantics

The official feature map in `docs/cookbook/extension-cookbook.md` describes Memory as:

> Memory → section provider + tool

That is the seam `dsh-memory` implements. It is not a wrapper around Memorix, Engram, or MCP Reference Memory.

## Gap this plugin fills

| Capability | Official MCP examples | `dsh-memory` |
| --- | --- | --- |
| Selective eligibility | No | Yes |
| Sensitivity / secret rejection | No | Yes |
| Scope + precedence | Vendor-specific / none | Deterministic hierarchy |
| Conflict types + dispute | No | Yes |
| Supersede instead of silent overwrite | No | Ledger + status |
| Decay ≠ delete | No | Score decay only |
| Expiration / GC / pin | No | Yes |
| Explicit forget + payload purge | No | Tombstone + index delete |
| Explainable recall | No | Score breakdown |
| Bounded context injection | No | `maxMemories` / `maxTokens` |
| Memory treated as DATA | Not specified | Policy section + escaped payload |

## Plugin entry point

Cordis plugin, installed as a **bundle**:

```text
package.json          dsh.bundle.patch = ./cordis.patch.yml
cordis.patch.yml      inserts id: dsh-memory, name: dsh-memory
src/index.ts          export name / apply / inject / Config
```

```ts
export const name = 'dsh-memory'
export const inject = ['tools']
export function apply(ctx, config) { ... }
```

`inject = ['tools']` is required so model-facing tools exist. `systemPrompt`, `commands`, and the `agent/*` event bus are used when present and ignored when absent. The plugin does not inject `agents` as required, so a partial composition can still load tools.

Configuration uses a Standard Schema (`Config['~standard']`) so Cordis can validate the row without a hard dependency on `@deepseek-ai/schemastery`.

Install:

```sh
dsh plugin --profile <name> add /path/to/dsh-memory
```

or `--patch` a local overlay that inserts the same row.

## Session APIs used

| API | Use |
| --- | --- |
| `ctx.on('session/event')` | Observe `user/message` events whose `source.kind === 'user'` for conservative automatic candidacy. Plugin-sourced messages are ignored so injected recall is not re-memorized. |
| `agent.session.events` | Read the latest real user text when assembling a recall query. |
| `agent.session.cwd` / `session.cwd` | Resolve the current project path for scope. |

No session persistence APIs are wrapped. Forgetting a memory does **not** rewrite Harness session history.

## Hooks used

Turn lifecycle from `docs/agent-lifecycle.md`:

```text
followup
  → agent/pre-step          (waterfall: reject | enter(messages))
  → step/start
  → user/message
  → system-prompt/assemble
  → agent/request
  → llm/stream
```

### Automatic recall: `agent/pre-step`

Chosen because it is the official request-preparation hook used by first-party context plugins (`dsh-time-context`, `dsh-tmux-context`).

Signature observed in `packages/context/time-context/src/index.ts`:

```ts
ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next): Promise<PreStepDecision> => {
  const decision = await next()
  if (decision.kind === 'reject') return decision
  return {
    kind: 'enter',
    messages: [
      ...decision.messages,
      createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text }] },
      }),
    ],
  }
}, { prepend: true })
```

`dsh-memory` does the same:

1. Call `next()` so downstream policy stays authoritative.
2. Read the entered user text.
3. Recall a bounded set of memories for the current scope.
4. Append one plugin-sourced snapshot message. It is labeled as **DATA**, not as a system instruction.

Default: only `step === 1` of a turn, matching tmux-context. Re-injection on every tool step is opt-in (`recallEveryStep`).

### Policy text: `ctx.systemPrompt.section()`

Official Memory pattern is “section provider + tool”. A stable section named `dsh-memory-policy` (`order: 40`) tells the model that recalled memories are untrusted data and that the current user message wins.

`ctx.systemPrompt.context()` is available and is a valid dynamic-context seam. It is **not** used for query-specific recall because `system-prompt/assemble` runs *after* `agent/pre-step` and does not itself receive the proposed user messages. Query-aware selection therefore happens in `pre-step`, where the text is present.

### Tools: `ctx.tools.register()`

Raw JSON-Schema tool definitions, which the official cookbook says `ctx.tools.register()` accepts directly (the same path MCP tools use). `defineTool` is not required.

Registered tools:

```text
memory_remember
memory_search
memory_get
memory_forget
memory_pin
memory_unpin
memory_conflicts
memory_resolve_conflict
memory_explain
memory_list
```

### Commands: `ctx.commands.register()` when present

```text
/memory
/memory search <q>
/memory conflicts
/memory inspect <id>
/memory forget <id>
/memory pin <id>
```

If the composition has no `dsh-commands` service, the plugin still loads.

## Storage strategy

Official `ctx.storage` is a KV domain hub (`loadAll` / `putRecord` / `deleteRecord`). It is the right seam for small typed documents. It is **not** used here because the memory engine needs:

- an append-only event ledger
- projected records
- FTS
- transactional forget (tombstone + payload + index + embedding)

Those do not map cleanly onto the current KV facet without re-implementing a database on top of it.

`dsh-memory` owns a SQLite file through Node 22 `node:sqlite`:

```text
$DSH_HOME/dsh-memory/memory.sqlite
```

override with `DSH_MEMORY_PATH` or plugin `databasePath`.

Domain logic talks only to `MemoryStore`. SQLite and the in-memory store are interchangeable. The core package has no import of Harness storage types.

## Context injection strategy

1. **Stable policy** — `systemPrompt.section('dsh-memory-policy')`. Prefix-friendly, not query-specific.
2. **Query-specific recall** — `agent/pre-step` appends at most `maxMemories` / `maxTokens` items.
3. **Trust boundary** — every payload is wrapped as `DATA: "<json string>"` and flagged if it looks like an instruction.
4. **No whole-database dump.** Forgotten, expired, rejected, and (by default) superseded records are excluded.

`createUserMessage` is loaded with `createRequire('@deepseek-ai/dsh-llm')` when that package exists (it does in a real DSH profile). If it is missing, a structural `{ role, content, source }` object is used.

## Why these integration points were chosen

| Need | Rejected option | Chosen option | Why |
| --- | --- | --- | --- |
| Automatic recall | Wrap AgentLoop / fork the driver | `agent/pre-step` | Documented waterfall; used by first-party context plugins |
| Inject facts | Rewrite the system prompt wholesale (`complete: true`) | Plugin-sourced user snapshot + a small policy section | Official time/tmux pattern; current user text still outranks memory |
| Tools | MCP-only wrapper | `ctx.tools.register` | Same registry the model already uses |
| Persistence | `ctx.storage` KV | Plugin-owned SQLite | Ledger + FTS + transactional purge |
| HMR / dispose | Global singleton | `ctx.effect(() => service.close())` | Registrations are effects; DB closes on fiber dispose |
| Subagents | Memory Curator / Resolver agents | Deterministic code | Official guidance: do not multiply agents without a bound. LLM is optional and unused in v0.1 |

## Disposal / HMR

Cordis unloads the plugin fiber on config change or HMR. Tool, section, command, and event registrations are effects and unregister automatically. The only extra resource is the SQLite handle; `ctx.effect` closes it.

## Honest boundary

Removing a `dsh-memory` record deletes that record’s payload, FTS row, and embedding from the plugin store. It does **not** erase the original user/assistant turns from the Harness session log.

## Unused official seams (intentionally)

| Seam | Why unused in v0.1 |
| --- | --- |
| MCP client | Would wrap Engram/Memorix, not implement lifecycle |
| `ctx.subagents` | Scoring, GC, and status transitions are deterministic |
| `ctx.jobs` | No long-running tool work |
| Conversation nodes / UI plugin | Tools + `/memory` cover inspect/conflict; Inspector UI is v0.2 |
| `ctx.storage.domain` | See storage strategy |
