#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# CodeGraph — Keep Gitea's main and tags in step with GitHub (mirror.yml)
# ──────────────────────────────────────────────────────────────────────────────
# GitHub is the source of truth: Dependabot, auto-merge and the nightly commit there,
# and GitHub's runners cannot reach this LAN host, so Gitea pulls.
#
#   nu scripts/ci/mirror.nu fetch              add the github remote, fetch main + tags
#   nu scripts/ci/mirror.nu sync               fast-forward main, push new tags; output: tags
#   nu scripts/ci/mirror.nu dispatch <tags>    start release.yml for each tag (space separated)
#
# Equal or Gitea ahead: nothing. Diverged: FAIL (someone committed to one host only).
# ──────────────────────────────────────────────────────────────────────────────

use output.nu [write_output]

export const GITHUB_OWNER = "sorinirimies"

# What to do given how the two main branches relate.
export def plan [github_is_ancestor: bool, gitea_is_ancestor: bool]: nothing -> string {
    if $github_is_ancestor { "up-to-date" } else if $gitea_is_ancestor { "fast-forward" } else { "diverged" }
}

# Tags reachable from GitHub's main that this host lacks, sorted.
export def new_tags [github_tags: list<string>, here: list<string>]: nothing -> list<string> {
    $github_tags | where {|t| $t not-in $here } | uniq | sort
}

export def github_url [repo: string]: nothing -> string {
    $"https://github.com/($GITHUB_OWNER)/($repo | split row '/' | last).git"
}

export def dispatch_url [server: string, repo: string]: nothing -> string {
    $"($server)/api/v1/repos/($repo)/actions/workflows/release.yml/dispatches"
}

def is_ancestor [a: string, b: string]: nothing -> bool {
    (do { ^git merge-base --is-ancestor $a $b } | complete | get exit_code) == 0
}

def "main fetch" [] {
    ^git fetch --tags --force origin main
    if "github" not-in (^git remote | lines) { ^git remote add github (github_url $env.GITHUB_REPOSITORY) }
    ^git fetch --no-tags github main
    ^git fetch github '+refs/tags/*:refs/tags/*'
    print $"gitea:  (^git log -1 --oneline origin/main)"
    print $"github: (^git log -1 --oneline github/main)"
}

def "main sync" [] {
    let g = ^git rev-parse github/main | str trim
    let l = ^git rev-parse origin/main | str trim
    match (plan (is_ancestor $g $l) (is_ancestor $l $g)) {
        "up-to-date" => { print "✅ main is up to date with GitHub." }
        "fast-forward" => {
            ^git push origin $"($g):refs/heads/main"
            print $"⏩ main fast-forwarded to (^git log -1 --oneline $g)"
        }
        _ => {
            print -e $"::error::Gitea and GitHub main have diverged. Merge them locally and push to both."
            exit 1
        }
    }
    let here = ^git ls-remote --tags origin | lines | parse --regex 'refs/tags/(?<t>[^^]+)$' | get t
    let tags = new_tags (^git tag --merged $g | lines) $here
    for t in $tags { ^git push origin $"refs/tags/($t)" }
    write_output { tags: ($tags | str join " ") }
    if ($tags | is-not-empty) { print $"🏷  pushed tags: ($tags | str join ' ')" }
}

# Tag pushes made with the built-in token don't always start workflows on Gitea,
# so start the release explicitly (its concurrency group makes a duplicate harmless).
def "main dispatch" [tags: string] {
    let token = $env.GITEA_TOKEN? | default ($env.GITHUB_TOKEN? | default "")
    let url = dispatch_url $env.GITHUB_SERVER_URL $env.GITHUB_REPOSITORY
    for tag in ($tags | split row " " | where {|t| $t | is-not-empty }) {
        print $"🚀 Dispatching release.yml for ($tag)…"
        try {
            http post --content-type application/json --headers { Authorization: $"token ($token)" } $url { ref: "main", inputs: { tag: $tag } } | ignore
        } catch { print "⚠️  Dispatch failed — the tag push may already have started the release." }
    }
}

def main [] { print "usage: nu scripts/ci/mirror.nu (fetch | sync | dispatch <tags>)" }
