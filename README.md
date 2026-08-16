# dsh-memory

English | [中文](README.zh.md)

**Install and use:** [Installation](#installation) · [Usage](#usage)

Long-term memory that knows when to change its mind.

**Remember what matters.  
Resolve what conflicts.  
Forget what no longer should remain.**

> Memory is not storage. Memory is lifecycle.

Intelligent Long-Term Memory for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

```text
“I use VS Code.”
        ↓
VS Code          ACTIVE
        ↓
“I switched to Cursor.”
        ↓
VS Code          SUPERSEDED
Cursor           ACTIVE
        ↓
“Forget my editor preference.”
        ↓
Cursor           FORGOTTEN
```

## Why

Ordinary agent memory is:

```text
store → retrieve
```

That answers “what is similar to this prompt?” It does not answer:

- What is worth remembering?
- In which scope?
- Does this contradict something we already believe?
- Should the old fact be superseded, disputed, or left alone?
- When should a fact fade, expire, or actually disappear?
- Why was *this* memory injected and not the other one?

`dsh-memory` is a lifecycle engine. Retrieval is one step, not the product.

## Ordinary memory vs dsh-memory

| Ordinary Agent Memory | dsh-memory |
| --- | --- |
| store → retrieve | observe → qualify → scope → remember → conflict → revise → decay → forget → explain |
| Vector similarity as truth | Composite, testable score |
| Silent overwrite | Ledger + supersede / dispute |
| Remember everything | Eligibility + sensitivity |
| Forget = hope the index drops it | Tombstone + payload purge + recall ban |

## What makes it different

- **Selective** — transient chatter never becomes long-term memory.
- **Scoped** — global preference and project fact can both be true.
- **Conflict-aware** — contradictions are classified, not overwritten.
- **Temporal** — “used to” and “now” can coexist; only current facts are recalled by default.
- **Explainable** — every recall has a score breakdown.
- **Forgettable** — explicit forget stops search, injection, and index hits immediately.

## Architecture

```text
Observation
    → Eligibility / Sensitivity
    → Classify + Scope
    → Dedup / Conflict policy
    → Ledger event
    → Projected MemoryRecord
    → FTS index
    → Bounded recall
```

The domain core has no DeepSeek Harness imports. The Cordis adapter is a thin boundary: tools, `/memory`, a system-prompt policy section, and `agent/pre-step` recall.

See [docs/harness-integration.md](docs/harness-integration.md) for the official APIs this was built against (`0.1.0-rc.5`, commit `47f943859bef60e4160492346772ded9b24f765a`).

## Memory lifecycle

```text
OBSERVATION
     ↓
CANDIDATE
     ↓
CLASSIFY → SENSITIVITY → SCOPE
     ↓
DEDUPLICATE → CONFLICT CHECK → POLICY
     ↓
STORE / MERGE / REJECT / DISPUTE
     ↓
ACTIVE MEMORY
     ↓
RECALL → CONFIRM / WEAKEN / UPDATE
     ↓
DECAY → SUPERSEDE / EXPIRE / FORGET
```

State is folded from an append-only **Memory Ledger**. Old states do not vanish. Forget is the exception: it writes `memory/forgotten`, then deletes payload, FTS, and embeddings so the fact cannot be recalled.

## Scopes

```text
task > project > workspace > global
```

These do **not** overwrite each other.

```text
Global:   user generally prefers pnpm
Project:  Alpha uses npm
```

In Alpha, project memory wins. In any other project, the global preference remains. A project fact is never promoted to “the user always wants this.”

## Conflict resolution

Conflicts are typed:

| Type | Example | Default policy |
| --- | --- | --- |
| `duplicate` | same fact twice | merge / confirm |
| `refinement` | coffee → Ethiopian light roast | update, not contradict |
| `scope_difference` | global pnpm vs project npm | keep both |
| `temporal_update` | VS Code → Cursor | supersede old |
| `direct_contradiction` | Postgres vs MySQL, same scope | compare authority |
| `uncertain_conflict` | equal evidence | **DISPUTED** — keep both |

Priority is deterministic:

```text
explicit user correction
  > explicit user statement
  > verified structured source
  > repeated observations
  > single inference
```

The engine will not invent consistency.

## Decay, expiration, forgetting

- **Decay** lowers retrieval weight. It does not delete.
- **Expiration** (`validUntil`) removes a fact from ordinary recall.
- **Garbage collection** only runs on unpinned, non-explicit, expired/rejected, low-importance, long-unused records.
- **Pin** disables automatic GC and slows decay. Explicit forget still wins.
- **Explicit forget** immediately stops recall, search, and injection, and deletes the stored payload.

```text
Removing dsh-memory's stored memory does not necessarily
erase the original source conversation from Harness session history.
```

## Retrieval

Not vector-only. Final score is:

```text
relevance
  × scopeWeight
  × confidenceWeight
  × freshnessWeight
  × importanceWeight
  × statusWeight
  × explicitBoost
  × pinnedBoost
  × confirmationWeight
  × accessWeight
```

Access count is a *utility* signal. It is not evidence.

Injection is bounded by `maxMemories` (default 8) and `maxTokens` (default 800).

Semantic embeddings are an optional `EmbeddingProvider`. v0.1 retrieval is lexical + metadata and does not require an API key.

## Explainable recall

```text
M-031
User prefers pnpm.

Recalled because:
scope: global:user
confidence: 0.94
importance: 0.90
conflict status: NONE
lexical: 0.82
Final recall score: 0.91
```

`memory_explain` / `/memory inspect` also answers **why not**: forgotten, expired, superseded, scope mismatch, low relevance, or below the context-budget cutoff.

## Security

Memories are **DATA**. They are never mounted as a new system prompt.

Secrets (API keys, tokens, private keys, passwords, connection strings, cards) are rejected even on explicit remember.

Prompt-injection-shaped text may be stored if the user insists, but it is escaped and labeled inert.

Local-first: the default store is a file on disk. Nothing is sent to a remote embedding or LLM provider unless you add one later.

## Installation

This package is **not on npm yet**. Install from GitHub or a local clone.

You need:

- Node `>=22.19` (`node -v`)
- A working DeepSeek Harness CLI (`dsh --help`)
- Replace `default` below with the profile you actually boot (see `~/.dsh/profiles/`)

### 1. Install into DeepSeek Harness (main path)

**Option A — from GitHub**

```sh
dsh plugin --profile default add github:245678000000/dsh-memory
```

pnpm 10+ may refuse to run this package's `prepare` script (it compiles TypeScript). Copy the package key that `dsh` printed into that profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-memory: true
```

Then run `add` again.

**Option B — clone, build, add the directory**

```sh
git clone https://github.com/245678000000/dsh-memory.git
cd dsh-memory
npm install
dsh plugin --profile default add "$PWD"
```

`npm install` runs `prepare` and writes `dist/`. Do not `dsh plugin add` a source tree that has not been built.

**Restart Harness after install:**

```sh
dsh --profile default --dump-config    # should contain "# == dsh-memory"
dsh web --profile default              # or however you normally start
```

You are installed when:

1. `--dump-config` shows a `dsh-memory` layer
2. A new session lists `memory_remember`, `memory_search`, `memory_forget`, …
3. The input box accepts `/memory`

Default database file:

```text
~/.dsh/dsh-memory/memory.sqlite
```

That is `$DSH_HOME/dsh-memory/memory.sqlite`. Override with `DSH_MEMORY_PATH`.

Uninstall:

```sh
dsh plugin --profile default remove dsh-memory
```

This removes the plugin only. It does not delete the sqlite file.

### 2. CLI only (no Harness)

```sh
git clone https://github.com/245678000000/dsh-memory.git
cd dsh-memory
npm install

npx dsh-memory help
npx dsh-memory remember "I generally use pnpm."
npx dsh-memory search "package manager"
npx dsh-memory list
npx dsh-memory demo
npx dsh-memory demo conflict
```

The CLI and the plugin share `~/.dsh/dsh-memory/memory.sqlite` unless `DSH_MEMORY_PATH` is set. From the repo you can also run:

```sh
npm run demo
npm run demo:conflict
npm test
```

### 3. As a TypeScript library

```sh
npm install github:245678000000/dsh-memory
```

```ts
import { MemoryService, activeScopeFromPaths } from "dsh-memory/core";

const service = new MemoryService();
const scope = activeScopeFromPaths({ cwd: process.cwd() });
service.remember({ content: "I generally use pnpm.", explicit: true }, scope);
const recalled = service.recall("Which package manager?", scope);
console.log(recalled.promptBlock);
service.close();
```

### Optional config

To change defaults, edit `~/.dsh/profiles/<name>/cordis.patch.yml`. Patches replace a row's whole `config` by `id` (Harness does not deep-merge):

```yaml
- id: dsh-memory
  name: dsh-memory
  inject: [tools]
  config:
    databasePath: /path/to/memory.sqlite
    automaticRecall: true      # inject relevant memories on turn step 1
    automaticObserve: true     # conservative auto-remember from user text
    recallEveryStep: false     # set true to recall on every tool step
    maxMemories: 8             # max memories injected per turn
    maxTokens: 800             # token budget for injected text
```

Restart the profile after editing.

## Usage

After install and restart you have three surfaces: talk to the agent, slash commands, or the CLI. Daily use is the first one.

### Talk to the agent

Start a new session:

```text
Remember: I generally use pnpm.
```

The model should call `memory_remember`. Open a **new** session (do not copy the first transcript):

```text
Which package manager should I use? Check memory.
```

It should recall pnpm. Then, inside a **specific project directory**:

```text
For this project we use npm.
What package manager should I use here?
```

Project npm wins. The global pnpm preference stays as background only.

To change your mind:

```text
I switched from VS Code to Cursor.
```

VS Code becomes `superseded` (not deleted). Then:

```text
Forget that I use Cursor.
```

Later editor questions must not treat Cursor as current. Secrets are rejected even if you ask to remember them:

```text
Remember that my API key is sk-...
```

Automatic observation is conservative. “It is 3pm” will not become long-term memory. If it matters, start with `Remember:`.

### Slash commands (no model)

Type these in the input box:

```text
/memory
/memory search package manager
/memory conflicts
/memory inspect M-XXXXXX
/memory forget M-XXXXXX
/memory pin M-XXXXXX
/memory unpin M-XXXXXX
```

`/memory` lists usable memories. `inspect` explains why a memory would or would not be recalled.

### Model tools

The agent can call these. You can also name them: “use `memory_search` for package manager”.

| Tool | When to use it | Common arguments |
| --- | --- | --- |
| `memory_remember` | Store a fact | `content` (required), `scope` (`global` / `project` / …), `kind`, `pin`, `validUntil` |
| `memory_search` | Search by question | `query`, `limit` |
| `memory_get` | Fetch one id | `id` |
| `memory_forget` | Forget | `id` or `query` or `subject` or `scope`; wiping everything also needs `all=true` and `confirmAll=true` |
| `memory_pin` / `memory_unpin` | Pin / unpin | `id` |
| `memory_conflicts` | List open conflicts | none |
| `memory_resolve_conflict` | Resolve a conflict | `conflictId`, `resolution`: `keep_a` / `keep_b` / `both_valid_by_scope` / `mark_newer` / `merge` / `remain_disputed` |
| `memory_explain` | Explain recall | `id`, optional `query` |
| `memory_list` | Filter the catalog | `status`, `scope`, `kind`, `includeForgotten` |

Each recall injects at most `maxMemories` items and stays under `maxTokens`. Expired, forgotten, and (by default) superseded memories are not injected.

### CLI

From the repo root (or after a global install):

```text
npx dsh-memory remember I generally use pnpm.
npx dsh-memory search "package manager"
npx dsh-memory list
npx dsh-memory get M-XXXXXX
npx dsh-memory forget M-XXXXXX
npx dsh-memory pin M-XXXXXX
npx dsh-memory conflicts
npx dsh-memory explain M-XXXXXX "package manager"
npx dsh-memory export
npx dsh-memory demo
npx dsh-memory demo conflict
npx dsh-memory bench
```

### What the repo demos do

```sh
npx tsx examples/killer-demo.ts
npx tsx examples/conflict-demo.ts
```

1. Store a global `pnpm` preference
2. Store project Alpha `npm`; asking “what should I use here?” in Alpha returns **npm**
3. VS Code is superseded by Cursor
4. After forgetting Cursor, recall does not return it

Second demo: PostgreSQL vs MySQL in the same project stays **DISPUTED**. No automatic overwrite.

### Keep in mind

- The current user message always outranks stored memory.
- Memories are data, not new system instructions.
- `forget` only removes dsh-memory's store. It does **not** erase Harness session history.

## Harness integration

Automatic recall runs on the official `agent/pre-step` waterfall — the same request-preparation hook as `dsh-time-context`. Details: [docs/harness-integration.md](docs/harness-integration.md).

## Testing

```sh
npm run lint
npm run typecheck
npm run test
npm run build
```

The suite includes the v0.1 acceptance scenarios: cross-session recall, supersede, scope precedence, dispute, forget compliance, expiration, pin vs GC, secret rejection, refinement, injection labeling, context budget, historical query, explainability, and ungrounded-guess rejection.

## Benchmark

```sh
npm run bench
```

Reports real numbers only: precision, coverage, conflict accuracy, scope accuracy, stale-memory error rate, forget compliance, and injected tokens. Do not treat a hand-written table as a result — run the runner.

## Roadmap

| Version | Scope |
| --- | --- |
| **v0.1** | Local ledger, scope, conflict, forget, decay, bounded explainable retrieval, Harness plugin |
| v0.2 | Optional embeddings, Memory Inspector UI, richer consolidation |
| v0.3 | MCP / Engram / Memorix backend adapters |
| v0.4 | Shared/team memories and permissions |
| v0.5 | Cross-agent federation |

## Limitations

- v0.1 retrieval is lexical + structured metadata. Semantic search is an interface, not a default provider.
- Classification and conflict typing are deterministic heuristics. Ambiguous natural language can be under-extracted.
- Automatic observe is conservative. If you care about a fact, say “Remember …”.
- Forget cannot erase Harness session logs.
- No Inspector UI yet. Use tools, `/memory`, or the CLI.
- No cloud sync, no multi-tenant auth, no team graph.

## License

MIT
