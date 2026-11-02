#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# Are there user-facing commits since the last release tag?
# ──────────────────────────────────────────────────────────────────────────────
# A patch release is worth publishing when there is
#   * a `feat`, `fix` or `perf` commit, or
#   * a library update: `chore(deps)`, `build(deps)` (runtime only; dev tooling never releases) (the nightly
#     lockfile update and merged Dependabot PRs).
# Plain chore / ci / docs / test / refactor / style commits and release commits are not.
# With no release tag at all nothing is released automatically (create a baseline tag first).
#
# Usage:
#   nu scripts/ci/unreleased.nu [--output "$GITHUB_OUTPUT"]
# Writes `releasable=true|false` and `unreleased=N`.
# ──────────────────────────────────────────────────────────────────────────────

# A commit subject counts when it is feat/fix/perf (optionally scoped, optionally breaking)
# or a library update.
export def is_releasable [subject: string]: nothing -> bool {
    ($subject | find --regex '^(feat|fix|perf)(\([^)]*\))?!?:' | is-not-empty) or (is_library_update $subject)
}

# `chore(deps): …`, `build(deps): …`: what the nightly job and Dependabot write.
export def is_library_update [subject: string]: nothing -> bool {
    ($subject | find --regex '^(chore|build)\(deps\)!?:' | is-not-empty)
}

export def count_releasable [subjects: list]: nothing -> int {
    $subjects | where {|s| is_releasable $s } | length
}

def main [--output: string = ""] {
    let tag = (do { ^git describe --tags --abbrev=0 --match "v*" } | complete)
    mut releasable = false
    mut count = 0
    if $tag.exit_code != 0 {
        print "No release tag found: not releasing automatically. Create a baseline tag (git tag vX.Y.Z)."
    } else {
        let last = ($tag.stdout | str trim)
        # Both hosts (GitHub + Gitea) run the nightly and make parallel, same-subject commits
        # (`chore(deps): nightly update <date>`). Merging them leaves the other host's copy
        # "after" the tag although it was already released: ignore subjects already in the tag.
        let released = (^git log $last --no-merges --format=%s | lines)
        let subjects = (^git log $"($last)..HEAD" --no-merges --format=%s | lines | where {|s| $s not-in $released })
        $count = (count_releasable $subjects)
        $releasable = ($count > 0)
        print $"($last)..HEAD: ($subjects | length) commit\(s\), ($count) releasable \(feat/fix/perf\)."
    }
    if $output != "" {
        $"releasable=($releasable)\nunreleased=($count)\n" | save --append $output
    }
}
