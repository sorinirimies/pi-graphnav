#!/usr/bin/env nu
# Tests for scripts/ci/output.nu

use std/assert
use runner.nu *
use ../ci/output.nu [lines_of, write_output]

def "test output: key=value lines, newline-terminated" [] {
    assert equal (lines_of { changed: true, tag: "v1.0.0" }) "changed=true\ntag=v1.0.0\n"
}

def "test output: appends to the given file" [] {
    let f = $nu.temp-dir | path join $"out-(random uuid).txt"
    "a=1\n" | save $f
    write_output { b: 2 } --file $f
    assert equal (open --raw $f) "a=1\nb=2\n"
    rm $f
}

def main [] { run-tests }
