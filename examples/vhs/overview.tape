# VHS tape: overview
# A repo without a CodeGraph index: pi-graphnav indexes it in the background, then the
# model reaches for `rg` on a symbol, gets blocked and pointed at CodeGraph, and answers
# from codegraph_search and codegraph_callers.
#
# A real pi with only this plugin, on a throw-away sample project and a scripted model
# (scripts/vhs.nu, examples/vhs/mock-llm.ts): nothing of yours is read.

Output examples/vhs/generated/overview.gif

Set Shell "nu"
Set FontSize 18
Set Width 1200
Set Height 900
Set Padding 24
Set PlaybackSpeed 1.0
Set Theme "Catppuccin Mocha"

Hide
Type "nu scripts/vhs.nu setup; clear"
Enter
Sleep 2s
Type "nu scripts/vhs.nu pi"
Enter
Wait+Screen@30s /codegraph: (indexing|checking|ready)/
Show

Wait+Screen@60s /codegraph: ready/
Sleep 1.5s
Type "Where is parseConfig defined and who calls it?"
Sleep 800ms
Enter
Wait+Screen@60s /pointed me there/
Sleep 5s
