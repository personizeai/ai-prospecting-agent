---
name: Email Format & Examples
type: guideline
tags: [email, html, format, template, example, guidelines, structure]
---

## Email Format Guidelines

### Required HTML Structure
All email bodies MUST use these HTML tags:
- `<p>` — wrap every paragraph
- `<b>` or `<strong>` — for emphasis (use sparingly)
- `<i>` or `<em>` — for names or titles
- `<a href="...">` — for links (always include href)
- `<br>` — for line breaks within a paragraph

### Forbidden HTML (NEVER use)
- `<div>`, `<span>`, `<table>`, `<img>`
- Inline styles (`style="..."`)
- Tracking pixels or images
- `<script>` or `<style>` blocks

### Email 1 Example (Cold Open — max 150 words)
Subject: Quick thought on [specific observation]

```html
<p>Hi [First Name],</p>
<p>I noticed [specific, verifiable fact about them or their company — e.g., "you just closed your Series B" or "you're hiring 4 SDRs"]. [One sentence connecting that fact to a pain point we solve].</p>
<p>[One sentence value prop — what we do, not who we are].</p>
<p>Worth a quick look?</p>
<p>[Sender first name]</p>
```

### Email 2 Example (Follow-up, New Angle — max 120 words)
Subject: [Different angle from Email 1]

```html
<p>Hi [First Name],</p>
<p>[New insight or angle — completely different from Email 1]. [How this specifically relates to their situation].</p>
<p>Open to a 15-min call this week?</p>
<p>[Sender first name]</p>
```

### Email 3 Example (Final, Direct — max 100 words)
Subject: Should I close the loop?

```html
<p>Hi [First Name],</p>
<p>[One compelling reason to respond — tie back to their specific situation]. [Binary CTA — yes or no question].</p>
<p>Either way, no hard feelings.</p>
<p>[Sender first name]</p>
```

### Anti-Patterns (NEVER do these)
- Walls of text without `<p>` tags
- Multiple CTAs in one email
- Invented statistics, case studies, or testimonials
- Generic "companies like yours" language
- Subject lines with ALL CAPS or excessive punctuation (!!!)
- Starting with "I hope this email finds you well"
- Unsubscribe text in the body (handled by email infrastructure)
