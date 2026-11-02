#!/usr/bin/env nu
# Tests for scripts/ci/gitea_release.nu

use std/assert
use runner.nu *
use ../ci/gitea_release.nu [release_payload]

def "test gitea_release: payload carries tag, name and notes" [] {
    assert equal (release_payload "v1.0.0" "notes") { tag_name: "v1.0.0", name: "v1.0.0", body: "notes" }
}

def main [] { run-tests }
