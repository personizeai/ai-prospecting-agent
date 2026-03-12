import { logger } from '../lib/logger.js';

/** Send a plain-text Slack notification via webhook. */
export async function notifySlack(
  message: string,
  webhookUrl = process.env.SLACK_WEBHOOK_URL
) {
  if (!webhookUrl) {
    logger.warn('SLACK_WEBHOOK_URL not set, skipping Slack notification.');
    return;
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
  });

  if (!response.ok) {
    logger.error('Slack notification failed', { status: response.status, body: await response.text() });
  }
}

/** Send a structured Block Kit alert for hot prospects. */
export async function notifyRepOnSlack(
  webhookUrl: string,
  message: { company: string; contact: string; reason: string; action: string }
) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: 'Hot Prospect Alert' },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Company:*\n${message.company}` },
            { type: 'mrkdwn', text: `*Contact:*\n${message.contact}` },
          ],
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Why now:*\n${message.reason}` },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Recommended action:*\n${message.action}` },
        },
      ],
    }),
  });

  if (!response.ok) {
    logger.error('Slack block notification failed', { status: response.status, body: await response.text() });
  }
}
