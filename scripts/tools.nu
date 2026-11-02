#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# CodeGraph — Development tools: check or install
# ──────────────────────────────────────────────────────────────────────────────
# Usage:
#   nu scripts/tools.nu check <tool>     fail with an install hint if missing
#   nu scripts/tools.nu install          install what is missing (cargo/brew) and bun deps
# ──────────────────────────────────────────────────────────────────────────────

# command → how to install it
export const TOOLS = {
    bun: "https://bun.sh"
    nu: "cargo install nu --locked"
    just: "cargo install just --locked"
    git-cliff: "cargo install git-cliff --locked"
}

export def missing [installed: list<string>]: nothing -> list<string> {
    $TOOLS | columns | where {|t| $t not-in $installed }
}

def installed []: nothing -> list<string> { $TOOLS | columns | where {|t| which $t | is-not-empty } }

def "main check" [tool: string] {
    if (which $tool | is-empty) {
        print $"❌ ($tool) not found. Install: ($TOOLS | get -o $tool | default 'see its docs')"
        exit 1
    }
}

def "main install" [] {
    for t in (missing (installed)) {
        print $"⚠️  ($t) is missing. Install: ($TOOLS | get $t)"
    }
    ^bun install
}

def main [] { print "usage: nu scripts/tools.nu (check <tool> | install)" }
