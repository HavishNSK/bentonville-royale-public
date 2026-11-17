# Patch Notes

## [2026-11-17] — v0.15.0: developer announcements, full-screen chat, username filter
- Signed-in accounts named Sumukh, Havish, Gecko, or Shehryar show a red [DEV] chat name. They can type `/announce` followed by a message and everyone online sees it as an announcement. The account server confirms the name; typing one of those names as a guest does not count.
- Global chat (lobby) has a Full screen button: the chat fills the window with larger text; Esc, the button or a click outside exits. Not available mid-match so it can't cover gameplay.
- Account usernames with swear words or slurs (shared filter in `src/net/chatFilter.js`, `nameIsClean`) must be renamed: the server flags them (`profile.mustRename`), the lobby opens a rename panel that can't be dismissed, and PLAY is blocked until it is done. New `rename` op on the account server migrates the account key, Google/Clever links, friends' lists, sessions and live sockets.
- Registration and Google/Clever auto-generated usernames reject bad names; flagged accounts are hidden from the RANKS boards until renamed.
- Guest names: a saved bad name is cleared and PLAY is blocked until a clean name is typed. All servers and clients show bad display names as "Player".
- In-game patch notes now include v0.15.0 (also covers the earlier in-game fullscreen fix). Catfish Ken's van stays v0.14.0.

## [2026-11-17] — Lobby cleanup, fullscreen fix, patch notes automation
- Simplified title screen: removed the dense controls bar and disclaimer text; trimmed the subtitle to "build to survive"
- Fixed fullscreen not working in-game: clicking into the game or unpausing now requests fullscreen automatically alongside pointer lock
- Added patch notes automation rule to agents/SUMMARY.md so future agents log significant changes here
