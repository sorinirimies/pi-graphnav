#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# May this Dependabot PR be merged without a human?
# ──────────────────────────────────────────────────────────────────────────────
# Patch and minor updates merge automatically (once CI is green); a major update, or one we
# cannot classify, always waits for a person.
#
# Dependabot states the update type in its commit message:
#   updated-dependencies:
#   - dependency-name: actions/checkout
#     update-type: version-update:semver-minor
# When that is missing the PR title is compared instead ("bump x from 4.4.0 to 7.0.0").
#
# Usage:
#   nu scripts/ci/update_type.nu --title "<PR title>" --messages "<commit messages>" [--output "$GITHUB_OUTPUT"]
# Writes `automerge=true|false` and `type=major|minor|patch|unknown`.
# ──────────────────────────────────────────────────────────────────────────────

# `update-type: version-update:semver-<t>` lines in commit messages → list of types.
export def types_from_messages [text: string]: nothing -> list {
    $text | parse --regex 'update-type:\s*version-update:semver-(?<t>major|minor|patch)' | get t
}

# "bump x from 1.2.3 to 1.3.0" → major | minor | patch | unknown (also for "none" / unparsable).
export def type_from_title [title: string]: nothing -> string {
    let m = ($title | parse --regex 'from\s+v?(?<from>\d+(?:\.\d+){0,2})\s+to\s+v?(?<to>\d+(?:\.\d+){0,2})')
    if ($m | is-empty) { return "unknown" }
    let pad = {|v| $v | split row "." | each {|p| $p | into int } | append [0 0 0] | first 3 }
    let a = (do $pad $m.0.from)
    let b = (do $pad $m.0.to)
    if $a.0 != $b.0 { "major" } else if $a.1 != $b.1 { "minor" } else if $a.2 != $b.2 { "patch" } else { "unknown" }
}

# The decision for a set of update types: any major, or nothing known, means a human.
export def decide [types: list]: nothing -> record {
    if ($types | is-empty) { return { type: "unknown", automerge: false } }
    if ($types | any {|t| $t == "major" }) { return { type: "major", automerge: false } }
    { type: (if ($types | any {|t| $t == "minor" }) { "minor" } else { "patch" }), automerge: true }
}

# Commit-message types win; the title is only a fallback.
export def classify [title: string, messages: string]: nothing -> record {
    let from_messages = (types_from_messages $messages)
    if ($from_messages | is-not-empty) { return (decide $from_messages) }
    let from_title = (type_from_title $title)
    if $from_title == "unknown" { decide [] } else { decide [$from_title] }
}

def main [--title: string = "", --messages: string = "", --output: string = ""] {
    let r = (classify $title $messages)
    print $"update type: ($r.type) → automerge=($r.automerge)"
    if $output != "" { $"automerge=($r.automerge)\ntype=($r.type)\n" | save --append $output }
}
