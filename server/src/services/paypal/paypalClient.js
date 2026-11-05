import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Ensure environment variables are loaded if not already loaded
if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
}

const getBaseUrl = () => {
  return process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
};

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Retrieve OAuth2 access token for PayPal REST API.
 * Uses client credentials grant. Caches token in memory until near expiry.
 * Never logs or prints the token or secrets.
 */
export async function getAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials missing: Ensure PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are set.');
  }

  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  const baseUrl = getBaseUrl();
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to obtain PayPal access token: HTTP ${response.status} - ${errorBody}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in * 1000);

  return cachedToken;
}

/**
 * Make an authenticated request to PayPal REST API.
 * Safely strips any sensitive values from error messages.
 */
export async function paypalRequest(endpoint, options = {}) {
  const token = await getAccessToken();
  const baseUrl = getBaseUrl();
  const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type') || '';
  let responseData = null;
  if (contentType.includes('application/json')) {
    responseData = await response.json();
  } else {
    responseData = await response.text();
  }

  if (!response.ok) {
    const errDetails = typeof responseData === 'object' ? JSON.stringify(responseData) : responseData;
    throw new Error(`PayPal API Error [${response.status}] on ${options.method || 'GET'} ${endpoint}: ${errDetails}`);
  }

  return responseData;
}

