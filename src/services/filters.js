'use strict';

const config = require('../config');

/**
 * Post-processing filters to suppress hallucinated / junk transcript that can
 * slip through even with VAD (silence, music, applause, mic bumps, feedback).
 *
 * These run ONLY on FINAL segments before persistence/broadcast. The goal is
 * to drop meaningless output without discarding genuine short utterances.
 */

// Common ASR/LLM hallucination phrases (silence/music tends to produce these).
const HALLUCINATION_PATTERNS = [
  /^thanks? for watching[.!]?$/i,
  /^thank you[.!]?$/i,
  /^please subscribe[.!]?$/i,
  /^subscribe[.!]?$/i,
  /^you[.!]?$/i,
  /^bye[.!]?$/i,
  /^\[.*\]$/, // bracketed sound tags like [music], [applause]
  /^\(.*\)$/, // parenthetical tags
  /^altyaz[ıi].*$/i, // "Altyazı M.K." style Turkish subtitle credits
  /^abone ol.*$/i,
  /^izlediğiniz için teşekkür.*$/i,
  /^müzik$/i,
  /^music$/i,
  /^applause$/i,
  /^alkış$/i,
];

function normalize(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

/**
 * @returns {{ ok: boolean, reason?: string, text: string }}
 */
function acceptFinalSegment(rawText) {
  const text = normalize(rawText);

  if (!text) return { ok: false, reason: 'empty', text };
  if (text.length < config.filters.minChars) {
    return { ok: false, reason: 'too_short', text };
  }

  const words = text.split(/\s+/).filter(Boolean);
  if (config.filters.minWords > 0 && words.length < config.filters.minWords) {
    return { ok: false, reason: 'too_few_words', text };
  }

  // Reject strings with no letters/digits at all (pure punctuation / noise).
  if (!/[\p{L}\p{N}]/u.test(text)) {
    return { ok: false, reason: 'no_alphanumeric', text };
  }

  // Reject a single repeated character ("aaaaaa", "......").
  if (/^(.)\1+$/u.test(text.replace(/\s/g, ''))) {
    return { ok: false, reason: 'repeated_char', text };
  }

  for (const pattern of HALLUCINATION_PATTERNS) {
    if (pattern.test(text)) {
      return { ok: false, reason: 'hallucination_phrase', text };
    }
  }

  return { ok: true, text };
}

module.exports = { acceptFinalSegment, normalize };
