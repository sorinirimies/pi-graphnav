#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# CI quality gate — used by CI, the nightly job, release and `just check`
# ──────────────────────────────────────────────────────────────────────────────
#   1. tsc --noEmit          (strict type check against pi's real types)
#   2. bun test
#   3. npm pack --dry-run    (the tarball has every extension file, and no tests)
#   4. nu script tests
#
# Usage:
#   nu scripts/ci/quality_gate.nu [--skip-typecheck] [--skip-test] [--skip-pack] [--skip-nu]
# Exit code 0 when everything passed, 1 otherwise.
# ──────────────────────────────────────────────────────────────────────────────

# Files the tarball must contain: every declared extension plus the docs.
export def required_files [pkg: record]: nothing -> list {
    let ext = ($pkg | get -o pi.extensions | default [] | each {|p| $p | str replace --regex '^\./' "" })
    $ext | append ["package.json" "README.md" "LICENSE"] | uniq
}

# Paths that must never ship.
const NEVER_SHIP = ["tests/" "scripts/" "examples/" ".github/" ".gitea/" "node_modules/"]

export def forbidden [paths: list]: nothing -> list {
    $paths | where {|p| $NEVER_SHIP | any {|prefix| $p | str starts-with $prefix } }
}

def step [label: string] { print $"(ansi cyan)▶(ansi reset) ($label)" }

def run_step [label: string, cmd: closure]: nothing -> bool {
    step $label
    let res = (do $cmd | complete)
    if $res.exit_code != 0 {
        print $"(ansi red)  ✗ failed(ansi reset)"
        if ($res.stdout | str trim | is-not-empty) { print $res.stdout }
        if ($res.stderr | str trim | is-not-empty) { print $res.stderr }
        false
    } else {
        print $"(ansi green)  ✔ ok(ansi reset)"
        true
    }
}

def main [--skip-typecheck, --skip-test, --skip-pack, --skip-nu] {
    print $"(ansi cyan)══════════════════════════ Quality gate ══════════════════════════(ansi reset)"
    mut ok = true

    if not $skip_typecheck {
        if not (run_step "tsc --noEmit" { ^bunx tsc --noEmit }) { $ok = false }
    }
    if not $skip_test {
        if not (run_step "bun test" { ^bun test }) { $ok = false }
    }
    if not $skip_pack {
        step "npm pack --dry-run"
        let res = (do { ^npm pack --dry-run --json } | complete)
        if $res.exit_code != 0 {
            print $"(ansi red)  ✗ npm pack failed(ansi reset)"
            print $res.stderr
            $ok = false
        } else {
            let files = ($res.stdout | from json | get 0.files | get path)
            let missing = (required_files (open package.json) | where {|f| $f not-in $files })
            let bad = (forbidden $files)
            if ($missing | is-not-empty) {
                print $"(ansi red)  ✗ missing from tarball: ($missing | str join ', ')(ansi reset)"
                $ok = false
            } else if ($bad | is-not-empty) {
                print $"(ansi red)  ✗ must not ship: ($bad | str join ', ')(ansi reset)"
                $ok = false
            } else {
                print $"(ansi green)  ✔ tarball has ($files | length) files(ansi reset)"
            }
        }
    }
    if not $skip_nu {
        if not (run_step "nu scripts/tests/run_all.nu" { ^nu scripts/tests/run_all.nu }) { $ok = false }
    }

    if not $ok {
        print $"(ansi red)══════════════════════ ✗ Quality gate FAILED ═════════════════════(ansi reset)"
        exit 1
    }
    print $"(ansi green)══════════════════════ ✔ Quality gate passed ═════════════════════(ansi reset)"
}
