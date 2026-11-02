#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# Publish the package to npm — idempotent
# ──────────────────────────────────────────────────────────────────────────────
# GitHub and Gitea both run releases independently, and a tag can be re-run, so
# publishing must be safe to repeat: if this exact version is already on the
# registry the script exits 0 without publishing. Both hosts can still check at
# the same moment and both publish: the loser gets a 409 ("cannot publish over
# previously staged version"). That is success too, once the version shows up.
#
# Usage:
#   nu scripts/ci/npm_publish.nu [--provenance] [--dry-run]
#
# Auth: NODE_AUTH_TOKEN / NPM_TOKEN must be a granular token with "bypass 2FA".
# --provenance needs a GitHub Actions runner with `id-token: write`.
# ──────────────────────────────────────────────────────────────────────────────

export def published [name: string, version: string]: nothing -> bool {
    let res = (do { ^npm view $"($name)@($version)" version --prefer-online } | complete)
    ($res.exit_code == 0) and (($res.stdout | str trim) == $version)
}

# Arguments for `npm publish`.
export def publish_args [provenance: bool, dry_run: bool]: nothing -> list {
    mut args = ["publish" "--access" "public"]
    if $provenance { $args = ($args | append "--provenance") }
    if $dry_run { $args = ($args | append "--dry-run") }
    $args
}

# True when `npm publish` failed only because this version is (being) published already.
export def lost_race [output: string]: nothing -> bool {
    $output =~ '(?i)E409|EPUBLISHCONFLICT|cannot publish over (the )?previously (staged|published) version'
}

# Wait for another publisher's upload of name@version to become visible.
def wait_published [name: string, version: string, tries: int = 12]: nothing -> bool {
    for _ in 1..$tries {
        if (published $name $version) { return true }
        sleep 10sec
    }
    false
}

# True when an npm auth token is configured (NODE_AUTH_TOKEN or NPM_TOKEN).
export def has_token [env_vars: record]: nothing -> bool {
    let t = ($env_vars | get -o NODE_AUTH_TOKEN | default ($env_vars | get -o NPM_TOKEN | default ""))
    ($t | is-not-empty)
}

def main [--provenance, --dry-run] {
    let pkg = (open package.json)
    print $"Package: ($pkg.name)@($pkg.version)"

    if (published $pkg.name $pkg.version) {
        print $"(ansi yellow)⚠(ansi reset) ($pkg.name)@($pkg.version) is already on npm — nothing to publish."
        return
    }

    if not $dry_run and not (has_token $env) {
        error make --unspanned { msg: "No npm token: set the NPM_TOKEN secret (granular token with 'bypass 2FA')." }
    }

    let args = (publish_args $provenance $dry_run)
    let res = (do { run-external "npm" ...$args } | complete)
    print $res.stdout
    print --stderr $res.stderr
    if $res.exit_code != 0 {
        if (lost_race $"($res.stdout)\n($res.stderr)") and (wait_published $pkg.name $pkg.version) {
            print $"(ansi yellow)⚠(ansi reset) ($pkg.name)@($pkg.version) was published by the other host's release — nothing to do."
            return
        }
        error make --unspanned { msg: $"npm publish failed \(exit ($res.exit_code)\)" }
    }
    let verb = if $dry_run { "Dry run OK for" } else { "Published" }
    print $"(ansi green)✓(ansi reset) ($verb) ($pkg.name)@($pkg.version)."
}
