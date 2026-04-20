// src/utils/moderateMessage.js
// Basic profanity + spam filter — Layer 1 moderation
// Extend the BLOCKED_TERMS list as needed

const BLOCKED_TERMS = [
    // solicitation
    'onlyfans', 'cashapp', 'venmo', 'paypal me', 'sugar daddy', 'sugar baby',
    'send money', 'wire transfer', 'western union', 'gift card',
    // off-platform contact
    'whatsapp me', 'telegram me', 'snapchat me', 'instagram me',
    'add me on', 'text me at', 'call me at', 'dm me',
    't.me/', 'wa.me/', 'whatsapp.com', 'telegram.org',
    // spam
    'click here', 'bit.ly', 'tinyurl', 'goo.gl', 'shorturl',
    'free money', 'make money', 'earn from home', 'investment opportunity',
    // adult solicitation
    'looking for fun', 'no strings', 'nsa fun', 'hook up', 'hookup',
    'one night', 'friends with benefits', 'fwb',
  ];

const PHONE_REGEX = /(\+?\d[\d\s\-().]{7,}\d)/;
const URL_REGEX = /https?:\/\/[^\s]+/i;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/**
 * Returns { allowed: bool, reason: string|null }
 */
function moderateMessage(text) {
  if (!text || typeof text !== "string")
    return { allowed: false, reason: "Empty message" };

  const lower = text.toLowerCase();

  for (const term of BLOCKED_TERMS) {
    if (lower.includes(term)) {
      return { allowed: false, reason: "Message contains prohibited content" };
    }
  }

  if (URL_REGEX.test(text)) {
    return { allowed: false, reason: "Links are not allowed" };
  }

  if (EMAIL_REGEX.test(text)) {
    return { allowed: false, reason: "Email addresses are not allowed" };
  }

  // Phone numbers — only block if message is SHORT (likely just sharing number)
  // Don't block if it's incidental in a longer message
  if (PHONE_REGEX.test(text) && text.length < 30) {
    return { allowed: false, reason: "Phone numbers are not allowed" };
  }

  return { allowed: true, reason: null };
}

module.exports = { moderateMessage };
