#!/usr/bin/env nu
# Tests for scripts/remotes.nu

use std/assert
use runner.nu *
use ../remotes.nu [REMOTES, targets, git_args]

def "test remotes: GitHub and Gitea Starscream" [] {
    assert equal ($REMOTES | columns) [origin gitea-starscream]
}

def "test remotes: only configured remotes are targeted" [] {
    assert equal (targets [origin other]) [origin]
}

def "test remotes: git arguments per operation" [] {
    assert equal (git_args push origin main) [push --follow-tags origin main]
    assert equal (git_args push origin main --force) [push --follow-tags --force origin main]
    assert equal (git_args push-tags origin main) [push origin --tags]
    assert equal (git_args pull origin main) [pull origin main]
}

def main [] { run-tests }
