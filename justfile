# CodeGraph — task runner
# Recipes run in Nushell; anything longer than a line lives in scripts/*.nu (tested).
# Install: brew install just nushell git-cliff · bun: https://bun.sh — or `just install-tools`
# Usage:   just <task>

set shell := ["nu", "-c"]

# ── Default ───────────────────────────────────────────────────────────────────

default:
    @just --list

# ── Tool checks ───────────────────────────────────────────────────────────────

_check-bun:
    @nu scripts/tools.nu check bun

_check-git-cliff:
    @nu scripts/tools.nu check git-cliff

# Report missing development tools and install the dependencies
install-tools:
    nu scripts/tools.nu install

# ── Develop ───────────────────────────────────────────────────────────────────

# Install dependencies
install: _check-bun
    bun install

# Run the test suite (coverage thresholds from bunfig.toml)
test: _check-bun
    bun test

# Type-check against pi's real types
typecheck: _check-bun
    bunx tsc --noEmit

# Tests with coverage and a summary table
coverage: _check-bun
    bun test
    nu scripts/ci/coverage_summary.nu

# Nushell script tests
test-nu:
    nu scripts/tests/run_all.nu

# The full quality gate (typecheck + tests + pack check + nu tests): what CI runs
check: _check-bun
    nu scripts/ci/quality_gate.nu

# What would be published
pack:
    npm pack --dry-run

# Render the README demo GIFs (all, or one: just vhs overview); needs vhs
vhs name="":
    nu scripts/vhs.nu record {{ name }}

# ── Fuzz & security ───────────────────────────────────────────────────────────

# Randomised robustness tests (e.g. just fuzz 200000)
fuzz iterations="5000": _check-bun
    nu scripts/ci/fuzz.nu --iterations {{ iterations }}

# Known vulnerabilities in the dependencies
audit: _check-bun
    bun audit

# Licenses, sources and bans of every dependency (deps-policy.nuon)
deps-policy: _check-bun
    nu scripts/ci/deps_policy.nu

# Security + fuzz locally, like the nightly workflows
nightly-local: audit deps-policy fuzz

# ── Dependencies ──────────────────────────────────────────────────────────────

# Update dependencies within their ranges
update: _check-bun
    nu scripts/ci/deps_update.nu update

# Show outdated dependencies
outdated: _check-bun
    bun outdated

# What the nightly does, locally: update, full gate
update-deps: update check

# Are there feat/fix/perf commits since the last tag?
unreleased:
    nu scripts/ci/unreleased.nu

# ── Nightly workflows on demand ───────────────────────────────────────────────

# Run a GitHub workflow now (deps-update | security | fuzz | ci), needs gh
gh-run workflow="deps-update":
    gh workflow run {{ workflow }}.yml
    @print "✅ Dispatched {{ workflow }}: gh run watch"

# Run a Gitea workflow now (security | fuzz | mirror); needs GITEA_URL + GITEA_TOKEN
gitea-run workflow="mirror":
    nu scripts/gitea_run.nu {{ workflow }}

# The nightly dependency update, now (GitHub; Gitea's mirror brings it over)
deps-update-now: (gh-run "deps-update")
    -just gitea-run mirror

# Security audit workflow, now, on both hosts
security-now: (gh-run "security")
    -just gitea-run security

# Fuzz workflow, now, on both hosts
fuzz-now: (gh-run "fuzz")
    -just gitea-run fuzz

# ── Changelog ─────────────────────────────────────────────────────────────────

# Regenerate CHANGELOG.md from all tags
changelog: _check-git-cliff
    git-cliff --output CHANGELOG.md

# Preview the next release's changelog
changelog-preview: _check-git-cliff
    @git-cliff --unreleased

# Show the latest release's entry
changelog-latest: _check-git-cliff
    @git-cliff --latest

# ── Version & release ─────────────────────────────────────────────────────────

# Current version (package.json)
version:
    @nu scripts/version.nu

# Validate that a version gives a valid vX.Y.Z tag equal to package.json
validate-tag version:
    nu scripts/ci/validate_tag.nu "v{{ version }}"

# What would be released, without changing anything
release-preview: _check-git-cliff
    @print $"Current version: (nu scripts/version.nu)\n"
    @git-cliff --unreleased

# Dry-run the npm publish
publish-dry: check
    nu scripts/ci/npm_publish.nu --dry-run

# Release from CI: gate, bump (patch | minor | major | current), changelog, tag, push, publish
release-ci bump="patch":
    gh workflow run release.yml --field bump={{ bump }}
    @print "✅ started: gh run watch (gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"

# Bump (patch | minor | major | X.Y.Z): gate, package.json + CHANGELOG, commit, tag. Does not push.
bump kind: _check-git-cliff
    nu scripts/bump_version.nu --yes {{ kind }}

# Bump, tag and push to GitHub: starts the Release workflow
release kind: (bump kind)
    git push --follow-tags origin (git branch --show-current)
    @print "✅ released: the Release workflow publishes to npm."

# Bump, tag and push to every remote: starts the Release workflows on both hosts
release-all kind: (bump kind) push-all

# Bump, tag and push to Gitea only (then just push-all, or the mirror finds the hosts diverged)
release-gitea-starscream kind: (bump kind)
    git push --follow-tags gitea-starscream (git branch --show-current)
    @print "✅ released on Gitea. Next: just push-all, so GitHub gets the release commit too."

# First release of the version already in package.json (no bump), pushed to every remote
release-initial-all: _check-git-cliff check
    nu scripts/release_initial.nu
    nu scripts/remotes.nu push

# Re-run the GitHub Release workflow for an existing tag (e.g. just release-retrigger 0.1.0)
release-retrigger version:
    gh workflow run release.yml --field tag=v{{ version }}

# ── Git remotes (GitHub = origin; Gitea Starscream mirrors it) ────────────────

# Push the current branch + tags to every configured remote (continues on failure)
push-all:
    nu scripts/remotes.nu push

# Show all configured remotes
remotes:
    @git remote -v

# Push the current branch to GitHub
push:
    git push origin (git branch --show-current)

# Push the current branch to Gitea Starscream
push-gitea-starscream:
    git push gitea-starscream (git branch --show-current)

# Push all tags to GitHub
push-tags:
    git push origin --tags

# Push all tags to every remote (continues on failure)
push-tags-all:
    nu scripts/remotes.nu push-tags

# Latest commit + tags to every remote, after the gate (no bump)
push-release-all: check push-all

# Force-push the current branch to every remote (no lease: be sure!)
push-all-force:
    nu scripts/remotes.nu push --force

# Pull the current branch from GitHub
pull:
    git pull origin (git branch --show-current)

# Pull the current branch from Gitea Starscream
pull-gitea-starscream:
    git pull gitea-starscream (git branch --show-current)

# Pull the current branch from every remote (continues on failure)
pull-all:
    nu scripts/remotes.nu pull

# Force-sync Gitea Starscream with this checkout (branch + tags)
sync-gitea-starscream:
    git push gitea-starscream (git branch --show-current) --force
    git push gitea-starscream --tags --force

# Add the missing remotes
setup-remotes:
    nu scripts/remotes.nu setup
