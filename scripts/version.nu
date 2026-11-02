#!/usr/bin/env nu
# Prints the current package version from package.json.
# Usage: nu scripts/version.nu

open package.json | get version | print
