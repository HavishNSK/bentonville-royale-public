// BENTONVILLE ROYALE — out-of-match meta screens on the title: account bar, sign in / create
// account, item shop, locker (outfit + emote wheel), friends, party invites, and the 3D
// line-up (Showcase) with lobby emotes.
//
//   const meta = createMeta(menus, account, {
//     partyCode: () => 'ABCD' | null,       // current party (invites)
//     partyMembers: () => [{name, skin, pickaxe, backbling, you}],
//     onJoinParty(code),                    // accept an invite / join a friend
//     onCosmetics({ skin, pickaxe, backbling, emotes }),  // equipped loadout changed
//     onName(name),                         // signed in: play under the account name
//     onClick(),
//   });
//   meta.refresh()            // party changed: line-up + invite buttons
//   meta.setActive(on)        // title screen shown / hidden (3D line-up render loop)
//   meta.matchReward(coins)   // "+340 coins" after a match
//   meta.setOnline(snap|null) // who's online (src/net/Presence.js); null = list unavailable
//
// Panels dock on the right so the line-up stays visible while shopping.
// User text always goes through textContent.

import './meta.css';
import { SKINS, EMOTES, PICKAXES, BACKBLINGS, EMOTE_SLOTS, PRICES, featuredToday, emoteDef, cosmeticDef } from '../game/Cosmetics.js';
import { createShowcase } from './Showcase.js';
import { PATCH_NOTES, LATEST_VERSION } from '../data/patchNotes.js';
import { RANKED_NOTE } from '../core/config.js';

const SEEN_KEY = 'bentonville-royale.seenPatch';
const seenPatch = () => {
  try {
    return localStorage.getItem(SEEN_KEY) || '';
  } catch {
    return '';
  }
};

import { partyHost, isLocal } from '../net/Net.js';
import { nameIsClean } from '../net/chatFilter.js';

// GIS / Clever buttons in renderAuth(); Account.loginWithGoogle / Clever OAuth redirect.
const GOOGLE_CLIENT_ID =
  typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID
    ? String(import.meta.env.VITE_GOOGLE_CLIENT_ID).trim()
    : '';
const CLEVER_ENABLED =
  typeof import.meta !== 'undefined' &&
  import.meta.env &&
  (import.meta.env.VITE_CLEVER_AUTH === '1' || !!String(import.meta.env.VITE_CLEVER_CLIENT_ID || '').trim());

function cleverStartUrl() {
  const host = partyHost();
  const scheme = isLocal(host) ? 'http' : 'https';
  return `${scheme}://${host}/auth/clever?return=${encodeURIComponent(location.origin)}`;
}

let gisLoad = null;
function loadGoogleGis() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no-window'));
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
  if (gisLoad) return gisLoad;
  gisLoad = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisLoad = null;
      reject(new Error('Google sign-in failed to load.'));
    };
    document.head.appendChild(s);
  });
  return gisLoad;
}

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(label, cls = 'mn-btn mn-btn-small', act) {
  const b = h('button', cls);
  b.type = 'button';
  b.appendChild(h('span', null, label));
  if (act) b.dataset.act = act;
  return b;
}
const RARITY_CSS = { common: 'var(--br-common)', uncommon: 'var(--br-uncommon)', rare: 'var(--br-rare)', epic: 'var(--br-epic)', legendary: 'var(--br-legendary)' };
const KIND_LABEL = { skin: 'Outfit', pickaxe: 'Pickaxe', backbling: 'Back Bling', emote: 'Emote' };

