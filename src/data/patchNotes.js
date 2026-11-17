// BENTONVILLE ROYALE — in-game patch notes (title screen > PATCH NOTES).
//
// EVERY UPDATE ADDS AN ENTRY AT THE TOP: a new version (bump package.json "version" to
// match), the date, a short title, and one plain line per change, written for players
// (what they will notice), grouped under a few headings. The title-screen button shows a
// NEW badge until a player opens the notes for the newest version.

export const PATCH_NOTES = [
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
