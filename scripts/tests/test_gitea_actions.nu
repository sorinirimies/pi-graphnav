#!/usr/bin/env nu
# Tests for scripts/ci/gitea_actions.nu

use std/assert
use runner.nu *
use ../ci/gitea_actions.nu [parse_pins, version_parts, tags_from_ls_remote, newest_tag, rewrite, plan]

const A = "1111111111111111111111111111111111111111"
const B = "2222222222222222222222222222222222222222"
const C = "3333333333333333333333333333333333333333"
const D = "4444444444444444444444444444444444444444"

def "test gitea_actions: parses sha pins with a version comment only" [] {
    let text = $"
      - uses: hustcer/setup-nu@($A) # v3
      - uses: oven-sh/setup-bun@($B) #v2.1
      - uses: actions/checkout@v4
      - uses: some/thing@($C)
"
    let pins = (parse_pins $text)
    assert equal ($pins | get repo) ["hustcer/setup-nu" "oven-sh/setup-bun"]
    assert equal ($pins | get version) ["v3" "v2.1"]
}

def "test gitea_actions: version parts" [] {
    assert equal (version_parts "v3") [3 0 0]
    assert equal (version_parts "v3.29") [3 29 0]
    assert equal (version_parts "v2.87.31") [2 87 31]
    assert equal (version_parts "v3-beta") null
    assert equal (version_parts "latest") null
}

def "test gitea_actions: annotated tags are peeled to their commit" [] {
    let out = $"($A)\trefs/tags/v3.28\n($B)\trefs/tags/v3.29\n($C)\trefs/tags/v3.29^{}\n"
    let tags = (tags_from_ls_remote $out)
    assert equal $tags [{ tag: "v3.28", sha: $A } { tag: "v3.29", sha: $C }]
}

def "test gitea_actions: newest tag is numeric, within the major, ignores pre-releases" [] {
    let tags = [
        { tag: "v3.9", sha: $A } { tag: "v3.29", sha: $B } { tag: "v4.0.0", sha: $C } { tag: "v3.30-rc1", sha: $D } { tag: "v3", sha: $D }
    ]
    assert equal (newest_tag $tags 3) { tag: "v3.29", sha: $B }
    assert equal (newest_tag $tags) { tag: "v4.0.0", sha: $C }
    assert equal (newest_tag $tags 9) null
    assert equal (newest_tag [] 3) null
}

def "test gitea_actions: rewrite keeps a bare major comment, updates a full one" [] {
    let text = $"a: x/y@($A) # v3\nb: x/y@($A) # v3\nc: x/z@($A) # v3\n"
    let out = (rewrite $text "x/y" $A "v3" $B "v3.29")
    assert equal $out $"a: x/y@($B) # v3\nb: x/y@($B) # v3\nc: x/z@($A) # v3\n"
    let full = (rewrite $"x/y@($A) # v3.28.0" "x/y" $A "v3.28.0" $B "v3.29.0")
    assert equal $full $"x/y@($B) # v3.29.0"
}

def "test gitea_actions: plan bumps within the major, reports majors, skips pinned actions" [] {
    let pins = [
        { repo: "hustcer/setup-nu", sha: $A, version: "v3" }
        { repo: "hustcer/setup-nu", sha: $A, version: "v3" }
        { repo: "oven-sh/setup-bun", sha: $C, version: "v2" }
        { repo: "actions/setup-node", sha: $A, version: "v4" }
        { repo: "actions/checkout", sha: $A, version: "v4" }
    ]
    let tags_of = {|repo|
        match $repo {
            "hustcer/setup-nu" => [{ tag: "v3.29", sha: $B }]
            "oven-sh/setup-bun" => [{ tag: "v2.1", sha: $C }]
            "actions/setup-node" => [{ tag: "v4.4.0", sha: $A } { tag: "v7.1.0", sha: $D }]
            _ => (error make { msg: $"must not be queried: ($repo)" })
        }
    }
    let p = (plan $pins $tags_of)
    assert equal ($p | length) 2
    assert equal ($p.0 | select repo from to tag) { repo: "hustcer/setup-nu", from: $A, to: $B, tag: "v3.29" }
    assert equal $p.0.major_available null
    assert equal ($p.1 | select repo to major_available) { repo: "actions/setup-node", to: null, major_available: "v7.1.0" }
}

def main [] { run-tests }
