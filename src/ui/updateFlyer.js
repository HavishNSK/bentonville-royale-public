// BENTONVILLE ROYALE — the update flyer (data: src/data/updateFlyer.js). Opens by itself the
// first time a player reaches the title screen after an update, once per version (stored in
// localStorage, like the patch-notes NEW badge). DOM only; styles in updateFlyer.css.
//
//   const fl = createUpdateFlyer(titleEl, { onNotes, onClick })
//   fl.maybeShow()      // shows it if this version's flyer has not been seen
//   fl.show() / fl.hide()

import { FLYER } from '../data/updateFlyer.js';
import './updateFlyer.css';

export const FLYER_SEEN_KEY = 'bentonville-royale.seenFlyer';

/** Should the flyer for `version` open, given the version last seen (pure; tested)? */
export function shouldShowFlyer(seen, version = FLYER.version) {
  return typeof version === 'string' && version.length > 0 && seen !== version;
}

function readSeen() {
  try {
    return localStorage.getItem(FLYER_SEEN_KEY) || '';
  } catch {
    return '';
  }
}

function markSeen(version) {
  try {
    localStorage.setItem(FLYER_SEEN_KEY, version);
  } catch {
    /* private mode: it may show again next launch */
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function img(src, alt, cls) {
  const i = el('img', cls);
  i.src = src;
  i.alt = alt || '';
  i.decoding = 'async';
  i.loading = 'lazy';
  return i;
}

export function createUpdateFlyer(parent, { onNotes = null, onClick = null } = {}) {
  const f = FLYER;
  const root = el('div', 'ufl');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'ufl-title');

  const card = el('article', 'ufl-card');
  // hero: the roof blast, the headline over it
  const hero = el('header', 'ufl-hero');
  hero.appendChild(img(f.hero.src, f.hero.alt, 'ufl-hero-img'));
  const heroText = el('div', 'ufl-hero-text');
  const kick = el('div', 'ufl-kicker');
  kick.append(el('span', 'ufl-kicker-tag', f.kicker), el('span', 'ufl-kicker-ver', 'v' + f.version));
  const h1 = el('h1', 'ufl-title');
  h1.id = 'ufl-title';
  h1.append(el('span', 'ufl-title-big', f.title[0]), el('span', 'ufl-title-small', f.title[1]));
  heroText.append(kick, h1, el('p', 'ufl-tagline', f.tagline));
  hero.appendChild(heroText);
  card.appendChild(hero);

  const body = el('div', 'ufl-body');
  for (const s of f.sections) {
    const sec = el('section', 'ufl-sec ufl-sec-' + s.id);
    const head = el('div', 'ufl-sec-head');
    head.append(el('span', 'ufl-tag', s.tag), el('h2', 'ufl-sec-title', s.title));
    sec.appendChild(head);
    if (s.items) {
      const grid = el('div', 'ufl-items');
      for (const it of s.items) {
        const c = el('div', 'ufl-item ufl-r-' + it.rarity);
        const pic = el('div', 'ufl-item-pic');
        pic.appendChild(img(it.img, it.name, 'ufl-item-img'));
        c.append(pic, el('div', 'ufl-item-name', it.name), el('p', 'ufl-item-text', it.text));
        grid.appendChild(c);
      }
      sec.appendChild(grid);
    }
    if (s.images || s.bullets) {
      const row = el('div', 'ufl-row' + (s.images && s.images.length === 1 ? ' is-single' : ''));
      if (s.images) {
        const shots = el('div', 'ufl-shots');
        for (const im of s.images) shots.appendChild(img(im.src, im.alt, 'ufl-shot'));
        row.appendChild(shots);
      }
      if (s.bullets) {
        const ul = el('ul', 'ufl-bullets');
        for (const b of s.bullets) ul.appendChild(el('li', null, b));
        row.appendChild(ul);
      }
      sec.appendChild(row);
    }
    body.appendChild(sec);
  }
  card.appendChild(body);

  const foot = el('footer', 'ufl-foot');
  const go = el('button', 'ufl-go', "LET'S GO");
  go.type = 'button';
  const notes = el('button', 'ufl-notes', 'Full patch notes');
  notes.type = 'button';
  foot.append(notes, go);
  card.appendChild(foot);
  const x = el('button', 'ufl-x', '×');
  x.type = 'button';
  x.setAttribute('aria-label', 'Close');
  card.appendChild(x);
  root.appendChild(card);
  parent.appendChild(root);

  let lastFocus = null;
  function hide() {
    if (root.hidden) return;
    root.classList.remove('is-open');
    root.hidden = true;
    document.removeEventListener('keydown', onKey, true);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onKey(e) {
    if (root.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hide();
    } else if (e.key === 'Tab') {
      // keep focus inside the flyer
      const btns = [x, notes, go];
      const i = btns.indexOf(document.activeElement);
      e.preventDefault();
      btns[(i + (e.shiftKey ? btns.length - 1 : 1) + btns.length) % btns.length].focus();
    }
  }
  function show() {
    markSeen(f.version);
    lastFocus = document.activeElement;
    root.hidden = false;
    void root.offsetWidth;
    root.classList.add('is-open');
    card.scrollTop = 0;
    document.addEventListener('keydown', onKey, true);
    go.focus({ preventScroll: true });
  }
  go.addEventListener('click', () => {
    if (onClick) onClick();
    hide();
  });
  x.addEventListener('click', () => {
    if (onClick) onClick();
    hide();
  });
  notes.addEventListener('click', () => {
    if (onClick) onClick();
    hide();
    if (onNotes) onNotes();
  });
  root.addEventListener('click', (e) => {
    if (e.target === root) hide(); // the scrim around the card
  });

  return {
    el: root,
    show,
    hide,
    get open() {
      return !root.hidden;
    },
    /** Shows it once per version (the first title screen after an update). True when shown. */
    maybeShow() {
      if (!shouldShowFlyer(readSeen(), f.version)) return false;
      show();
      return true;
    },
  };
}
