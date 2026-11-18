# Patch Notes

## [2026-11-18] — Unreleased: moderation, player reports and security fixes
- **Security:** the QA console hooks (`window.__game.debug`: teleport, give items, damage anyone) shipped in the production build, so a player, and especially a match host, could teleport or give themselves items mid-game. They now exist only in `vite` dev builds.
- **Security:** the account `Rank_1_Kills`, used to exploit that, is permanently banned in the code (`PERMA_BANNED` in `party/moderation.js`). It can't be lifted with `/unban`. Signing in shows a permanent-ban notice that can't be closed, and the account can't start or join matches, chat, shop or use friends.
- **Accounts:** too many wrong passwords now makes you wait before trying again. New passwords need at least 8 characters and can't be a very common one. You can sign out on all devices. Developers must have signed in within 12 hours to use dev commands.
- **Removed:** Log in with Clever. Use a username and password (or Google, where it works).
- **Security:** a security log of sign-ins, origin checks on the account API and sockets, and browser security headers (`vercel.json`). The internal matchmaker endpoints are closed to the internet.
- **DEV panel:** developers get a DEV button in the lobby to give or remove titles and to ban (pick the length: 1 hour, 1 day, 1 week, 1 month or permanent), warn, unban, and see reports and history, without typing commands.
- **Titles:** developers can give a player a custom title with `/title name TITLE #titlecolour #namecolour` and remove it with `/untitle name`. Staff-style titles like MOD are allowed, but titles never grant powers.
- **Report a player:** signed-in players can report someone from the lobby ONLINE list or the pause menu, with a reason and a note. Reports are private. Developers read them with `/reports` or `/history <user>`, then `/ban` (which clears them) or `/dismiss <user>`. Limits: one report per player per day, and 10 a day per reporter.
- Developers can `/warn`, `/ban`, `/unban`, `/history`, `/resetstats` and `/flags` from global chat. The account server re-checks developer rights, and only the developer sees the result.
- Bans escalate per offence: 1 hour, 1 day, 1 week, 1 month, then permanent. A developer can also set the length (`/ban name perm reason`). Timed bans lift on their own; unbanning keeps the offence count.
- Match results that look impossible or unlikely are flagged for a developer to review. Nothing is banned automatically.
- A banned account sees the reason and a countdown, earns no coins or stats, is hidden from the ranks, and can't chat, shop or use friends.
- This is moderation, not anti-cheat: results are still reported by the browser.

## [2026-11-17] — v0.16.1: humans-only private matches are unranked
- A private match with bots turned off pays no coins and does not add a win or eliminations, even when the host is on Hard.
- Hard matches that include bots still pay coins and count.

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
