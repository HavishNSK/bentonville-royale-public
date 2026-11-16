// BENTONVILLE ROYALE — out-of-match meta screens on the title: account bar, sign in / create
// account, item shop, locker (outfit + emote wheel), friends, party invites, and the 3D
// line-up (Showcase) with lobby emotes.
//
//   const meta = createMeta(menus, account, {
//     partyCode: () => 'ABCD' | null,       // current party (invites)
//     partyMembers: () => [{name, skin, you}],
//     onJoinParty(code),                    // accept an invite / join a friend
//     onCosmetics({ skin, emotes }),        // equipped outfit / wheel changed
//     onName(name),                         // signed in: play under the account name
//     onClick(),
//   });
//   meta.refresh()            // party changed: line-up + invite buttons
//   meta.setActive(on)        // title screen shown / hidden (3D line-up render loop)
//   meta.matchReward(coins)   // "+340 coins" after a match
//
// Panels dock on the right so the line-up stays visible while shopping.
// User text always goes through textContent.

import './meta.css';
import { SKINS, EMOTES, EMOTE_SLOTS, PRICES, featuredToday, skinDef, emoteDef } from '../game/Cosmetics.js';
import { createShowcase } from './Showcase.js';

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
const hexCss = (n) => '#' + n.toString(16).padStart(6, '0');
const SKIN_BASE = { player: '#5b6bb5', bot_a: '#8a96b0', bot_b: '#b06a3c', bot_c: '#6d4fb8' };

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
    const me = { name: account.profile.guest ? '' : account.profile.name, skin: account.profile.equipped.skin, you: true };
    const others = (opts.partyMembers ? opts.partyMembers() : []).filter((m) => !m.you).map((m) => ({ name: m.name, skin: m.skin || 'skin_rogue' }));
    showcase.setMembers([me, ...others]);
  }

  // ---------------------------------------------------------------- account bar
  const bar = h('div', 'mt-bar');
  const who = h('div', 'mt-who');
  const whoName = h('b', 'br-ol');
  const whoSub = h('small');
  who.append(whoName, whoSub);
  const coins = h('div', 'mt-coins');
  coins.title = 'Coins: earn them in matches, spend them in the shop';
  const coinsNum = h('b', 'br-ol', '0');
  coins.append(h('i', 'mt-coin', ''), coinsNum);
  const bShop = btn('SHOP', 'mn-chip mt-chip', 'shop');
  const bLocker = btn('LOCKER', 'mn-chip mt-chip', 'locker');
  const bFriends = btn('FRIENDS', 'mn-chip mt-chip', 'friends');
  const badge = h('em', 'mt-badge');
  bFriends.appendChild(badge);
  const bAuth = btn('SIGN IN', 'mn-chip mt-chip mt-chip-sun', 'auth');
  bar.append(who, coins, bShop, bLocker, bFriends, bAuth);
  titleEl.appendChild(bar);

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

  function openPanel(which) {
    open = which;
    panel.hidden = false;
    titleEl.classList.add('has-meta');
    panel.dataset.kind = which;
    say('');
    render();
    const f = panel.querySelector('input, button:not([data-act=close])');
    if (f) f.focus();
  }
  function closePanel() {
    open = null;
    panel.hidden = true;
    titleEl.classList.remove('has-meta');
    showcase.preview(null);
    selSlot = -1;
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
    if (act === 'auth' && account.signedIn) {
      account.logout();
      closePanel();
      return;
    }
    if (open === act) closePanel();
    else openPanel(act);
  });

  // ---------------------------------------------------------------- renderers
  function render() {
    panelBody.replaceChildren();
    if (open === 'auth') renderAuth();
    else if (open === 'shop') renderShop();
    else if (open === 'locker') renderLocker();
    else if (open === 'friends') renderFriends();
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
    const guest = h('p', 'mt-hint', 'Playing as a guest keeps your coins and items on this device only.');
    panelBody.append(tabs, form, guest);
  }

  function itemCard(id, { owned, equipped, onClick, action }) {
    const s = SKINS[id];
    const e = EMOTES[id];
    const d = s || e;
    const card = h('button', 'mt-item');
    card.type = 'button';
    card.style.setProperty('--rar', RARITY_CSS[d.rarity] || RARITY_CSS.common);
    const art = h('span', 'mt-item-art');
    if (s) {
      art.classList.add('is-skin');
      art.style.setProperty('--skin', s.tint != null ? hexCss(s.tint) : SKIN_BASE[s.model] || '#5b6bb5');
    } else art.classList.add('is-emote');
    const name = h('b', 'mt-item-name', d.name);
    const kind = h('small', 'mt-item-kind', `${d.rarity} ${s ? 'outfit' : 'emote'}`);
    const foot = h('span', 'mt-item-foot');
    if (equipped) foot.textContent = 'EQUIPPED';
    else if (owned) foot.textContent = action || 'OWNED';
    else {
      foot.appendChild(h('i', 'mt-coin'));
      foot.appendChild(document.createTextNode(String(PRICES[id])));
    }
    card.classList.toggle('is-owned', !!owned);
    card.classList.toggle('is-equipped', !!equipped);
    card.append(art, name, kind, foot);
    card.addEventListener('click', () => {
      click();
      onClick();
    });
    return card;
  }

  let pending = null; // shop item awaiting BUY confirm
  function renderShop() {
    panelTitle.textContent = 'ITEM SHOP';
    const p = account.profile;
    const sections = [
      ['FEATURED TODAY', featuredToday(4)],
      ['OUTFITS', Object.keys(SKINS).filter((k) => PRICES[k])],
      ['EMOTES', Object.keys(EMOTES).filter((k) => PRICES[k])],
    ];
    for (const [label, ids] of sections) {
      panelBody.appendChild(h('div', 'mn-party-label mt-sub', label));
      const grid = h('div', 'mt-grid');
      for (const id of ids) {
        grid.appendChild(
          itemCard(id, {
            owned: p.owned.includes(id),
            equipped: p.equipped.skin === id,
            onClick: () => {
              if (SKINS[id]) showcase.preview(id);
              else showcase.emote(id);
              pending = p.owned.includes(id) ? null : id;
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
    if (!pending) {
      bar.appendChild(h('span', 'mt-hint', 'Pick an item to try it on. Earn coins in matches: placing well, eliminations and wins.'));
      return;
    }
    const d = SKINS[pending] || EMOTES[pending];
    const price = PRICES[pending];
    const can = account.profile.coins >= price;
    bar.appendChild(h('b', null, d.name));
    const b = btn(`BUY · ${price}`, 'mn-btn mn-btn-hero mt-buy-go');
    b.disabled = !can;
    b.classList.toggle('is-disabled', !can);
    b.addEventListener('click', async () => {
      click();
      const id = pending;
      b.disabled = true;
      try {
        await account.buy(id);
        say(`${d.name} is yours! Equip it in the Locker.`);
        pending = null;
        render();
      } catch (err) {
        say(err.message, true);
        b.disabled = false;
      }
    });
    bar.appendChild(b);
    if (!can) bar.appendChild(h('small', 'mt-hint', `You need ${price - account.profile.coins} more coins.`));
  }

  let selSlot = -1;
  function renderLocker() {
    panelTitle.textContent = 'LOCKER';
    const p = account.profile;
    panelBody.appendChild(h('div', 'mn-party-label mt-sub', 'OUTFIT'));
    const grid = h('div', 'mt-grid');
    for (const id of Object.keys(SKINS).filter((k) => p.owned.includes(k))) {
      grid.appendChild(
        itemCard(id, {
          owned: true,
          equipped: p.equipped.skin === id,
          action: 'EQUIP',
          onClick: async () => {
            showcase.preview(null);
            try {
              await account.equip({ skin: id });
            } catch (err) {
              say(err.message, true);
            }
            render();
          },
        })
      );
    }
    panelBody.appendChild(grid);

    panelBody.appendChild(h('div', 'mn-party-label mt-sub', 'EMOTE WHEEL'));
    panelBody.appendChild(h('p', 'mt-hint', 'Pick a slot, then an emote. In a match, hold the emote key and flick the mouse (or press 1-6).'));
    const slots = h('div', 'mt-slots');
    for (let i = 0; i < EMOTE_SLOTS; i++) {
      const id = p.equipped.emotes[i];
      const s = h('button', 'mt-slot' + (selSlot === i ? ' is-sel' : ''));
      s.type = 'button';
      s.appendChild(h('kbd', 'br-key', String(i + 1)));
      s.appendChild(h('span', null, id ? emoteDef(id).name : 'Empty'));
      s.setAttribute('aria-pressed', String(selSlot === i));
      s.addEventListener('click', () => {
        click();
        selSlot = selSlot === i ? -1 : i;
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
            equipped: p.equipped.emotes[selSlot] === id,
            action: 'SET',
            onClick: async () => {
              const list = p.equipped.emotes.slice();
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
        const list = p.equipped.emotes.slice();
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
    renderBar();
    lineUp();
    renderEmoteBar();
    if (open && open !== 'auth') render();
    if (opts.onCosmetics) opts.onCosmetics({ skin: account.profile.equipped.skin, emotes: account.profile.equipped.emotes });
    if (!account.profile.guest && opts.onName) opts.onName(account.profile.name);
  });

  function renderBar() {
    const p = account.profile;
    whoName.textContent = p.guest ? 'GUEST' : p.name;
    whoSub.textContent = p.guest ? 'Not signed in' : `${p.stats.wins} wins · ${p.stats.kills} elims`;
    coinsNum.textContent = p.coins.toLocaleString();
    bAuth.querySelector('span').textContent = account.signedIn ? 'SIGN OUT' : 'SIGN IN';
    bAuth.classList.toggle('mt-chip-sun', !account.signedIn);
    const n = account.friends.incoming.length;
    badge.textContent = n ? String(n) : '';
    badge.hidden = !n;
  }

  renderBar();
  lineUp();
  renderEmoteBar();

  return {
    refresh() {
      lineUp();
      if (open === 'friends') render();
    },
    setActive(on) {
      showcase.setActive(on);
      if (!on && open) closePanel();
    },
    matchReward(n) {
      if (n > 0) toast(`+${n} coins for that match`, [['SHOP', () => openPanel('shop'), 'mt-chip-sun']]);
    },
    openPanel,
  };
}
