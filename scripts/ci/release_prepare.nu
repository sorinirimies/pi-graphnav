#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# pi-graphnav — Which tag a Release run publishes (and cut it first when asked)
# ──────────────────────────────────────────────────────────────────────────────
#   push of a vX.Y.Z tag             → publish that tag
#   dispatch with tag=vX.Y.Z         → publish that existing tag again (idempotent)
#   dispatch with bump=patch|minor|major|X.Y.Z
#                                    → bump_version.nu: package.json + CHANGELOG, commit,
#                                      tag, then push main and the tag
#   dispatch with bump=current       → first release: tag the version already in
#                                      package.json (release_initial.nu), then push
#
# Reads EVENT, REF, TAG and BUMP from the environment (the workflow sets them) and
# writes `tag` and `cut` (true when this run created the tag) as step outputs.
# Runs after the quality gate, so the bump itself skips it.
#
# The tag pushed here uses GITHUB_TOKEN, which starts no other workflow: this run
# publishes it itself. Gitea's mirror.yml copies main and the tag and runs its own
# release from there.
# ──────────────────────────────────────────────────────────────────────────────

use output.nu [write_output]

# What to do: {mode: existing, tag} | {mode: initial} | {mode: bump, kind}.
export def plan [event: string, ref: string, tag: string, bump: string]: nothing -> record {
    if $event == "push" { return { mode: "existing", tag: $ref } }
    if ($tag | is-not-empty) { return { mode: "existing", tag: $tag } }
    if $ref != "main" { error make { msg: $"a bump releases main: run the workflow on main, not ($ref)" } }
    match $bump {
        "" => { error make { msg: "nothing to release: give a tag to re-run or a bump" } }
        "current" => { mode: "initial" }
        _ => { mode: "bump", kind: $bump }
    }
}

def cut [script: list<string>] {
    ^git config user.name "github-actions[bot]"
    ^git config user.email "github-actions[bot]@users.noreply.github.com"
    ^nu ...$script
    let tag = $"v(open package.json | get version)"
    # Fail loudly: nothing is published when main or the tag cannot be pushed.
    ^git push origin HEAD:main
    ^git push origin $tag
    write_output { tag: $tag, cut: true }
}

def main [] {
    let p = try {
        plan ($env.EVENT? | default "") ($env.REF? | default "") ($env.TAG? | default "") ($env.BUMP? | default "")
    } catch {|e|
        print --stderr $"(ansi red)❌ ($e.msg)(ansi reset)"
        exit 1
    }
    match $p.mode {
        "existing" => { write_output { tag: $p.tag, cut: false } }
        "initial" => { cut ["scripts/release_initial.nu"] }
        _ => { cut ["scripts/bump_version.nu" $p.kind "--yes" "--skip-checks"] }
    }
}
