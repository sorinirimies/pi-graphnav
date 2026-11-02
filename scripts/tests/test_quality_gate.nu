#!/usr/bin/env nu
# Tests for scripts/ci/quality_gate.nu (pack rules)

use std/assert
use runner.nu *
use ../ci/quality_gate.nu [required_files, forbidden]

def "test quality_gate: required files are the extensions plus docs" [] {
    let req = (required_files { pi: { extensions: ["./extensions/a.ts", "./extensions/b.ts"] } })
    assert equal $req ["extensions/a.ts" "extensions/b.ts" "package.json" "README.md" "LICENSE"]
}

def "test quality_gate: works without a pi manifest" [] {
    assert equal (required_files {}) ["package.json" "README.md" "LICENSE"]
}

def "test quality_gate: the repo own manifest is covered" [] {
    let req = (required_files (open package.json))
    assert ($req | any {|f| $f | str starts-with "extensions/" })
}

def "test quality_gate: tests, scripts, CI and node_modules must not ship" [] {
    let bad = (forbidden ["extensions/a.ts" "tests/a.test.ts" "scripts/x.nu" "examples/vhs/overview.tape" "examples/vhs/generated/a.gif" ".github/workflows/ci.yml" ".gitea/workflows/ci.yml" "node_modules/x/index.js" "README.md"])
    assert equal $bad ["tests/a.test.ts" "scripts/x.nu" "examples/vhs/overview.tape" "examples/vhs/generated/a.gif" ".github/workflows/ci.yml" ".gitea/workflows/ci.yml" "node_modules/x/index.js"]
}

def "test quality_gate: a clean file list has nothing forbidden" [] {
    assert equal (forbidden ["extensions/a.ts" "package.json" "LICENSE"]) []
}

def main [] { run-tests }
