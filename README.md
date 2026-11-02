# pi-codegraph

[![npm](https://img.shields.io/npm/v/pi-codegraph.svg)](https://www.npmjs.com/package/pi-codegraph)
[![CI](https://github.com/sorinirimies/pi-codegraph/actions/workflows/ci.yml/badge.svg)](https://github.com/sorinirimies/pi-codegraph/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Audit](https://github.com/sorinirimies/pi-codegraph/actions/workflows/security.yml/badge.svg)](https://github.com/sorinirimies/pi-codegraph/actions/workflows/security.yml)
[![Fuzz](https://github.com/sorinirimies/pi-codegraph/actions/workflows/fuzz.yml/badge.svg)](https://github.com/sorinirimies/pi-codegraph/actions/workflows/fuzz.yml)

CodeGraph-first code navigation for pi: persistent index, auto init/sync, and a gate that steers structural searches to codegraph_* tools.

A [pi](https://github.com/earendil-works/pi-coding-agent) extension.

## Install

```bash
pi install npm:pi-codegraph
```

## Use

| Command | |
|---|---|
| `/codegraph` or `/codegraph status` | show the settings |
| `/codegraph [on\|off]` | switch it (remembered across sessions) |
| `/codegraph level <1-100>` | sample number setting |
| `/codegraph hello [name]` | sample command: replace it |

Settings live in `<pi agent dir>/codegraph.json` (`PI_CODING_AGENT_DIR`, else `~/.pi/agent`).

## Development

```bash
bun install
just check   # typecheck + tests (95% coverage gate) + pack check + nu script tests
just --list  # everything else: fuzz, audit, release, remotes
```

Layout:

| Path | What |
|---|---|
| `extensions/codegraph.ts` | the extension: pure functions plus a thin default export |
| `tests/` | `bun test`: `core` (pure logic), `extension` (hooks), `fuzz` (randomised properties) |
| `scripts/` | Nushell only, each with a test in `scripts/tests/` |
| `.github/`, `.gitea/` | CI, release, nightlies on both hosts |

Releases: `just release patch` bumps `package.json`, regenerates `CHANGELOG.md` with git-cliff, tags and
pushes; the Release workflow publishes to npm (secret `NPM_TOKEN`).

## License

MIT
