/**
 * Email Validation
 *
 * RFC-compliant email validation with disposable domain detection
 * and role-account flagging. Used before sending any outbound email.
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface EmailValidationResult {
  valid: boolean;
  reason?: 'invalid_format' | 'too_long' | 'disposable_domain' | 'role_account' | 'missing';
}

// ─── Constants ───────────────────────────────────────────────────────

/**
 * RFC 5322 simplified email regex.
 * Covers: local part (alphanumeric, dots, special chars), @ symbol, domain with TLD.
 * Does NOT allow: consecutive dots, leading/trailing dots in local part.
 */
const EMAIL_REGEX = /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~.-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

/** Known disposable email domains. */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwaway.email',
  'sharklasers.com', 'guerrillamailblock.com', 'grr.la', 'guerrillamail.info',
  'guerrillamail.biz', 'guerrillamail.de', 'guerrillamail.net',
  'yopmail.com', 'yopmail.fr', 'cool.fr.nf', 'jetable.fr.nf',
  'trashmail.com', 'trashmail.me', 'trashmail.net', 'trashmail.org',
  'dispostable.com', 'maildrop.cc', 'mailnesia.com', 'tempail.com',
  'fakeinbox.com', 'getnada.com', 'inboxbear.com', 'mailcatch.com',
  'mailexpire.com', 'mailforspam.com', 'mailinater.com', 'mohmal.com',
  'spamgourmet.com', 'temp-mail.org', 'tempinbox.com', 'tempmailo.com',
  'tempomail.fr', 'temporaryemail.net', 'trash-mail.com', '10minutemail.com',
  'minutemail.com', 'discard.email', 'emailondeck.com',
]);

/** Role-based prefixes — these are functional addresses, not personal. */
const ROLE_PREFIXES = [
  'info', 'sales', 'admin', 'noreply', 'no-reply', 'support', 'help',
  'contact', 'webmaster', 'postmaster', 'hostmaster', 'abuse',
  'billing', 'marketing', 'team', 'hello', 'office', 'feedback',
];

// ─── Validators ──────────────────────────────────────────────────────

/** Check if an email address is syntactically valid (RFC 5322 simplified). */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  if (email.length > 254) return false; // RFC 5321 max length
  const localPart = email.split('@')[0];
  if (!localPart || localPart.length > 64) return false; // RFC 5321 local part max
  if (localPart.startsWith('.') || localPart.endsWith('.')) return false;
  if (localPart.includes('..')) return false;
  return EMAIL_REGEX.test(email);
}

/** Full validation: format + disposable domain + role account detection. */
export function validateEmail(email: string): EmailValidationResult {
  if (!email || typeof email !== 'string') {
    return { valid: false, reason: 'missing' };
  }

  const trimmed = email.trim().toLowerCase();

  if (trimmed.length > 254) {
    return { valid: false, reason: 'too_long' };
  }

  if (!isValidEmail(trimmed)) {
    return { valid: false, reason: 'invalid_format' };
  }

  const domain = trimmed.split('@')[1];
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { valid: false, reason: 'disposable_domain' };
  }

  const localPart = trimmed.split('@')[0];
  if (ROLE_PREFIXES.some((prefix) => localPart === prefix)) {
    return { valid: false, reason: 'role_account' };
  }

  return { valid: true };
}
