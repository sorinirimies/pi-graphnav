#!/usr/bin/env nu
# Tests for scripts/ci/npm_publish.nu (pure helpers; no network)

use std/assert
use runner.nu *
use ../ci/npm_publish.nu [publish_args, has_token]

def "test npm_publish: plain publish is public" [] {
    assert equal (publish_args false false) ["publish" "--access" "public"]
}

def "test npm_publish: provenance and dry-run flags" [] {
    assert equal (publish_args true false) ["publish" "--access" "public" "--provenance"]
    assert equal (publish_args false true) ["publish" "--access" "public" "--dry-run"]
    assert equal (publish_args true true) ["publish" "--access" "public" "--provenance" "--dry-run"]
}

def "test npm_publish: token from NODE_AUTH_TOKEN or NPM_TOKEN" [] {
    assert (has_token { NODE_AUTH_TOKEN: "abc" })
    assert (has_token { NPM_TOKEN: "abc" })
}

def "test npm_publish: missing or empty token" [] {
    assert (not (has_token {}))
    assert (not (has_token { NODE_AUTH_TOKEN: "", NPM_TOKEN: "" }))
}

def main [] { run-tests }
