# VHS tape: commands
# /codegraph status, switching the mode, turning the plugin off and on, and a sync.

Output examples/vhs/generated/commands.gif

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
Wait+Screen@60s /codegraph: ready/
Show

Sleep 1.5s
Type "/codegraph status"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 3s
Type "/codegraph mode nudge"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 2s
Type "/codegraph off"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 2s
Type "/codegraph on"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 2s
Type "/codegraph sync"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 3s
