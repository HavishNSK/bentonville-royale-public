// BENTONVILLE ROYALE — Box Fights lobby screens (DOM only; wiring in src/ui/boxLobbyFlow.js,
// view models in src/ui/boxLobbyModel.js, styles in boxLobby.css over the menus.css components).
//
//   const ui = createBoxLobbyUI(menus, { onClick, onHover, keyLabel(action), on: { ...handlers } });
//   ui.showHome({ name, nameLocked, outfit: { name, rarity, index, count }, notice, noticeError,
//                 filter, rows, loading, error, joining, joinError, privateOpen })   A+C: lobby browser
//   ui.showSettings({ offline, editing, settings, busy, error })                                   B
//   ui.showCode({ value, error, busy })                                                            D
//   ui.showRoom(view)  view = { code, type, mode, count, hostName, waiting, list (slotListView), start
//                      (startState), countdown, loading, notice, noticeError, in3D }             E
//   ui.setCountdown(seconds)   ui.current -> 'home'|'settings'|'code'|'room'|null
//
// Screens are mounted into the menus layer (menus.mount) so the backdrop, screen switching and
// the meta/ads hooks behave like every other menu. Player names and lobby names come from other
// people: they only ever go through textContent.

import './boxLobby.css';
import { icon } from './icons.js';
import { MODE_LABEL, DIFF_LABEL, LOBBY_MODES, LOBBY_DIFFICULTIES, BOT_TAG, ruleLine, sanitizeCodeInput, countdownLabel } from './boxLobbyModel.js';


/** Tiny DOM helper: h('button.mn-btn', { type: 'button', onclick }, ...children). Strings are text. */
function h(spec, props, ...kids) {
  const [tag, ...cls] = spec.split('.');
  const e = document.createElement(tag || 'div');
  if (cls.length) e.className = cls.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') {
      for (const c of String(v).split(/\s+/)) if (c) e.classList.add(c);
    } else if (k === 'dataset') {
      for (const [dk, dv] of Object.entries(v)) if (dv != null) e.dataset[dk] = dv;
    }
    else if (k === 'html') e.innerHTML = v; // only for our own icon markup
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}

