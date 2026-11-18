# Patch Notes

## [2026-11-18] — Bug fixes from the deep test
- Fixed a GPU memory leak between matches: every character's animation skeleton (one per bot and player, about 100 a match) kept a texture on the graphics card after the match ended. Playing many matches in a row without reloading no longer slowly fills video memory, which mattered most on Chromebooks.
- Fixed the PRIVATE MATCH room-code box and JOIN button being covered by the global chat panel on screens shorter than 1080 px (including 1366x768 Chromebooks), which made it impossible to join a friend's room by code. The lobby chat now steps aside while the private-match panel is open and comes back when it closes.
- Fixed built walls, floors, ramps and cones inside buildings sinking up to 2.7 m through the floor or floating above it (so walls looked like different sizes). Pieces built indoors now start flush with the floor you stand on, and pieces near buildings follow the levelled ground instead of the raw hillside.

## [2026-11-17] — v0.15.1: much stricter, kid-friendly global chat
- `src/net/chatFilter.js` rewritten: a message that breaks a rule is refused (not masked with ****) and the sender sees which rule. Categories: profanity (including acronyms like stfu, gtfo, kys, fml), slurs and hate phrases, bullying ("ur so gay"), sexual talk, real-world threats, self-harm, drugs, and personal-info / off-app requests ("whats ur snap", "how old r u", "where do u live").
- Sees through leetspeak, look-alike letters from other alphabets, fancy/fullwidth/circled letters, accents, stretched letters, symbols inside words, spaced-out letters, words split in two and some reversed spellings. Normal game talk ("i will kill you", "clap them", "45s left", "sus") still goes through.
- Server (`party/presence.js`) stays the authority and now pauses a player's chat for 5 minutes after 3 rule breaks in 10 minutes. The client's filter reports only the rule category it stopped (never the text) so it counts too.
- Word-list filter, not a human or AI reviewer: new slang can still slip through and some innocent messages may be blocked. Tests in `tests/chat-filter.test.mjs`.

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
