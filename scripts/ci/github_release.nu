#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# CodeGraph — Create or update the GitHub release for a tag
# ──────────────────────────────────────────────────────────────────────────────
# Idempotent: an existing release only gets its notes refreshed.
# Usage (.github/workflows/release.yml, env GH_TOKEN):
#   nu scripts/ci/github_release.nu v0.2.0
# ──────────────────────────────────────────────────────────────────────────────

use release_notes.nu [notes_for]

# `create` for a new release, `edit` when one exists.
export def action [exists: bool]: nothing -> string {
    if $exists { "edit" } else { "create" }
}

# The gh arguments for a release.
export def gh_args [action: string, tag: string, notes_file: string]: nothing -> list<string> {
    match $action {
        "edit" => [release edit $tag --notes-file $notes_file]
        _ => [release create $tag --title $tag --notes-file $notes_file]
    }
}

def main [tag: string] {
    let notes = $nu.temp-dir | path join $"notes-($tag).md"
    notes_for $tag | save --force $notes
    let exists = (do { ^gh release view $tag } | complete | get exit_code) == 0
    ^gh ...(gh_args (action $exists) $tag $notes)
    print $"(ansi green)✅ GitHub release ($tag)(ansi reset)"
}
