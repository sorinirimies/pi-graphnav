#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# CodeGraph — Release notes for a tag
# ──────────────────────────────────────────────────────────────────────────────
# This release's section of the changelog (git-cliff --latest; the release workflow
# runs at the tag, so --unreleased would be empty), or a one-liner when git-cliff
# is missing or has nothing.
#
# Usage:
#   nu scripts/ci/release_notes.nu v0.2.0      writes notes.md
# Library: use release_notes.nu [notes_for]
# ──────────────────────────────────────────────────────────────────────────────

# The notes text: the changelog section, or a fallback line.
export def fallback [tag: string, changes: string]: nothing -> string {
    if ($changes | str trim | is-empty) { $"Release ($tag)" } else { $changes | str trim }
}

# Run git-cliff for the latest release; empty when it is missing or fails.
export def changelog []: nothing -> string {
    if (which git-cliff | is-empty) { return "" }
    let r = do { ^git-cliff --latest --strip header } | complete
    if $r.exit_code == 0 { $r.stdout } else { "" }
}

export def notes_for [tag: string]: nothing -> string {
    fallback $tag (changelog)
}

def main [tag: string, --out: path = "notes.md"] {
    notes_for $tag | save --force $out
    print -e $"(ansi green)✅ ($out) for ($tag)(ansi reset)"
}
