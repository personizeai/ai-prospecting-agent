import { createRequire } from 'module';
import type { GeneratedEmail } from '../types.js';

export async function sendViaSendGrid(generated: GeneratedEmail) {
  if (!process.env.SENDGRID_API_KEY) {
    throw new Error('Missing required environment variable: SENDGRID_API_KEY');
  }
  if (!process.env.SENDER_EMAIL) {
    throw new Error('Missing required environment variable: SENDER_EMAIL');
  }

  const require = createRequire(import.meta.url);
  const sgMail = require('@sendgrid/mail') as {
    setApiKey: (key: string) => void;
    send: (message: unknown) => Promise<unknown>;
  };

  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

  const response = await sgMail.send({
    to: generated.email,
    from: {
      email: process.env.SENDER_EMAIL!,
      name: process.env.SENDER_NAME || 'Sales Team',
    },
    subject: generated.subject,
    html: generated.bodyHtml,
    text: generated.bodyText,
    trackingSettings: {
      openTracking: { enable: true },
      clickTracking: { enable: true },
    },
  });

  return response as Array<{ headers?: Record<string, string> }>;
}
