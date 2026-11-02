#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# Validate a release tag
# ──────────────────────────────────────────────────────────────────────────────
# A release tag must look like vX.Y.Z and, unless --skip-package is given, its
# version must equal the version in package.json (so a tag can never publish a
# different version than the one that was tested).
#
# Usage:
#   nu scripts/ci/validate_tag.nu <tag> [--skip-package]
#
# stdout gets only key=value lines, so a workflow can do:
#   nu scripts/ci/validate_tag.nu "$TAG" >> "$GITHUB_OUTPUT"
# ──────────────────────────────────────────────────────────────────────────────

# Validate the tag shape; returns {tag, version}. Raises a catchable error.
export def validate [tag: string]: nothing -> record<tag: string, version: string> {
    if ($tag | is-empty) {
        error make { msg: "Tag is empty — nothing to validate." }
    }
    if ($tag | find --regex '^v\d+\.\d+\.\d+$' | is-empty) {
        error make { msg: $"Tag '($tag)' does not match vX.Y.Z — aborting." }
    }
    { tag: $tag, version: ($tag | str substring 1..) }
}

# The tag's version must equal the package version.
export def matches_package [tag: string, package_version: string]: nothing -> record<tag: string, version: string> {
    let r = (validate $tag)
    if $r.version != $package_version {
        error make { msg: $"Tag '($tag)' does not match package.json version ($package_version)." }
    }
    $r
}

def main [tag: string, --skip-package] {
    let result = try {
        if $skip_package {
            validate $tag
        } else {
            matches_package $tag (open package.json | get version)
        }
    } catch {|err|
        print --stderr $"(ansi red)❌ ($err.msg)(ansi reset)"
        exit 1
    }
    print --stderr $"(ansi green)✅ Tag ($result.tag) is valid.(ansi reset)"
    print $"tag=($result.tag)"
    print $"version=($result.version)"
}
