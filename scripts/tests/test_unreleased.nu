#!/usr/bin/env nu
# Tests for scripts/ci/unreleased.nu

use std/assert
use runner.nu *
use ../ci/unreleased.nu [is_releasable, is_library_update, count_releasable]

def "test unreleased: feat fix perf are releasable" [] {
    for s in ["feat: x" "fix: y" "perf: z" "feat(chart): x" "fix(ui)!: breaking" "feat!: big"] {
        assert (is_releasable $s) $"should release on ($s)"
    }
}

def "test unreleased: library updates are releasable" [] {
    for s in ["chore(deps): nightly update 2026-10-09" "build(deps): bump x"] {
        assert (is_releasable $s) $"should release on ($s)"
        assert (is_library_update $s) $"should be a library update: ($s)"
    }
}

def "test unreleased: dev tooling updates never release" [] {
    for s in ["chore(deps-dev): bump typescript" "build(deps-dev): bump x" "chore: nightly dev-tooling lockfile update 2026-10-14 (not released)"] {
        assert (not (is_releasable $s)) $"dev-only must not release: ($s)"
    }
}

def "test unreleased: only deps scopes count as library updates" [] {
    for s in ["chore(ci): tweak" "chore(release): 1.0" "ci: tweak" "docs(deps): note" "feat(deps): x" "chore: update deps" "refactor(deps): tidy"] {
        assert (not (is_library_update $s)) $"not a library update: ($s)"
    }
}

def "test unreleased: chore ci docs test refactor release style are not" [] {
    for s in ["chore: x" "ci: tweak" "docs: readme" "test: more" "refactor: tidy" "chore: release 0.3.1" "style: fmt"] {
        assert (not (is_releasable $s)) $"should not release on ($s)"
    }
}

def "test unreleased: non-conventional subjects are ignored" [] {
    for s in ["Update stuff" "fixed a bug" "feature: nope" "Merge branch 'main'" ""] {
        assert (not (is_releasable $s)) $"should not release on '($s)'"
    }
}

def "test unreleased: counts only releasable commits" [] {
    assert equal (count_releasable ["feat: a" "chore: b" "fix: c" "docs: d"]) 2
    assert equal (count_releasable ["chore(deps): n" "ci(deps): b" "chore: release 1.0.0"]) 1
    assert equal (count_releasable []) 0
}

def main [] { run-tests }
