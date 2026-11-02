#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# CodeGraph — Commit some paths as the bot and push to main
# ──────────────────────────────────────────────────────────────────────────────
# Usage: nu scripts/ci/commit_push.nu <message> <path>… [--body <text>] [--bot <name>] [--email <mail>]
# Rebases onto main first, so a commit that landed meanwhile does not fail the push.
# ──────────────────────────────────────────────────────────────────────────────

# The `git commit` arguments, with an optional body paragraph.
export def commit_args [message: string, body: string]: nothing -> list<string> {
    [commit -m $message] | append (if ($body | is-empty) { [] } else { [-m $body] })
}

def main [
    message: string
    ...paths: string
    --body: string = ""
    --bot: string = "github-actions[bot]"
    --email: string = "github-actions[bot]@users.noreply.github.com"
] {
    ^git config user.name $bot
    ^git config user.email $email
    ^git add ...$paths
    ^git ...(commit_args $message $body)
    ^git pull --rebase origin main
    ^git push origin HEAD:main
}
