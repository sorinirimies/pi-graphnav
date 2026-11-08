#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# CodeGraph — Nightly dependency update helpers (used by deps-update.yml)
# ──────────────────────────────────────────────────────────────────────────────
#   nu scripts/ci/deps_update.nu snapshot before|after   installed versions → $RUNNER_TEMP
#   nu scripts/ci/deps_update.nu update                  bun update + bun install
#   nu scripts/ci/deps_update.nu changed                 outputs: changed, ships
#   nu scripts/ci/deps_update.nu commit <ships>          commit package.json + bun.lock
#   nu scripts/ci/deps_update.nu bump                    patch bump + changelog + tag; output: tag
#   nu scripts/ci/deps_update.nu push [<tag>]            push main (and the tag) — fails loudly
#   nu scripts/ci/deps_update.nu bot <name> <email>      git identity for the commits
#
# `changed` = a library really moved up and nothing down; `ships` = that library is a
# runtime dependency (dev tooling alone never publishes).
# ──────────────────────────────────────────────────────────────────────────────

use output.nu [write_output]

export const MANIFESTS = ["package.json" "bun.lock"]

# Where the snapshots live.
export def snapshot_dir [runner_temp: string]: nothing -> string {
    if ($runner_temp | is-empty) { $nu.temp-dir } else { $runner_temp }
}

# The snapshot file for a phase (before | after) and scope (all | prod).
export def snapshot_file [dir: string, phase: string, scope: string]: nothing -> string {
    $dir | path join $"($phase)-($scope).txt"
}

# The commit subject: a runtime dependency moved (released) or dev tooling only (not).
export def commit_message [ships: bool, date: string]: nothing -> string {
    if $ships {
        $"chore\(deps\): nightly update ($date)"
    } else {
        $"chore: nightly dev-tooling lockfile update ($date) \(not released\)"
    }
}

def today [] { date now | date to-timezone UTC | format date "%Y-%m-%d" }

def "main snapshot" [phase: string] {
    let dir = snapshot_dir ($env.RUNNER_TEMP? | default "")
    ^nu scripts/ci/snapshot_deps.nu (snapshot_file $dir $phase all)
    ^nu scripts/ci/snapshot_deps.nu (snapshot_file $dir $phase prod) --prod
}

def "main update" [] {
    ^bun update
    ^bun install
}

def "main changed" [] {
    let dir = snapshot_dir ($env.RUNNER_TEMP? | default "")
    main snapshot after
    if (do { ^git diff --quiet -- ...$MANIFESTS } | complete | get exit_code) == 0 {
        print "No dependency changes detected."
        write_output { changed: false, ships: false }
        return
    }
    let out = $env.GITHUB_OUTPUT? | default ""
    let all = [(snapshot_file $dir before all) (snapshot_file $dir after all)]
    let prod = [(snapshot_file $dir before prod) (snapshot_file $dir after prod)]
    ^nu scripts/ci/dep_changes.nu ...$all --key changed --output $out
    ^nu scripts/ci/dep_changes.nu ...$prod --key ships --output $out
}

def "main bot" [name: string, email: string] {
    ^git config user.name $name
    ^git config user.email $email
}

def "main commit" [ships: any] {
    ^git add ...$MANIFESTS
    ^git commit -m (commit_message (($ships | into string) == "true") (today))
}

def "main bump" [] {
    ^nu scripts/bump_version.nu patch --yes --skip-checks
    write_output { tag: $"v(open package.json | get version)" }
}

def "main push" [tag: string = ""] {
    ^git push origin HEAD:main
    if ($tag | is-not-empty) { ^git push origin $tag }
}

def main [] { print "usage: nu scripts/ci/deps_update.nu (snapshot <phase> | update | changed | bot | commit <ships> | bump | push [tag])" }
