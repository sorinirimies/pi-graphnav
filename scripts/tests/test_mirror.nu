#!/usr/bin/env nu
# Tests for scripts/ci/mirror.nu

use std/assert
use runner.nu *
use ../ci/mirror.nu [plan, new_tags, github_url, dispatch_url]

def "test mirror: up to date, fast-forward or diverged" [] {
    assert equal (plan true true) "up-to-date"
    assert equal (plan true false) "up-to-date"
    assert equal (plan false true) "fast-forward"
    assert equal (plan false false) "diverged"
}

def "test mirror: only tags this host lacks, sorted and unique" [] {
    assert equal (new_tags [v1.0.1 v1.0.0 v1.0.1] [v1.0.0]) [v1.0.1]
    assert equal (new_tags [v1.0.0] [v1.0.0]) []
}

def "test mirror: urls" [] {
    assert equal (github_url "sorin/pi-x") "https://github.com/sorinirimies/pi-x.git"
    assert equal (dispatch_url "http://g" "o/r") "http://g/api/v1/repos/o/r/actions/workflows/release.yml/dispatches"
}

def main [] { run-tests }
