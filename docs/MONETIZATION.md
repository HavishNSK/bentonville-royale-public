# Making money from Bentonville Royale

Two routes, both built in (`src/net/Ads.js`):

1. **CrazyGames**: a portal build with their SDK. They bring players and run the ads, and
   pay out monthly (€100 minimum).
2. **Google AdSense H5 Games Ads** on the game's own website.

Without either setting, the game shows no ads at all, as it did before.

## Where ads show (same for both)

- **Between matches:** a short ad when you leave the results screen (PLAY AGAIN or MAIN MENU).
  - At most one every 3 minutes.
  - Never in the first minute of a visit, never during a match, never right after another ad.
- **Rewarded:** "WATCH AD +100" on the results screen and in the Item Shop, for signed-in players.
  - The server allows 5 a day per account, one every 20 seconds (`adReward` in `party/accounts.js`).
- **While an ad plays,** the game is muted and ignores input. If no ad starts within 6 seconds,
  the game simply carries on.

## Kids and privacy

Many players are under 13 (US COPPA rules apply), and every player sees the same ads. So:

- **In the code:** every AdSense request asks for **non-personalized** ads and carries the
  child age-treatment tag.
- **Site-level (do this too):** in [Google Search Console](https://search.google.com/search-console),
  add the site and tag it as **directed to children**.
- **Consent banner:** in AdSense, go to **Privacy & messaging** and turn on the European
  regulations message (needed for EU / UK / Swiss visitors).
- **Privacy policy:** lives at `/privacy.html` (`public/privacy.html`) and is linked from the
  title screen. Update its Contact section if you get a support e-mail.
- **Students:** many players are students under 13. Check your district's rules before turning
  ads on.

## Before you turn anything on

- [ ] **Hosting allows commercial use.** Vercel's free Hobby plan does not. Either upgrade to
      Vercel Pro, or move the static site to Cloudflare Pages (free, commercial use allowed).
      The game server is already on Cloudflare.
- [ ] **Your own domain** (e.g. a `.com`) pointing at the site. AdSense won't approve a
      `*.vercel.app` address.
- [ ] **Permission from Catfish Ken** to use his name and likeness in a game that makes money.
- [ ] Consider renaming Fortnite's own terms ("Reboot Van", "Item Shop", "Back Bling") now
      that the game earns money.

## AdSense (own website)

1. **Sign up** for AdSense with your domain and wait for site approval.
2. **Apply for H5 Games Ads:** AdSense > Products / Sites > H5 Games Ads.
3. **Set your publisher id** where the site is built:
   - Vercel: Project > Settings > Environment Variables.
   - Locally: in `.env.local`.

   ```
   VITE_ADSENSE_CLIENT=ca-pub-1234567890123456
   ```

   This turns ads on and also writes `ads.txt` into the build, which AdSense checks for.
4. **Deploy.** In `npm run dev`, ads run in Google's **test mode** (`data-adbreak-test="on"`),
   showing an "ad example" box, so you can click through without real ads.

## CrazyGames

1. **Make a developer account** at [developer.crazygames.com](https://developer.crazygames.com/).
2. **Build:**

   ```
   VITE_PARTYKIT_HOST=bentonville-royale.bentonville-royale.workers.dev npm run build:crazygames
   ```

   This writes `dist-crazygames/` and `bentonville-royale-crazygames.zip` (about 22 MB, 136 files;
   their limits are 1,500 files, 250 MB total, 50 MB initial download).
3. **Upload** the zip. Test it in their preview / QA tool: their SDK shows demo ads there.
4. **Submit for Full Launch.** It's the stage that earns money; multiplayer games may skip
   Basic Launch.

**What changes in the CrazyGames build:**

- **Guests only.** CrazyGames doesn't allow outside sign-in, so there's no Google /
  password sign-in, no coins, friends or shop. The locker keeps the free items.
- **Their ads** (midgame + rewarded) replace AdSense.
- **Invites:** COPY INVITE gives a CrazyGames invite link, and opening one joins the party.
- **"Instant multiplayer"** launches go straight to PLAY.
- **Global chat** stays on. CrazyGames requires chat moderation, which is the chat filter in
  `src/net/chatFilter.js`.

## Server deploy

The rewarded-coins op is new on the account server. After merging, run `npm run party:deploy`
once.
