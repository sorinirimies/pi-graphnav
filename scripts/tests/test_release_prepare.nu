#!/usr/bin/env nu
# Tests for scripts/ci/release_prepare.nu

use std/assert
use runner.nu *
use ../ci/release_prepare.nu [plan]

def "test release_prepare: a pushed tag is published as is" [] {
    assert equal (plan push v1.2.3 "" patch) { mode: "existing", tag: "v1.2.3" }
}

def "test release_prepare: a dispatched tag wins over the bump" [] {
    assert equal (plan workflow_dispatch main v0.4.0 minor) { mode: "existing", tag: "v0.4.0" }
}

def "test release_prepare: a bump cuts a new version" [] {
    for kind in [patch minor major "2.0.0"] {
        assert equal (plan workflow_dispatch main "" $kind) { mode: "bump", kind: $kind }
    }
}

def "test release_prepare: current tags the version in package.json" [] {
    assert equal (plan workflow_dispatch main "" current) { mode: "initial" }
}

def "test release_prepare: nothing to release is an error" [] {
    let msg = try { plan workflow_dispatch main "" ""; "" } catch {|e| $e.msg }
    assert ($msg | str contains "nothing to release")
}

def "test release_prepare: a bump only runs on main" [] {
    let msg = try { plan workflow_dispatch feature "" patch; "" } catch {|e| $e.msg }
    assert ($msg | str contains "not feature")
}

def main [] { run-tests }