export function createBoxLobbyUI(menus, opts = {}) {
  const on = opts.on || {};
  const fire = (name, ...a) => {
    if (opts.onClick) opts.onClick();
    if (typeof on[name] === 'function') on[name](...a);
  };
  const keyLabel = opts.keyLabel || ((a) => a);

  /** A menu button that plays the usual click / hover sounds. */
  const btn = (cls, label, act, extra = {}) =>
    h(`button.mn-btn${cls ? '.' + cls : ''}`, { type: 'button', onclick: act, onmouseenter: () => opts.onHover && opts.onHover(), ...extra }, ...(Array.isArray(label) ? label : [h('span', null, label)]));

  const screens = {};
  for (const name of ['home', 'settings', 'code', 'room']) {
    const s = h(`section.mn-screen.mn-bf.mn-bf-${name}`, { 'aria-label': `Box Fights ${name}` });
    menus.mount(s, `bf-${name}`);
    screens[name] = s;
  }
  let current = null;

  /** Re-render a screen, keeping keyboard focus on the same control (data-key). */
  function render(name, build, withBg = true) {
    const s = screens[name];
    const active = document.activeElement;
    const key = active && s.contains(active) ? active.dataset.key : null;
    s.replaceChildren(...[].concat(build()).filter(Boolean));
    if (current !== name || menus.current !== `bf-${name}`) {
      menus.showScreen(`bf-${name}`, withBg);
      current = name;
      const first = s.querySelector('[data-autofocus]');
      if (first && !key) requestAnimationFrame(() => first.focus({ preventScroll: true }));
    } else menus.setBackdrop(withBg);
    if (key) {
      const again = s.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (again && !again.disabled) again.focus({ preventScroll: true });
    }
  }

  const status = (text, isError) => h(`p.mn-status${isError ? '.mn-error' : ''}`, { role: isError ? 'alert' : 'status', 'aria-live': 'polite' }, text || '');

  // ---------------------------------------------------------------- A+C: home = public lobby browser
  // Layout (owner direction): name / outfit strip, mode filter row, one framed list panel, then
  // BACK (left) and HOST / PRIVATE LOBBY (right). PRIVATE LOBBY opens a small two-choice modal.
  const PERSON_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="4.6" r="3" fill="currentColor"/><path d="M2.2 15c.4-3.6 2.8-5.6 5.8-5.6s5.4 2 5.8 5.6z" fill="currentColor"/></svg>';
  const FILTERS = [['any', 'ANY'], ...LOBBY_MODES.map((m) => [m, MODE_LABEL[m]])];

  function lobbyRow(r, v) {
    const label = r.joinable ? `Join ${r.name}'s ${r.mode} lobby, ${r.players} of ${r.max} players` : `${r.name}'s ${r.mode} lobby: ${r.status}`;
    return h('li', null,
      h('button.mn-bf-lrow', { type: 'button', class: r.joinable ? '' : 'is-off', disabled: !r.joinable || !!v.joining, 'aria-label': label, onclick: () => fire('join', r.code), dataset: { key: `join-${r.code}` } },
        h('span.mn-bf-pill', null, r.mode),
        h('span.mn-bf-l-name', { title: r.name }, r.name),
        h('span.mn-bf-l-state', null, v.joining === r.code ? 'JOINING…' : r.joinable ? '' : r.status),
        h('span.mn-bf-l-count', null, h('i.mn-bf-person', { html: PERSON_SVG }), r.count),
      ),
    );
  }

  function showHome(v = {}) {
    render('home', () => {
      const rows = v.rows || [];
      let body;
      if (v.loading && !rows.length) body = h('p.mn-bf-panel-msg', { role: 'status' }, 'Looking for lobbies…');
      else if (v.error && !rows.length) body = h('p.mn-bf-panel-msg.mn-error', { role: 'alert' }, v.error);
      else if (!rows.length)
        body = h('div.mn-bf-panel-msg', null, h('p', null, v.filter && v.filter !== 'any' ? `No ${MODE_LABEL[v.filter]} lobbies — Host one!` : 'No lobbies — Host one!'), btn('mn-btn-small', 'HOST A LOBBY', () => fire('hostPublic'), { dataset: { key: 'empty-host' } }));
      else body = h('ul.mn-bf-lobbies', { 'aria-label': 'Public lobbies' }, rows.map((r) => lobbyRow(r, v)));
      const modal = v.privateOpen
        ? h('div.mn-bf-modal', { onclick: (e) => e.target === e.currentTarget && fire('privateClose') },
            h('div.mn-card.mn-card-narrow.mn-bf-dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mn-bf-priv-h', onkeydown: (e) => e.key === 'Escape' && (e.stopPropagation(), fire('privateClose')) },
              h('h2.mn-h.br-ol', { id: 'mn-bf-priv-h' }, 'PRIVATE LOBBY'),
              btn('mn-btn-hero', 'ENTER CODE', () => fire('private'), { dataset: { key: 'p-code', autofocus: '' } }),
              btn('', 'CREATE LOBBY', () => fire('hostPrivate'), { dataset: { key: 'p-create' } }),
              btn('mn-btn-small', 'CANCEL', () => fire('privateClose'), { dataset: { key: 'p-cancel' } }),
            ),
          )
        : null;
      return [
        h('div.mn-bf-browser', { 'aria-hidden': v.privateOpen ? 'true' : null, inert: !!v.privateOpen },
          h('div.mn-bf-strip', null,
            h('h2.mn-bf-title.br-ol', null, 'BOX FIGHTS'),
            btn('mn-bf-bots', 'PLAY WITH BOTS', () => fire('bots'), { dataset: { key: 'bots' } }),
          ),
          h('div.mn-bf-filters', null,
            h('div.mn-bf-filter', { role: 'group', 'aria-label': 'Filter by mode' },
              FILTERS.map(([id, text]) => h('button.mn-bf-ftab', { type: 'button', class: id === (v.filter || 'any') ? 'is-on' : '', 'aria-pressed': String(id === (v.filter || 'any')), onclick: () => fire('filter', id), dataset: { key: `f-${id}`, autofocus: id === (v.filter || 'any') ? '' : null } }, text)),
            ),
            h('button.mn-chip', { type: 'button', onclick: () => fire('refresh'), disabled: !!v.loading, dataset: { key: 'refresh' } }, v.loading ? 'REFRESHING…' : 'REFRESH'),
          ),
          h('section.mn-bf-listpanel', { 'aria-label': 'Public lobbies', 'aria-busy': v.loading ? 'true' : 'false' }, body),
          rows.length && v.error ? status(v.error, true) : null,
          status(v.joinError || v.notice, !!v.joinError || v.noticeError),
          h('div.mn-bf-foot', null,
            btn('mn-bf-outline', [h('span', { html: icon('back') }), h('span', null, 'BACK')], () => fire('back'), { dataset: { key: 'back' } }),
            btn('mn-bf-outline', [h('span', { html: icon('crown') }), h('span', null, 'HOST')], () => fire('hostPublic'), { dataset: { key: 'host' } }),
            btn('mn-btn-hero', [h('span', { html: icon('people') }), h('span', null, 'PRIVATE LOBBY')], () => fire('privateOpen'), { dataset: { key: 'private' } }),
          ),
        ),
        modal,
      ];
    });
    if (v.privateOpen) {
      const f = screens.home.querySelector('.mn-bf-dialog [data-autofocus]');
      if (f && !screens.home.querySelector('.mn-bf-dialog').contains(document.activeElement)) f.focus({ preventScroll: true });
    }
  }

  // ---------------------------------------------------------------- B: host settings
  function seg(label, key, items, value, onPick, { disabled = false } = {}) {
    return h('div.mn-row.mn-bf-row', null,
      h('span', null, label),
      h('div.mn-seg.mn-bf-seg', { role: 'group', 'aria-label': label },
        items.map(([val, text]) =>
          h('button', { type: 'button', class: val === value ? 'is-on' : '', 'aria-pressed': String(val === value), disabled, onclick: () => val !== value && onPick(val), dataset: { key: `${key}-${val}` } }, text),
        ),
      ),
    );
  }

  function showSettings(v = {}) {
    const s = v.settings || {};
    const ffa = s.mode === 'ffa';
    const patch = (p) => fire('change', p);
    render('settings', () => {
      const fill = h('input.mn-toggle', { type: 'checkbox', checked: !!s.fillWithBots, disabled: !!v.busy, dataset: { key: 'fill' } });
      fill.addEventListener('change', () => patch({ fillWithBots: fill.checked }));
      const rounds = s.roundsToWin || 5;
      const title = v.offline ? 'PLAY WITH BOTS' : v.editing ? 'LOBBY SETTINGS' : 'HOST A LOBBY';
      const go = v.offline ? 'START' : v.editing ? 'SAVE' : 'CREATE LOBBY';
      return h('div.mn-card.mn-bf-card', null,
        h('h2.mn-h.br-ol', null, title),
        h('div.mn-bf-modes', { role: 'group', 'aria-label': 'Mode' },
          LOBBY_MODES.map((m) =>
            h('button.mn-bf-mode', { type: 'button', class: m === s.mode ? 'is-on' : '', 'aria-pressed': String(m === s.mode), disabled: !!v.busy, onclick: () => m !== s.mode && patch({ mode: m }), dataset: { key: `mode-${m}`, autofocus: m === s.mode ? '' : null } },
              h('b', null, MODE_LABEL[m]), h('small', null, m === 'ffa' ? '2-6 players' : `${m[0]} per team`)),
          ),
        ),
        ffa ? seg('Players', 'ffa', [2, 3, 4, 5, 6].map((n) => [n, String(n)]), s.maxPlayers, (n) => patch({ maxPlayers: n }), { disabled: !!v.busy }) : null,
        v.offline ? null : seg('Lobby', 'type', [['public', 'PUBLIC'], ['private', 'PRIVATE']], s.type, (t) => patch({ type: t }), { disabled: !!v.busy }),
        v.offline ? null : h('label.mn-row.mn-bf-row', null, h('span', null, 'Fill with bots', h('small.mn-hint', null, s.fillWithBots ? 'Empty slots get bots at start.' : 'Every slot needs a player.')), fill),
        seg('Bot difficulty', 'diff', LOBBY_DIFFICULTIES.map((d) => [d, DIFF_LABEL[d]]), s.botDifficulty, (d) => patch({ botDifficulty: d }), { disabled: !!v.busy }),
        ffa
          ? h('div.mn-row.mn-bf-row', null, h('span', null, 'Rules'), h('b.mn-bf-rule', null, ruleLine(s)))
          : h('div.mn-row.mn-bf-row', null,
              h('span', null, 'Rounds to win'),
              h('div.mn-bf-step', { role: 'group', 'aria-label': 'Rounds to win' },
                h('button.mn-chip', { type: 'button', 'aria-label': 'Fewer rounds', disabled: !!v.busy || rounds <= 1, onclick: () => patch({ roundsToWin: rounds - 1 }), dataset: { key: 'r-' } }, '−'),
                h('b.br-ol', { 'aria-live': 'polite' }, String(rounds)),
                h('button.mn-chip', { type: 'button', 'aria-label': 'More rounds', disabled: !!v.busy || rounds >= 9, onclick: () => patch({ roundsToWin: rounds + 1 }), dataset: { key: 'r+' } }, '+'),
              ),
            ),
        status(v.error, true),
        btn('mn-btn-hero', [h('span', { html: icon('play') }), h('span', null, v.busy ? 'CREATING…' : go)], () => !v.busy && fire('submit'), { disabled: !!v.busy, dataset: { key: 'go' } }),
        btn('mn-btn-small', [h('span', { html: icon('back') }), h('span', null, 'BACK')], () => fire('settingsBack'), { dataset: { key: 'back' } }),
      );
    });
  }

  // ---------------------------------------------------------------- D: enter code
  function showCode(v = {}) {
    render('code', () => {
      const input = h('input.mn-field.mn-code.mn-bf-code-in', { maxLength: 6, value: v.value || '', placeholder: 'BNTV42', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Lobby code', 'aria-invalid': v.error ? 'true' : 'false', disabled: !!v.busy, dataset: { key: 'code', autofocus: '' } });
      input.addEventListener('input', () => {
        const clean = sanitizeCodeInput(input.value);
        if (clean !== input.value) input.value = clean;
        if (on.codeInput) on.codeInput(clean);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') fire('code', input.value);
      });
      return h('div.mn-card.mn-bf-card.mn-card-narrow', null,
        h('h2.mn-h.br-ol', null, 'PRIVATE LOBBY'),
        h('p.mn-bf-lede', null, 'Enter the 6-character code from the host.'),
        input,
        status(v.error, true),
        btn('mn-btn-hero', h('span', null, v.busy ? 'JOINING…' : 'JOIN'), () => fire('code', input.value), { disabled: !!v.busy, dataset: { key: 'go' } }),
        btn('mn-btn-small', [h('span', { html: icon('back') }), h('span', null, 'BACK')], () => fire('codeBack'), { dataset: { key: 'back' } }),
      );
    });
  }

  // ---------------------------------------------------------------- E: lobby room
  const cd = h('div.mn-bf-countdown.br-ol-xl', { role: 'status', 'aria-live': 'assertive' });
  let copyTimer = 0;

  function slotRow(r) {
    const li = h('li', { class: [r.kind === 'human' ? 'is-human' : r.isBot ? 'is-bot' : 'is-open', r.isYou ? 'is-you' : ''].join(' ') });
    const name = h('span.mn-bf-s-name', { title: r.label });
    if (r.isBot) name.append(h('i.mn-bf-bot', { 'aria-label': 'Bot', role: 'img' }, BOT_TAG), ' ');
    name.append(r.label);
    li.append(name);
    const tags = [r.isHost ? 'HOST' : '', r.isYou ? 'YOU' : ''].filter(Boolean).join(' · ');
    if (tags) li.append(h('em', null, tags));
    if (r.canKick) li.append(h('button.mn-chip.mn-chip-danger', { type: 'button', 'aria-label': `Kick ${r.label}`, onclick: () => fire('kick', r.id), dataset: { key: `kick-${r.id}` } }, 'KICK'));
    return li;
  }

  function showRoom(v = {}) {
    const list = v.list || { groups: [] };
    const st = v.start || {};
    render('room', () => {
      const copy = v.type === 'private'
        ? h('button.mn-chip', { type: 'button', onclick: (e) => {
              fire('copy');
              const b = e.currentTarget;
              b.textContent = 'COPIED';
              clearTimeout(copyTimer);
              copyTimer = setTimeout(() => (b.textContent = 'COPY'), 1400);
            }, 'aria-label': `Copy lobby code ${v.code}`, dataset: { key: 'copy' } }, 'COPY')
        : null;
      const top = h('header.mn-bf-top.mn-bf-panel', null,
        h('div.mn-bf-code', null, h('small', null, v.type === 'private' ? 'PRIVATE CODE' : 'PUBLIC LOBBY'), h('b.br-ol', null, v.code || '······'), copy),
        h('div.mn-bf-meta', null, h('span.mn-bf-pill', null, MODE_LABEL[v.mode] || '?'), h('span', { 'aria-label': `${v.count} players` }, h('b', null, v.count || '0/0'), ' PLAYERS'), v.hostName ? h('span.mn-bf-hostname', { title: v.hostName }, 'HOST ', h('b', null, v.hostName)) : null),
      );
      const groups = list.groups.map((g) =>
        h('section.mn-bf-team', { class: g.mine ? 'is-mine' : '', 'aria-label': g.label },
          h('div.mn-bf-team-head', null,
            h('b', null, g.label),
            g.canJoin ? h('button.mn-chip', { type: 'button', onclick: () => fire('team', g.team), dataset: { key: `team-${g.team}` } }, 'SWITCH HERE') : null,
          ),
          h('ul.mn-bf-slots', null, g.slots.map(slotRow)),
        ),
      );
      const hostBtns = list.isHost
        ? [
            btn('mn-btn-hero', [h('span', { html: icon('play') }), h('span', null, 'START')], () => st.enabled && fire('start'), { disabled: !st.enabled, 'aria-describedby': 'mn-bf-why', dataset: { key: 'start' } }),
            btn('mn-btn-small', [h('span', { html: icon('gear') }), h('span', null, 'SETTINGS')], () => fire('roomSettings'), { disabled: !v.waiting, dataset: { key: 'settings' } }),
          ]
        : [];
      const keys = `${keyLabel('moveForward')}${keyLabel('moveLeft')}${keyLabel('moveBack')}${keyLabel('moveRight')}`;
      const side = h('aside.mn-bf-side.mn-bf-panel', { 'aria-label': 'Lobby' },
        h('div.mn-bf-teams', { class: list.ffa ? 'is-ffa' : '' }, groups),
        h('p.mn-status', { id: 'mn-bf-why', role: 'status', 'aria-live': 'polite' }, st.reason || ''),
        status(v.notice, v.noticeError),
        ...hostBtns,
        btn('mn-btn-small.mn-btn-danger', [h('span', { html: icon('back') }), h('span', null, 'LEAVE')], () => fire('leave'), { dataset: { key: 'leave' } }),
      );
      const help = h('p.mn-bf-help.mn-bf-panel', null,
        v.in3D
          ? `Click the arena to walk (${keys}), ${keyLabel('jump')} jumps, hold ${keyLabel('emote')} to emote. Esc frees the mouse.`
          : v.loading || 'Warming up the arena…');
      return [top, side, help, cd];
    }, !v.in3D);
    screens.room.classList.toggle('is-3d', !!v.in3D);
    setCountdown(v.countdown || 0);
  }

  function setCountdown(seconds) {
    const t = countdownLabel(seconds);
    cd.textContent = t;
    cd.classList.toggle('is-on', !!t);
    if (t) {
      cd.classList.remove('is-tick');
      void cd.offsetWidth;
      cd.classList.add('is-tick');
    }
  }

  return {
    showHome,
    showSettings,
    showCode,
    showRoom,
    setCountdown,
    get current() {
      const m = menus.current;
      return m && m.startsWith('bf-') && current === m.slice(3) ? current : null;
    },
  };
}
