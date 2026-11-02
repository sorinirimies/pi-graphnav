#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# Snapshot installed dependency versions (`name version`, one per line)
# ──────────────────────────────────────────────────────────────────────────────
# Reads node_modules via `npm ls`, which understands the layout `bun install`
# produces. Two snapshots are taken around `bun update`:
#
#   --prod   only what ships to users: `dependencies`, not devDependencies or
#            peerDependencies (pi provides those)
#   (default) everything, dev tooling included
#
# Usage:
#   nu scripts/ci/snapshot_deps.nu out.txt [--prod]
# ──────────────────────────────────────────────────────────────────────────────

# Flatten `npm ls --json --all` into [{name, version}], deduplicated.
export def flatten_tree [tree: record]: nothing -> list {
    let deps = ($tree | get -o dependencies | default {})
    $deps
    | transpose name node
    | each {|row|
        let own = [{ name: $row.name, version: ($row.node | get -o version | default "") }]
        $own | append (flatten_tree $row.node)
    }
    | flatten
    | where {|p| $p.version != "" }
    | uniq
    | sort-by name version
}

def main [out: string, --prod] {
    let args = if $prod { ["--omit=dev" "--omit=peer"] } else { [] }
    # `npm ls` exits non-zero on peer/extraneous warnings; the JSON is still valid.
    let res = (do { ^npm ls --json --all ...$args } | complete)
    let tree = (try { $res.stdout | from json } catch { {} })
    let rows = (flatten_tree $tree)
    $rows | each {|p| $"($p.name) ($p.version)" } | str join "\n" | $"($in)\n" | save --force $out
    print $"($rows | length) packages → ($out)"
}
