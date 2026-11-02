#!/usr/bin/env nu
# Tests for scripts/vhs.nu

use std/assert
use runner.nu *
use ../vhs.nu [DEMO, PORT, SAMPLE, demo_env, project_dir, models_config, settings_config, plugin_config, pi_args, tapes]

def "test vhs: everything stays inside the demo directory" [] {
    let env_ = (demo_env "/d")
    assert equal $env_.HOME "/d/home"
    assert equal $env_.PI_CODING_AGENT_DIR "/d/agent"
    assert ((project_dir "/d") | str starts-with "/d/home/")
    assert ($DEMO | str starts-with "/tmp/")
}

def "test vhs: the model is the local scripted one" [] {
    let demo = (models_config 1234).providers.demo
    assert equal $demo.baseUrl "http://127.0.0.1:1234/v1"
    assert equal $demo.api "openai-completions"
    assert equal ($demo.models | get id) [demo-model]
    let s = (settings_config)
    assert equal [$s.defaultProvider $s.defaultModel] [demo demo-model]
    assert ($PORT > 1024)
}

def "test vhs: the plugin config sets the mode and has every setting" [] {
    assert equal (plugin_config nudge).mode nudge
    assert equal ((plugin_config enforce) | columns | sort) [autoInit autoSync enabled mode readHintAfter showStatus timeoutMs watch]
}

def "test vhs: pi loads only this plugin and leaves no session" [] {
    let args = (pi_args "/x/graphnav.ts")
    assert ($args | any {|a| $a == "--no-extensions" })
    assert equal ($args | window 2 | where {|w| $w.0 == "-e" } | get 0.1) "/x/graphnav.ts"
    for flag in [--no-skills --no-context-files --no-mcp --no-session --offline] { assert ($flag in $args) }
}

def "test vhs: the sample project has the call chain the scripted answers describe" [] {
    assert ($SAMPLE."src/config.ts" | str contains "export function parseConfig")
    assert ($SAMPLE."src/config.ts" | str contains "return parseConfig(")
    assert ($SAMPLE."src/server.ts" | str contains "await loadSettings()")
    assert ($SAMPLE."src/cli.ts" | str contains "parseConfig(")
    assert ($SAMPLE."src/server.ts" | str contains "registerRoutes(config)")
}

def "test vhs: one tape by name, or every tape sorted" [] {
    assert equal (tapes "examples/vhs" overview) ["examples/vhs/overview.tape"]
    let all = (tapes "examples/vhs")
    assert (($all | length) >= 3)
    assert equal $all ($all | sort)
    assert ($all | all {|t| $t | str ends-with ".tape" })
}

def "test vhs: every tape writes its own gif and every gif is in the README" [] {
    let readme = (open --raw README.md)
    for tape in (tapes "examples/vhs") {
        let name = ($tape | path parse | get stem)
        assert ((open --raw $tape) | str contains $"Output examples/vhs/generated/($name).gif") $"($name).tape output"
        assert ($readme | str contains $"examples/vhs/generated/($name).gif") $"($name).gif in README"
    }
}

def main [] { run-tests }
