#!/usr/bin/env nu
# Tests for scripts/ci/auto_merge.nu

use std/assert
use runner.nu *
use ../ci/auto_merge.nu [pick]

def "test auto_merge: act only when CI ran for the current PR head" [] {
    assert equal (pick "7" "abc" "abc") "7"
    assert equal (pick "7" "abc" "def") ""
    assert equal (pick "" "" "abc") ""
}

def main [] { run-tests }
