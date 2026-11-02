#!/usr/bin/env nu
# Tests for scripts/release_initial.nu

use std/assert
use runner.nu *
use ../release_initial.nu [blocker]

def "test release_initial: what stops a first release" [] {
    assert equal (blocker v0.1.0 false false false) null
    assert equal (blocker v0.1.0 true false false) "the working tree is dirty"
    assert equal (blocker v0.1.0 false true false) "v0.1.0 exists locally"
    assert equal (blocker v0.1.0 false false true) "v0.1.0 exists on origin"
}

def main [] { run-tests }
