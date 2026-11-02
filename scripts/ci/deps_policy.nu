#!/usr/bin/env nu
# Dependency policy (what cargo-deny does for Rust): every package in bun.lock comes
# from an allowed registry, is not banned, and uses an allowed license. Policy lives
# in deps-policy.nuon. Needs `bun install` first (licenses are read from node_modules).
#
# Usage: nu scripts/ci/deps_policy.nu [--policy deps-policy.nuon] [--lock bun.lock]
# Prints packages=<n> and problems=<n>; exit 1 on any problem.

# The packages of a bun.lock: key (install path), name, version spec, registry, and
# whether it is platform-specific (os/cpu set: only installed on that platform).
export def lock_packages [text: string]: nothing -> table {
    let pkgs = $text | from json | get -o packages | default {}
    $pkgs | transpose key v | each {|r|
        let spec = $r.v.0
        let at = $spec | str index-of --end "@"
        let name = if $at > 0 { $spec | str substring ..<$at } else { $spec }
        let version = if $at > 0 { $spec | str substring ($at + 1).. } else { "" }
        let meta = $r.v.2? | default {}
        let platform = ($meta | describe | str starts-with record) and (($meta.os? != null) or ($meta.cpu? != null))
        { key: $r.key, name: $name, version: $version, registry: ($r.v.1? | default ""), platform: $platform }
    }
}

const NON_REGISTRY = ["git+" "git:" "github:" "gitlab:" "bitbucket:" "http:" "https:" "file:" "link:" "workspace:" "portal:"]

# Problems with where packages come from (git, URLs, local paths, other registries).
export def source_problems [pkgs: table, registries: list<string>]: nothing -> list<string> {
    $pkgs | each {|p|
        if ($NON_REGISTRY | any {|pre| $p.version | str starts-with $pre }) {
            $"($p.name): not from a registry \(($p.version)\)"
        } else if ($p.registry | is-not-empty) and ($p.registry not-in $registries) {
            $"($p.name): registry ($p.registry) is not allowed"
        }
    } | compact
}

export def ban_problems [pkgs: table, bans: list<string>]: nothing -> list<string> {
    $pkgs | where name in $bans | each {|p| $"($p.name): banned" } | uniq
}

# node_modules path of a bun.lock key: "a/b" is b nested in a, "@s/n" is one scoped name.
export def module_path [key: string]: nothing -> string {
    let parts = $key | split row "/"
    mut names = []
    mut i = 0
    while $i < ($parts | length) {
        let part = $parts | get $i
        if ($part | str starts-with "@") and ($i + 1) < ($parts | length) {
            $names = ($names | append $"($part)/($parts | get ($i + 1))")
            $i = $i + 2
        } else {
            $names = ($names | append $part)
            $i = $i + 1
        }
    }
    $names | each {|n| $"node_modules/($n)" } | str join "/"
}

# The SPDX expression of a package.json ("" when it declares none).
export def license_of [pkg: record]: nothing -> string {
    let l = $pkg.license? | default ($pkg.licenses? | default null)
    match ($l | describe | str replace --regex '<.*' "") {
        "string" => $l
        "record" => ($l.type? | default "")
        "list" | "table" => ($l | each {|x| if ($x | describe) == "string" { $x } else { $x.type? | default "" } } | str join " OR ")
        _ => ""
    }
}

# An SPDX expression is allowed when one OR alternative has only allowed AND parts.
export def license_allowed [expr: string, allowed: list<string>]: nothing -> bool {
    let e = $expr | str replace --all --regex '[()]' "" | str trim
    if ($e | is-empty) { return false }
    $e | split row --regex '\s+OR\s+' | any {|alt|
        $alt | split row --regex '\s+AND\s+' | all {|id| ($id | str trim | str replace --regex '\s+WITH\s+.*$' "") in $allowed }
    }
}

export def license_problems [pkgs: table, read: closure, allowed: list<string>, exceptions: record]: nothing -> list<string> {
    $pkgs | where {|p| $p.name not-in ($exceptions | columns) } | each {|p|
        let manifest = do $read (module_path $p.key)
        if $manifest == null {
            # Another platform's binary is not installed here; its own runner checks it.
            if ($p.platform? | default false) { return null }
            return $"($p.name): not installed \(run bun install\)"
        }
        let lic = license_of $manifest
        if not (license_allowed $lic $allowed) {
            let shown = if ($lic | is-empty) { "none declared" } else { $lic }
            $"($p.name)@($p.version): license ($shown) is not allowed"
        }
    } | compact | uniq
}

def main [--policy: path = "deps-policy.nuon", --lock: path = "bun.lock"] {
    let pol = open $policy
    let pkgs = lock_packages (open --raw $lock | decode utf-8)
    let read = {|dir| let f = $dir | path join package.json; if ($f | path exists) { open $f } else { null } }
    let problems = (source_problems $pkgs $pol.registries)
        | append (ban_problems $pkgs $pol.bans)
        | append (license_problems $pkgs $read $pol.licenses ($pol.exceptions? | default {}))
    for p in $problems { print -e $"(ansi red)✗(ansi reset) ($p)" }
    print $"packages=($pkgs | length)"
    print $"problems=($problems | length)"
    if ($problems | is-not-empty) { exit 1 }
}
