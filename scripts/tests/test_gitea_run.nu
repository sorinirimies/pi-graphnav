#!/usr/bin/env nu
# Tests for scripts/gitea_run.nu

use std/assert
use runner.nu *
use ../gitea_run.nu [dispatch_url]

def "test gitea_run: the workflow file name is completed" [] {
    assert equal (dispatch_url "http://g:3000/" "fuzz") (dispatch_url "http://g:3000" "fuzz.yml")
}

def "test gitea_run: dispatch endpoint" [] {
    assert ((dispatch_url "http://g:3000" "fuzz") | str ends-with "/actions/workflows/fuzz.yml/dispatches")
}

def main [] { run-tests }
