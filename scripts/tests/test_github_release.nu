#!/usr/bin/env nu
# Tests for scripts/ci/github_release.nu

use std/assert
use runner.nu *
use ../ci/github_release.nu [action, gh_args]

def "test github_release: edit an existing release, create a new one" [] {
    assert equal (action true) "edit"
    assert equal (action false) "create"
}

def "test github_release: gh arguments" [] {
    assert equal (gh_args edit v1.0.0 n.md) [release edit v1.0.0 --notes-file n.md]
    assert equal (gh_args create v1.0.0 n.md) [release create v1.0.0 --title v1.0.0 --notes-file n.md]
}

def main [] { run-tests }
