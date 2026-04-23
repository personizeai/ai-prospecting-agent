---
name: Meeting Booking Links
type: guideline
tags: [booking, calendly, meeting, link, calendar, schedule, cal.com]
---

## Meeting Booking Configuration

### Sender-to-Booking-Link Mapping
Map each sender email to their personal booking link. The AI will include
the correct link in outreach emails and call scripts based on who is sending.

Format: sender_email → booking_url

- default → https://calendly.com/your-team/30min
- (Add your sender-specific links below)
- alice@company.com → https://calendly.com/alice/30min
- bob@company.com → https://calendly.com/bob/30min

### Rules
- Every email that includes a CTA for a meeting SHOULD include a booking link
- Use the sender-specific link if available, otherwise use the default
- NEVER include a booking link in Email 1 (too aggressive) — use a soft CTA instead
- Email 2+ and LinkedIn messages CAN include a booking link
- Call scripts should ALWAYS reference the booking link: "I'll send you a link to grab 15 minutes"
- Format in emails: use a plain text link, not a button (better deliverability)
