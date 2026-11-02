#!/usr/bin/env nu
# Tests for scripts/ci/fuzz.nu

use std/assert
use runner.nu *
use ../ci/fuzz.nu [iterations]

def "test fuzz: an explicit input wins" [] {
    assert equal (iterations "42" "schedule") "42"
}

def "test fuzz: the nightly is long, everything else short" [] {
    assert equal (iterations "" "schedule") "200000"
    assert equal (iterations "" "push") "5000"
}

def main [] { run-tests }
