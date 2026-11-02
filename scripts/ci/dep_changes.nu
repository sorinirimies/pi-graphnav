#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# Did the dependency update REALLY upgrade something?
# ──────────────────────────────────────────────────────────────────────────────
# The nightly job updates the lockfile and then decides whether to commit it (and,
# when it affects what ships, release). A lockfile that merely *changed* is not
# enough: this compares package versions before and after and reports
#
#   changed=true  when at least one package moved to a HIGHER version and
#                 nothing moved to a LOWER one (a downgrade means a yanked release
#                 or a resolver surprise: a human should look).
#
# Inputs are two snapshot files made by `nu scripts/ci/snapshot_deps.nu`, one
# `name version` pair per line.
#
# Usage:
#   nu scripts/ci/dep_changes.nu before.txt after.txt [--key changed] [--output "$GITHUB_OUTPUT"]
# ──────────────────────────────────────────────────────────────────────────────

# Split a semantic version into numeric parts and the pre-release tag.
def split_version [v: string]: nothing -> record {
    let core = ($v | str trim --left --char "v" | split row "+" | first)
    let parts = ($core | split row "-")
    let nums = ($parts | first | split row "." | each {|p|
        try { $p | into int } catch { 0 }
    })
    { nums: $nums, pre: ($parts | skip 1 | str join "-") }
}

# -1 when a < b, 0 when equal, 1 when a > b. Build metadata is ignored and a
# pre-release (`1.0.0-rc.1`) sorts before its release.
export def cmp_version [a: string, b: string]: nothing -> int {
    let x = (split_version $a)
    let y = (split_version $b)
    let len = ([($x.nums | length) ($y.nums | length)] | math max)
    for i in 0..<$len {
        let p = ($x.nums | get -o $i | default 0)
        let q = ($y.nums | get -o $i | default 0)
        if $p < $q { return (-1) }
        if $p > $q { return 1 }
    }
    if $x.pre == $y.pre { return 0 }
    if ($x.pre | is-empty) { return 1 }
    if ($y.pre | is-empty) { return (-1) }
    if $x.pre < $y.pre { -1 } else { 1 }
}

# `name version` lines → [{name, version}], deduplicated. Scoped names keep their `@`.
export def parse_snapshot [text: string]: nothing -> list {
    $text
    | lines
    | each {|l| $l | str trim }
    | where {|l| $l != "" }
    | each {|l|
        let w = ($l | split row " " | where {|x| $x != "" })
        { name: ($w | get 0), version: ($w | get -o 1 | default "" | str trim --left --char "v") }
    }
    | where {|p| $p.version != "" }
    | uniq
}

def sorted_versions [versions: list]: nothing -> list {
    $versions | sort-by --custom {|a, b| (cmp_version $a $b) < 0 }
}

# What changed between two package lists.
export def classify [before: list, after: list]: nothing -> record {
    let names = ($before | append $after | get name | uniq | sort)
    mut upgraded = []
    mut downgraded = []
    mut added = []
    mut removed = []
    for name in $names {
        let b = ($before | where name == $name | get version | uniq)
        let a = ($after | where name == $name | get version | uniq)
        # Only versions that appeared / disappeared matter, so a package that exists
        # twice at different versions is compared version by version.
        let gone = (sorted_versions ($b | where {|v| $v not-in $a }))
        let came = (sorted_versions ($a | where {|v| $v not-in $b }))
        let pairs = ([($gone | length) ($came | length)] | math min)
        for i in 0..<$pairs {
            let from = ($gone | get $i)
            let to = ($came | get $i)
            let row = { name: $name, from: $from, to: $to }
            if (cmp_version $to $from) > 0 {
                $upgraded = ($upgraded | append $row)
            } else {
                $downgraded = ($downgraded | append $row)
            }
        }
        for v in ($came | skip $pairs) { $added = ($added | append { name: $name, version: $v }) }
        for v in ($gone | skip $pairs) { $removed = ($removed | append { name: $name, version: $v }) }
    }
    { upgraded: $upgraded, downgraded: $downgraded, added: $added, removed: $removed }
}

# The decision: act only for real upgrades and never alongside a downgrade.
export def should_act [changes: record]: nothing -> bool {
    ($changes.upgraded | length) > 0 and ($changes.downgraded | is-empty)
}

def main [
    before: string,        # snapshot before the update
    after: string,         # snapshot after
    --key: string = "changed", # output key to write (changed | ships)
    --output: string = "", # file to append `key=…` to (e.g. $GITHUB_OUTPUT)
] {
    let read = {|p| if ($p | path exists) { parse_snapshot (open $p --raw) } else { [] } }
    let changes = (classify (do $read $before) (do $read $after))
    let act = (should_act $changes)

    for u in $changes.upgraded { print $"  ↑ ($u.name) ($u.from) → ($u.to)" }
    for d in $changes.downgraded { print $"  ↓ DOWNGRADE ($d.name) ($d.from) → ($d.to)" }
    for a in $changes.added { print $"  + ($a.name) ($a.version)" }
    for r in $changes.removed { print $"  - ($r.name) ($r.version)" }

    if $act {
        print $"✅ ($changes.upgraded | length) package\(s\) upgraded, no downgrades: ($key)=true."
    } else if not ($changes.downgraded | is-empty) {
        print $"⚠️  ($changes.downgraded | length) package\(s\) would be DOWNGRADED: ($key)=false. Look at it by hand."
    } else {
        print $"No package moved to a higher version: ($key)=false."
    }

    if $output != "" {
        $"($key)=($act)\n" | save --append $output
    }
}
