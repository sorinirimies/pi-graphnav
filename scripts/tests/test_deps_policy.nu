#!/usr/bin/env nu
# Tests for scripts/ci/deps_policy.nu

use std/assert
use runner.nu *
use ../ci/deps_policy.nu [lock_packages source_problems ban_problems module_path license_of license_allowed license_problems]

const LOCK = '{
  "lockfileVersion": 1,
  "packages": {
    "@scope/a": ["@scope/a@1.2.3", "", {}, "sha512-x"],
    "b": ["b@2.0.0", "", {}, "sha512-y"],
    "b/c": ["c@0.1.0", "", {}, "sha512-z"],
    "d-linux": ["d-linux@1.0.0", "", { "os": "linux", "cpu": "x64" }, "sha512-w"],
  },
}'

const ALLOWED = [MIT Apache-2.0 ISC]

def pkg [name: string, version: string = "1.0.0", registry: string = ""] {
    { key: $name, name: $name, version: $version, registry: $registry }
}

def "test deps policy: lock packages split name and version" [] {
    let p = lock_packages $LOCK
    assert equal ($p | get name) ["@scope/a" b c d-linux]
    assert equal ($p | get version) ["1.2.3" "2.0.0" "0.1.0" "1.0.0"]
    assert equal ($p | get key) ["@scope/a" b "b/c" d-linux]
    assert equal ($p | get platform) [false false false true]
}

def "test deps policy: a lock without packages is empty" [] {
    assert equal (lock_packages '{"lockfileVersion": 1}') []
}

def "test deps policy: registry packages pass" [] {
    assert equal (source_problems [(pkg a) (pkg b "1.0.0" "https://registry.npmjs.org/")] ["https://registry.npmjs.org/"]) []
}

def "test deps policy: git url and path sources fail" [] {
    let bad = [(pkg a "github:x/a") (pkg b "git+https://h/b.git") (pkg c "https://h/c.tgz") (pkg d "file:../d")]
    assert equal (source_problems $bad [] | length) 4
}

def "test deps policy: other registries fail" [] {
    let p = source_problems [(pkg a "1.0.0" "https://evil.example/")] ["https://registry.npmjs.org/"]
    assert ($p.0 | str contains "evil.example")
}

def "test deps policy: banned names fail once" [] {
    assert equal (ban_problems [(pkg a) (pkg bad) (pkg bad "2.0.0")] [bad]) ["bad: banned"]
}

def "test deps policy: module paths follow nesting and scopes" [] {
    assert equal (module_path "a") "node_modules/a"
    assert equal (module_path "@s/a") "node_modules/@s/a"
    assert equal (module_path "a/b") "node_modules/a/node_modules/b"
    assert equal (module_path "@s/a/@t/b/c") "node_modules/@s/a/node_modules/@t/b/node_modules/c"
}

def "test deps policy: license forms are read" [] {
    assert equal (license_of {license: MIT}) MIT
    assert equal (license_of {license: {type: ISC}}) ISC
    assert equal (license_of {licenses: [{type: MIT} {type: Apache-2.0}]}) "MIT OR Apache-2.0"
    assert equal (license_of {}) ""
}

def "test deps policy: spdx expressions" [] {
    assert (license_allowed MIT $ALLOWED)
    assert (license_allowed "(MIT OR GPL-3.0)" $ALLOWED)
    assert (license_allowed "MIT AND ISC" $ALLOWED)
    assert not (license_allowed "MIT AND GPL-3.0" $ALLOWED)
    assert not (license_allowed GPL-3.0 $ALLOWED)
    assert not (license_allowed "" $ALLOWED)
    assert (license_allowed "Apache-2.0 WITH LLVM-exception" $ALLOWED)
}

def "test deps policy: license problems name the package" [] {
    let manifests = { "node_modules/a": {license: MIT}, "node_modules/b": {license: GPL-3.0}, "node_modules/c": {} }
    let read = {|dir| $manifests | get -o $dir }
    let p = license_problems [(pkg a) (pkg b) (pkg c) (pkg d)] $read $ALLOWED {}
    assert equal $p ["b@1.0.0: license GPL-3.0 is not allowed" "c@1.0.0: license none declared is not allowed" "d: not installed (run bun install)"]
}

def "test deps policy: missing platform packages are skipped" [] {
    let read = {|dir| null }
    assert equal (license_problems [({key: x, name: x, version: "1", registry: "", platform: true})] $read $ALLOWED {}) []
}

def "test deps policy: exceptions skip the license check" [] {
    let read = {|dir| {license: GPL-3.0} }
    assert equal (license_problems [(pkg b)] $read $ALLOWED {b: "reviewed"}) []
}

def "test deps policy: the template policy is valid" [] {
    let pol = open ($env.FILE_PWD | path join .. .. deps-policy.nuon)
    assert ("MIT" in $pol.licenses)
    assert equal $pol.registries ["https://registry.npmjs.org/"]
    assert equal ($pol.bans | describe | str starts-with "list") true
}

def main [] { run-tests }
