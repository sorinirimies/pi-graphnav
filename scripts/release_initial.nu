#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# pi-graphnav — First release: tag the version already in package.json (no bump)
# ──────────────────────────────────────────────────────────────────────────────
# Refuses a dirty tree or an existing tag (local or on origin); regenerates the
# changelog for the tag, commits it if it changed, tags. Pushing is the caller's.
#
# Usage: nu scripts/release_initial.nu
# ──────────────────────────────────────────────────────────────────────────────

def fail [msg: string] { print $"(ansi red)❌ ($msg)(ansi reset)"; exit 1 }

# The refusal reason, or null when the tag may be created.
export def blocker [tag: string, dirty: bool, local: bool, remote: bool]: nothing -> any {
    if $dirty { "the working tree is dirty" } else if $local { $"($tag) exists locally" } else if $remote { $"($tag) exists on origin" } else { null }
}

def main [] {
    let tag = $"v(open package.json | get version)"
    ^nu scripts/ci/validate_tag.nu $tag | ignore
    let remote = do { ^git ls-remote --tags origin $"refs/tags/($tag)" } | complete
    let why = blocker $tag (^git status --porcelain | str trim | is-not-empty) (^git tag --list $tag | str trim | is-not-empty) ($remote.exit_code == 0 and ($remote.stdout | str trim | is-not-empty))
    if $why != null { fail $why }

    ^git-cliff --output CHANGELOG.md --tag $tag
    ^git add CHANGELOG.md
    if (do { ^git diff --cached --quiet } | complete | get exit_code) != 0 {
        ^git commit -q -m $"chore: release ($tag | str substring 1..)"
    }
    ^git tag -a $tag -m $"Release ($tag)"
    print $"(ansi green)✓(ansi reset) tagged ($tag)"
}
