import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateEmailHtml } from '../lib/email-html.js';

// ─── Valid HTML ──────────────────────────────────────────────────────

describe('validateEmailHtml — valid HTML', () => {
  it('accepts well-formed HTML with allowed tags', () => {
    const html = '<p>Hi John,</p><p>I noticed your <b>Series B</b> announcement. <a href="https://example.com">Learn more</a>.</p>';
    const result = validateEmailHtml(html);

    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.ok(result.sanitized.includes('<p>'));
    assert.ok(result.sanitized.includes('<b>'));
    assert.ok(result.sanitized.includes('<a href='));
  });

  it('accepts <strong> and <em> tags', () => {
    const html = '<p><strong>Important</strong> and <em>emphasized</em></p>';
    const result = validateEmailHtml(html);

    assert.equal(result.valid, true);
    assert.ok(result.sanitized.includes('<strong>'));
    assert.ok(result.sanitized.includes('<em>'));
  });

  it('accepts list tags', () => {
    const html = '<ul><li>Item 1</li><li>Item 2</li></ul>';
    const result = validateEmailHtml(html);

    assert.equal(result.valid, true);
    assert.ok(result.sanitized.includes('<ul>'));
    assert.ok(result.sanitized.includes('<li>'));
  });
});

// ─── Tag Stripping ───────────────────────────────────────────────────

describe('validateEmailHtml — strips disallowed tags', () => {
  it('strips <div> tags but keeps text content', () => {
    const html = '<div>Hello</div>';
    const result = validateEmailHtml(html);

    assert.ok(result.sanitized.includes('Hello'));
    assert.ok(!result.sanitized.includes('<div>'));
    assert.ok(result.errors.some((e) => e.includes('div')));
  });

  it('strips <span> tags but keeps text content', () => {
    const html = '<p>Hello <span>World</span></p>';
    const result = validateEmailHtml(html);

    assert.ok(result.sanitized.includes('Hello'));
    assert.ok(result.sanitized.includes('World'));
    assert.ok(!result.sanitized.includes('<span>'));
  });

  it('strips <img> tags', () => {
    const html = '<p>Text</p><img src="pixel.gif" />';
    const result = validateEmailHtml(html);

    assert.ok(!result.sanitized.includes('<img'));
    assert.ok(result.errors.some((e) => e.includes('img')));
  });

  it('strips <table> related tags', () => {
    const html = '<table><tr><td>Cell</td></tr></table>';
    const result = validateEmailHtml(html);

    assert.ok(!result.sanitized.includes('<table'));
    assert.ok(!result.sanitized.includes('<tr'));
    assert.ok(!result.sanitized.includes('<td'));
    assert.ok(result.sanitized.includes('Cell'));
  });
});

// ─── Inline Styles & Event Handlers ─────────────────────────────────

describe('validateEmailHtml — strips dangerous attributes', () => {
  it('strips inline styles', () => {
    const html = '<p style="color: red;">Hello</p>';
    const result = validateEmailHtml(html);

    assert.ok(!result.sanitized.includes('style='));
    assert.ok(result.sanitized.includes('<p>'));
    assert.ok(result.errors.some((e) => e.includes('inline styles')));
  });

  it('strips event handlers', () => {
    const html = '<p onclick="alert(1)">Click me</p>';
    const result = validateEmailHtml(html);

    assert.ok(!result.sanitized.includes('onclick'));
    assert.ok(result.errors.some((e) => e.includes('event handlers')));
  });

  it('strips class and id attributes', () => {
    const html = '<p class="fancy" id="main">Text</p>';
    const result = validateEmailHtml(html);

    assert.ok(!result.sanitized.includes('class='));
    assert.ok(!result.sanitized.includes('id='));
  });
});

// ─── Anchor Validation ──────────────────────────────────────────────

describe('validateEmailHtml — anchor tag validation', () => {
  it('keeps <a> tags with href', () => {
    const html = '<p><a href="https://example.com">Link</a></p>';
    const result = validateEmailHtml(html);

    assert.ok(result.sanitized.includes('<a href="https://example.com">'));
  });

  it('removes <a> tags without href', () => {
    const html = '<p><a>No link</a></p>';
    const result = validateEmailHtml(html);

    assert.ok(!result.sanitized.includes('<a>'));
    assert.ok(result.errors.some((e) => e.includes('without href')));
  });

  it('removes javascript: hrefs', () => {
    const html = '<p><a href="javascript:alert(1)">XSS</a></p>';
    const result = validateEmailHtml(html);

    assert.ok(!result.sanitized.includes('javascript:'));
    assert.ok(result.errors.some((e) => e.includes('javascript')));
  });
});

// ─── Auto-wrapping ───────────────────────────────────────────────────

describe('validateEmailHtml — auto-wrapping', () => {
  it('wraps bare text in <p> tags', () => {
    const html = 'Hello World\n\nSecond paragraph';
    const result = validateEmailHtml(html);

    assert.ok(result.sanitized.includes('<p>Hello World</p>'));
    assert.ok(result.sanitized.includes('<p>Second paragraph</p>'));
  });

  it('does not double-wrap already-wrapped content', () => {
    const html = '<p>Already wrapped</p>';
    const result = validateEmailHtml(html);

    assert.ok(!result.sanitized.includes('<p><p>'));
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────

describe('validateEmailHtml — edge cases', () => {
  it('returns invalid for empty string', () => {
    const result = validateEmailHtml('');

    assert.equal(result.valid, false);
    assert.equal(result.sanitized, '');
  });

  it('returns invalid for whitespace-only string', () => {
    const result = validateEmailHtml('   \n\n  ');

    assert.equal(result.valid, false);
  });

  it('handles <br> self-closing tags', () => {
    const html = '<p>Line 1<br>Line 2</p>';
    const result = validateEmailHtml(html);

    assert.ok(result.sanitized.includes('<br>'));
    assert.equal(result.valid, true);
  });
});
