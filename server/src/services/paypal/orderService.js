import crypto from 'crypto';
import { paypalRequest } from './paypalClient.js';

/**
 * Create a PayPal Order with intent AUTHORIZE in USD.
 * Generates an idempotent PayPal-Request-Id header to prevent duplicate charges.
 * 
 * @param {Object} params
 * @param {string|number} params.amount - Order amount in USD (e.g., "50.00")
 * @param {string} [params.referenceId="default"] - Optional reference id
 * @param {string} [params.customId] - Optional custom tracker (e.g. milestone ID)
 * @param {string} [params.returnUrl="https://example.com/return"] - Placeholder return URL
 * @param {string} [params.cancelUrl="https://example.com/cancel"] - Placeholder cancel URL
 * @returns {Promise<{ orderId: string, approvalUrl: string, status: string }>}
 */
export async function createAuthorizeOrder({
  amount,
  referenceId = 'default',
  customId,
  requestId,
  returnUrl = 'https://example.com/return',
  cancelUrl = 'https://example.com/cancel',
}) {
  const formattedAmount = Number(amount).toFixed(2);
  const reqId = requestId || crypto.randomUUID();

  const payload = {
    intent: 'AUTHORIZE',
    purchase_units: [
      {
        reference_id: referenceId,
        custom_id: customId,
        amount: {
          currency_code: 'USD',
          value: formattedAmount,
        },
      },
    ],
    application_context: {
      return_url: returnUrl,
      cancel_url: cancelUrl,
      user_action: 'CONTINUE',
    },
  };

  const data = await paypalRequest('/v2/checkout/orders', {
    method: 'POST',
    headers: {
      'PayPal-Request-Id': reqId,
    },
    body: JSON.stringify(payload),
  });

  const approvalLink = data.links?.find((link) => link.rel === 'approve');
  if (!approvalLink) {
    throw new Error('No approval link returned from PayPal order creation.');
  }

  return {
    orderId: data.id,
    approvalUrl: approvalLink.href,
    status: data.status,
  };
}

/**
 * FALLBACK (UNTESTED - verify in sandbox; may fail with payee permission errors):
 * Create an order where the freelancer is set directly as the payee in purchase_units.
 * 
 * Note: UNTESTED - verify in sandbox; may fail with payee permission errors. In sandbox 
 * environments without Payouts API permissions, specifying the freelancer as direct payee
 * routes captured funds directly into the freelancer's sandbox account upon authorization capture.
 * 
 * @param {Object} params
 * @param {string|number} params.amount - Order amount in USD
 * @param {string} params.freelancerEmail - Freelancer's sandbox PayPal email
 * @param {string} [params.referenceId="default"]
 * @param {string} [params.customId]
 * @param {string} [params.returnUrl="https://example.com/return"]
 * @param {string} [params.cancelUrl="https://example.com/cancel"]
 * @returns {Promise<{ orderId: string, approvalUrl: string, status: string }>}
 */
export async function createOrderWithFreelancerPayee({
  amount,
  freelancerEmail,
  referenceId = 'default',
  customId,
  returnUrl = 'https://example.com/return',
  cancelUrl = 'https://example.com/cancel',
}) {
  if (!freelancerEmail) {
    throw new Error('freelancerEmail is required for freelancer payee fallback.');
  }

  const formattedAmount = Number(amount).toFixed(2);
  const requestId = crypto.randomUUID();

  const payload = {
    intent: 'AUTHORIZE',
    purchase_units: [
      {
        reference_id: referenceId,
        custom_id: customId,
        payee: {
          email_address: freelancerEmail,
        },
        amount: {
          currency_code: 'USD',
          value: formattedAmount,
        },
      },
    ],
    application_context: {
      return_url: returnUrl,
      cancel_url: cancelUrl,
      user_action: 'CONTINUE',
    },
  };

  const data = await paypalRequest('/v2/checkout/orders', {
    method: 'POST',
    headers: {
      'PayPal-Request-Id': requestId,
    },
    body: JSON.stringify(payload),
  });

  const approvalLink = data.links?.find((link) => link.rel === 'approve');
  if (!approvalLink) {
    throw new Error('No approval link returned from PayPal order creation.');
  }

  return {
    orderId: data.id,
    approvalUrl: approvalLink.href,
    status: data.status,
  };
}

/**
 * Authorize an approved order.
 * Locks the client's funds without capturing immediately.
 * 
 * @param {string} orderId - The approved PayPal order ID
 * @returns {Promise<{ orderId: string, authorizationId: string, status: string }>}
 */
export async function authorizeOrder(orderId) {
  if (!orderId) {
    throw new Error('orderId is required to authorize order.');
  }

  const data = await paypalRequest(`/v2/checkout/orders/${orderId}/authorize`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  const authorization = data.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!authorization) {
    throw new Error(`No authorization found in PayPal response for order: ${orderId}`);
  }

  return {
    orderId: data.id,
    authorizationId: authorization.id,
    status: authorization.status,
  };
}

