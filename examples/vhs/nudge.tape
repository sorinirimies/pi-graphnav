# VHS tape: nudge
# In nudge mode a symbol search runs, and its output carries a hint to CodeGraph:
# the model follows it with codegraph_explore.

Output examples/vhs/generated/nudge.gif

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
Type "nu scripts/vhs.nu pi --mode nudge"
Enter
Wait+Screen@60s /codegraph: ready/
Show

Sleep 1.5s
Type "How does the server load its settings?"
Sleep 800ms
Enter
Wait+Screen@60s /full picture/
Sleep 5s
