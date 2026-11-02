#!/usr/bin/env nu
# ── pi-graphnav · test_workflows.nu ────────────────────────────────────
# GitHub and Gitea run the same CI: every workflow exists on both hosts (except GitHub's
# Dependabot helpers and Gitea's mirror, which keeps main and tags in step), the nightlies
# keep their schedules, the justfile can start each nightly on demand, and all scripting
# is Nushell.

use std/assert
use runner.nu *

def root [] { $env.CURRENT_FILE | path dirname | path join ".." ".." }

def workflows [host: string]: nothing -> list<string> {
    ls (root | path join $host "workflows") | get name | path basename | sort
}

def cron [host: string, file: string]: nothing -> list<string> {
    open (root | path join $host "workflows" $file) | get on | get -o schedule | default [] | get cron
}

# Nightly workflows and their UTC schedule on [GitHub, Gitea]. deps-update runs on GitHub
# only: Gitea's mirror.yml brings main and the tags over.
const NIGHTLIES = [[file github gitea];
    ["security.yml" "0 3 * * *" "30 3 * * *"]
    ["fuzz.yml" "0 4 * * *" "30 4 * * *"]]

def "test workflows: both hosts share ci, release, security and fuzz" [] {
    let shared = ["ci.yml" "fuzz.yml" "release.yml" "security.yml"]
    assert equal (workflows ".github" | where $it in $shared) $shared
    assert equal (workflows ".gitea" | where $it in $shared) $shared
}

def "test workflows: only the documented host-specific workflows exist" [] {
    let gh = ["auto-merge.yml" "deps-update.yml" "gitea-actions.yml"]
    let gitea = ["mirror.yml"]
    let shared = ["ci.yml" "fuzz.yml" "release.yml" "security.yml"]
    assert equal (workflows ".github") ($shared | append $gh | sort)
    assert equal (workflows ".gitea") ($shared | append $gitea | sort)
}

def "test workflows: the nightlies are scheduled" [] {
    for n in $NIGHTLIES {
        assert equal (cron ".github" $n.file) [$n.github] $"GitHub ($n.file)"
        assert equal (cron ".gitea" $n.file) [$n.gitea] $"Gitea ($n.file)"
    }
    assert equal (cron ".github" "deps-update.yml") ["0 2 * * *"]
}

def "test workflows: dependabot watches the github actions" [] {
    let d = open (root | path join ".github" "dependabot.yml")
    assert equal ($d.updates | get package-ecosystem) ["github-actions"]
}

def "test workflows: every nightly can be started from the justfile" [] {
    let just = (open --raw (root | path join "justfile"))
    for r in ["deps-update-now:" "security-now:" "fuzz-now:" "gh-run workflow" "gitea-run workflow"] {
        assert ($just | str contains $r) $"justfile has ($r)"
    }
}

def "test workflows: deps updates run the full gate before pushing" [] {
    let raw = (open --raw (root | path join ".github" "workflows" "deps-update.yml"))
    assert ($raw | str contains "nu scripts/ci/quality_gate.nu") "runs the gate"
    assert ($raw | str contains "nu scripts/ci/deps_update.nu update") "updates via deps_update.nu"
    assert ($raw | str contains "cancel-in-progress: false") "never cancels mid-push"
}

def "test workflows: a release can be cut from CI" [] {
    let wf = open (root | path join ".github" "workflows" "release.yml")
    assert equal ($wf.on.workflow_dispatch.inputs.bump.options) ["patch" "minor" "major" "current"]
    let runs = $wf.jobs.release.steps | get -o run | compact
    let at = {|cmd| $runs | enumerate | where {|r| $r.item | str contains $cmd } | get 0.index }
    assert ((do $at "quality_gate.nu") < (do $at "release_prepare.nu")) "the gate runs before the bump"
    assert ((do $at "release_prepare.nu") < (do $at "npm_publish.nu")) "the tag exists before publishing"
    assert (open --raw (root | path join "justfile") | str contains "release-ci bump=")
}

def "test workflows: the fuzz workflow runs the fuzz script" [] {
    for host in [".github" ".gitea"] {
        let raw = (open --raw (root | path join $host "workflows" "fuzz.yml"))
        assert ($raw | str contains "nu scripts/ci/fuzz.nu") $"($host) fuzzes via fuzz.nu"
    }
}

def "test workflows: every action is pinned to a commit sha" [] {
    for host in [".github" ".gitea"] {
        for f in (workflows $host) {
            let uses = open --raw (root | path join $host "workflows" $f) | lines
                | where {|l| $l =~ '^\s*(-\s+)?uses:' } | each {|l| $l | str replace --regex '^\s*(-\s+)?uses:\s*' '' }
            for u in $uses {
                assert ($u =~ '@[0-9a-f]{40}\b') $"($host)/($f): '($u)' is not pinned to a sha"
            }
        }
    }
}

# A run step longer than one line is shell logic. Allowed only to install tools
# (before nu exists); everything else is a nu script.
def "test workflows: run steps call nushell scripts" [] {
    for host in [".github" ".gitea"] {
        for f in (workflows $host) {
            let wf = open (root | path join $host "workflows" $f)
            for job in ($wf.jobs | values) {
                for s in ($job.steps? | default [] | where {|s| ($s.run? | default "" | str trim | lines | length) > 1 }) {
                    let name = $s.name? | default ""
                    assert ($name | str starts-with "Install") $"($host)/($f): '($name)' is shell logic, move it to scripts/*.nu"
                }
            }
        }
    }
}

def "test workflows: no shell or python scripts" [] {
    let found = glob ((root) | path join "**" "*.{sh,bash,zsh,py}") --exclude [**/node_modules/** **/.git/**]
    assert equal $found [] "scripting is Nushell only"
}

def "test workflows: justfile recipes run in nushell" [] {
    let just = open --raw (root | path join "justfile")
    assert ($just | str contains 'set shell := ["nu", "-c"]')
    assert not ($just =~ '#!/usr/bin/env (sh|bash)') "no sh/bash shebang recipes"
}

def "test workflows: package.json declares every extension that exists" [] {
    let pkg = open (root | path join "package.json")
    for e in $pkg.pi.extensions {
        assert ((root | path join $e) | path exists) $"($e) exists"
    }
}

def main [] { run-tests }
