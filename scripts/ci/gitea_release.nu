#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# CodeGraph — Create the Gitea release for a tag
# ──────────────────────────────────────────────────────────────────────────────
# Idempotent: when the release exists nothing happens.
# Usage (.gitea/workflows/release.yml):
#   nu scripts/ci/gitea_release.nu v0.2.0 --api <server>/api/v1/repos/<owner>/<repo>
# Env: GITEA_TOKEN (the workflow passes a token with repo scope).
# ──────────────────────────────────────────────────────────────────────────────

use release_notes.nu [notes_for]

export def release_payload [tag: string, notes: string]: nothing -> record {
    { tag_name: $tag, name: $tag, body: $notes }
}

def main [tag: string, --api: string] {
    let headers = { Authorization: $"token ($env.GITEA_TOKEN? | default '')" }
    let existing = try { http get --headers $headers $"($api)/releases/tags/($tag)" | get id } catch { null }
    if $existing != null {
        print $"(ansi yellow)⚠(ansi reset) release ($tag) already exists — nothing to do."
        return
    }
    http post --content-type application/json --headers $headers $"($api)/releases" (release_payload $tag (notes_for $tag)) | ignore
    print $"(ansi green)✅ Gitea release ($tag)(ansi reset)"
}
