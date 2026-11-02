#!/usr/bin/env nu
# Tests for scripts/ci/snapshot_deps.nu

use std/assert
use runner.nu *
use ../ci/snapshot_deps.nu [flatten_tree]

def "test snapshot_deps: flattens nested dependencies" [] {
    let tree = { dependencies: {
        a: { version: "1.0.0", dependencies: { b: { version: "2.0.0" } } }
        c: { version: "3.0.0" }
    } }
    let rows = (flatten_tree $tree)
    assert equal ($rows | length) 3
    assert equal ($rows | get name) ["a" "b" "c"]
    assert equal ($rows | where name == "b" | get version.0) "2.0.0"
}

def "test snapshot_deps: deduplicates a package seen at several depths" [] {
    let tree = { dependencies: {
        a: { version: "1.0.0", dependencies: { shared: { version: "9.9.9" } } }
        b: { version: "1.0.0", dependencies: { shared: { version: "9.9.9" } } }
    } }
    assert equal (flatten_tree $tree | where name == "shared" | length) 1
}

def "test snapshot_deps: keeps different versions of one package" [] {
    let tree = { dependencies: {
        a: { version: "1.0.0", dependencies: { x: { version: "1.0.0" } } }
        b: { version: "1.0.0", dependencies: { x: { version: "2.0.0" } } }
    } }
    assert equal (flatten_tree $tree | where name == "x" | length) 2
}

def "test snapshot_deps: scoped names and missing versions" [] {
    let rows = (flatten_tree { dependencies: { "@scope/p": { version: "1.2.3" }, broken: {} } })
    assert equal $rows.0.name "@scope/p"
    assert equal ($rows | length) 1
}

def "test snapshot_deps: an empty tree has no packages" [] {
    assert equal (flatten_tree {} | length) 0
    assert equal (flatten_tree { dependencies: {} } | length) 0
}

def main [] { run-tests }
