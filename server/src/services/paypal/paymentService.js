import crypto from 'crypto';
import { paypalRequest } from './paypalClient.js';

/**
 * Capture an authorized payment.
 * Generates an idempotent PayPal-Request-Id header to prevent double-capturing on retries.
 * 
 * @param {string} authorizationId - The authorization ID to capture
 * @param {Object} [options]
 * @param {string|number} [options.amount] - Optional partial capture amount (USD)
 * @param {boolean} [options.isFinal=true] - Whether this capture is the final capture
 * @returns {Promise<{ captureId: string, authorizationId: string, status: string, amount: Object }>}
 */
export async function captureAuthorization(authorizationId, options = {}) {
  if (!authorizationId) {
    throw new Error('authorizationId is required to capture authorization.');
  }

  const requestId = options.requestId || crypto.randomUUID();
  const payload = {
    final_capture: options.isFinal ?? true,
  };

  if (options.amount) {
    payload.amount = {
      currency_code: 'USD',
      value: Number(options.amount).toFixed(2),
    };
  }

  const data = await paypalRequest(`/v2/payments/authorizations/${authorizationId}/capture`, {
    method: 'POST',
    headers: {
      'PayPal-Request-Id': requestId,
    },
    body: JSON.stringify(payload),
  });

  return {
    captureId: data.id,
    authorizationId,
    status: data.status,
    amount: data.amount,
  };
}

/**
 * Void an authorized payment.
 * Releases the authorized hold back to the client.
 * 
 * @param {string} authorizationId - The authorization ID to void
 * @returns {Promise<{ authorizationId: string, status: string }>}
 */
export async function voidAuthorization(authorizationId) {
  if (!authorizationId) {
    throw new Error('authorizationId is required to void authorization.');
  }

  await paypalRequest(`/v2/payments/authorizations/${authorizationId}/void`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  return {
    authorizationId,
    status: 'VOIDED',
  };
}

