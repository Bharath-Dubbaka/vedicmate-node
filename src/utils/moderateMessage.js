// src/utils/moderateMessage.js
// Basic profanity + spam filter — Layer 1 moderation
// Extend the BLOCKED_TERMS list as needed

const BLOCKED_TERMS = [
  // sexual solicitation
  "onlyfans",
  "cashapp",
  "venmo",
  "paypal me",
  "sugar daddy",
  "sugar baby",
  // spam patterns
  "click here",
  "bit.ly",
  "tinyurl",
  "t.me/",
  "whatsapp.com",
  // add slurs etc here — keeping list clean for commit
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
