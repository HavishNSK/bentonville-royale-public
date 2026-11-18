// BENTONVILLE ROYALE — Crystal Bridges gallery DOM: caption, info panel, veil, vignette, banner.
// Port of musewalk src/ui.js (MIT License, Copyright (c) 2026 Musewalk contributors). All text
// goes through textContent (titles, artists and descriptions come from a JSON config and
// Commons metadata: data, never markup).

import './gallery.css';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}

export function createGalleryUI(parent = document.body) {
  const root = el('div', 'cbg');
  root.setAttribute('aria-live', 'polite');
  const vignette = el('div', 'vignette');
  const veil = el('div', 'veil');
  const caption = el('div', 'caption');
  const capT = el('div', 'cap-t');
  const capS = el('div', 'cap-s');
  const capK = el('div', 'cap-k');
  caption.append(capT, capS, capK);
  const panel = el('aside', 'panel');
  panel.setAttribute('aria-label', 'Painting details');
  const entering = el('div', 'entering');
  entering.append(el('div', 'e-k', 'NOW ENTERING'), el('div', 'e-t', 'CRYSTAL BRIDGES'), el('div', 'e-s', 'Museum of American Art'));
  const hint = el('div', 'hint');
  root.append(vignette, caption, panel, entering, hint, veil);
  parent.appendChild(root);

  let enterT = null;
  let hintT = null;
  let shownKey = null;

  return {
    root,
    /** Interior mood 0..1 (musewalk .vignette under the gallery lighting). */
    setVignette(k, deep = false) {
      vignette.classList.toggle('deep', deep);
      vignette.style.opacity = String(Math.max(0, Math.min(1, deep ? 1 : k)));
    },
    caption(data, key = 'E') {
      if (!data) {
        caption.classList.remove('show');
        shownKey = null;
        return;
      }
      const id = data.title + '|' + data.artist;
      if (shownKey !== id) {
        capT.textContent = data.title;
        capS.textContent = [data.artist, data.year].filter(Boolean).join(' · ');
        capK.textContent = '';
        shownKey = id;
      }
      caption.classList.add('show');
    },
    /** musewalk ui.panel(entry): staggered reveal of the work's details. */
    panel(p, opts = {}) {
      panel.textContent = '';
      panel.classList.remove('show');
      if (!p) return;
      const scroll = el('div', 'p-scroll');
      panel.appendChild(scroll);
      let i = 0;
      const add = (node) => {
        node.classList.add('reveal');
        node.style.setProperty('--i', i++);
        scroll.appendChild(node);
        return node;
      };
      add(el('div', 'p-hall', `${p.wingNo || ''} · ${p.wingName || ''}`));
      add(el('h1', 'p-title', p.title));
      if (p.artist) add(el('div', 'p-orig', p.artist));
      const meta = el('div', 'p-meta', [p.year, p.placeholder ? 'Not reproduced' : null].filter(Boolean).join(' · '));
      meta.append(document.createElement('br'), document.createTextNode('Crystal Bridges Museum of American Art'));
      add(meta);
      add(el('div', 'p-rule'));
      if (p.desc) add(el('p', 'p-desc', p.desc));
      add(el('div', 'p-artist-label', 'SOURCE'));
      add(el('div', 'p-artist-name', p.placeholder ? 'Label only' : p.license || 'Public domain'));
      add(el('div', 'p-credit', p.credit || ''));
      const actions = el('div', 'p-actions');
      if (p.portal) actions.appendChild(el('div', 'p-enter', 'Walk Into the Painting'));
      actions.appendChild(el('div', 'p-close', `[${opts.key || 'E'}] Back`));
      panel.appendChild(actions);
      if (p.line) panel.appendChild(el('div', 'p-poem', p.line));
      void panel.offsetWidth; // reflow to replay the reveal (musewalk)
      panel.classList.add('show');
    },
    /** White veil (#f6f1e6) over `dur` ms, as musewalk's step-into-painting transition. */
    veil(on, dur = 800) {
      veil.style.transitionDuration = dur + 'ms';
      veil.style.opacity = on ? '1' : '0';
    },
    entering(on) {
      clearTimeout(enterT);
      entering.classList.toggle('show', !!on);
      if (on) enterT = setTimeout(() => entering.classList.remove('show'), 3600);
    },
    hint(text, ms = 4000) {
      clearTimeout(hintT);
      if (!text) return hint.classList.remove('show');
      hint.textContent = text;
      hint.classList.add('show');
      hintT = setTimeout(() => hint.classList.remove('show'), ms);
    },
    dispose() {
      root.remove();
    },
  };
}
