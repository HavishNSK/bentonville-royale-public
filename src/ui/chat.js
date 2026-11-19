// BENTONVILLE ROYALE — global chat UI (messages come from src/net/Presence.js; the server in
// party/presence.js filters and rate-limits them).
//
//   const chat = createChat({ onSend(text) -> bool, onTypingChange(typing) })
//   chat.add({ id, name, text, at })     a message (rendered as text, never HTML)
//   chat.system(text)                    a grey local line (errors, offline)
//   chat.mod(lines, ok)                  private answer to a dev moderation command (/ban, /flags, ...)
//   chat.setOnline(on)                   status dot
//   chat.setMe(name)                     our own name (highlighted)
//   chat.setMode('lobby' | 'match')      docked panel / fading in-match feed (Enter to type)
//   chat.typing                          true while the in-match input is open
//   chat.setFull(on)                     lobby only: the chat fills the window (Full button, Esc exits)
//
// The open / collapsed choice is remembered in localStorage (per browser).

import { cleanChat, CHAT_MAX } from '../net/chatFilter.js';
import { parseModCommand } from '../net/devs.js';
import './chat.css';

const KEEP = 80; // messages kept in the list
const FADE_MS = 9000; // in a match, a message fades after this
const STORE = 'br.chat.collapsed';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function createChat({ onSend = () => false, onBlocked = () => {}, onTypingChange = () => {} } = {}) {
  const root = el('div', 'br-chat');
  root.setAttribute('aria-label', 'Global chat');
  const box = el('div', 'br-chat-box');
  const head = el('div', 'br-chat-head');
  const dot = el('span', 'br-chat-dot');
  const title = el('span', 'br-chat-title', 'GLOBAL CHAT');
  const unread = el('span', 'br-chat-unread');
  const fullBtn = el('button', 'br-chat-toggle br-chat-full', 'Full screen');
  fullBtn.type = 'button';
  fullBtn.setAttribute('aria-pressed', 'false');
  const toggle = el('button', 'br-chat-toggle', 'Hide');
  toggle.type = 'button';
  head.append(dot, title, unread, fullBtn, toggle);
  const list = el('div', 'br-chat-list');
  list.setAttribute('role', 'log');
  list.setAttribute('aria-live', 'polite');
  const form = el('form', 'br-chat-form');
  const input = el('input', 'br-chat-input');
  input.type = 'text';
  input.maxLength = CHAT_MAX;
  input.autocomplete = 'off';
  input.spellcheck = true;
  input.placeholder = 'Say something nice…';
  input.setAttribute('aria-label', 'Chat message');
  const send = el('button', 'br-chat-send', 'SEND');
  send.type = 'submit';
  form.append(input, send);
  const err = el('div', 'br-chat-err');
  err.setAttribute('role', 'status');
  const hint = el('div', 'br-chat-hint', '[Enter] chat');
  box.append(head, list, form, err);
  root.append(box, hint);
  document.body.appendChild(root);

  let mode = 'lobby';
  let me = '';
  let typing = false;
  let unreadN = 0;
  let collapsed = false;
  let full = false;
  try {
    collapsed = localStorage.getItem(STORE) === '1';
  } catch {
    /* storage blocked */
  }
  const applyCollapsed = () => {
    root.classList.toggle('is-collapsed', collapsed);
    toggle.textContent = collapsed ? 'Show' : 'Hide';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    if (!collapsed) {
      unreadN = 0;
      unread.textContent = '';
      list.scrollTop = list.scrollHeight;
    }
  };
  applyCollapsed();
  // Full screen (lobby only): the chat fills the window; Esc, the button or a click outside exits.
  function setFull(on, refocus = true) {
    on = !!on && mode === 'lobby';
    if (on === full) return;
    full = on;
    if (on && collapsed) {
      collapsed = false;
      applyCollapsed();
    }
    root.classList.toggle('is-full', on);
    root.setAttribute('role', on ? 'dialog' : 'region');
    root.setAttribute('aria-modal', String(on));
    fullBtn.textContent = on ? 'Exit full screen' : 'Full screen';
    fullBtn.setAttribute('aria-pressed', String(on));
    list.scrollTop = list.scrollHeight;
    if (on) setTimeout(() => input.focus(), 0);
    else if (refocus) fullBtn.focus(); // never when a match starts: Space would press it
  }
  fullBtn.addEventListener('click', () => setFull(!full));
  root.addEventListener('click', (e) => {
    if (full && e.target === root) setFull(false);
  });
  window.addEventListener('keydown', (e) => {
    if (full && e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setFull(false);
    }
  });

  toggle.addEventListener('click', () => {
    if (full) setFull(false);
    collapsed = !collapsed;
    try {
      localStorage.setItem(STORE, collapsed ? '1' : '0');
    } catch {
      /* storage blocked */
    }
    applyCollapsed();
  });

  const atBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 24;
  function push(node) {
    const stick = atBottom();
    list.appendChild(node);
    while (list.children.length > KEEP) list.firstChild.remove();
    if (stick || mode === 'match') list.scrollTop = list.scrollHeight;
    // in a match each line fades on its own after a while
    setTimeout(() => node.classList.add('is-old'), FADE_MS);
  }

  function setTyping(on) {
    if (on === typing) return;
    typing = on;
    root.classList.toggle('is-typing', on);
    if (on) {
      err.textContent = '';
      input.value = '';
      for (const n of list.children) n.classList.remove('is-old');
      setTimeout(() => input.focus(), 0);
    } else {
      input.blur();
      for (const n of list.children) n.classList.add('is-old');
    }
    onTypingChange(on);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = input.value;
    if (!raw.trim()) {
      if (mode === 'match') setTyping(false);
      return;
    }
    // Dev moderation commands skip the local filter (a ban reason may quote what was said).
    // The server only accepts them from a verified dev account and never broadcasts them.
    const r = parseModCommand(raw) ? { ok: true, text: raw.trim().slice(0, CHAT_MAX) } : cleanChat(raw);
    if (!r.ok) {
      // not kid-friendly: never sent; the server only hears the rule it broke (repeat offenders get paused)
      err.textContent = r.reason === 'empty' ? '' : r.reason;
      if (r.category) onBlocked(r.category);
      return;
    }
    if (!onSend(r.text)) {
      err.textContent = 'Chat is offline right now.';
      return;
    }
    err.textContent = '';
    input.value = '';
    if (mode === 'match') setTyping(false);
  });
  // keys typed into the box never reach the game (Input listens on window)
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.code === 'Escape') {
      e.preventDefault();
      if (mode === 'match') setTyping(false);
      else if (full) setFull(false);
      else input.blur();
    }
  });
  input.addEventListener('keyup', (e) => e.stopPropagation());
  // in a match: Enter opens the box
  window.addEventListener('keydown', (e) => {
    if (mode !== 'match' || typing || collapsed || e.repeat) return;
    if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    setTyping(true);
  });

  return {
    el: root,
    get typing() {
      return typing;
    },
    add(m) {
      const dev = !!m.dev;
      const titled = !dev && !!m.title; // a verified account title (devs.js PLAYER_TITLES)
      const row = el('div', 'br-chat-msg' + (me && m.name === me ? ' is-me' : '') + (dev ? ' is-dev' : '') + (titled ? ' has-title' : '') + (m.announce ? ' is-announce' : ''));
      if (m.announce) row.append(el('span', 'br-chat-ann', 'ANNOUNCEMENT'));
      const name = el('span', 'br-chat-name', dev ? `[DEV] ${m.name}` : titled ? null : m.name);
      if (titled) {
        // title and username can have their own colours (#rrggbb, checked in Presence.js)
        const tag = el('span', 'br-chat-tag', `[${m.title}] `);
        const who = el('span', null, m.name);
        if (m.color) tag.style.color = m.color;
        if (m.nameColor || m.color) who.style.color = m.nameColor || m.color;
        name.append(tag, who);
      }
      row.append(name, document.createTextNode(m.text));
      push(row);
      if (collapsed && mode === 'lobby') {
        unreadN++;
        unread.textContent = unreadN > 99 ? '99+' : String(unreadN);
      }
    },
    system(text) {
      push(el('div', 'br-chat-msg br-chat-sys', text));
    },
    mod(lines, ok) {
      for (const line of lines.length ? lines : ['Done.']) push(el('div', 'br-chat-msg br-chat-mod' + (ok ? '' : ' is-bad'), line));
    },
    error(text) {
      err.textContent = text;
      if (mode === 'match' && !typing) this.system(text);
    },
    setOnline(on) {
      root.classList.toggle('is-online', !!on);
      send.disabled = !on;
      input.placeholder = on ? 'Say something nice…' : 'Chat is offline';
    },
    setMe(name) {
      me = name || '';
    },
    setMode(next) {
      if (next === mode) return;
      if (typing) setTyping(false);
      if (full) setFull(false, false);
      mode = next;
      root.classList.toggle('is-match', mode === 'match');
      for (const n of list.children) n.classList.toggle('is-old', mode === 'match');
      list.scrollTop = list.scrollHeight;
    },
    close() {
      setTyping(false);
      setFull(false, false);
    },
    setFull: (on) => setFull(on),
  };
}
