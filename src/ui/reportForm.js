// BENTONVILLE ROYALE — "Report a player" dialog (lobby ONLINE list, pause menu).
//
//   const report = createReportForm(menusRoot, account, { onClick })
//   report.open({ name? })     opens the dialog (name prefilled when known)
//
// Reports go to the account server (party/accounts.js `report`) and are private: only developers
// read them in chat (/reports, /history) and decide whether to /ban. Signed-in players only.
// Everything is rendered as text; the note is checked again on the server.

import { REPORT_REASONS, REPORT_NOTE_MAX } from '../../party/moderation.js';
import './reportForm.css';

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function createReportForm(root, account, { onClick = () => {} } = {}) {
  const dlg = h('dialog', 'rp-dialog');
  dlg.setAttribute('aria-labelledby', 'rp-title');
  const card = h('form', 'mn-card rp-card');
  card.method = 'dialog';
  const title = h('h2', 'mn-h rp-title', 'REPORT A PLAYER');
  title.id = 'rp-title';
  const intro = h('p', 'rp-hint', 'Only the developers see reports. They check them and decide on a ban. False reports can get you banned too.');

  const nameLabel = h('label', 'rp-label', 'Username');
  const name = h('input', 'mn-field rp-input');
  name.autocomplete = 'off';
  name.maxLength = 16;
  name.required = true;
  name.placeholder = 'Their username';
  nameLabel.appendChild(name);

  const reasonSet = h('fieldset', 'rp-reasons');
  reasonSet.appendChild(h('legend', 'rp-label', 'Reason'));
  for (const [id, label] of Object.entries(REPORT_REASONS)) {
    const opt = h('label', 'rp-reason');
    const radio = h('input');
    radio.type = 'radio';
    radio.name = 'rp-reason';
    radio.value = id;
    opt.append(radio, h('span', null, label));
    reasonSet.appendChild(opt);
  }

  const noteLabel = h('label', 'rp-label', 'What happened? (optional)');
  const note = h('textarea', 'mn-field rp-note');
  note.maxLength = REPORT_NOTE_MAX;
  note.rows = 3;
  note.placeholder = 'e.g. teleported across the map, took no damage';
  noteLabel.appendChild(note);

  const msg = h('p', 'rp-msg');
  msg.setAttribute('role', 'status');
  const row = h('div', 'rp-actions');
  const cancel = h('button', 'mn-btn mn-btn-small', 'CANCEL');
  cancel.type = 'button';
  const send = h('button', 'mn-btn mn-btn-hero', 'SEND REPORT');
  send.type = 'submit';
  row.append(cancel, send);
  card.append(title, intro, nameLabel, reasonSet, noteLabel, msg, row);
  dlg.appendChild(card);
  root.appendChild(dlg);

  // typing here never reaches the game (Input listens on window)
  for (const ev of ['keydown', 'keyup']) dlg.addEventListener(ev, (e) => e.stopPropagation());
  const say = (text, bad) => {
    msg.textContent = text;
    msg.classList.toggle('is-bad', !!bad);
  };
  const close = () => {
    if (dlg.open) dlg.close();
  };
  cancel.addEventListener('click', () => {
    onClick();
    close();
  });
  // a click on the backdrop closes it
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close();
  });

  let busy = false;
  card.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    onClick();
    const picked = card.querySelector('input[name="rp-reason"]:checked');
    if (!picked) return say('Pick a reason.', true);
    if (!account.signedIn) return say('Sign in to send reports.', true);
    busy = true;
    send.disabled = true;
    say('Sending…');
    try {
      const text = await account.report(name.value.trim(), picked.value, note.value);
      say(text || 'Report sent. Thanks!');
      note.value = '';
      setTimeout(close, 1600);
    } catch (err) {
      say(err && err.message ? err.message : 'Could not send the report.', true);
    } finally {
      busy = false;
      send.disabled = false;
    }
  });

  return {
    open({ name: who = '' } = {}) {
      name.value = String(who || '').slice(0, 16);
      note.value = '';
      for (const r of card.querySelectorAll('input[name="rp-reason"]')) r.checked = false;
      say(account.signedIn ? '' : 'Sign in to send reports.', !account.signedIn);
      send.disabled = !account.signedIn;
      if (!dlg.open) dlg.showModal();
      (who ? reasonSet.querySelector('input') : name).focus();
    },
    close,
  };
}
