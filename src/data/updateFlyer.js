// BENTONVILLE ROYALE — the update flyer: a full-screen splash that opens by itself the first
// time a player reaches the title screen after an update (src/ui/updateFlyer.js). One flyer
// at a time; its version must match the newest PATCH_NOTES entry. Images are in-game captures
// in public/ui/news/ (item renders of the real models, screenshots with the HUD hidden).

export const FLYER = {
  version: '0.20.0',
  kicker: 'NEW UPDATE',
  title: ['BHS', 'and Box Fights'],
  tagline: 'Back to school. Settle it in the box.',
  hero: { src: '/ui/news/v20-bhs-entrance.jpg', alt: 'The main entrance of the rebuilt Bentonville High North Building, glass doors under a white canopy, with a big American flag flying over the plaza' },
  sections: [
    {
      id: 'bhs',
      tag: 'BHS',
      title: 'Back to school',
      images: [
        { src: '/ui/news/v20-bhs-arts.jpg', alt: 'Rows of red seats in the Arend Arts Center facing the stage and its red curtain' },
        { src: '/ui/news/v20-bhs-arena.jpg', alt: 'Tiger Arena, the school gym, with a painted court between rows of bleachers' },
      ],
      bullets: [
        'Bentonville High is rebuilt inside and out: two full buildings, every floor, every room',
        'Walk in the North Building entrance, past the three-storey cafeteria and 100+ classrooms',
        'Take the stage in the 1,798-seat Arend Arts Center, or fight across Tiger Arena and the two-storey library',
        'Everything at the school breaks: blast through the roof and drop into class',
        'New: vault over fences, railings and other thin obstacles anywhere on the map',
      ],
    },
    {
      id: 'boxfights',
      tag: 'BOX FIGHTS',
      title: 'A new mode: Box Fights',
      images: [
        { src: '/ui/news/v20-box-wall.jpg', alt: 'The Box Fights arena before a round, the middle wall up between the two teams' },
        { src: '/ui/news/v20-box-fight.jpg', alt: 'Mid-fight in the Box Fights arena: players boxed up behind wooden walls on the checkered floor' },
      ],
      bullets: [
        '1V1, 2V2, 3V3 or 4V4: flip the party panel to BOX FIGHTS, or pick it in a private match',
        'A two-storey indoor arena. A wall hides the other team for the 5 second countdown, then slides up at FIGHT',
        'First to 3 rounds. Everyone gets the same kit: pump, AR, SMG, 2 tonics, 2 medkits, 500 mats',
        'Building fix: one tap, one ramp, and never a ramp under your own feet',
      ],
    },
    {
      id: 'elo',
      tag: 'RANKED',
      title: 'Climb the Box Fights ranks',
      bullets: [
        'Box Fights has its own Elo rating, like chess. Everyone starts at 1000',
        'Bots count too: Easy 800, Normal 1200, Hard 1600',
        'Six tiers: Trail Rat, Creek Hopper, Square Regular, Bridge Walker, Ozark Legend, Mayor of Bentonville',
        'See your +/- after every match and your spot on the RANKS board. Sign in to get rated',
      ],
    },
  ],
};
