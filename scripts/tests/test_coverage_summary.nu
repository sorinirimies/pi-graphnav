#!/usr/bin/env nu
# Tests for scripts/ci/coverage_summary.nu

use std/assert
use runner.nu *
use ../ci/coverage_summary.nu [parse_lcov, pct, fmt_pct, to_markdown]

const LCOV = "TN:
SF:extensions/a.ts
FNF:4
FNH:3
LF:20
LH:19
end_of_record
TN:
SF:extensions/b.ts
FNF:0
FNH:0
LF:10
LH:10
end_of_record
"

def "test coverage_summary: parses every record" [] {
    let rows = (parse_lcov $LCOV)
    assert equal ($rows | length) 2
    assert equal $rows.0.file "extensions/a.ts"
    assert equal $rows.0.lines_hit 19
    assert equal $rows.0.funcs_found 4
    assert equal $rows.1.file "extensions/b.ts"
}

def "test coverage_summary: ignores empty input and missing counters" [] {
    assert equal (parse_lcov "" | length) 0
    let rows = (parse_lcov "SF:x.ts\nend_of_record\n")
    assert equal $rows.0.lines_found 0
    assert equal $rows.0.funcs_hit 0
}

def "test coverage_summary: pct and fmt_pct" [] {
    assert equal (pct 19 20) 95.0
    assert equal (pct 0 0) 100.0
    assert equal (fmt_pct 95.0) "95.0%"
    assert equal (fmt_pct 100.0) "100.0%"
    assert equal (fmt_pct 66.666) "66.7%"
}

def "test coverage_summary: markdown has a header, one row per file and totals" [] {
    let md = (to_markdown (parse_lcov $LCOV))
    assert ($md | str contains "### Test coverage")
    assert ($md | str contains "| `extensions/a.ts` | 95.0% | 75.0% |")
    assert ($md | str contains "| `extensions/b.ts` | 100.0% | 100.0% |")
    assert ($md | str contains "| **Total** | **96.7%** | **75.0%** |")
}

def main [] { run-tests }
