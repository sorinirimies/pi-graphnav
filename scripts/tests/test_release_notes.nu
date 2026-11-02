#!/usr/bin/env nu
# Tests for scripts/ci/release_notes.nu

use std/assert
use runner.nu *
use ../ci/release_notes.nu [fallback, notes_for]

def "test release_notes: the changelog section wins" [] {
    assert equal (fallback "v1.0.0" "\n- feat: x\n") "- feat: x"
}

def "test release_notes: an empty changelog falls back to one line" [] {
    assert equal (fallback "v1.0.0" "  \n") "Release v1.0.0"
}

def "test release_notes: notes_for always returns text" [] {
    assert ((notes_for "v9.9.9") | is-not-empty)
}

def main [] { run-tests }
