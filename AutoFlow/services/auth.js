/**
 * Auth Service — يسجّل دخول Activepieces ويجيب JWT Token
 */

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  // لو عندنا token صالح — نرجعه
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const baseUrl = process.env.AP_BASE_URL;
  const email = process.env.AP_EMAIL;
  const password = process.env.AP_PASSWORD;

  if (!email || !password) {
    throw new Error('AP_EMAIL و AP_PASSWORD مطلوبين');
  }

  console.log('Signing in to Activepieces...');

  const response = await fetch(`${baseUrl}/api/v1/authentication/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Sign-in failed (${response.status}): ${err}`);
  }

  const data = await response.json();
  cachedToken = data.token || data.body?.token;
  
  if (!cachedToken) {
    // بعض النسخ ترجع الـ token بشكل مختلف
    cachedToken = data.accessToken || data.access_token || data;
    if (typeof cachedToken === 'object') {
      cachedToken = cachedToken.token || cachedToken.accessToken;
    }
  }

  if (!cachedToken) {
    throw new Error('No token in sign-in response: ' + JSON.stringify(data).substring(0, 200));
  }

  // Token صالح لـ 23 ساعة
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
  console.log('Signed in successfully, token cached');

  return cachedToken;
}

function clearToken() {
  cachedToken = null;
  tokenExpiry = 0;
}

module.exports = { getToken, clearToken };
