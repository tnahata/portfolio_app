#!/usr/bin/env node
/**
 * Exchange Schwab Authorization Code for Tokens
 *
 * Usage:
 *   node scripts/exchange-code.js "YOUR_AUTHORIZATION_CODE"
 *
 * Or paste the full redirect URL:
 *   node scripts/exchange-code.js "https://127.0.0.1:3001/callback?code=XXX&session=YYY"
 */

require('dotenv').config({ path: '.env.local' });

const APP_KEY = process.env.SCHWAB_APP_KEY;
const APP_SECRET = process.env.SCHWAB_APP_SECRET;
const REDIRECT_URI = 'https://127.0.0.1:3001/callback';

if (!APP_KEY || !APP_SECRET) {
  console.error('❌ Error: SCHWAB_APP_KEY and SCHWAB_APP_SECRET must be set in .env.local');
  process.exit(1);
}

const input = process.argv[2];

if (!input) {
  console.error('❌ Error: Please provide the authorization code or full redirect URL');
  console.error('\nUsage:');
  console.error('  node scripts/exchange-code.js "YOUR_CODE"');
  console.error('  or');
  console.error('  node scripts/exchange-code.js "https://127.0.0.1:3001/callback?code=XXX&session=YYY"');
  process.exit(1);
}

// Extract code from URL if full URL was provided
let code = input;
if (input.includes('code=')) {
  const url = new URL(input.replace('https://127.0.0.1:3001', 'http://placeholder.com'));
  code = url.searchParams.get('code');
  console.log('📋 Extracted code from URL:', code);
}

async function exchangeCode() {
  try {
    console.log('\n🔄 Exchanging authorization code for tokens...\n');

    const credentials = Buffer.from(`${APP_KEY}:${APP_SECRET}`).toString('base64');

    const response = await fetch('https://api.schwabapi.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Token exchange failed:', response.status);
      console.error(JSON.stringify(data, null, 2));

      if (data.error_description?.includes('expired')) {
        console.error('\n⚠️  The authorization code has expired (they only last a few minutes).');
        console.error('    Please go through the OAuth flow again at: http://localhost:3001/auth/schwab');
      }

      process.exit(1);
    }

    console.log('✅ SUCCESS! Tokens obtained.\n');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📋 ADD THIS LINE TO YOUR .env.local FILE:');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log(`SCHWAB_REFRESH_TOKEN=${data.refresh_token}\n`);
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('ℹ️  Token Info:');
    console.log(`   • Access token expires in: ${Math.floor(data.expires_in / 60)} minutes`);
    console.log(`   • Refresh token expires in: 7 days`);
    console.log(`   • Token type: ${data.token_type}\n`);
    console.log('⚠️  IMPORTANT:');
    console.log('   1. Add the line above to your .env.local file');
    console.log('   2. Restart your dev server: npm run dev');
    console.log('   3. Visit http://localhost:3001 to see your Schwab data!\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

exchangeCode();
