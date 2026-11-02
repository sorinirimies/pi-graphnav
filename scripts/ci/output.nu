#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# CodeGraph — Step outputs for workflows
# ──────────────────────────────────────────────────────────────────────────────
# Scripts hand values to later steps as `key=value` lines appended to $GITHUB_OUTPUT
# (GitHub and Gitea both set it). Without it the lines are printed, for local runs.
#
#   use output.nu [write_output]
#   write_output { changed: true, tag: "v1.2.3" }
# ──────────────────────────────────────────────────────────────────────────────

# `key=value` lines, one per record field, newline-terminated.
export def lines_of [pairs: record]: nothing -> string {
    $pairs | transpose k v | each {|r| $"($r.k)=($r.v)" } | str join "\n" | $"($in)\n"
}

# Append the pairs to $GITHUB_OUTPUT (or --file); print them when neither is set.
export def write_output [pairs: record, --file: string] {
    let target = $file | default ($env.GITHUB_OUTPUT? | default "")
    if ($target | is-empty) {
        print (lines_of $pairs | str trim --right)
    } else {
        lines_of $pairs | save --append --raw $target
    }
}

def main [] { print "library: use output.nu [write_output]" }
