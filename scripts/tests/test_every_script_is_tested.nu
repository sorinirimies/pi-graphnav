#!/usr/bin/env nu
# Meta test: every script in scripts/ and scripts/ci has a test file, so a new
# script cannot land untested. Run from the repo root.

use std/assert
use runner.nu *

def "test meta: every script has a test_<name>.nu" [] {
    let scripts = (ls scripts/*.nu scripts/ci/*.nu | get name | each {|p| $p | path parse | get stem })
    let tests = (ls scripts/tests/test_*.nu | get name | each {|p| $p | path parse | get stem | str replace "test_" "" })
    let untested = ($scripts | where {|s| $s not-in $tests })
    assert equal $untested [] $"scripts without tests: ($untested | str join ', ')"
}

def main [] { run-tests }
