#!/usr/bin/env node
/**
 * Schwab OAuth Helper Script
 *
 * This script helps you obtain a refresh token for the Schwab API.
 * Run this ONCE to get your refresh token, then add it to .env.local
 *
 * Usage:
 *   node scripts/schwab-oauth.js
 */

const http = require('http');
const url = require('url');
const { exec } = require('child_process');
require('dotenv').config({ path: '.env.local' });

const APP_KEY = process.env.SCHWAB_APP_KEY || '';
const APP_SECRET = process.env.SCHWAB_APP_SECRET || '';
const REDIRECT_URI = 'https://127.0.0.1:3000/callback';

if (!APP_KEY || !APP_SECRET) {
  console.error('❌ Error: SCHWAB_APP_KEY and SCHWAB_APP_SECRET must be set in .env.local');
  process.exit(1);
}

async function getRefreshToken(authCode) {
  const credentials = Buffer.from(`${APP_KEY}:${APP_SECRET}`).toString('base64');

  const response = await fetch('https://api.schwabapi.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${error}`);
  }

  return response.json();
}

function startLocalServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url || '', true);

      if (parsedUrl.pathname === '/callback') {
        const code = parsedUrl.query.code;

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <head><title>Success</title></head>
              <body style="font-family: Arial; text-align: center; padding: 50px;">
                <h1 style="color: green;">✅ Success!</h1>
                <p>Authorization successful. You can close this window and return to the terminal.</p>
              </body>
            </html>
          `);

          setTimeout(() => {
            server.close();
            resolve(code);
          }, 1000);
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <head><title>Error</title></head>
              <body style="font-family: Arial; text-align: center; padding: 50px;">
                <h1 style="color: red;">❌ Error!</h1>
                <p>No authorization code received.</p>
              </body>
            </html>
          `);
          server.close();
          reject(new Error('No authorization code received'));
        }
      }
    });

    server.listen(3000, '127.0.0.1', () => {
      console.log('📡 Local server started on http://127.0.0.1:3000\n');
    });

    // Handle errors
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error('❌ Error: Port 3000 is already in use.');
        console.error('   Please stop any other servers on port 3000 and try again.');
      } else {
        console.error('❌ Server error:', err.message);
      }
      reject(err);
    });
  });
}

function openBrowser(url) {
  const platform = process.platform;
  let command;

  if (platform === 'darwin') {
    command = `open "${url}"`;
  } else if (platform === 'win32') {
    command = `start "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  exec(command, (error) => {
    if (error) {
      console.log('⚠️  Could not automatically open browser. Please open the URL manually.');
    }
  });
}

async function main() {
  console.log('🔐 Schwab OAuth Setup\n');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Build authorization URL
  const authUrl = new URL('https://api.schwabapi.com/v1/oauth/authorize');
  authUrl.searchParams.append('client_id', APP_KEY);
  authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.append('response_type', 'code');

  console.log('📝 IMPORTANT: Before continuing, make sure:\n');
  console.log(`   1. Your Schwab app redirect URI is set to: ${REDIRECT_URI}`);
  console.log('      → Go to: https://developer.schwab.com/dashboard/apps');
  console.log('      → Edit your app and set the redirect URI\n');

  console.log('🚀 Starting OAuth flow...\n');
  console.log('   1. A browser window will open (or copy the URL below)');
  console.log('   2. Log in with your Schwab credentials');
  console.log('   3. Authorize the application');
  console.log('   4. You\'ll be redirected back automatically\n');

  console.log('🔗 Authorization URL:\n');
  console.log(authUrl.toString());
  console.log('\n');

  try {
    console.log('⏳ Starting local callback server...\n');

    // Start server first
    const serverPromise = startLocalServer();

    // Wait a moment for server to start, then open browser
    setTimeout(() => {
      console.log('🌐 Opening browser...\n');
      openBrowser(authUrl.toString());
      console.log('⏳ Waiting for authorization callback...\n');
    }, 1000);

    // Wait for callback
    const authCode = await serverPromise;

    console.log('✅ Authorization code received!\n');
    console.log('🔄 Exchanging code for tokens...\n');

    // Exchange code for tokens
    const tokens = await getRefreshToken(authCode);

    console.log('✅ Success! Tokens obtained.\n');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📋 ADD THIS LINE TO YOUR .env.local FILE:');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log(`SCHWAB_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('⚠️  IMPORTANT NOTES:\n');
    console.log('   • This refresh token expires in 7 days');
    console.log('   • You will need to re-run this script every 7 days');
    console.log('   • Keep this token secure - do not commit it to git');
    console.log('   • After adding the token, restart your dev server\n');
    console.log(`ℹ️  Access token expires in: ${Math.floor(tokens.expires_in / 60)} minutes\n`);

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\n💡 Troubleshooting:');
    console.error('   • Make sure your redirect URI is correctly set in the Schwab Developer Portal');
    console.error('   • Ensure port 3000 is not in use by another application');
    console.error('   • Check that your SCHWAB_APP_KEY and SCHWAB_APP_SECRET are correct\n');
    process.exit(1);
  }
}

main();
