#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# Keep the actions used by .gitea/workflows up to date (Gitea has no Dependabot)
# ──────────────────────────────────────────────────────────────────────────────
# Every `uses: owner/repo@<40-hex sha> # vN[.x[.y]]` pin is moved to the commit of the
# newest release tag of the SAME major (read with `git ls-remote`, no API token, no rate
# limit). The sha changes, the `# vN` comment stays (a full `# vN.x.y` comment is updated).
#
# Never touched automatically:
#   * a new MAJOR: reported only (act_runner may lack the node runtime a new major needs),
#   * actions/checkout and actions/*-artifact: pinned on purpose for act_runner,
#   * pins without a version comment or not on a 40-hex sha.
#
# Usage:
#   nu scripts/ci/gitea_actions.nu [--dir .gitea/workflows] [--output "$GITHUB_OUTPUT"] [--dry-run]
# Writes `changed=true|false` and a one-line `summary=...`.
# ──────────────────────────────────────────────────────────────────────────────

export const SKIP = ["actions/checkout" "actions/upload-artifact" "actions/download-artifact"]

# `uses: owner/repo@<sha> # v3` lines → [{repo, sha, version}].
export def parse_pins [text: string]: nothing -> list {
    $text
    | parse --regex 'uses:\s*(?<repo>[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)@(?<sha>[0-9a-f]{40})\s+#\s*(?<version>v\d+(?:\.\d+)*)'
}

# "v3" / "v3.29" / "v3.29.1" → [3 29 1] (missing parts are 0); null when it is not a plain version tag.
export def version_parts [tag: string]: nothing -> any {
    if not ($tag =~ '^v\d+(\.\d+){0,2}$') { return null }
    $tag | str substring 1.. | split row "." | each {|p| $p | into int } | append [0 0 0] | first 3
}

# `git ls-remote --tags` output → [{tag, sha}] with annotated tags peeled to their commit.
export def tags_from_ls_remote [text: string]: nothing -> list {
    let rows = ($text | lines | parse --regex '^(?<sha>[0-9a-f]{40})\s+refs/tags/(?<ref>\S+)$')
    let peeled = ($rows | where {|r| $r.ref | str ends-with "^{}" } | each {|r| { tag: ($r.ref | str replace "^{}" ""), sha: $r.sha } })
    let plain = ($rows | where {|r| not ($r.ref | str ends-with "^{}") } | each {|r| { tag: $r.ref, sha: $r.sha } })
    $plain | each {|r|
        let p = ($peeled | where tag == $r.tag)
        if ($p | is-empty) { $r } else { $p.0 }
    }
}

# The newest plain release tag; with `major`, only within that major. null when none.
export def newest_tag [tags: list, major?: int]: nothing -> any {
    let candidates = (
        $tags
        | each {|t| { tag: $t.tag, sha: $t.sha, parts: (version_parts $t.tag) } }
        | where parts != null
        | where {|t| $major == null or $t.parts.0 == $major }
    )
    if ($candidates | is-empty) { return null }
    $candidates | sort-by {|t| $t.parts.0 * 1000000 + $t.parts.1 * 1000 + $t.parts.2 } | last | reject parts
}

# Move one pin to a new sha. A bare `# vN` comment stays; a fuller one becomes the new tag.
export def rewrite [text: string, repo: string, old_sha: string, version: string, new_sha: string, new_tag: string]: nothing -> string {
    let comment = (if ($version =~ '^v\d+$') { $version } else { $new_tag })
    $text | str replace --all --regex $"($repo | str replace --all '.' '\.')@($old_sha)\\s+#\\s*($version | str replace --all '.' '\.')\\b" $"($repo)@($new_sha) # ($comment)"
}

# One planned change per distinct pin: {repo, from, to, version, tag} or {repo, major_available}.
export def plan [pins: list, tags_of: closure]: nothing -> list {
    $pins
    | where {|p| $p.repo not-in $SKIP }
    | uniq-by repo sha version
    | each {|p|
        let tags = (do $tags_of $p.repo)
        let major = ((version_parts $p.version).0)
        let same = (newest_tag $tags $major)
        let any = (newest_tag $tags)
        let newer_major = (if $any != null and ((version_parts $any.tag).0) > $major { $any.tag } else { null })
        if $same != null and $same.sha != $p.sha {
            { repo: $p.repo, from: $p.sha, to: $same.sha, version: $p.version, tag: $same.tag, major_available: $newer_major }
        } else if $newer_major != null {
            { repo: $p.repo, from: null, to: null, version: $p.version, tag: null, major_available: $newer_major }
        } else { null }
    }
    | compact
}

def main [--dir: string = ".gitea/workflows", --output: string = "", --dry-run] {
    let files = (ls $dir | where name =~ '\.ya?ml$' | get name)
    let pins = ($files | each {|f| parse_pins (open --raw $f) } | flatten)
    let tags_of = {|repo|
        let r = (do { ^git ls-remote --tags $"https://github.com/($repo).git" } | complete)
        if $r.exit_code != 0 { print $"⚠️  ($repo): cannot list tags, skipped"; [] } else { tags_from_ls_remote $r.stdout }
    }
    let changes = (plan $pins $tags_of)

    for c in ($changes | where major_available != null) {
        print $"::notice::($c.repo) ($c.major_available) is out \(pinned ($c.version)\): a new major is not applied automatically."
    }
    let bumps = ($changes | where to != null)
    for b in $bumps {
        print $"($b.repo) ($b.version): ($b.from | str substring 0..6) → ($b.to | str substring 0..6) \(($b.tag)\)"
        if not $dry_run {
            for f in $files {
                let before = (open --raw $f)
                let after = (rewrite $before $b.repo $b.from $b.version $b.to $b.tag)
                if $after != $before { $after | save --force --raw $f }
            }
        }
    }
    if ($bumps | is-empty) { print "✅ All Gitea workflow actions are up to date within their major." }

    let summary = ($bumps | each {|b| $"($b.repo) → ($b.tag)" } | str join ", ")
    if $output != "" { $"changed=(($bumps | is-not-empty) and not $dry_run)\nsummary=($summary)\n" | save --append $output }
}
