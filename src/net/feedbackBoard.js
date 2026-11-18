// Shared suggestion-board helpers (party/accounts.js is the authority).
// Existing posts stay on the `fb:` keys; replies are an optional array on the same record.

import { isDevName } from './devs.js';
import { moderate } from './chatFilter.js';

export const FEEDBACK_MAX = 500;
export const MAX_REPLIES = 30;

/** The two board kinds. Anything else (including posts saved without a kind) is a suggestion. */
export const FEEDBACK_KINDS = Object.freeze(['idea', 'bug']);

export function feedbackKind(raw) {
  return raw === 'bug' ? 'bug' : 'idea';
}

/** Title-screen tab -> board kind. SUGGEST shows ideas, REPORT A BUG shows bugs. */
export const FEEDBACK_TAB_KIND = Object.freeze({ feedback: 'idea', bugs: 'bug' });

/** Posts for one tab, most upvoted first (newest breaks ties). Does not mutate the input. */
export function boardPosts(items, kind) {
  const want = feedbackKind(kind);
  return (Array.isArray(items) ? items : [])
    .filter((it) => it && feedbackKind(it.kind) === want)
    .sort((a, b) => (b.votes | 0) - (a.votes | 0) || (Number(b.at) || 0) - (Number(a.at) || 0));
}

export function canModerateFeedback(name) {
  return isDevName(name);
}

/** Strip private fields. Posts written before replies still list. */
export function publicItem(item) {
  if (!item || typeof item !== 'object') return null;
  const replies = Array.isArray(item.replies) ? item.replies.map(publicReply).filter(Boolean).slice(0, MAX_REPLIES) : [];
  return {
    id: String(item.id || ''),
    kind: feedbackKind(item.kind),
    text: String(item.text || '').slice(0, FEEDBACK_MAX),
    by: String(item.by || 'Guest').slice(0, 16),
    at: Number(item.at) || 0,
    votes: Math.max(0, item.votes | 0),
    replies,
  };
}

function publicReply(r) {
  if (!r || typeof r !== 'object' || !r.id || !r.text) return null;
  return {
    id: String(r.id).replace(/[^a-z0-9]/gi, '').slice(0, 24),
    text: String(r.text).slice(0, FEEDBACK_MAX),
    by: String(r.by || 'Guest').slice(0, 16),
    at: Number(r.at) || 0,
  };
}

export function sanitizeFeedbackText(raw) {
  const text = String(raw || '')
    .replace(/[\u0000-\u0008\u000b-\u001f<>]/g, '')
    .trim()
    .slice(0, FEEDBACK_MAX);
  if (text.length < 4) return { ok: false, reason: 'Write a few words first.' };
  const category = moderate(text);
  if (category) return { ok: false, reason: 'That is not allowed on the board.', category };
  return { ok: true, text };
}

export function addReply(item, reply) {
  const pub = publicReply(reply);
  if (!pub) return { error: 'Write a few words first.' };
  const replies = Array.isArray(item.replies) ? item.replies.slice() : [];
  if (replies.length >= MAX_REPLIES) return { error: 'This thread is full.' };
  replies.push(pub);
  return { item: { ...item, replies } };
}

export function removeReply(item, replyId) {
  const id = String(replyId || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
  const replies = Array.isArray(item.replies) ? item.replies : [];
  const next = replies.filter((r) => r.id !== id);
  if (next.length === replies.length) return { error: 'That reply is gone.' };
  return { item: { ...item, replies: next } };
}
