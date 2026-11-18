// BENTONVILLE ROYALE — the update flyer: a full-screen splash that opens by itself the first
// time a player reaches the title screen after an update (src/ui/updateFlyer.js). One flyer
// at a time; its version must match the newest PATCH_NOTES entry. Images are in-game captures
// in public/ui/news/ (item renders of the real models, screenshots with the HUD hidden).

export const FLYER = {
  version: '0.17.0',
  kicker: 'NEW UPDATE',
  title: ['BOMBS', 'and Bridges'],
  tagline: 'Blow the roof off the museum. Then go see the art.',
  hero: { src: '/ui/news/bb-roof-blast.jpg', alt: 'A rocket blast tearing open the copper roof of a Crystal Bridges gallery, debris flying into the sky' },
  sections: [
    {
      id: 'bombs',
      tag: 'BOMBS',
      title: 'Explosives hit harder',
      items: [
        { img: '/ui/news/bb-item-rocket-launcher.png', name: 'Rocket Launcher', rarity: 'epic', text: 'Fixed: a bug stopped rockets from launching. Epic launchers now drop far more often; legendary ones are rarer.' },
        { img: '/ui/news/bb-item-grenade.png', name: 'Grenade', rarity: 'common', text: 'Grenades and rockets rip holes in the museum roof. Blow it open from above or below.' },
        { img: '/ui/news/bb-item-smoke.png', name: 'Smoke Grenade', rarity: 'uncommon', text: 'Pop a thick cloud of cover to rotate, revive or reboot without getting picked off.' },
      ],
    },
    {
      id: 'bridges',
      tag: 'BRIDGES',
      title: 'Crystal Bridges, upgraded',
      images: [
        { src: '/ui/news/bb-entrance.jpg', alt: 'The Crystal Bridges main entrance lined with obelisks, guardian statues and stone dragons' },
        { src: '/ui/news/bb-gallery.jpg', alt: 'A gallery with paintings on the walls and a loot chest on a bench' },
      ],
      bullets: [
        '30 stone statues: dragons and guardians at the doors, more in every gallery',
        '15 more paintings, and clear, bright galleries (the fog is gone)',
        'Chests on benches, tables and counters, plus a few hidden ones',
        'No more gaps in the roof, and smooth paths up to every entrance',
        'Build anywhere inside: pieces sit flush on the floors and roofs',
      ],
    },
    {
      id: 'fixes',
      tag: 'FIXED',
      title: "Catfish Ken's reboot van",
      images: [{ src: '/ui/news/bb-van.jpg', alt: "Catfish Ken's spray-painted reboot van parked by the road" }],
      bullets: [
        'A reboot card now always lands on the ground, even if your teammate went down in the air. No more "bring a reboot card" while you are holding one.',
        'Rebooting takes 5 seconds (was 8).',
        'Hard bots miss a bit more up close, build smarter, and edit their way out of their own boxes.',
      ],
    },
  ],
};
