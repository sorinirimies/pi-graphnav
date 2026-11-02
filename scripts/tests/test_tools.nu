#!/usr/bin/env nu
# Tests for scripts/tools.nu

use std/assert
use runner.nu *
use ../tools.nu [TOOLS, missing]

def "test tools: what is missing, in declaration order" [] {
    assert equal (missing [bun just]) [nu git-cliff]
    assert equal (missing ($TOOLS | columns)) []
}

def main [] { run-tests }
