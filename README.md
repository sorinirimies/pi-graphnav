# pi-graphnav

[![npm](https://img.shields.io/npm/v/pi-graphnav.svg)](https://www.npmjs.com/package/pi-graphnav)
[![CI](https://github.com/sorinirimies/pi-graphnav/actions/workflows/ci.yml/badge.svg)](https://github.com/sorinirimies/pi-graphnav/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Audit](https://github.com/sorinirimies/pi-graphnav/actions/workflows/security.yml/badge.svg)](https://github.com/sorinirimies/pi-graphnav/actions/workflows/security.yml)
[![Fuzz](https://github.com/sorinirimies/pi-graphnav/actions/workflows/fuzz.yml/badge.svg)](https://github.com/sorinirimies/pi-graphnav/actions/workflows/fuzz.yml)

CodeGraph-first code navigation for pi: the agent understands code through
[CodeGraph](https://github.com/colbymchenry/codegraph)'s symbol graph instead of grepping and
reading file after file, without being told to.

A [pi](https://github.com/earendil-works/pi-coding-agent) extension.

## What it does

* **Keeps the index current.** At session start, in the background: `codegraph init` for a git repo
  without an index, a full `codegraph index` when the index is stale or was built by another
  CodeGraph version, `codegraph sync` for pending changes. An index a killed run left half-built
  is rebuilt (unless another process is indexing right now), and a failure on a stale lock gets
  `codegraph unlock` and one more try. While pi runs, the server's file watcher follows your edits.
* **The `codegraph_*` tools** (`explore`, `search`, `node`, `callers`, `callees`, `impact`,
  `files`, `status`) on one long-lived `codegraph serve --mcp` per project: no process start per
  call, and the watcher stays alive. Resilient, with
  [arrow-resilience-kit](https://www.npmjs.com/package/arrow-resilience-kit): a server that dies
  under a call is restarted and the call retried once; after 3 failed calls in a row CodeGraph
  counts as unavailable for a minute, so calls fail fast and the gate stops sending the agent to
  it (status line: `codegraph: unavailable`).
* **Steers symbol searches to CodeGraph.** `rg parseConfig`, `grep -rn UserService src`,
  `git grep`, `ag`, `ack` and pi's `grep` tool with a symbol-like pattern are blocked once with
  the CodeGraph call that answers it (`enforce`), or run with that hint appended (`nudge`).
  Running the same command again is allowed: CodeGraph cannot answer everything. Searches for
  phrases, string literals or in docs and config (`*.md`, `--type yaml`, …) are never touched,
  nor symbols already looked up with CodeGraph. Searches a codemode script makes with literal
  `tools.bash({ command })` / `tools.grep({ pattern })` are gated the same way.
* **Nudges file-name lookups.** `fd UserService`, `find . -name '*ParseConfig*'` and pi's `find`
  tool with a camelCase or snake_case name run, with a hint to `codegraph_search` (never blocked).
* **Hints after blind reading.** Reading several source files before any CodeGraph call adds
  one hint to use `codegraph_explore`; reading a whole source file over 400 lines adds one to
  fetch just the symbol with `codegraph_node`.
* **Shows whether it helps.** `/codegraph status` counts blocked searches, how many the agent
  answered with CodeGraph and how many it re-ran instead.
* **Prompt guidance** that stays the same every turn, so the prompt cache survives.

Needs the CodeGraph CLI: `npm i -g @colbymchenry/codegraph`. The project is the nearest
directory with `.codegraph/`, else the git work tree; never your home directory.

## Demos

A repo without an index: indexed in the background, then a symbol `rg` is blocked and the
answer comes from `codegraph_search` and `codegraph_callers`.

![Overview: background indexing, a blocked rg, CodeGraph answers](examples/vhs/generated/overview.gif)

`nudge` mode: the search runs, and its output points at CodeGraph.

![Nudge mode: rg runs and its output carries the CodeGraph hint](examples/vhs/generated/nudge.gif)

The `/codegraph` command: status, mode, off/on, sync.

![The /codegraph command](examples/vhs/generated/commands.gif)

Recorded with [VHS](https://github.com/charmbracelet/vhs) against a throw-away sample project and a
scripted local model (`just vhs`, `scripts/vhs.nu`, `examples/vhs/`): a real pi with only this plugin.

## Install

```bash
pi install npm:pi-graphnav
```

## Use

| Command | |
|---|---|
| `/codegraph` or `/codegraph status` | project, index state, mode, blocked/nudged counts |
| `/codegraph [on\|off]` | switch it all (remembered across sessions) |
| `/codegraph mode <mode>` | symbol searches: `enforce` (default), `nudge` or `off` |
| `/codegraph sync` | sync the index with changed files |
| `/codegraph reindex` | rebuild the index from scratch |
| `/codegraph init` | create the index (for a directory that is not a git repo) |

Settings live in `<pi agent dir>/codegraph.json` (`PI_CODING_AGENT_DIR`, else `~/.pi/agent`):

| Key | Default | |
|---|---|---|
| `enabled` | `true` | master switch |
| `showStatus` | `true` | status line entry |
| `mode` | `"enforce"` | `enforce`, `nudge` or `off` |
| `autoInit` | `true` | init a git repo that has no index |
| `autoSync` | `true` | sync or rebuild a stale index at session start |
| `watch` | `true` | keep the server's file watcher running |
| `readHintAfter` | `3` | source files read before the CodeGraph hint (`0`: never) |
| `timeoutMs` | `30000` | per-call timeout of the CodeGraph server |

A project can override `enabled`, `mode`, `autoInit`, `autoSync` and `readHintAfter` for itself in
`<project>/.pi/codegraph.json` (commit it to share), e.g. `{ "mode": "nudge" }` for a repo full of
generated code. A `/codegraph` command still wins for the session.

Replaces `@vndv/pi-codegraph` (same tool names): uninstall that one first.

## Development

```bash
bun install
just check   # typecheck + tests (95% coverage gate) + pack check + nu script tests
just --list  # everything else: fuzz, audit, release, remotes
```

Layout:

| Path | What |
|---|---|
| `extensions/graphnav.ts` | wiring: hooks, tools, the command, the status line |
| `extensions/core/gate.ts` | spotting symbol searches in shell commands; the gate decision |
| `extensions/core/project.ts` | project root, `codegraph status -j`, what keeps the index current |
| `extensions/core/mcp.ts` | the long-lived `codegraph serve --mcp` client |
| `extensions/core/resilience.ts` | circuit breaker and crash retry (arrow-resilience-kit) |
| `extensions/core/tools.ts` | tool definitions and prompt guidelines |
| `extensions/core/config.ts`, `extensions/command/parse.ts` | settings, `/codegraph` parsing |
| `tests/` | `bun test`: one file per module, `extension` (hooks), `fuzz` (randomised properties) |
| `scripts/` | Nushell only, each with a test in `scripts/tests/` |
| `examples/vhs/` | demo tapes, the scripted model, the rendered GIFs |
| `.github/`, `.gitea/` | CI, release, nightlies on both hosts |

Releases: `just release patch` bumps `package.json`, regenerates `CHANGELOG.md` with git-cliff, tags and
pushes; the Release workflow publishes to npm (secret `NPM_TOKEN`).

## License

MIT
