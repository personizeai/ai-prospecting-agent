/**
 * Email HTML Validation & Sanitization
 *
 * Ensures all outgoing HTML emails use only safe, email-client-compatible tags.
 * Strips anything dangerous or unsupported. Always returns a safe-to-send result.
 */

// ─── Allowed Tags ────────────────────────────────────────────────────

const ALLOWED_TAGS = new Set([
  'p', 'b', 'i', 'a', 'br', 'strong', 'em', 'ul', 'ol', 'li',
]);

// Self-closing tags that don't need a closing pair
const SELF_CLOSING = new Set(['br']);

// ─── Types ───────────────────────────────────────────────────────────

export interface HtmlValidationResult {
  valid: boolean;
  sanitized: string;
  errors: string[];
}

// ─── Core Validator ──────────────────────────────────────────────────

/**
 * Validate and sanitize HTML for email bodies.
 *
 * - Strips disallowed tags (keeps their text content)
 * - Strips inline styles and event handlers
 * - Validates <a> tags have href attributes
 * - Auto-wraps bare text in <p> tags
 * - Returns sanitized HTML that is always safe to send
 */
export function validateEmailHtml(html: string): HtmlValidationResult {
  const errors: string[] = [];

  if (!html || !html.trim()) {
    return { valid: false, sanitized: '', errors: ['Empty HTML content'] };
  }

  let sanitized = html;

  // Step 1: Strip inline styles (style="...")
  const stylePattern = /\s+style\s*=\s*"[^"]*"/gi;
  if (stylePattern.test(sanitized)) {
    errors.push('Stripped inline styles');
    sanitized = sanitized.replace(stylePattern, '');
  }

  // Step 2: Strip event handlers (onclick, onload, etc.)
  const eventPattern = /\s+on\w+\s*=\s*"[^"]*"/gi;
  if (eventPattern.test(sanitized)) {
    errors.push('Stripped event handlers');
    sanitized = sanitized.replace(eventPattern, '');
  }

  // Step 3: Strip class and id attributes
  const classIdPattern = /\s+(?:class|id)\s*=\s*"[^"]*"/gi;
  sanitized = sanitized.replace(classIdPattern, '');

  // Step 4: Strip disallowed tags (keep their text content)
  const tagPattern = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
  sanitized = sanitized.replace(tagPattern, (fullMatch, tagName: string) => {
    const lower = tagName.toLowerCase();
    if (ALLOWED_TAGS.has(lower)) {
      return fullMatch;
    }
    errors.push(`Stripped disallowed tag: <${lower}>`);
    // Keep text content by removing the tag but not what's between open/close
    return '';
  });

  // Step 5: Strip <script> and <style> blocks entirely (content included)
  const scriptStylePattern = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
  if (scriptStylePattern.test(sanitized)) {
    errors.push('Stripped <script>/<style> blocks');
    sanitized = sanitized.replace(scriptStylePattern, '');
  }

  // Step 6: Validate <a> tags have href attributes
  const anchorPattern = /<a\b([^>]*)>/gi;
  sanitized = sanitized.replace(anchorPattern, (fullMatch, attrs: string) => {
    if (!/href\s*=\s*"/i.test(attrs)) {
      errors.push('Found <a> tag without href — removed');
      return '';
    }
    // Strip javascript: hrefs
    if (/href\s*=\s*"javascript:/i.test(attrs)) {
      errors.push('Stripped javascript: href');
      return '';
    }
    return fullMatch;
  });

  // Step 7: Auto-wrap bare text in <p> tags
  sanitized = autoWrapParagraphs(sanitized);

  // Step 8: Clean up whitespace
  sanitized = sanitized
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const valid = errors.length === 0;
  return { valid, sanitized, errors };
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Wrap bare text (text not inside any block-level tag) in <p> tags.
 * Leaves already-wrapped content untouched.
 */
function autoWrapParagraphs(html: string): string {
  // If the content already has <p> tags, assume it's structured
  if (/<p[\s>]/i.test(html)) {
    return html;
  }

  // Split by double newlines and wrap each chunk
  const paragraphs = html.split(/\n\n+/).filter((p) => p.trim());
  if (paragraphs.length === 0) return html;

  return paragraphs
    .map((p) => {
      const trimmed = p.trim();
      // Don't wrap if it's already a block element
      if (/^<(?:ul|ol|li|p)\b/i.test(trimmed)) {
        return trimmed;
      }
      // Convert single newlines to <br> within a paragraph
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
}
