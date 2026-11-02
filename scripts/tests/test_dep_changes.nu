#!/usr/bin/env nu
# Tests for scripts/ci/dep_changes.nu

use std/assert
use runner.nu *
use ../ci/dep_changes.nu [cmp_version, parse_snapshot, classify, should_act]

def pkgs [text: string] { parse_snapshot $text }

def "test dep_changes: cmp_version orders numerically, not lexically" [] {
    assert equal (cmp_version "1.10.0" "1.9.0") 1
    assert equal (cmp_version "1.9.0" "1.10.0") (-1)
    assert equal (cmp_version "2.0.0" "2.0.0") 0
}

def "test dep_changes: cmp_version handles pre-releases and missing parts" [] {
    assert equal (cmp_version "1.0.0-rc.1" "1.0.0") (-1)
    assert equal (cmp_version "1.0.0" "1.0.0-rc.1") 1
    assert equal (cmp_version "1.0" "1.0.0") 0
    assert equal (cmp_version "1.0.0+build5" "1.0.0") 0
}

def "test dep_changes: parse_snapshot keeps scoped names and drops blanks" [] {
    let p = (pkgs "@scope/pkg 1.2.3\n\n  left-pad v1.0.0 \n")
    assert equal ($p | length) 2
    assert equal $p.0.name "@scope/pkg"
    assert equal $p.1.version "1.0.0"
}

def "test dep_changes: parse_snapshot deduplicates" [] {
    assert equal (pkgs "a 1.0.0\na 1.0.0\n" | length) 1
}

def "test dep_changes: detects an upgrade" [] {
    let c = (classify (pkgs "a 1.0.0\nb 2.0.0") (pkgs "a 1.0.1\nb 2.0.0"))
    assert equal ($c.upgraded | length) 1
    assert equal $c.upgraded.0.name "a"
    assert equal $c.upgraded.0.to "1.0.1"
    assert (should_act $c)
}

def "test dep_changes: no change means no action" [] {
    let c = (classify (pkgs "a 1.0.0") (pkgs "a 1.0.0"))
    assert (not (should_act $c))
}

def "test dep_changes: a downgrade blocks the action" [] {
    let c = (classify (pkgs "a 1.0.1") (pkgs "a 1.0.0"))
    assert equal ($c.downgraded | length) 1
    assert (not (should_act $c))
}

def "test dep_changes: an upgrade next to a downgrade is still blocked" [] {
    let c = (classify (pkgs "a 1.0.0\nb 2.0.1") (pkgs "a 1.1.0\nb 2.0.0"))
    assert (not (should_act $c))
}

def "test dep_changes: added and removed alone never act" [] {
    let c = (classify (pkgs "a 1.0.0") (pkgs "a 1.0.0\nb 1.0.0"))
    assert equal ($c.added | length) 1
    assert (not (should_act $c))
    let d = (classify (pkgs "a 1.0.0\nb 1.0.0") (pkgs "a 1.0.0"))
    assert equal ($d.removed | length) 1
    assert (not (should_act $d))
}

def "test dep_changes: duplicate versions of one package are compared pairwise" [] {
    let c = (classify (pkgs "x 0.5.0\nx 0.6.0") (pkgs "x 0.5.1\nx 0.6.0"))
    assert equal ($c.upgraded | length) 1
    assert equal $c.upgraded.0.from "0.5.0"
    assert (should_act $c)
}

def "test dep_changes: empty inputs are fine" [] {
    let c = (classify [] [])
    assert (not (should_act $c))
}

def main [] { run-tests }
