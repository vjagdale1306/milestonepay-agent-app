import express from 'express';
import crypto from 'crypto';
import db, { recordAuditLog } from '../db/database.js';
import { createAuthorizeOrder, authorizeOrder } from '../services/paypal/index.js';

const router = express.Router();

// Prepared statements for milestones
const selectMilestoneStmt = db.prepare(`
  SELECT * FROM milestones WHERE id = ?
`);

const incrementFundAttemptStmt = db.prepare(`
  UPDATE milestones
  SET fund_attempt_count = fund_attempt_count + 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
  RETURNING fund_attempt_count
`);

const updateMilestoneOrderStmt = db.prepare(`
  UPDATE milestones
  SET paypal_order_id = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const updateMilestoneFundedStmt = db.prepare(`
  UPDATE milestones
  SET status = 'funded',
      authorization_id = ?,
      authorized_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status = 'pending_funding'
`);

const insertSubmissionStmt = db.prepare(`
  INSERT INTO submissions (id, milestone_id, deliverable_url, content, notes)
  VALUES (?, ?, ?, ?, ?)
`);

const updateMilestoneSubmittedStmt = db.prepare(`
  UPDATE milestones
  SET status = 'submitted',
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

/**
 * POST /api/milestones/:id/fund
 * Create a PayPal order with intent AUTHORIZE for the milestone.
 */
router.post('/:id/fund', async (req, res) => {
  const { id } = req.params;

  const milestone = selectMilestoneStmt.get(id);
  if (!milestone) {
    return res.status(404).json({ error: 'Milestone not found.' });
  }

  if (milestone.status !== 'pending_funding') {
    return res.status(409).json({
      error: `Cannot fund milestone with status '${milestone.status}'. Status must be 'pending_funding'.`,
    });
  }

  // Increment attempt counter and derive unique idempotency request ID
  const { fund_attempt_count: attemptCount } = incrementFundAttemptStmt.get(id);
  const idempotencyKey = `${id}_fund_${attemptCount}`;

  // Convert amount_cents to 2-decimal USD string
  const amountUsd = (milestone.amount_cents / 100).toFixed(2);

  try {
    const order = await createAuthorizeOrder({
      amount: amountUsd,
      customId: milestone.id,
      referenceId: milestone.id,
      requestId: idempotencyKey,
    });

    updateMilestoneOrderStmt.run(order.orderId, id);

    recordAuditLog({
      entityType: 'milestone',
      entityId: id,
      action: 'order_created',
      previousState: { status: milestone.status, paypal_order_id: milestone.paypal_order_id },
      newState: { status: milestone.status, paypal_order_id: order.orderId },
      details: {
        idempotency_key: idempotencyKey,
        amount_usd: amountUsd,
        order_status: order.status,
      },
    });

    return res.json({
      orderId: order.orderId,
      approvalUrl: order.approvalUrl,
      status: order.status,
    });
  } catch (error) {
    return res.status(500).json({ error: `PayPal order creation failed: ${error.message}` });
  }
});

/**
 * POST /api/milestones/:id/confirm
 * Authorize the approved PayPal order and transition milestone to 'funded'.
 */
router.post('/:id/confirm', async (req, res) => {
  const { id } = req.params;

  const milestone = selectMilestoneStmt.get(id);
  if (!milestone) {
    return res.status(404).json({ error: 'Milestone not found.' });
  }

  // Idempotency: If the status is anything later than pending_funding, return current state without calling PayPal
  const laterStatuses = ['funded', 'submitted', 'verified', 'rejected', 'needs_review', 'paid'];
  if (laterStatuses.includes(milestone.status)) {
    return res.status(200).json({
      message: `Milestone is already processed (status: '${milestone.status}').`,
      milestone,
    });
  }

  if (milestone.status !== 'pending_funding') {
    return res.status(409).json({
      error: `Cannot confirm funding for milestone with status '${milestone.status}'. Status must be 'pending_funding'.`,
    });
  }

  if (!milestone.paypal_order_id) {
    return res.status(400).json({
      error: 'Milestone has no PayPal order associated with it. Please call /fund first.',
    });
  }

  try {
    const authResult = await authorizeOrder(milestone.paypal_order_id);

    const markFundedTx = db.transaction(() => {
      const result = updateMilestoneFundedStmt.run(authResult.authorizationId, id);
      if (result.changes === 0) {
        return false;
      }

      recordAuditLog({
        entityType: 'milestone',
        entityId: id,
        action: 'authorized',
        previousState: { status: milestone.status, authorization_id: null },
        newState: { status: 'funded', authorization_id: authResult.authorizationId },
        details: {
          order_id: milestone.paypal_order_id,
          auth_status: authResult.status,
        },
      });

      return true;
    });

    const updated = markFundedTx();
    if (!updated) {
      return res.status(409).json({
        error: 'Milestone could not be updated to funded because its state has changed.',
      });
    }

    const updatedMilestone = selectMilestoneStmt.get(id);
    return res.json({
      message: 'Milestone funded successfully.',
      milestone: updatedMilestone,
    });
  } catch (error) {
    const errMsg = error.message || '';
    if (errMsg.includes('ORDER_NOT_APPROVED')) {
      return res.status(409).json({
        error: 'Order has not been approved by the client yet. Please complete approval on PayPal first.',
      });
    }

    if (errMsg.includes('ORDER_ALREADY_AUTHORIZED')) {
      return res.status(409).json({
        error: 'This PayPal order has already been authorized.',
      });
    }

    return res.status(500).json({ error: `Failed to authorize payment: ${error.message}` });
  }
});

/**
 * POST /api/milestones/:id/submit
 * Save freelancer submission and set status to 'submitted'.
 */
router.post('/:id/submit', (req, res) => {
  const { id } = req.params;
  const { deliverable_url, content, notes } = req.body;

  const milestone = selectMilestoneStmt.get(id);
  if (!milestone) {
    return res.status(404).json({ error: 'Milestone not found.' });
  }

  // Only allow submissions when funded, needs_review, or rejected
  const allowedStatuses = ['funded', 'needs_review', 'rejected'];
  if (!allowedStatuses.includes(milestone.status)) {
    return res.status(409).json({
      error: `Cannot submit work when milestone status is '${milestone.status}'. Allowed statuses: ${allowedStatuses.join(', ')}.`,
    });
  }

  if (!deliverable_url && !content) {
    return res.status(400).json({
      error: 'Submission must provide at least deliverable_url or content.',
    });
  }

  if (deliverable_url && (typeof deliverable_url !== 'string' || deliverable_url.length > 2048)) {
    return res.status(400).json({ error: 'deliverable_url cannot exceed 2048 characters.' });
  }

  if (content && (typeof content !== 'string' || content.length > 50000)) {
    return res.status(400).json({ error: 'content cannot exceed 50000 characters.' });
  }

  if (notes && (typeof notes !== 'string' || notes.length > 5000)) {
    return res.status(400).json({ error: 'notes cannot exceed 5000 characters.' });
  }

  const submissionId = crypto.randomUUID();

  const submitTx = db.transaction(() => {
    insertSubmissionStmt.run(
      submissionId,
      id,
      deliverable_url ? deliverable_url.trim() : null,
      content ? content.trim() : null,
      notes ? notes.trim() : null
    );

    updateMilestoneSubmittedStmt.run(id);

    recordAuditLog({
      entityType: 'milestone',
      entityId: id,
      action: 'submitted',
      previousState: { status: milestone.status },
      newState: { status: 'submitted' },
      details: {
        submission_id: submissionId,
        has_url: Boolean(deliverable_url),
        has_content: Boolean(content),
      },
    });
  });

  try {
    submitTx();
    const updatedMilestone = selectMilestoneStmt.get(id);
    return res.status(201).json({
      message: 'Work submitted successfully.',
      submission_id: submissionId,
      milestone: updatedMilestone,
    });
  } catch (error) {
    return res.status(500).json({ error: `Failed to record submission: ${error.message}` });
  }
});

export default router;

