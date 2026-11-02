#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# CodeGraph — Run the randomised robustness tests (fuzz.yml)
# ──────────────────────────────────────────────────────────────────────────────
# Usage: nu scripts/ci/fuzz.nu [--iterations N] [--seed S] [--event schedule|push|…]
# A failure prints the seed that reproduces it.
# ──────────────────────────────────────────────────────────────────────────────

# Iterations per property: the input when given, 200k for the nightly, 5k otherwise.
export def iterations [input: string, event: string]: nothing -> string {
    if ($input | is-not-empty) { $input } else if $event == "schedule" { "200000" } else { "5000" }
}

def main [--iterations: string = "", --seed: string = "", --event: string = ""] {
    let iters = iterations $iterations $event
    print $"iterations=($iters) seed=(if ($seed | is-empty) { 'random' } else { $seed })"
    let env_vars = { FUZZ_ITERS: $iters } | merge (if ($seed | is-empty) { {} } else { { FUZZ_SEED: $seed } })
    # 200k nightly runs take far longer than bun's 5 s per-test default timeout.
    with-env $env_vars { ^bun test tests/fuzz.test.ts --config=bunfig.fuzz.toml --timeout=600000 }
}
