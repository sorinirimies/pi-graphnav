#!/usr/bin/env nu
# Tests for scripts/ci/update_type.nu

use std/assert
use runner.nu *
use ../ci/update_type.nu [types_from_messages, type_from_title, decide, classify]

const MINOR_MSG = "Bumps actions/checkout from 4.1.0 to 4.2.0.\n---\nupdated-dependencies:\n- dependency-name: actions/checkout\n  dependency-type: direct:production\n  update-type: version-update:semver-minor\n..."

def "test update_type: reads the type from the Dependabot commit message" [] {
    assert equal (types_from_messages $MINOR_MSG) ["minor"]
    assert equal (types_from_messages "update-type: version-update:semver-patch") ["patch"]
    assert equal (types_from_messages "update-type: version-update:semver-major") ["major"]
}

def "test update_type: grouped updates list every type" [] {
    let msg = "update-type: version-update:semver-patch\n- dependency-name: b\n  update-type: version-update:semver-major"
    assert equal (types_from_messages $msg) ["patch" "major"]
}

def "test update_type: no marker means no types" [] {
    assert equal (types_from_messages "fix: something") []
    assert equal (types_from_messages "") []
}

def "test update_type: title comparison" [] {
    assert equal (type_from_title "ci(deps): bump actions/setup-node from 4.4.0 to 7.0.0") "major"
    assert equal (type_from_title "bump x from 1.2.3 to 1.3.0") "minor"
    assert equal (type_from_title "bump x from 1.2.3 to 1.2.4") "patch"
    assert equal (type_from_title "bump x from 4 to 5") "major"
    assert equal (type_from_title "bump x from v2.1 to v2.2") "minor"
    assert equal (type_from_title "bump x from 1.0.0 to 1.0.0") "unknown"
}

def "test update_type: unparsable titles are unknown" [] {
    assert equal (type_from_title "bump x") "unknown"
    assert equal (type_from_title "bump x from abc1234 to def5678") "unknown"
    assert equal (type_from_title "") "unknown"
}

def "test update_type: patch and minor merge, major and unknown wait" [] {
    assert equal (decide ["patch"]) { type: "patch", automerge: true }
    assert equal (decide ["patch" "minor"]) { type: "minor", automerge: true }
    assert equal (decide ["minor" "major"]) { type: "major", automerge: false }
    assert equal (decide ["major"]) { type: "major", automerge: false }
    assert equal (decide []) { type: "unknown", automerge: false }
}

def "test update_type: message types win over the title" [] {
    # the title looks like a patch but Dependabot says major: trust Dependabot
    let r = (classify "bump x from 1.0.0 to 1.0.1" "update-type: version-update:semver-major")
    assert equal $r.automerge false
    assert equal $r.type "major"
}

def "test update_type: falls back to the title, and to a human when neither helps" [] {
    assert equal (classify "bump x from 1.0.0 to 1.1.0" "").automerge true
    assert equal (classify "bump x from 1.0.0 to 2.0.0" "").automerge false
    assert equal (classify "bump something" "").automerge false
}

def main [] { run-tests }
