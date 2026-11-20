// BENTONVILLE ROYALE — in-game patch notes (title screen > PATCH NOTES).
//
// EVERY UPDATE ADDS AN ENTRY AT THE TOP: a new version (bump package.json "version" to
// match), the date, a short title, and one plain line per change, written for players
// (what they will notice), grouped under a few headings. The title-screen button shows a
// NEW badge until a player opens the notes for the newest version.

export const PATCH_NOTES = [
  {
    version: '0.20.3',
    date: '2026-11-20',
    title: 'Ads on the website',
    staffOnly: true, // devs and jr devs only (src/ui/meta.js canSeeStaffNotes)
    sections: [
      {
        heading: 'Website',
        items: [
          'The website now shows Google ads to help keep the game free. They are child-safe and never based on your interests or browsing (see the privacy page).',
          'The CrazyGames version is unchanged: CrazyGames runs its own ads there.',
        ],
      },
    ],
  },
  {
    version: '0.20.2',
    date: '2026-11-20',
    title: 'The real Downtown Square',
    sections: [
      {
        heading: 'Downtown Square',
        items: [
          'The Square now has its real fountain in the middle: a stone basin with water, spray and a planted centre. You can hop up on the rim, and it cannot be destroyed.',
          'The walks around the fountain are brick, laid out like the real park, and the shade trees stand where the real ones do (mapped from aerial photos).',
          'The building across NE 2nd Street, north of the park, is back.',
          'The park has its own loot now: two chests and a few floor items, instead of random stalls and benches.',
          'Reboot vans no longer park on the Square\'s lawn.',
          'Multiplayer: everyone needs to refresh for this update.',
        ],
      },
    ],
  },
  {
    version: '0.20.1',
    date: '2026-11-19',
    title: 'Item Shop Revamp',
    sections: [
      {
        heading: 'Item Shop',
        items: [
          'The item shop got a revamp: redundant skins and items were removed, and anyone who bought them got their coins back.',
          'New exclusive legendary skins: Software Engineer, Primal Barbarian, Vanta Knight and more!',
        ],
      },
    ],
  },
  {
    version: '0.20.0',
    date: '2026-11-19',
    title: 'BHS and Box Fights',
    sections: [
      {
        heading: 'New mode: Box Fights',
        items: [
          'Pick BOX FIGHTS on the party panel and press PLAY: browse public lobbies by mode, host your own, join a private lobby with its 6-character code, or play with bots offline.',
          'Modes: 1V1, 2V2, 3V3 and FFA (2 to 6 players). Lobbies hold up to 6, and bots fill the empty spots unless the host turns Fill off. Every bot plays at the same difficulty, picked by the host.',
          'Wait for the match in the lobby room: walk around, jump and emote while the host sets it up.',
          'Two teams (or everyone for themselves in FFA) in a two-storey indoor arena floating in the void. No storm, no loot, no bus.',
          'Every round starts with a wall down the middle: you can\'t see the other team for the 5 second countdown. At FIGHT it slides up into the ceiling.',
          'First team to win 5 rounds takes the match (the host can change it). FFA is 10 rounds, most eliminations wins, or first to 15. Everyone respawns with full health and shield each round.',
          'One kit for everyone: pump shotgun, assault rifle, SMG, 2 shield tonics and 500 of each material.',
          'The results screen shows everyone\'s eliminations, damage and builds. Back to Lobby keeps the same players together.',
          'If the host leaves mid-match, another player takes over and the match keeps going.',
        ],
      },
      {
        heading: 'Box Fights rating (Elo)',
        items: [
          'Box Fights now has its own rating, worked out like chess Elo. Everyone starts at 1000. Beat higher-rated players to climb faster.',
          'Bots have fixed ratings: Easy 800, Normal 1200, Hard 1600.',
          'Six tiers to climb: Trail Rat, Creek Hopper, Square Regular, Bridge Walker, Ozark Legend and Mayor of Bentonville.',
          'The result screen shows how many points you won or lost. Your rating and tier sit in the account bar, and there is a Box Fights board under RANKS.',
          'Sign in to get rated. Results are sent by each player\'s game, so they are reviewed, not guaranteed. Leaving after FIGHT counts as a loss.',
        ],
      },
      {
        heading: 'Building',
        items: [
          'One tap, one ramp: a quick tap no longer stacks a second ramp over your head.',
          'Ramps are never placed under your own feet, and nothing can be built through the Box Fights middle wall.',
        ],
      },
      {
        heading: 'Shop',
        items: [
          'New: the Femboy Jaithra Bundle. The Femboy Jaithra outfit, the Paw Pounder pickaxe, the Rainbow Gecko back bling and the Paws Up glider for 25,000 coins (27,500 bought one by one).',
          'Every piece is also sold on its own, and the bundle gets cheaper for the pieces you already own.',
          'The shop opens on a FEATURED row: the bundle and each of its pieces. Bundles moved to the bottom.',
        ],
      },
      {
        heading: 'Title screen',
        items: [
          'Cleaner title screen: the MUSEUM button and the key hints are gone. Your controls are in Settings.',
          'Bentonville High School, rebuilt, is the star of this update\'s splash: go see the North Building entrance, the Arend Arts Center and Tiger Arena.',
        ],
      },
    ],
  },
  /* v0.19.5 (Bentonville High rebuilt): commented out; the co-developers write the release notes for this update.
  {
    version: '0.19.5',
    date: '2026-11-19',
    title: 'Back to School: Bentonville High, rebuilt',
    sections: [
      {
        heading: 'The biggest POI drop yet',
        items: [
          'Bentonville High School is completely rebuilt, inside and out, to look like the real school. Two full buildings, every floor, every room. Drop in and see if you can find your locker.',
          'Built from real photos of the campus: red brick, cast-stone bands, silver metal panels, big blue glass and white roofs you can recognize from the sky.',
          '"NOW ENTERING BENTONVILLE HIGH SCHOOL": a banner greets you at the campus, with the tiger emblem slamming down onto it.',
        ],
      },
      {
        heading: 'North Building',
        items: [
          'The main entrance on the west side: glass doors under a big canopy, a two-storey glass wall, the MAIN ENTRANCE sign with the tiger emblem, and the tall stair tower.',
          'Walk in like a student: the lobby, the huge cafeteria on your left, the crosswalk exit on your right, and the main hallway straight ahead, looping all the way around the building.',
          'The cafeteria is a three-storey atrium with wood walls, round tables, banners and a glass-railed walkway you can fight across from above.',
          'Classrooms on all three floors, with glass windows into the hallway and out onto the green courtyard in the middle.',
          'Four big corner stairwells take you from floor 1 to 3, plus a two-storey media center and a lecture hall.',
          'A huge American flag flies over the entrance plaza on a 14 m pole.',
        ],
      },
      {
        heading: 'Main Building',
        items: [
          'The Arend Arts Center: a giant auditorium with nearly 1,800 seats, a balcony, and a raised stage behind a red curtain. Take the stage. Claim the balcony.',
          'Tiger Arena: a full competition gym with a painted court, 12-row bleachers on both sides and a running-track balcony up top. Plus an auxiliary gym with a climbing wall.',
          'A two-storey library with a glass-railed mezzanine, long rows of shelves and a computer zone.',
          'A second cafeteria with lunch tables all around the reboot van, the entry court with its water channel and arch, and the curved brick front of the arts center.',
          'A covered walkway and a crosswalk connect the two buildings.',
        ],
      },
      {
        heading: 'Every room is different',
        items: [
          'Over 100 classrooms, each set up for its subject: science labs with fume hoods, art rooms with easels and a kiln, computer labs, band and choir rooms on risers, kitchens, robotics labs and more.',
          'Desks in rows, pods, U-shapes and circles, backpacks on chairs, posters, flags, plants, whiteboards. No two rooms next to each other look alike.',
          'Hallways lined with lockers, offices, restrooms and storage rooms, with carpet, wood and polished floors.',
        ],
      },
      {
        heading: 'Loot everywhere',
        items: [
          'Bentonville High is stacked with loot, but not a dump: chests in about one classroom in four, plus ammo boxes and floor loot in the halls.',
          'Check the hallways, classrooms, closets, stairwell landings, the stage, the press box, the gym concourse and the library mezzanine.',
          'Loot no longer floats: if you blow up the floor under a chest, the chest drops to the floor below.',
        ],
      },
      {
        heading: 'Break everything, vault anything',
        items: [
          'Every wall, window, floor, stair, bleacher and roof at the school can be destroyed. Land on the roof, blast a hole, drop straight into class.',
          'New: vault! Jump at a fence or railing to vault over it. Works on fences and rails anywhere on the map.',
          'Tiger Stadium got a clean-up: the visitor stand is gone so the school\'s main entrance plaza is wide open, and the scoreboard is lit up: TIGERS 28, GUEST 14, fourth quarter.',
        ],
      },
      {
        heading: 'Fixes',
        items: [
          'Fixed the chest prompt saying "Open Open Chest".',
          'Multiplayer: everyone needs to refresh for this update.',
        ],
      },
    ],
  },
  */
  {
    version: '0.19.4',
    date: '2026-11-19',
    title: 'Fullscreen setting',
    sections: [
      {
        heading: 'Settings',
        items: [
          'New setting: Fullscreen when playing (Settings > Game, on by default). Turn it off to play in the browser window.',
          'Stuck at 20-30 FPS in fullscreen but fine after pressing Escape? Some graphics drivers slow down a fullscreen browser. Turn this setting off, or turn off Radeon Chill and Frame Rate Target Control in AMD Software.',
        ],
      },
    ],
  },
  {
    version: '0.19.3',
    date: '2026-11-19',
    title: 'FPS details',
    sections: [
      {
        heading: 'Settings',
        items: [
          'Show FPS now also shows what each frame costs, mouse events per second, your resolution, mouse lock and fullscreen, and your graphics card. If your FPS drops, a screenshot of it helps us find out why.',
        ],
      },
    ],
  },
  {
    version: '0.19.2',
    date: '2026-11-19',
    title: 'FPS limit and raw mouse',
    sections: [
      {
        heading: 'Settings',
        items: [
          'New FPS limit slider (Settings > Game): 30 to 240, or Unlimited.',
          'New Raw mouse input toggle. If your FPS drops in a match but jumps back up when you press Escape, try turning it on (or off) to see which is smoother on your PC.',
          'Dynamic resolution stays off while the FPS limit is under 50, so a low limit does not make the game blurry.',
        ],
      },
    ],
  },
  {
    version: '0.19.1',
    date: '2026-11-19',
    title: 'Smoother on PC',
    sections: [
      {
        heading: 'Performance',
        items: [
          'Fixed the game getting stuck at 20 FPS on some PCs. When your graphics card falls behind, the game now lowers the resolution a little instead of the frame rate, and raises it again when things calm down.',
          'New setting: Dynamic resolution (Settings > Game, on by default). Turn it off if you would rather keep full resolution.',
          'Moving the game to a monitor with different display scaling now picks the right resolution.',
        ],
      },
    ],
  },
  {
    version: '0.19.0',
    date: '2026-11-18',
    title: 'Cars',
    sections: [
      {
        heading: 'Drivable cars',
        items: [
          'Three cars you can drive: the Sedan (500 HP), the SUV (650 HP, slower and tougher) and the Pickup (450 HP, the fastest). About 30 are parked in lots and along the main roads, shown on the minimap.',
          'Press E to get in. You take the wheel if it is free. Drive with WASD, Space for the handbrake, Shift for a short boost, H for the horn, C to change seats, E to get out.',
          'Every car has 4 seats. Passengers hold aim (or fire) to lean out of their window and shoot, or throw grenades. You can heal in any seat.',
        ],
      },
      {
        heading: 'Shooting cars',
        items: [
          'Bullets hit the car: the body soaks them and the HP bar goes down. Glass stops shots too, until you break it. Then you can hit the people inside through the window.',
          'At 0 HP the car blows up: everyone inside takes 75 damage and is thrown out, and anyone standing next to it takes a little too. The burnt wreck stays for a while.',
          'Cars smoke when they are hurt and catch fire when they are about to blow.',
          'Grenades and rockets hurt cars and blow out their glass. Bots shoot at cars with people in them, and jump out of the way of one driving at them.',
        ],
      },
      {
        heading: 'Driving',
        items: [
          'Running someone over hurts (more the faster you go). Teammates are safe.',
          'Ramming a build breaks it. Crashing into walls at speed dents the car.',
          'Cars use fuel. New Gas Can item: use it in or next to a car to refuel. An empty car only crawls.',
          'Multiplayer: everyone needs to refresh for this update.',
        ],
      },
    ],
  },
  {
    version: '0.18.1',
    date: '2026-11-18',
    title: 'Parties get into the game',
    sections: [
      {
        heading: 'Parties',
        items: [
          'Fixed "Match found" not putting the whole party into the game. If you are in Sandbox, the Museum or a results screen when your party finds a match, you now jump straight in.',
          'Starting Sandbox, the Museum or a bot match on your own un-readies you, so your party never queues without you.',
          'The leader can\'t press PLAY while a party member is reconnecting, and someone whose connection blipped as the match was found still gets in.',
          'The leader now sees a countdown ("2/3 here · starting in 9s"). The match starts with whoever made it.',
          'If the leader\'s match never opens, you get a clear message instead of a stuck screen.',
        ],
      },
    ],
  },
  {
    version: '0.18.0',
    date: '2026-11-18',
    title: 'Smoother everything',
    sections: [
      {
        heading: 'Performance',
        items: [
          'The game runs much faster, especially on slower computers. In our test of a 100-player match on a slowed-down computer, it went from 26 to 55 frames per second.',
          'Chromebooks and older laptops now start on faster graphics settings automatically the first time you play. You can still change them in Settings.',
          'Building interiors are only drawn when you are near them, and far-away players no longer slow the game down.',
        ],
      },
      {
        heading: 'Animations',
        items: [
          'Characters walk when moving slowly instead of running in slow motion: aiming, crouching and backing up no longer slide.',
          'Crouching is a real crouch now, and you can see other players crouch.',
          'Jumps show in the air, landings dip, and getting hit makes characters flinch.',
          'Pistols have their own reload, grenades are thrown overhand, and you reach out when you open or grab loot.',
          'Sprinting lowers your gun, and characters lean into turns and strafes.',
          'Swing combos blend from one move to the next instead of snapping.',
        ],
      },
      {
        heading: 'Camera and controls',
        items: [
          'The camera glides over stairs, ramps and ledges instead of stepping.',
          'It no longer pops in and out when you pass poles and trees.',
          'Building a ramp over yourself no longer makes the camera flicker up and down or snap in and out.',
          'A ramp built behind you no longer lifts the camera on top of it or into the wood.',
          'Recoil kicks the view up and then settles back. Shotguns and snipers have a little extra punch.',
          'Hard landings dip the camera.',
        ],
      },
      {
        heading: 'Fixes',
        items: [
          'Back to the flat map: the hills and the photo ground are gone. They let players and bots fall under the ground and slip into buildings.',
          'Roads, sidewalks and grass look the way they did before the hills.',
          'Floors you build on the ground no longer flicker.',
          'Jumping while building on a ramp no longer shifts your pieces halfway between levels.',
          'Edited walls and floors keep one clean texture instead of turning into a grid of mini planks or bricks.',
          'The grass no longer shows a repeating block pattern from the air, and wooden walls no longer shimmer with stripes in the distance.',
          'Thin dotted lines on floors and ceilings inside buildings are gone.',
          'The big map has a fainter grid with square cells.',
        ],
      },
    ],
  },
  {
    version: '0.17.0',
    date: '2026-11-17',
    title: 'BOMBS and Bridges',
    sections: [
      {
        heading: 'Bombs',
        items: [
          'Rocket Launcher fixed: a bug stopped rockets from launching. They fire every time now.',
          'Epic Rocket Launchers drop far more often; legendary ones are rarer.',
          'Grenades and rockets rip holes in the Crystal Bridges roof, from above or below. Bullets and the pickaxe break roof panels too.',
        ],
      },
      {
        heading: 'Crystal Bridges',
        items: [
          '30 stone statues: dragons, guardians, gargoyles and obelisks at the entrances and in every gallery.',
          '15 more paintings on the walls, and the galleries are bright and clear (the heavy fog is gone).',
          'Chests sit on benches, tables, counters and the gift-shop case, plus a few hidden spots.',
          'No more gaps in the roof, and the paths to every entrance are smooth instead of steep.',
          'You can build inside the museum and on its roofs: pieces sit flush on the floors.',
          'The museum sits in the new real-world hills around it.',
        ],
      },
      {
        heading: 'Fixes and changes',
        items: [
          "Catfish Ken's reboot van: a reboot card always lands on the ground, even if your teammate went down in the air. No more \"bring a reboot card\" while you are holding one.",
          'Rebooting takes 5 seconds (was 8).',
          'Building costs 5 materials per piece (was 10) and you can place pieces faster.',
          'Hard bots miss a bit more up close, build smarter, box you in and peek with window edits, and edit or pickaxe their way out of their own boxes.',
          'When shot, bots now put up a wall toward where they think the shots came from, and sometimes guess wrong.',
        ],
      },
    ],
  },
  {
    version: '0.16.0',
    date: '2026-11-17',
    title: 'Supporting the game',
    sections: [
      {
        heading: 'Ads',
        items: [
          'Short ads can play between matches, when you leave the results screen. Never during a match, and at most one every few minutes.',
          'Signed in? Watch an ad on the results screen or in the Item Shop for +100 coins, up to 5 times a day.',
          'Only child-safe, non-personalized ads are shown. See the Privacy link at the bottom of the title screen.',
        ],
      },
    ],
  },
  {
    version: '0.15.1',
    date: '2026-11-17',
    title: 'Safer global chat',
    sections: [
      {
        heading: 'Global chat',
        items: [
          'Chat is much stricter so it stays kid-friendly. A message that breaks the rules is not sent at all, and you see why.',
          'Blocked: swearing and its abbreviations, slurs and hate speech, bullying, sexual talk, threats, talk about hurting yourself or others, drugs, and asking for or sharing personal info like ages, schools, addresses or other apps.',
          'Tricks like s.p.a.c.i.n.g, symbols, numbers for letters, fancy fonts and stretched letters no longer get around the filter.',
          'Breaking the chat rules 3 times in 10 minutes pauses your chat for 5 minutes.',
        ],
      },
    ],
  },
  {
    version: '0.15.0',
    date: '2026-11-17',
    title: 'Developer announcements and cleaner names',
    sections: [
      {
        heading: 'Global chat',
        items: [
          'New Full screen button on the lobby chat: the chat fills the window with bigger text. Press Esc, Exit full screen or click outside it to go back.',
          'Developer accounts show a red [DEV] name in chat and can post announcements everyone sees.',
        ],
      },
      {
        heading: 'Names',
        items: [
          'Names and usernames with swear words or slurs are no longer allowed.',
          'If your account username has one, you will be asked to pick a new one before you can play. Your coins, items, stats and friends stay with you.',
          'Guests with a name like that need to type a new name before playing. Other players see it as "Player" until then.',
        ],
      },
      {
        heading: 'Fixes',
        items: ['Clicking into the game, dropping from the Drop Bus or unpausing now switches the game to full screen along with locking the mouse.'],
      },
    ],
  },
  {
    version: '0.14.0',
    date: '2026-11-17',
    title: "Catfish Ken's van",
    sections: [
      {
        heading: 'Reboot vans',
        items: [
          "The reboot van is now Catfish Ken's own van: spray-painted pink, purple and blue all over (sides, roof, hood and back), with 'Catfish Ken' down both sides and lime-green rims.",
          'Catfish Ken himself sits in the driver\'s seat. He waves when you walk up and looks your way. He is friendly and never hurts anyone.',
          'While you carry a teammate\'s reboot card, every reboot van is highlighted and labeled on the minimap and the full map ("REBOOT VAN", or a countdown while it recharges).',
        ],
      },
    ],
  },
  {
    version: '0.13.0',
    date: '2026-11-17',
    title: 'Global chat, swimming and a pickleball paddle',
    sections: [
      {
        heading: 'Global chat',
        items: [
          'Chat with everyone who is online, in the lobby or in a match, wherever they are.',
          'In a match, press Enter to chat and Enter again to send (Esc closes). Messages fade after a few seconds.',
          'Keep it friendly: swear words are hidden, links, e-mails and phone numbers are blocked, and spamming pauses your chat for a minute.',
          'Hide the chat any time with the Hide button.',
        ],
      },
      {
        heading: 'Swimming',
        items: [
          "Walk into ponds and lakes to swim. You're slower in the water and can't shoot, build or heal until you climb out.",
        ],
      },
      {
        heading: 'Item Shop',
        items: ['New pickaxe: the Pickleball Paddle.'],
      },
      {
        heading: 'Map',
        items: ["Catfish Ken's reboot vans now show on the minimap and the full map in every mode, from the Drop Bus on, with a bigger icon."],
      },
    ],
  },
  {
    version: '0.12.0',
    date: '2026-11-17',
    title: 'Hard mode ranks and breakable ceilings',
    sections: [
      {
        heading: 'Ranks',
        items: [
          'Only matches on HARD bot difficulty count toward the RANKS boards now. Wins and eliminations from Easy or Normal matches are not added.',
          'In a private match, the host\'s bot difficulty decides whether the match counts.',
          'You still earn coins on every difficulty. The results screen tells you when a match was unranked.',
        ],
      },
      {
        heading: 'Buildings',
        items: [
          'Ceilings between floors can be broken. Pickaxe or shoot them from above or below, then drop, shoot or climb through the hole.',
        ],
      },
    ],
  },
  {
    version: '0.11.0',
    date: '2026-11-17',
    title: "Catfish Ken's reboot vans",
    sections: [
      {
        heading: 'Reboot vans',
        items: [
          "Catfish Ken's reboot van is parked at every major POI. Look for the food truck with the big catfish on the roof.",
          'In Duos, Trios and Squads, an eliminated player drops a reboot card. Teammates press E to pick it up.',
          'Hold E at a reboot van while carrying cards to bring those teammates back with a pistol, ammo and 100 wood.',
          'A van needs 60 seconds to recharge after a reboot. Vans and your team\'s cards show on the minimap.',
          'Bot teammates pick up your card and reboot you too.',
        ],
      },
      {
        heading: 'Less lag',
        items: [
          "A match no longer runs in slow motion when the host's computer drops below 20 FPS.",
          'Hosted matches keep running when the host switches tabs.',
          'Your builds show up instantly in multiplayer instead of after a round trip to the host.',
          'Hits, eliminations and other match events reach players sooner.',
          'Hosts upload much less data per player, and a slow connection no longer builds up a growing delay.',
        ],
      },
    ],
  },
  {
    version: '0.10.0',
    date: '2026-11-17',
    title: 'Fast shotguns, smarter bots',
    sections: [
      {
        heading: 'Shotguns',
        items: [
          'Shotguns reload one shell at a time (about half a second per shell) instead of one long reload.',
          'Shoot any time during a shotgun reload to stop it and fire the shells you have already loaded.',
        ],
      },
      {
        heading: 'Bots',
        items: [
          'Bots stop fighting and run for the safe zone when the storm is on them or about to catch them, shooting back on the way.',
          'Bots leave late-game circles earlier and head for the middle of tiny final circles.',
          'Bots stuck in the storm break through builds and walls in their way, or build a ramp over them.',
          'Bots build much more: more walls, ramps, ramp rushes and boxes on every difficulty, and they gather more materials to do it.',
        ],
      },
    ],
  },
  {
    version: '0.9.0',
    date: '2026-11-17',
    title: 'Pickaxe moves',
    sections: [
      {
        heading: 'Pickaxes',
        items: [
          'Every pickaxe now has its own moves, chained into a combo: the Hatchet chops and slices, the Dagger slashes and stabs, the Crystal Bridge Greatsword and Shadow Reaper spin, the Sparkle Wand casts, and the Root Beer Float throws punches.',
          'Every pickaxe still hits at the same speed, so none of them is better than another.',
          'Trying a pickaxe on in the Item Shop or Locker shows off its full combo.',
          'The hotbar shows the name of your equipped pickaxe.',
        ],
      },
      {
        heading: 'Shop',
        items: ["If an item can't be bought yet while the shop is being updated, the shop says so (and keeps your coins) instead of 'This item is not in the shop'."],
      },
    ],
  },
  {
    version: '0.8.1',
    date: '2026-11-17',
    title: 'Roof and stairwell fixes',
    sections: [
      {
        heading: 'Fixes',
        items: [
          'You can stand on the roof of the Bentonville Community Center again (you used to sink into the building), and its walls are solid.',
          'You can no longer climb sideways out of a building stairwell up through the floor above. Take the stairs!',
        ],
      },
    ],
  },
  {
    version: '0.8.0',
    date: '2026-11-16',
    title: 'Pickaxes, back blings and a new lobby',
    sections: [
      {
        heading: 'Fixes',
        items: [
          'You can no longer jump, mantle or walk up through build floors (or ramps) from underneath. Floors block your head like a ceiling.',
          'Bots can no longer fall through floors at low frame rates.',
          'Fixed overlapping text and boxes: the NEW tag on Patch Notes, the credits line under open panels, the squished party code box, cut-off names in party slots, emote wheel prompts and crowded place names on the full map.',
        ],
      },
      {
        heading: 'Cosmetics',
        items: [
          'New: 11 pickaxes, from the Bus Loop Hatchet to the Crystal Bridge Greatsword and the Root Beer Float.',
          'New: back blings, with capes, shields and a spellbook to wear on your back.',
          '7 new outfits and 5 new emotes in the Item Shop.',
          'Your pickaxe and back bling show in the lobby, to your party and to everyone in the match.',
        ],
      },
      {
        heading: 'Lobby & menus',
        items: [
          'New top bar with PLAY, LOCKER, ITEM SHOP, RANKS and PATCH NOTES tabs.',
          'Item Shop cards show a 3D picture of every item. Click one to try it on in the lobby.',
          'The Locker has Outfit, Back Bling, Pickaxe and Emote slots.',
          'Panels slide in, settings use real switches and sliders, and loading tips change while you wait.',
        ],
      },
      {
        heading: 'In the match',
        items: [
          'A new emote wheel with highlighted wedges and rarity colours.',
          'The kill feed shows player names in bold, with your own name in gold.',
          'The results screen reveals your placement and stats one at a time, shows the coins you earned, and throws confetti when you win.',
        ],
      },
    ],
  },
  {
    version: '0.7.0',
    date: '2026-11-16',
    title: 'Sniper bullet drop, custom crosshairs, who is online',
    sections: [
      {
        heading: 'Weapons',
        items: [
          'Sniper rounds now fly instead of hitting instantly. Lead moving targets a little; the bullet takes about a quarter second to cross 100 m.',
          'Sniper rounds drop slightly over distance: barely noticeable at 100 m, about a player’s height at 250 m.',
          'The Hunting Rifle is about half as common in loot and chests.',
        ],
      },
      {
        heading: 'Settings',
        items: [
          'New CROSSHAIR tab: pick a style (classic, dot, cross, circle), a color, the size, the thickness and the outline. It only changes the regular gun crosshair.',
        ],
      },
      {
        heading: 'Online',
        items: [
          'The ONLINE button on the title screen shows who is playing right now and who is searching for a match.',
          'Press PLAY in the same mode around the same time as other players to land in the same match. Bots fill the rest.',
        ],
      },
    ],
  },
  {
    version: '0.6.0',
    date: '2026-11-16',
    title: 'Community Center, 100 players, smoother moves',
    sections: [
      {
        heading: 'Map',
        items: [
          'The Walmart Home Office is gone: the Bentonville Community Center (Citizens Park, 1101 SW Citizens Circle) takes its corner of the map.',
        ],
      },
      {
        heading: 'Matches',
        items: [
          'Matches now hold 100 players.',
          'Bots spread out over the whole map when they drop instead of piling onto a few spots, so the lobby lasts much longer.',
        ],
      },
      {
        heading: 'Building',
        items: ['Run out of wood (or any material) and you switch to the next one you have automatically. No need to press the switch-material key.'],
      },
      {
        heading: 'Inventory',
        items: [
          'Dragging is easier: drop near a slot and it snaps there; you no longer have to land exactly on the card.',
          'While you drag, you see where both items will end up before you let go, and the swap animates into place.',
        ],
      },
      {
        heading: 'Animations',
        items: [
          'Characters turn smoothly instead of snapping.',
          'Running, strafing and backpedalling stay in step, with no more foot-sliding while blending between them.',
          'Starting to move, emotes and eliminations fade in and out instead of popping.',
        ],
      },
      {
        heading: 'Community',
        items: [
          'New: PATCH NOTES on the title screen, with a board to post suggestions and bug reports and upvote other players’ posts.',
          'New: RANKS: leaderboards for the most wins and eliminations, plus how many players are online.',
        ],
      },
      {
        heading: 'Accounts',
        items: [
          'Sign in with Google, or with Clever on school Chromebooks.',
          'Coins, match rewards and shop unlocks now need a signed-in account.',
          'Signing out asks you to confirm first.',
        ],
      },
      {
        heading: 'Performance',
        items: ['New Chromebook Performance mode in Settings: half resolution, no bloom or outlines, and a shorter draw distance for smooth play on low-end laptops.'],
      },
    ],
  },
  {
    version: '0.5.0',
    date: '2026-11-16',
    title: 'Box-fighting bots, party fixes',
    sections: [
      {
        heading: 'Fixes',
        items: [
          'Other players’ builds are visible again in multiplayer.',
          'Refreshing the page keeps you in your party (your slot is held for 20 seconds) with the same name.',
          'Your party sees the outfit you actually have equipped.',
        ],
      },
      {
        heading: 'Bots',
        items: [
          'Hard bots aim better, react faster and build faster.',
          'Hard bots box up in close fights and edit-peek: they edit a window or door into the wall facing you, shoot, then reset the edit. They also replace broken walls and heal inside their box.',
        ],
      },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-11-16',
    title: 'Ramps fixed, servers moved',
    sections: [
      {
        heading: 'Building',
        items: [
          'Ramps can be placed inside a box with a floor or a roof.',
          'You can walk under the high end of a ramp.',
        ],
      },
      { heading: 'Servers', items: ['Multiplayer, parties, matchmaking and accounts now run on new servers.'] },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-11-16',
    title: 'New map, pings and assists',
    sections: [
      {
        heading: 'Map',
        items: [
          'A bolder, easier-to-read map with big place names and an A–J / 1–10 grid.',
          'Click the full map to place a marker. Middle mouse pings enemies, loot or places for your team.',
        ],
      },
      {
        heading: 'Combat',
        items: [
          'The elimination goes to whoever knocked the player.',
          'Assists for 50+ damage. The full map shows each teammate’s elims, assists and damage.',
        ],
      },
      { heading: 'Inventory', items: ['Right-click an ammo or material stack to drop part of it.'] },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-11-16',
    title: 'Accounts, shop and emotes',
    sections: [
      {
        heading: 'New',
        items: [
          'Accounts with coins, an item shop, a locker, friends and party invites.',
          'An emote wheel (hold B) and a 3D lobby showing your outfit.',
          'Carry knocked teammates (H), mantle onto ledges, and siphon (+50 per elimination).',
          'Materials are picked up automatically, and items can be dragged out of the inventory to drop them.',
        ],
      },
    ],
  },
];

export const LATEST_VERSION = PATCH_NOTES[0].version;

// Entries with `staffOnly: true` are listed only for devs and jr devs (src/ui/meta.js). This only
// hides them in the menu: the text still ships in the game bundle, so never put secrets here.
export const visibleNotes = (staff) => PATCH_NOTES.filter((n) => staff || !n.staffOnly);
/** Newest entry everyone can see (drives the NEW badge for players who are not staff). */
export const PUBLIC_LATEST_VERSION = visibleNotes(false)[0].version;
