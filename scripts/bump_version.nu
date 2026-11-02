#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# Bump the package version, update the changelog, commit and tag
# ──────────────────────────────────────────────────────────────────────────────
# Usage:
#   nu scripts/bump_version.nu <patch|minor|major|X.Y.Z> [--yes] [--skip-checks]
#
# Order matters: the quality gate runs FIRST, on the unmodified tree, and nothing
# is edited, committed or tagged until it is green. If a later step fails,
# everything the script touched is rolled back.
#
#   --yes          non-interactive (CI)
#   --skip-checks  the caller already ran the gate (the nightly workflow does)
# ──────────────────────────────────────────────────────────────────────────────

# Files this script edits (committed, and restored on failure).
const TOUCHED = ["package.json" "CHANGELOG.md"]

# Next version for `patch` / `minor` / `major`, or an explicit X.Y.Z.
export def next_version [current: string, kind: string]: nothing -> string {
    let m = ($current | parse --regex '^(?<ma>\d+)\.(?<mi>\d+)\.(?<pa>\d+)$')
    if ($m | is-empty) {
        error make { msg: $"current version '($current)' is not X.Y.Z" }
    }
    let ma = ($m.0.ma | into int)
    let mi = ($m.0.mi | into int)
    let pa = ($m.0.pa | into int)
    match $kind {
        "patch" => $"($ma).($mi).($pa + 1)"
        "minor" => $"($ma).($mi + 1).0"
        "major" => $"($ma + 1).0.0"
        _ => {
            if ($kind | find --regex '^\d+\.\d+\.\d+$' | is-empty) {
                error make { msg: $"'($kind)' is not patch, minor, major or X.Y.Z" }
            }
            $kind
        }
    }
}

# Like next_version, but a patch bump never lands on a tag that already exists
# (two hosts, or a re-run, may have got there first).
export def next_free [current: string, kind: string, tags: list]: nothing -> string {
    mut v = (next_version $current $kind)
    if $kind == "patch" {
        while $"v($v)" in $tags { $v = (next_version $v "patch") }
    }
    $v
}

# Replace the first `"version": "…"` (the package's own) without reformatting the file.
export def set_version [text: string, version: string]: nothing -> string {
    $text | str replace --regex '"version":\s*"[^"]+"' $'"version": "($version)"'
}

def roll_back [start: string, tag: string] {
    print $"(ansi red)✗ Bump failed — rolling back to ($start | str substring 0..7).(ansi reset)"
    do --ignore-errors { ^git tag -d $tag | ignore }
    ^git reset --hard $start
    print $"(ansi yellow)Nothing was committed or tagged; the version is unchanged.(ansi reset)"
}

def main [
    kind: string,         # patch | minor | major | X.Y.Z
    --yes (-y),           # non-interactive
    --skip-checks,        # the caller already ran the quality gate
] {
    let current = (open package.json | get version)
    let existing = (^git tag --list "v*" | lines)
    let new_version = (try { next_free $current $kind $existing } catch {|e|
        print $"(ansi red)Error:(ansi reset) ($e.msg)"
        exit 1
    })
    let tag = $"v($new_version)"
    print $"(ansi cyan)Bump(ansi reset) ($current) → (ansi green)($new_version)(ansi reset)"

    if $current == $new_version {
        print $"(ansi yellow)⚠(ansi reset) Version is already ($new_version). Nothing to do."
        return
    }
    if (^git tag --list $tag | str trim | is-not-empty) {
        print $"(ansi red)Error:(ansi reset) tag ($tag) already exists."
        exit 1
    }
    if (^git status --porcelain | str trim | is-not-empty) {
        print $"(ansi red)Error:(ansi reset) the working tree is dirty — commit or stash first."
        exit 1
    }
    let start = (^git rev-parse HEAD | str trim)

    if $skip_checks {
        print $"(ansi yellow)⚠(ansi reset) --skip-checks: assuming the caller already ran the gate."
    } else {
        run-external "nu" "scripts/ci/quality_gate.nu"
    }

    try {
        set_version (open package.json --raw) $new_version | save --force package.json
        print $"(ansi green)✓(ansi reset) package.json → ($new_version)"

        if (which git-cliff | is-not-empty) {
            run-external "git-cliff" "--output" "CHANGELOG.md" "--tag" $tag
            print $"(ansi green)✓(ansi reset) CHANGELOG.md updated via git-cliff."
        } else {
            print $"(ansi yellow)⚠(ansi reset) git-cliff not found — skipping changelog."
        }

        let files = ($TOUCHED | where {|f| $f | path exists })
        run-external "git" "add" ...$files
        run-external "git" "commit" "-m" $"chore: release ($new_version)"
        run-external "git" "tag" "-a" $tag "-m" $"Release ($tag)"
        print $"(ansi green)✓(ansi reset) Committed and tagged ($tag)."
    } catch {|err|
        roll_back $start $tag
        error make --unspanned { msg: $"bump to ($new_version) failed and was rolled back: ($err.msg)" }
    }

    print ""
    print $"(ansi green)Version bumped to ($new_version) 🚀(ansi reset)  Next: git push origin main --tags"
}
