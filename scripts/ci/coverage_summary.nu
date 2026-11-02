#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# Coverage summary — lcov.info → a markdown table
# ──────────────────────────────────────────────────────────────────────────────
# `bun test` writes coverage/lcov.info (see bunfig.toml; thresholds are enforced there).
# This prints a readable table and, with --output, appends it to a file such as
# $GITHUB_STEP_SUMMARY so the numbers show on the workflow run page.
#
# Usage:
#   nu scripts/ci/coverage_summary.nu [lcov.info] [--output "$GITHUB_STEP_SUMMARY"]
# ──────────────────────────────────────────────────────────────────────────────

# lcov text → [{file, lines_found, lines_hit, funcs_found, funcs_hit}]
export def parse_lcov [text: string]: nothing -> list {
    $text
    | split row "end_of_record"
    | each {|rec| $rec | lines | each {|l| $l | str trim } | where {|l| $l != "" } }
    | where {|ls| $ls | any {|l| $l | str starts-with "SF:" } }
    | each {|ls|
        let num = {|key|
            let hit = ($ls | where {|l| $l | str starts-with $"($key):" } | first | default "")
            if ($hit | is-empty) { 0 } else { $hit | split row ":" | last | into int }
        }
        {
            file: ($ls | where {|l| $l | str starts-with "SF:" } | first | str substring 3..)
            lines_found: (do $num "LF")
            lines_hit: (do $num "LH")
            funcs_found: (do $num "FNF")
            funcs_hit: (do $num "FNH")
        }
    }
}

# hit / found as a percentage (100 when there is nothing to cover).
export def pct [hit: int, found: int]: nothing -> float {
    if $found == 0 { 100.0 } else { ($hit / $found * 100.0) }
}

export def fmt_pct [p: float]: nothing -> string {
    $"(($p * 10 | math round) / 10 | into string -d 1)%"
}

# Markdown table with a totals row.
export def to_markdown [rows: list]: nothing -> string {
    let total = {
        lf: ($rows | get lines_found | math sum), lh: ($rows | get lines_hit | math sum)
        ff: ($rows | get funcs_found | math sum), fh: ($rows | get funcs_hit | math sum)
    }
    let body = ($rows | each {|r|
        $"| `($r.file)` | (fmt_pct (pct $r.lines_hit $r.lines_found)) | (fmt_pct (pct $r.funcs_hit $r.funcs_found)) |"
    })
    let all = $"| **Total** | **(fmt_pct (pct $total.lh $total.lf))** | **(fmt_pct (pct $total.fh $total.ff))** |"
    ["### Test coverage" "" "| File | Lines | Functions |" "|---|---|---|"] | append $body | append $all | str join "\n"
}

def main [path: string = "coverage/lcov.info", --output: string = ""] {
    if not ($path | path exists) {
        print $"(ansi yellow)⚠(ansi reset) ($path) not found — run `bun test` first."
        return
    }
    let md = (to_markdown (parse_lcov (open $path --raw)))
    print $md
    if $output != "" { $"($md)\n" | save --append $output }
}
