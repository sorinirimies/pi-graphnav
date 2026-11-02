#!/usr/bin/env nu
# Tests for scripts/ci/deps_update.nu

use std/assert
use runner.nu *
use ../ci/deps_update.nu [snapshot_dir, snapshot_file, commit_message, MANIFESTS]

def "test deps_update: snapshots go to RUNNER_TEMP, else the temp dir" [] {
    assert equal (snapshot_dir "/run/tmp") "/run/tmp"
    assert equal (snapshot_dir "") $nu.temp-dir
}

def "test deps_update: one snapshot file per phase and scope" [] {
    assert equal (snapshot_file "/t" before prod) "/t/before-prod.txt"
    assert equal (snapshot_file "/t" after all) "/t/after-all.txt"
}

def "test deps_update: the commit subject says whether it ships" [] {
    assert equal (commit_message true "2026-11-01") "chore(deps): nightly update 2026-11-01"
    assert ((commit_message false "2026-11-01") | str contains "not released")
}

def "test deps_update: only the manifest and lockfile are committed" [] {
    assert equal $MANIFESTS ["package.json" "bun.lock"]
}

def main [] { run-tests }
