#!/usr/bin/env nu
# Tests for scripts/bump_version.nu (pure helpers)

use std/assert
use runner.nu *
use ../bump_version.nu [next_version, next_free, set_version]

def "test bump_version: patch" [] { assert equal (next_version "0.3.0" "patch") "0.3.1" }
def "test bump_version: patch rolls past 9" [] { assert equal (next_version "0.3.9" "patch") "0.3.10" }
def "test bump_version: minor resets patch" [] { assert equal (next_version "0.3.7" "minor") "0.4.0" }
def "test bump_version: major resets minor and patch" [] { assert equal (next_version "1.2.3" "major") "2.0.0" }
def "test bump_version: explicit version" [] { assert equal (next_version "0.3.0" "1.0.0") "1.0.0" }

def "test bump_version: rejects garbage" [] {
    for k in ["nope" "1.0" "v1.0.0" "1.0.0-rc.1" ""] {
        assert (try { next_version "0.3.0" $k; false } catch { true }) $"should reject ($k)"
    }
}

def "test bump_version: rejects a malformed current version" [] {
    assert (try { next_version "0.3" "patch"; false } catch { true })
}

def "test bump_version: set_version changes only the package version" [] {
    let text = '{
  "name": "x",
  "version": "0.3.0",
  "dependencies": { "version": "1.0.0" },
  "files": ["a", "b"]
}'
    let out = (set_version $text "0.3.1")
    assert ($out | str contains '"version": "0.3.1"')
    assert ($out | str contains '"version": "1.0.0"')
    assert (not ($out | str contains '"version": "0.3.0"'))
}

def "test bump_version: set_version keeps formatting" [] {
    let text = "{\n  \"version\": \"0.1.0\",\n  \"files\": [\"extensions\", \"README.md\"]\n}\n"
    let out = (set_version $text "0.1.1")
    assert equal $out "{\n  \"version\": \"0.1.1\",\n  \"files\": [\"extensions\", \"README.md\"]\n}\n"
}

def "test bump_version: set_version round-trips as valid json" [] {
    let out = (set_version (open package.json --raw) "9.9.9")
    assert equal ($out | from json | get version) "9.9.9"
}

def "test bump_version: next_free skips existing patch tags" [] {
    assert equal (next_free "0.3.0" "patch" ["v0.3.1" "v0.3.2"]) "0.3.3"
    assert equal (next_free "0.3.0" "patch" []) "0.3.1"
    assert equal (next_free "0.3.0" "patch" ["v0.9.0"]) "0.3.1"
}

def "test bump_version: next_free does not skip for minor, major or explicit" [] {
    assert equal (next_free "0.3.0" "minor" ["v0.4.0"]) "0.4.0"
    assert equal (next_free "0.3.0" "1.0.0" ["v1.0.0"]) "1.0.0"
}

def main [] { run-tests }