export function createMeta(menus, account, opts = {}) {
  const titleEl = menus.el.querySelector('.mn-title');
  const click = () => opts.onClick && opts.onClick();

  // ---------------------------------------------------------------- 3D line-up
  const showcase = createShowcase(titleEl);
  const emoteBar = h('div', 'mt-emotebar');
  emoteBar.setAttribute('role', 'group');
  emoteBar.setAttribute('aria-label', 'Emote');
  showcase.el.appendChild(emoteBar);
  let lobbyEmote = null;

  function renderEmoteBar() {
    emoteBar.replaceChildren();
    const list = account.profile.equipped.emotes.filter(Boolean);
    for (const id of list) {
      const d = emoteDef(id);
      if (!d) continue;
      const b = h('button', 'mn-chip' + (lobbyEmote === id ? ' is-on' : ''));
      b.type = 'button';
      b.appendChild(h('span', null, d.name));
      b.setAttribute('aria-pressed', String(lobbyEmote === id));
      b.addEventListener('click', () => {
        click();
        lobbyEmote = lobbyEmote === id ? null : id;
        showcase.emote(lobbyEmote);
        renderEmoteBar();
      });
      emoteBar.appendChild(b);
    }
  }

  function lineUp() {
    const eq = account.profile.equipped;
    const me = { name: account.profile.guest ? '' : account.profile.name, skin: eq.skin, pickaxe: eq.pickaxe, backbling: eq.backbling, you: true };
    const others = (opts.partyMembers ? opts.partyMembers() : [])
      .filter((m) => !m.you)
      .map((m) => ({ name: m.name, skin: m.skin || 'skin_rogue', pickaxe: m.pickaxe, backbling: m.backbling }));
    showcase.setMembers([me, ...others]);
  }

  // ---------------------------------------------------------------- account bar
  const bar = h('nav', 'mt-bar');
  bar.setAttribute('aria-label', 'Main menu');
  const tabs = h('div', 'mt-tabs');
  const right = h('div', 'mt-right');
  const who = h('div', 'mt-who');
  const whoName = h('b', 'br-ol');
  const whoSub = h('small');
  who.append(whoName, whoSub);
  const coins = h('div', 'mt-coins');
  coins.title = 'Coins: sign in to earn them in matches and spend them in the shop';
  const coinsNum = h('b', 'br-ol', '0');
  coins.append(h('i', 'mt-coin', ''), coinsNum);
  const tab = (label, act) => {
    const b = btn(label, 'mt-tab', act);
    b.setAttribute('aria-pressed', 'false');
    return b;
  };
  const bPlay = tab('PLAY', 'play');
  const bLocker = tab('LOCKER', 'locker');
  const bShop = tab('ITEM SHOP', 'shop');
  const bBoard = tab('RANKS', 'leaderboard');
  const bNews = tab('PATCH NOTES', 'news');
  const newBadge = h('em', 'mt-badge mt-badge-new', 'NEW');
  newBadge.hidden = seenPatch() === LATEST_VERSION;
  bNews.appendChild(newBadge);
  tabs.append(bPlay, bLocker, bShop, bBoard, bNews);
  const bFriends = btn('FRIENDS', 'mn-chip mt-chip', 'friends');
  const badge = h('em', 'mt-badge');
  bFriends.appendChild(badge);
  const bOnline = btn('ONLINE', 'mn-chip mt-chip mt-chip-online', 'online');
  const onlineNum = h('em', 'mt-online-num', '');
  bOnline.prepend(h('i', 'mt-dot', ''));
  bOnline.appendChild(onlineNum);
  bOnline.title = 'Players on the title screen or in a match right now';
  const bAuth = btn('SIGN IN', 'mn-chip mt-chip mt-chip-sun', 'auth');
  right.append(bOnline, bFriends, coins, who, bAuth);
  bar.append(tabs, right);
  let online = null; // last presence snapshot
  titleEl.appendChild(bar);
  function syncTabs() {
    for (const b of tabs.children) {
      const on = (open || 'play') === b.dataset.act;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    bFriends.classList.toggle('is-on', open === 'friends');
    bOnline.classList.toggle('is-on', open === 'online');
  }

  // ---------------------------------------------------------------- panel shell
  const panel = h('aside', 'mt-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.hidden = true;
  const panelHead = h('div', 'mt-panel-head');
  const panelTitle = h('h2', 'mn-h br-ol');
  const close = btn('CLOSE', 'mn-chip', 'close');
  panelHead.append(panelTitle, close);
  const panelBody = h('div', 'mt-panel-body');
  const panelMsg = h('p', 'mt-msg');
  panelMsg.setAttribute('role', 'status');
  panelMsg.setAttribute('aria-live', 'polite');
  panel.append(panelHead, panelMsg, panelBody);
  titleEl.appendChild(panel);
  let open = null;

  function say(text, isError) {
    panelMsg.textContent = text || '';
    panelMsg.classList.toggle('is-error', !!isError);
  }

  let hideT = 0;
  function openPanel(which) {
    const switching = !!open && open !== which;
    open = which;
    clearTimeout(hideT);
    panel.hidden = false;
    // slide in (or cross-fade the content when switching tabs)
    if (!switching) {
      panel.classList.remove('is-open');
      void panel.offsetWidth;
    } else {
      panelBody.classList.remove('is-swap');
      void panelBody.offsetWidth;
      panelBody.classList.add('is-swap');
    }
    panel.classList.add('is-open');
    titleEl.classList.add('has-meta');
    syncTabs();
    panel.dataset.kind = which;
    say('');
    render();
    const f = panel.querySelector('input, button:not([data-act=close])');
    if (f) f.focus();
  }
  // A signed-in name that breaks the username rules: the RENAME panel stays up until it is fixed.
  const mustRename = () => account.signedIn && !!account.profile.mustRename;
  function closePanel() {
    if (!open) return;
    if (open === 'rename' && mustRename()) return;
    open = null;
    panel.classList.remove('is-open');
    hideT = setTimeout(() => (panel.hidden = true), 220);
    titleEl.classList.remove('has-meta');
    showcase.preview(null);
    showcase.emote(null);
    selSlot = -1;
    syncTabs();
  }
  close.addEventListener('click', () => {
    click();
    closePanel();
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePanel();
    }
  });

  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    click();
    const act = b.dataset.act;
    if (mustRename() && act !== 'auth') {
      openPanel('rename');
      return;
    }
    if (act === 'play') {
      closePanel();
      return;
    }
    // Signed-in SIGN OUT opens a confirm panel (no one-click logout).
    if (act === 'auth' && account.signedIn) {
      if (open === 'signout') closePanel();
      else openPanel('signout');
      return;
    }
    if (open === act) closePanel();
    else openPanel(act);
  });

  // ---------------------------------------------------------------- renderers
  function render() {
    panelBody.replaceChildren();
    close.hidden = open === 'rename' && mustRename(); // no way around a forced rename
    if (open === 'news') renderNews();
    else if (open === 'auth') renderAuth();
    else if (open === 'signout') renderSignOut();
    else if (open === 'rename') renderRename();
    else if (open === 'shop') renderShop();
    else if (open === 'locker') renderLocker();
    else if (open === 'leaderboard') renderLeaderboard();
    else if (open === 'friends') renderFriends();
    else if (open === 'online') renderOnline();
  }

  // ---------------------------------------------------------------- who's online
  const MODE_LABEL = { solo: 'Solo', duo: 'Duos', trio: 'Trios', squad: 'Squads' };
  function renderOnline() {
    panelTitle.textContent = 'ONLINE';
    if (!online) {
      panelBody.appendChild(h('p', 'mt-hint', 'Can’t reach the online list right now. You can still press PLAY for a match with bots.'));
      return;
    }
    const searching = Object.values(online.searching).reduce((a, b) => a + b, 0);
    panelBody.appendChild(h('p', 'mt-hint', `${online.count} online · ${searching} searching · ${online.inMatch} in a match`));
    panelBody.appendChild(
      h('p', 'mt-hint', 'Pick the same mode and press PLAY within a few seconds of each other to land in the same match. Bots fill the empty spots.')
    );
    const modes = Object.entries(online.searching).filter(([, n]) => n > 0);
    if (modes.length) {
      panelBody.appendChild(h('div', 'mn-party-label mt-sub', 'SEARCHING NOW'));
      const row = h('div', 'mt-online-modes');
      for (const [m, n] of modes) row.appendChild(h('span', 'mn-chip mt-chip-sun', `${MODE_LABEL[m]} · ${n}`));
      panelBody.appendChild(row);
    }
    panelBody.appendChild(h('div', 'mn-party-label mt-sub', 'PLAYERS'));
    for (const p of online.players) {
      const row = h('div', 'mt-friend is-online' + (p.status === 'queued' ? ' is-queued' : p.status === 'match' ? ' is-busy' : ''));
      const info = h('span', 'mt-friend-info');
      const what = p.status === 'queued' ? `Searching · ${MODE_LABEL[p.mode]}` : p.status === 'match' ? 'In a match' : 'In the lobby';
      info.append(h('b', null, p.name), h('small', null, what));
      row.append(h('i', 'mt-dot'), info);
      panelBody.appendChild(row);
    }
    if (online.count > online.players.length) panelBody.appendChild(h('p', 'mt-hint', `…and ${online.count - online.players.length} more`));
  }

  function renderOnlineChip() {
    onlineNum.textContent = online ? String(online.count) : '–';
    bOnline.classList.toggle('is-off', !online);
    bOnline.setAttribute('aria-label', online ? `Online: ${online.count} players` : 'Online list unavailable');
  }
  renderOnlineChip();

  // ---------------------------------------------------------------- patch notes + board
  let newsTab = 'notes';
  let board = null; // last loaded posts
  let boardKind = 'idea';
  function renderNews() {
    panelTitle.textContent = newsTab === 'notes' ? 'PATCH NOTES' : 'IDEAS & BUGS';
    try {
      localStorage.setItem(SEEN_KEY, LATEST_VERSION);
    } catch {
      /* private mode */
    }
    newBadge.hidden = true;
    const tabs = h('div', 'mn-seg');
    for (const [id, label] of [
      ['notes', 'PATCH NOTES'],
      ['board', 'SUGGEST / REPORT A BUG'],
    ]) {
      const t = h('button', newsTab === id ? 'is-on' : '', label);
      t.type = 'button';
      t.setAttribute('aria-pressed', String(newsTab === id));
      t.addEventListener('click', () => {
        click();
        newsTab = id;
        say('');
        render();
      });
      tabs.appendChild(t);
    }
    panelBody.appendChild(tabs);
    if (newsTab === 'notes') {
      for (const n of PATCH_NOTES) {
        const sec = h('section', 'mt-note' + (n.version === LATEST_VERSION ? ' is-latest' : ''));
        const head = h('div', 'mt-note-head');
        head.append(h('b', 'mt-note-ver', 'v' + n.version), h('span', 'mt-note-title', n.title), h('small', 'mt-note-date', n.date));
        sec.appendChild(head);
        for (const g of n.sections) {
          sec.appendChild(h('div', 'mt-note-h', g.heading));
          const ul = h('ul', 'mt-note-list');
          for (const it of g.items) ul.appendChild(h('li', null, it));
          sec.appendChild(ul);
        }
        panelBody.appendChild(sec);
      }
      return;
    }
    // board: post form + recent posts
    const form = h('form', 'mt-form mt-board-form');
    const kinds = h('div', 'mn-seg');
    for (const [id, label] of [
      ['idea', 'SUGGESTION'],
      ['bug', 'BUG REPORT'],
    ]) {
      const t = h('button', boardKind === id ? 'is-on' : '', label);
      t.type = 'button';
      t.setAttribute('aria-pressed', String(boardKind === id));
      t.addEventListener('click', () => {
        click();
        boardKind = id;
        kinds.querySelectorAll('button').forEach((b) => {
          b.classList.toggle('is-on', b === t);
          b.setAttribute('aria-pressed', String(b === t));
        });
        text.placeholder = id === 'bug' ? 'What went wrong, and what were you doing when it happened?' : 'What should we add or change?';
      });
      kinds.appendChild(t);
    }
    const text = h('textarea', 'mn-field mt-board-text');
    text.maxLength = 500;
    text.rows = 3;
    text.placeholder = boardKind === 'bug' ? 'What went wrong, and what were you doing when it happened?' : 'What should we add or change?';
    text.setAttribute('aria-label', 'Your suggestion or bug report');
    const send = btn('POST', 'mn-btn');
    send.type = 'submit';
    form.append(kinds, text, send);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      click();
      send.disabled = true;
      try {
        const item = await account.feedback(boardKind, text.value);
        text.value = '';
        board = [item, ...(board || []).filter((x) => x.id !== item.id)];
        say('Posted. Thanks for helping make the game better!');
        renderBoard(list);
      } catch (err) {
        say(err.offline ? 'Could not reach the server. Try again in a moment.' : err.message, true);
      }
      send.disabled = false;
    });
    panelBody.appendChild(form);
    panelBody.appendChild(h('div', 'mn-party-label mt-sub', 'FROM PLAYERS (UPVOTE WHAT YOU WANT MOST)'));
    const list = h('div', 'mt-posts');
    panelBody.appendChild(list);
    renderBoard(list);
    account
      .feedbackList()
      .then((items) => {
        board = items;
        if (open === 'news' && newsTab === 'board') renderBoard(list);
      })
      .catch(() => {
        if (!board) {
          list.replaceChildren(h('p', 'mt-hint', 'Could not load posts right now.'));
        }
      });
  }

  function renderBoard(list) {
    list.replaceChildren();
    if (!board) {
      list.appendChild(h('p', 'mt-hint', 'Loading…'));
      return;
    }
    if (!board.length) {
      list.appendChild(h('p', 'mt-hint', 'No posts yet. Be the first!'));
      return;
    }
    const items = board.slice().sort((a, b) => b.votes - a.votes || b.at - a.at);
    for (const it of items) {
      const row = h('div', 'mt-post');
      row.dataset.kind = it.kind;
      const vote = btn('▲ ' + it.votes, 'mn-chip mt-vote');
      vote.setAttribute('aria-label', `Upvote (${it.votes} votes)`);
      vote.addEventListener('click', async () => {
        click();
        try {
          const up = await account.feedbackVote(it.id);
          board = board.map((x) => (x.id === up.id ? up : x));
          renderBoard(list);
        } catch (err) {
          say(err.message, true);
        }
      });
      const body = h('div', 'mt-post-body');
      body.append(h('span', 'mt-post-kind', it.kind === 'bug' ? 'BUG' : 'IDEA'), h('p', 'mt-post-text', it.text), h('small', null, `${it.by} · ${new Date(it.at).toLocaleDateString()}`));
      row.append(vote, body);
      list.appendChild(row);
    }
  }

  let boardCache = null;
  let boardLoading = false;
  async function renderLeaderboard() {
    panelTitle.textContent = 'RANKS';
    const onlineEl = h('p', 'mt-online br-ol', boardCache ? `${boardCache.online} PLAYERS ONLINE` : 'Loading…');
    panelBody.appendChild(onlineEl);
    panelBody.appendChild(h('p', 'mt-hint mt-ranked-note', RANKED_NOTE));
    panelBody.appendChild(h('p', 'mt-hint', 'Signed-in players only. Guests do not appear on the boards.'));

    const paint = (data) => {
      boardCache = data;
      onlineEl.textContent = `${data.online} PLAYERS ONLINE`;
      const wrap = h('div', 'mt-boards');
      wrap.appendChild(boardColumn('MOST WINS', data.wins || [], 'wins'));
      wrap.appendChild(boardColumn('MOST ELIMS', data.kills || [], 'kills'));
      const old = panelBody.querySelector('.mt-boards');
      if (old) old.replaceWith(wrap);
      else panelBody.appendChild(wrap);
    };

    if (boardCache) paint(boardCache);
    if (boardLoading) return;
    boardLoading = true;
    try {
      const data = await account.leaderboard();
      if (open === 'leaderboard') paint(data);
    } catch (err) {
      if (open === 'leaderboard') say(err.offline ? 'Could not reach the account server.' : err.message, true);
    } finally {
      boardLoading = false;
    }
  }

  function boardColumn(title, rows, key) {
    const col = h('div', 'mt-board');
    col.appendChild(h('div', 'mn-party-label mt-sub', title));
    if (!rows.length) {
      col.appendChild(h('p', 'mt-hint', 'No ranked players yet. Sign in and play matches.'));
      return col;
    }
    const list = h('ol', 'mt-board-list');
    rows.forEach((row, i) => {
      const li = h('li', 'mt-board-row');
      li.append(
        h('span', 'mt-board-rank', String(i + 1)),
        h('span', 'mt-board-name', row.name),
        h('span', 'mt-board-stat', String(row[key] | 0))
      );
      if (account.signedIn && account.profile.name === row.name) li.classList.add('is-you');
      list.appendChild(li);
    });
    col.appendChild(list);
    return col;
  }

  function renderSignOut() {
    panelTitle.textContent = 'SIGN OUT';
    const name = account.profile && account.profile.name ? account.profile.name : 'your account';
    panelBody.appendChild(h('p', 'mt-hint', `Sign out of ${name}? You’ll keep playing as a guest on this device until you sign in again.`));
    const row = h('div', 'mt-signout-actions');
    const cancel = btn('CANCEL', 'mn-btn mn-btn-small');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      click();
      closePanel();
    });
    const confirm = btn('SIGN OUT', 'mn-btn mn-btn-hero mt-signout-confirm');
    confirm.type = 'button';
    confirm.addEventListener('click', () => {
      click();
      account.logout();
      closePanel();
    });
    row.append(cancel, confirm);
    panelBody.appendChild(row);
  }

  function renderRename() {
    panelTitle.textContent = 'NEW USERNAME NEEDED';
    panelBody.appendChild(
      h('p', 'mt-hint', `Your username “${account.profile.name}” has a word that isn’t allowed. Pick a new one to keep playing. Your coins, items, stats and friends stay with you.`)
    );
    const form = h('form', 'mt-form');
    const user = h('input', 'mn-field');
    user.placeholder = 'New username';
    user.autocomplete = 'username';
    user.maxLength = 16;
    user.required = true;
    user.spellcheck = false;
    user.setAttribute('aria-label', 'New username');
    const go = btn('SAVE USERNAME', 'mn-btn mn-btn-hero');
    go.type = 'submit';
    form.append(user, go, h('p', 'mt-hint', 'Usernames are 3-16 letters, numbers, _ or -, with no swear words.'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      click();
      const name = user.value.trim();
      if (!nameIsClean(name)) {
        say('That username is not allowed. Pick one without swear words.', true);
        return;
      }
      go.disabled = true;
      say('Saving…');
      try {
        await account.rename(name);
        say('');
        closePanel();
      } catch (err) {
        say(err.offline ? 'Could not reach the account server. Try again in a moment.' : err.message, true);
        go.disabled = false;
      }
    });
    panelBody.append(form, h('p', 'mt-hint', 'Not your account? Use SIGN OUT at the top to play as a guest.'));
  }

  let authTab = 'login';
  function renderAuth() {
    panelTitle.textContent = authTab === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT';
    const tabs = h('div', 'mn-seg');
    for (const [id, label] of [
      ['login', 'SIGN IN'],
      ['register', 'CREATE ACCOUNT'],
    ]) {
      const t = h('button', authTab === id ? 'is-on' : '', label);
      t.type = 'button';
      t.setAttribute('aria-pressed', String(authTab === id));
      t.addEventListener('click', () => {
        click();
        authTab = id;
        say('');
        render();
      });
      tabs.appendChild(t);
    }
    const form = h('form', 'mt-form');
    const user = h('input', 'mn-field');
    user.placeholder = 'Username';
    user.autocomplete = 'username';
    user.maxLength = 16;
    user.required = true;
    user.spellcheck = false;
    user.setAttribute('aria-label', 'Username');
    const pw = h('input', 'mn-field');
    pw.type = 'password';
    pw.placeholder = 'Password';
    pw.autocomplete = authTab === 'login' ? 'current-password' : 'new-password';
    pw.maxLength = 72;
    pw.required = true;
    pw.setAttribute('aria-label', 'Password');
    const go = btn(authTab === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT', 'mn-btn mn-btn-hero');
    go.type = 'submit';
    const hint = h(
      'p',
      'mt-hint',
      authTab === 'login'
        ? 'Your outfits, emotes, coins and friends follow your account to any device.'
        : 'Usernames are 3-16 letters, numbers, _ or -. Passwords need at least 6 characters. You start with 1,500 coins.'
    );
    form.append(user, pw, go, hint);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      click();
      go.disabled = true;
      say(authTab === 'login' ? 'Signing in…' : 'Creating your account…');
      try {
        if (authTab === 'login') await account.login(user.value.trim(), pw.value);
        else await account.register(user.value.trim(), pw.value);
        closePanel();
      } catch (err) {
        say(err.offline ? 'Could not reach the account server. You can keep playing as a guest.' : err.message, true);
        go.disabled = false;
      }
    });
    const guest = h('p', 'mt-hint', 'Guests can play with free defaults. Sign in to earn coins, unlock outfits, and keep progress on any device.');
    panelBody.append(tabs, form, guest);

    // Clever first: Bentonville Google Workspace blocks unverified 3rd-party apps (admin_policy_enforced).
    if (CLEVER_ENABLED) {
      const divider = h('p', 'mt-hint mt-or', 'or');
      const cleverBtn = btn('LOG IN WITH CLEVER', 'mn-btn mn-btn-hero mt-clever');
      cleverBtn.type = 'button';
      cleverBtn.addEventListener('click', () => {
        click();
        window.location.assign(cleverStartUrl());
      });
      const cleverHint = h('p', 'mt-hint', 'Best on school Chromebooks — uses Clever instead of Google.');
      panelBody.append(divider, cleverBtn, cleverHint);
    }

    if (GOOGLE_CLIENT_ID && !CLEVER_ENABLED) {
      const divider = h('p', 'mt-hint mt-or', 'or');
      const googleWrap = h('div', 'mt-google');
      googleWrap.setAttribute('aria-label', 'Continue with Google');
      panelBody.append(divider, googleWrap);
      loadGoogleGis()
        .then(() => {
          if (open !== 'auth' || !window.google?.accounts?.id) return;
          window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: async (resp) => {
              if (!resp || !resp.credential) {
                say('Google sign-in was cancelled.', true);
                return;
              }
              say('Signing in with Google…');
              try {
                await account.loginWithGoogle(resp.credential);
                closePanel();
              } catch (err) {
                say(err.offline ? 'Could not reach the account server. You can keep playing as a guest.' : err.message, true);
              }
            },
            auto_select: false,
            cancel_on_tap_outside: true,
          });
          googleWrap.replaceChildren();
          window.google.accounts.id.renderButton(googleWrap, {
            theme: 'filled_black',
            size: 'large',
            text: 'continue_with',
            shape: 'pill',
            width: 280,
          });
        })
        .catch(() => {
          say('Google sign-in is unavailable right now. Use username and password, or play as a guest.', true);
        });
    }
  }

  /** Fortnite-style item tile: rarity backdrop, 3D thumbnail, name banner, price or state. */
  function itemCard(id, { owned, equipped, onClick, action, selected }) {
    const c = cosmeticDef(id);
    const d = c.def;
    const card = h('button', 'mt-item');
    card.type = 'button';
    card.dataset.rarity = d.rarity;
    card.dataset.id = id;
    card.style.setProperty('--rar', RARITY_CSS[d.rarity] || RARITY_CSS.common);
    const art = h('span', 'mt-item-art');
    art.dataset.kind = c.kind;
    showcase.thumb(id).then((url) => {
      if (!url) {
        art.classList.add('is-blank'); // nothing to draw (e.g. "No Back Bling")
        return;
      }
      const img = h('img');
      img.alt = '';
      img.decoding = 'async';
      img.src = url;
      art.appendChild(img);
      art.classList.add('has-img');
    });
    const info = h('span', 'mt-item-info');
    info.append(h('b', 'mt-item-name', d.name), h('small', 'mt-item-kind', `${d.rarity} ${KIND_LABEL[c.kind]}`));
    const foot = h('span', 'mt-item-foot');
    if (equipped) foot.textContent = 'EQUIPPED';
    else if (owned) foot.textContent = action || 'OWNED';
    else {
      foot.appendChild(h('i', 'mt-coin'));
      foot.appendChild(document.createTextNode(PRICES[id].toLocaleString()));
    }
    card.classList.toggle('is-owned', !!owned);
    card.classList.toggle('is-equipped', !!equipped);
    card.classList.toggle('is-sel', !!selected);
    card.setAttribute('aria-label', `${d.name}, ${d.rarity} ${KIND_LABEL[c.kind]}${equipped ? ', equipped' : owned ? ', owned' : `, ${PRICES[id]} coins`}`);
    card.append(art, info, foot);
    card.addEventListener('click', () => {
      click();
      onClick();
    });
    return card;
  }

  /** Try an item on in the line-up: outfits / pickaxes / back blings are worn, emotes played. */
  function tryOn(id) {
    const c = cosmeticDef(id);
    if (!c) return;
    if (c.kind === 'emote') {
      showcase.preview(null);
      showcase.emote(id);
    } else {
      showcase.emote(null);
      showcase.preview(id);
    }
  }

  let pending = null; // shop item awaiting BUY confirm
  const forSale = (table) => Object.keys(table).filter((k) => PRICES[k]);
  function renderShop() {
    panelTitle.textContent = 'ITEM SHOP';
    const p = account.profile;
    const eq = p.equipped;
    const sections = [
      ['FEATURED TODAY', featuredToday(4), 'is-featured'],
      ['OUTFITS', forSale(SKINS)],
      ['PICKAXES', forSale(PICKAXES)],
      ['BACK BLINGS', forSale(BACKBLINGS)],
      ['EMOTES', forSale(EMOTES)],
    ];
    for (const [label, ids, cls] of sections) {
      panelBody.appendChild(h('div', 'mt-sub', label));
      const grid = h('div', 'mt-grid' + (cls ? ' ' + cls : ''));
      for (const id of ids) {
        grid.appendChild(
          itemCard(id, {
            owned: p.owned.includes(id),
            equipped: eq.skin === id || eq.pickaxe === id || eq.backbling === id,
            selected: pending === id,
            onClick: () => {
              tryOn(id);
              pending = p.owned.includes(id) ? null : id;
              for (const el of panelBody.querySelectorAll('.mt-item.is-sel')) el.classList.remove('is-sel');
              for (const el of panelBody.querySelectorAll(`.mt-item[data-id="${id}"]`)) el.classList.add('is-sel');
              renderBuy();
            },
          })
        );
      }
      panelBody.appendChild(grid);
    }
    const buyBar = h('div', 'mt-buy');
    buyBar.dataset.ref = 'buy';
    panelBody.prepend(buyBar);
    renderBuy();
  }

  function renderBuy() {
    const bar = panelBody.querySelector('[data-ref=buy]');
    if (!bar) return;
    bar.replaceChildren();
    if (!account.signedIn) {
      bar.appendChild(h('span', 'mt-hint', 'Sign in to earn coins from matches and unlock outfits, pickaxes, back blings and emotes.'));
      const sign = btn('SIGN IN', 'mn-btn mn-btn-hero');
      sign.addEventListener('click', () => {
        click();
        openPanel('auth');
      });
      bar.appendChild(sign);
      return;
    }
    if (!pending) {
      bar.appendChild(h('span', 'mt-hint', 'Pick an item to try it on. Earn coins in matches: placing well, eliminations and wins.'));
      return;
    }
    const c = cosmeticDef(pending);
    const price = PRICES[pending];
    const can = account.profile.coins >= price;
    const name = h('span', 'mt-buy-name');
    name.append(h('b', null, c.def.name), h('small', 'mt-item-kind', `${c.def.rarity} ${KIND_LABEL[c.kind]}`));
    bar.appendChild(name);
    const b = btn('', 'mn-btn mn-btn-hero mt-buy-go');
    b.firstChild.append('BUY ', h('i', 'mt-coin'), ` ${price.toLocaleString()}`);
    b.disabled = !can;
    b.classList.toggle('is-disabled', !can);
    b.addEventListener('click', async () => {
      click();
      const id = pending;
      b.disabled = true;
      try {
        await account.buy(id);
        say(`${c.def.name} is yours! Equip it in the Locker.`);
        pending = null;
        render();
      } catch (err) {
        // the account server's catalog is older than this page's (it has not been redeployed yet)
        say(/not in the shop/i.test(err.message) ? `${c.def.name} isn't on sale yet: the shop server is being updated. Try again soon. Your coins were not spent.` : err.message, true);
        b.disabled = false;
      }
    });
    bar.appendChild(b);
    if (!can) bar.appendChild(h('small', 'mt-hint mt-buy-need', `You need ${(price - account.profile.coins).toLocaleString()} more coins.`));
  }

  // ---- locker: Fortnite-style loadout slots; pick a slot, then an item for it
  let lockerSlot = 'skin';
  let selSlot = -1; // emote wheel slot being filled
  const LOADOUT = [
    ['skin', 'OUTFIT', SKINS],
    ['backbling', 'BACK BLING', BACKBLINGS],
    ['pickaxe', 'PICKAXE', PICKAXES],
    ['emotes', 'EMOTES', EMOTES],
  ];
  function renderLocker() {
    panelTitle.textContent = 'LOCKER';
    const p = account.profile;
    const eq = p.equipped;
    const row = h('div', 'mt-loadout');
    for (const [key, label] of LOADOUT) {
      const id = key === 'emotes' ? eq.emotes.find(Boolean) : eq[key];
      const s = h('button', 'mt-load' + (lockerSlot === key ? ' is-on' : ''));
      s.type = 'button';
      s.setAttribute('aria-pressed', String(lockerSlot === key));
      const c = cosmeticDef(id);
      if (c) s.style.setProperty('--rar', RARITY_CSS[c.def.rarity] || RARITY_CSS.common);
      const art = h('span', 'mt-load-art');
      if (id)
        showcase.thumb(id).then((url) => {
          if (!url) return;
          const img = h('img');
          img.alt = '';
          img.src = url;
          art.appendChild(img);
        });
      s.append(art, h('small', null, label), h('b', null, key === 'emotes' ? `${eq.emotes.filter(Boolean).length} / ${EMOTE_SLOTS}` : c ? c.def.name : '—'));
      s.addEventListener('click', () => {
        click();
        lockerSlot = key;
        selSlot = -1;
        render();
      });
      row.appendChild(s);
    }
    panelBody.appendChild(row);

    if (lockerSlot !== 'emotes') {
      const [, label, table] = LOADOUT.find((l) => l[0] === lockerSlot);
      const ids = Object.keys(table).filter((k) => p.owned.includes(k));
      const notOwned = Object.keys(table).length - ids.length;
      panelBody.appendChild(h('div', 'mt-sub', `${label} · ${ids.length} OWNED`));
      const grid = h('div', 'mt-grid');
      for (const id of ids) {
        grid.appendChild(
          itemCard(id, {
            owned: true,
            equipped: eq[lockerSlot] === id,
            action: 'EQUIP',
            onClick: async () => {
              showcase.preview(null);
              try {
                await account.equip({ [lockerSlot]: id });
                if (lockerSlot !== 'skin') tryOn(id); // show it off (the line-up already wears it)
              } catch (err) {
                say(err.message, true);
              }
              render();
            },
          })
        );
      }
      panelBody.appendChild(grid);
      if (notOwned > 0) {
        const more = btn(`${notOwned} MORE IN THE ITEM SHOP`, 'mn-chip mt-more');
        more.addEventListener('click', () => {
          click();
          openPanel('shop');
        });
        panelBody.appendChild(more);
      }
      return;
    }

    panelBody.appendChild(h('div', 'mt-sub', 'EMOTE WHEEL'));
    panelBody.appendChild(h('p', 'mt-hint', 'Pick a slot, then an emote. In a match, hold the emote key and flick the mouse (or press 1-6).'));
    const slots = h('div', 'mt-slots');
    for (let i = 0; i < EMOTE_SLOTS; i++) {
      const id = eq.emotes[i];
      const s = h('button', 'mt-slot' + (selSlot === i ? ' is-sel' : ''));
      s.type = 'button';
      s.appendChild(h('kbd', 'br-key', String(i + 1)));
      s.appendChild(h('span', null, id ? emoteDef(id).name : 'Empty'));
      s.setAttribute('aria-pressed', String(selSlot === i));
      s.addEventListener('click', () => {
        click();
        selSlot = selSlot === i ? -1 : i;
        if (id) tryOn(id);
        render();
      });
      slots.appendChild(s);
    }
    panelBody.appendChild(slots);
    if (selSlot >= 0) {
      const pick = h('div', 'mt-grid');
      const ownedEmotes = Object.keys(EMOTES).filter((k) => p.owned.includes(k));
      for (const id of ownedEmotes) {
        pick.appendChild(
          itemCard(id, {
            owned: true,
            equipped: eq.emotes[selSlot] === id,
            action: 'SET',
            onClick: async () => {
              const list = eq.emotes.slice();
              const j = list.indexOf(id);
              if (j >= 0 && j !== selSlot) list[j] = list[selSlot]; // swap if it sat in another slot
              list[selSlot] = id;
              showcase.emote(id);
              selSlot = -1;
              try {
                await account.equip({ emotes: list });
              } catch (err) {
                say(err.message, true);
              }
              render();
            },
          })
        );
      }
      const clear = btn('CLEAR SLOT', 'mn-chip');
      clear.addEventListener('click', async () => {
        click();
        const list = eq.emotes.slice();
        list[selSlot] = null;
        selSlot = -1;
        await account.equip({ emotes: list }).catch((err) => say(err.message, true));
        render();
      });
      panelBody.append(pick, clear);
    }
  }

  function renderFriends() {
    panelTitle.textContent = 'FRIENDS';
    if (!account.signedIn) {
      panelBody.appendChild(h('p', 'mt-hint', 'Sign in to add friends, see who is online and invite them to your party.'));
      const b = btn('SIGN IN', 'mn-btn mn-btn-hero');
      b.addEventListener('click', () => {
        click();
        openPanel('auth');
      });
      panelBody.appendChild(b);
      return;
    }
    const form = h('form', 'mt-add');
    const name = h('input', 'mn-field');
    name.placeholder = 'Friend’s username';
    name.maxLength = 16;
    name.spellcheck = false;
    name.setAttribute('aria-label', 'Friend’s username');
    const add = btn('ADD FRIEND', 'mn-btn');
    add.type = 'submit';
    form.append(name, add);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      click();
      const n = name.value.trim();
      if (!n) return name.focus();
      try {
        const text = await account.friendAdd(n);
        say(text || 'Request sent.');
        name.value = '';
      } catch (err) {
        say(err.message, true);
      }
    });
    panelBody.appendChild(form);

    const f = account.friends;
    if (f.incoming.length) {
      panelBody.appendChild(h('div', 'mn-party-label mt-sub', 'REQUESTS'));
      for (const n of f.incoming) {
        const row = h('div', 'mt-friend');
        row.appendChild(h('b', null, n));
        const yes = btn('ACCEPT', 'mn-chip mt-chip-sun');
        const no = btn('DECLINE', 'mn-chip mn-chip-danger');
        yes.addEventListener('click', () => friendDo(() => account.friendAccept(n)));
        no.addEventListener('click', () => friendDo(() => account.friendDecline(n)));
        row.append(yes, no);
        panelBody.appendChild(row);
      }
    }
    panelBody.appendChild(h('div', 'mn-party-label mt-sub', `FRIENDS · ${f.list.filter((x) => x.online).length} ONLINE`));
    if (!f.list.length) panelBody.appendChild(h('p', 'mt-hint', 'No friends yet. Add someone by their username above.'));
    const code = opts.partyCode ? opts.partyCode() : null;
    for (const fr of f.list) {
      const row = h('div', 'mt-friend' + (fr.online ? ' is-online' : ''));
      const dot = h('i', 'mt-dot');
      const info = h('span', 'mt-friend-info');
      info.append(h('b', null, fr.name), h('small', null, !fr.online ? 'Offline' : fr.status === 'match' ? 'In a match' : fr.party ? `In the lobby · party ${fr.party}` : 'In the lobby'));
      row.append(dot, info);
      if (fr.online && code && fr.party !== code) {
        const inv = btn('INVITE', 'mn-chip mt-chip-sun');
        inv.addEventListener('click', () => friendDo(async () => (await account.invite(fr.name, code), `Invite sent to ${fr.name}.`)));
        row.appendChild(inv);
      }
      if (fr.online && fr.party && fr.party !== code && fr.status !== 'match') {
        const join = btn('JOIN', 'mn-chip');
        join.addEventListener('click', () => {
          click();
          if (opts.onJoinParty) opts.onJoinParty(fr.party);
          closePanel();
        });
        row.appendChild(join);
      }
      const rm = btn('✕', 'mn-chip mt-x');
      rm.title = `Remove ${fr.name}`;
      rm.setAttribute('aria-label', `Remove ${fr.name}`);
      rm.addEventListener('click', () => {
        if (rm.dataset.sure) friendDo(() => account.friendRemove(fr.name));
        else {
          rm.dataset.sure = '1';
          rm.querySelector('span').textContent = 'REMOVE?';
        }
      });
      row.appendChild(rm);
      panelBody.appendChild(row);
    }
    if (f.outgoing.length) {
      panelBody.appendChild(h('div', 'mn-party-label mt-sub', 'SENT'));
      for (const n of f.outgoing) {
        const row = h('div', 'mt-friend');
        row.append(h('b', null, n), h('small', null, 'Waiting for them to accept'));
        const cancel = btn('CANCEL', 'mn-chip');
        cancel.addEventListener('click', () => friendDo(() => account.friendRemove(n)));
        row.appendChild(cancel);
        panelBody.appendChild(row);
      }
    }
  }

  async function friendDo(fn) {
    click();
    try {
      const text = await fn();
      if (typeof text === 'string' && text) say(text);
    } catch (err) {
      say(err.message, true);
    }
    if (open === 'friends') render();
  }

  // ---------------------------------------------------------------- toasts (invites, requests)
  const toasts = h('div', 'mt-toasts');
  toasts.setAttribute('aria-live', 'polite');
  menus.el.appendChild(toasts);
  function toast(text, actions = []) {
    const t = h('div', 'mt-toast');
    t.appendChild(h('span', null, text));
    for (const [label, fn, cls] of actions) {
      const b = btn(label, 'mn-chip ' + (cls || ''));
      b.addEventListener('click', () => {
        click();
        fn();
        t.remove();
      });
      t.appendChild(b);
    }
    const x = btn('✕', 'mn-chip mt-x');
    x.setAttribute('aria-label', 'Dismiss');
    x.addEventListener('click', () => t.remove());
    t.appendChild(x);
    toasts.appendChild(t);
    setTimeout(() => t.remove(), 20000);
  }

  account.on('invite', ({ from, code }) => {
    toast(`${from} invited you to their party`, [['JOIN', () => opts.onJoinParty && opts.onJoinParty(code), 'mt-chip-sun']]);
  });
  account.on('request', (from) => {
    toast(`${from} sent you a friend request`, [
      ['ACCEPT', () => account.friendAccept(from).catch(() => {}), 'mt-chip-sun'],
      ['VIEW', () => openPanel('friends')],
    ]);
  });
  account.on('friends', () => {
    renderBar();
    if (open === 'friends') render();
  });
  account.on('change', () => {
    boardCache = null; // refresh RANKS after match rewards update stats
    renderBar();
    lineUp();
    renderEmoteBar();
    if (open && open !== 'auth') render();
    if (opts.onCosmetics) opts.onCosmetics({ ...account.profile.equipped });
    if (!account.profile.guest && opts.onName) opts.onName(account.profile.name);
  });

  function renderBar() {
    const p = account.profile;
    whoName.textContent = p.guest ? 'GUEST' : p.name;
    whoSub.textContent = p.guest ? 'Sign in for coins & skins' : `${p.stats.wins} wins · ${p.stats.kills} elims`;
    coinsNum.textContent = p.coins.toLocaleString();
    bAuth.querySelector('span').textContent = account.signedIn ? 'SIGN OUT' : 'SIGN IN';
    bAuth.classList.toggle('mt-chip-sun', !account.signedIn);
    const n = account.friends.incoming.length;
    badge.textContent = n ? String(n) : '';
    badge.hidden = !n;
  }

  function checkRename() {
    if (mustRename()) {
      if (open !== 'rename' && open !== 'signout') openPanel('rename');
    } else if (open === 'rename') {
      closePanel();
    }
  }
  account.on('change', checkRename);
  menus.onNeedRename = () => openPanel('rename');

  renderBar();
  lineUp();
  renderEmoteBar();
  checkRename();

  return {
    refresh() {
      lineUp();
      if (open === 'friends') render();
    },
    setActive(on) {
      showcase.setActive(on);
      if (!on && open) closePanel();
    },
    matchReward(n, note) {
      if (n > 0) toast(`+${n} coins for that match`, [['SHOP', () => openPanel('shop'), 'mt-chip-sun']]);
      else if (note) toast(note, account.signedIn ? [] : [['SIGN IN', () => openPanel('auth'), 'mt-chip-sun']]);
    },
    openPanel,
    setOnline(snap) {
      online = snap || null;
      renderOnlineChip();
      if (open === 'online') render();
    },
  };
}
