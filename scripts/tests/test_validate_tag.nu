#!/usr/bin/env nu
# Tests for scripts/ci/validate_tag.nu

use std/assert
use runner.nu *
use ../ci/validate_tag.nu [validate, matches_package]

def "test validate_tag: simple release tag" [] {
    let r = (validate "v1.0.0")
    assert equal $r.tag "v1.0.0"
    assert equal $r.version "1.0.0"
}

def "test validate_tag: large numbers" [] {
    assert equal (validate "v12.345.6789").version "12.345.6789"
}

def "test validate_tag: version has no v prefix, tag keeps it" [] {
    let r = (validate "v3.2.1")
    assert (not ($r.version | str starts-with "v"))
    assert ($r.tag | str starts-with "v")
}

def "test validate_tag: rejects missing v" [] {
    assert (try { validate "1.0.0"; false } catch { true })
}

def "test validate_tag: rejects two segments" [] {
    assert (try { validate "v1.0"; false } catch { true })
}

def "test validate_tag: rejects pre-release and junk" [] {
    for t in ["v1.0.0-rc.1" "v1.0.0.0" "vX.Y.Z" "release-1" " v1.0.0"] {
        assert (try { validate $t; false } catch { true }) $"should reject ($t)"
    }
}

def "test validate_tag: rejects empty" [] {
    assert (try { validate ""; false } catch { true })
}

def "test validate_tag: matches package version" [] {
    assert equal (matches_package "v0.3.0" "0.3.0").version "0.3.0"
}

def "test validate_tag: rejects tag that differs from package version" [] {
    assert (try { matches_package "v0.3.1" "0.3.0"; false } catch { true })
}

def main [] { run-tests }
