#!/usr/bin/env nu
# Tests for scripts/version.nu (run from the repo root: `nu scripts/tests/run_all.nu`)

use std/assert
use runner.nu *

def "test version: matches package.json" [] {
    let out = (^nu scripts/version.nu | str trim)
    assert equal $out (open package.json | get version)
}

def "test version: is a plain X.Y.Z" [] {
    let out = (^nu scripts/version.nu | str trim)
    assert ($out | find --regex '^\d+\.\d+\.\d+$' | is-not-empty)
}

def main [] { run-tests }
