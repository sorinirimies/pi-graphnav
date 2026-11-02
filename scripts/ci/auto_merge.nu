#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# CodeGraph — Auto-merge a Dependabot PR after CI (auto-merge.yml)
# ──────────────────────────────────────────────────────────────────────────────
#   nu scripts/ci/auto_merge.nu find <repo> <branch> <sha>   output: number (empty = skip)
#   nu scripts/ci/auto_merge.nu classify <repo> <number>     outputs: automerge, type
#   nu scripts/ci/auto_merge.nu merge <repo> <number>        squash + delete branch; output: merged
# Env: GH_TOKEN.
# ──────────────────────────────────────────────────────────────────────────────

use output.nu [write_output]

# The PR number to act on: only when CI ran for the commit that is on the PR now.
export def pick [number: string, current_sha: string, ci_sha: string]: nothing -> string {
    if ($number | is-empty) or $current_sha != $ci_sha { "" } else { $number }
}

def gh_json [args: list<string>]: nothing -> any {
    ^gh ...$args | from json
}

def "main find" [repo: string, branch: string, sha: string] {
    let prs = gh_json [pr list --repo $repo --head $branch --state open --json number]
    let number = if ($prs | is-empty) { "" } else { $prs.0.number | into string }
    if ($number | is-empty) { print $"No open PR for ($branch) (already merged or closed)." }
    let current = if ($number | is-empty) { "" } else { (gh_json [pr view $number --repo $repo --json headRefOid]).headRefOid }
    let picked = pick $number $current $sha
    if ($number | is-not-empty) and ($picked | is-empty) { print $"PR head moved on; a newer CI run will decide." }
    write_output { number: $picked }
}

def "main classify" [repo: string, number: string] {
    let pr = gh_json [pr view $number --repo $repo --json "title,commits"]
    print $"PR #($number): ($pr.title)"
    let messages = $pr.commits | get messageBody | str join "\n"
    ^nu scripts/ci/update_type.nu --title $pr.title --messages $messages --output ($env.GITHUB_OUTPUT? | default "")
}

# GITHUB_TOKEN cannot merge a PR that changes .github/workflows/*: pass GH_PAT as GH_TOKEN.
def "main merge" [repo: string, number: string] {
    try { ^gh pr merge $number --repo $repo --squash --delete-branch } catch {
        print -e "::error::Merge failed. Workflow-file PRs need a GH_PAT secret (repo + workflow scopes)."
        exit 1
    }
    write_output { merged: true }
}

def main [] { print "usage: nu scripts/ci/auto_merge.nu (find | classify | merge)" }
