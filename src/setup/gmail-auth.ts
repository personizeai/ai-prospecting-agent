/**
 * Gmail OAuth2 setup helper — supports multiple senders.
 *
 * Run this for EACH sender to get their refresh token:
 *   npm run gmail:auth
 *
 * All senders share the same Client ID + Client Secret (one Google Cloud project).
 * Each sender logs into their own Google Workspace account and gets a unique refresh token.
 *
 * Prerequisites:
 *   1. Go to Google Cloud Console → APIs & Services → Enable Gmail API
 *   2. Create OAuth2 credentials (Application type: Desktop app)
 *   3. Set GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET in .env
 *   4. Run this script for each sender — it opens a browser for consent
 *   5. Copy the refresh token into your GMAIL_SENDERS JSON array or GMAIL_REFRESH_TOKEN
 */

import 'dotenv/config';
import { google } from 'googleapis';
import { createServer } from 'http';
import { URL } from 'url';
import { logger } from '../lib/logger.js';

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  logger.error('Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET in .env');
  logger.error('Steps: 1. Go to https://console.cloud.google.com/apis/credentials 2. Create OAuth 2.0 Client ID (Desktop app) 3. Copy Client ID and Client Secret into .env');
  process.exit(1);
}

const REDIRECT_PORT = Number(process.env.GMAIL_AUTH_PORT) || 3847;
const REDIRECT_URI = process.env.GMAIL_AUTH_REDIRECT_URI || `http://localhost:${REDIRECT_PORT}/oauth2callback`;
const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent', // Force consent to always get a refresh token
});

// Check how many senders are already configured
let existingSenders: Array<{ email: string }> = [];
if (process.env.GMAIL_SENDERS) {
  try { existingSenders = JSON.parse(process.env.GMAIL_SENDERS); } catch { /* ignore */ }
}

logger.info('=== Gmail OAuth2 Setup ===');
if (existingSenders.length > 0) {
  logger.info('Already configured senders, adding another', { existing: existingSenders.map((s) => s.email).join(', ') });
}
logger.info('Sign in with the Google Workspace account you want to send emails FROM.');
logger.info('Opening browser. If it does not open, visit this URL:', { authUrl });

// Start a temporary local server to catch the OAuth2 redirect
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${REDIRECT_PORT}`);

  if (url.pathname !== '/oauth2callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400);
    res.end('Missing authorization code');
    return;
  }

  try {
    const { tokens } = await oauth2.getToken(code);

    // Try to get the sender's email address
    const authedClient = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    authedClient.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: authedClient });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const senderEmail = profile.data.emailAddress || 'unknown';

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h2>Gmail authorization successful!</h2><p>Authorized: <b>${senderEmail}</b></p><p>You can close this tab.</p>`);

    logger.info('Authorization successful', { senderEmail });

    if (existingSenders.length > 0 || process.env.GMAIL_SENDERS) {
      // Multi-sender mode
      const entry = `{"email":"${senderEmail}","name":"${senderEmail.split('@')[0]}","refreshToken":"${tokens.refresh_token}","dailyLimit":100}`;
      logger.info('Add this entry to your GMAIL_SENDERS array in .env', { entry });
      const all = [...existingSenders.map((s: any) => JSON.stringify(s)), entry];
      logger.info('Full example', { GMAIL_SENDERS: `[${all.join(',')}]` });
    } else {
      // Single-sender mode
      logger.info('Option A: Single sender', { GMAIL_REFRESH_TOKEN: tokens.refresh_token, SENDER_EMAIL: senderEmail, SENDER_NAME: senderEmail.split('@')[0] });
      logger.info('Option B: Multi-sender (start an array)', { GMAIL_SENDERS: `[{"email":"${senderEmail}","name":"${senderEmail.split('@')[0]}","refreshToken":"${tokens.refresh_token}","dailyLimit":100}]` });
    }

    logger.info('Run this script again to add more senders.');

    server.close();
    process.exit(0);
  } catch (err) {
    res.writeHead(500);
    res.end('Failed to exchange authorization code');
    logger.error('Token exchange failed', { error: err instanceof Error ? err.message : String(err) });
    server.close();
    process.exit(1);
  }
});

server.listen(REDIRECT_PORT, () => {
  // Open browser (cross-platform)
  const openCmd = process.platform === 'win32' ? 'start'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';

  import('child_process').then(({ exec }) => {
    exec(`${openCmd} "${authUrl}"`);
  });
});
