#!/usr/bin/env nu
# Tests for scripts/ci/commit_push.nu

use std/assert
use runner.nu *
use ../ci/commit_push.nu [commit_args]

def "test commit_push: the body is a second -m" [] {
    assert equal (commit_args "ci: x" "") [commit -m "ci: x"]
    assert equal (commit_args "ci: x" "why") [commit -m "ci: x" -m "why"]
}

def main [] { run-tests }
