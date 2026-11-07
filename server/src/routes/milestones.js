import express from 'express';
import crypto from 'crypto';
import db, { recordAuditLog } from '../db/database.js';
import {
  createAuthorizeOrder,
  authorizeOrder,
  captureAuthorization,
  voidAuthorization,
} from '../services/paypal/index.js';
import { verifySubmission } from '../services/verifier/index.js';

const router = express.Router();

// Concurrency lock for in-flight payment/verification operations
const activeMoneyOps = new Set();

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

const selectLatestSubmissionStmt = db.prepare(`
  SELECT * FROM submissions WHERE milestone_id = ? ORDER BY rowid DESC LIMIT 1
`);

const insertVerificationStmt = db.prepare(`
  INSERT INTO verifications (
    id, milestone_id, submission_id, decision, model_decision,
    confidence, requirements, feedback, reason, service_error
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateMilestoneStatusStmt = db.prepare(`
  UPDATE milestones
  SET status = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status = ?
`);

const updateMilestonePaidStmt = db.prepare(`
  UPDATE milestones
  SET status = 'paid',
      capture_id = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status = 'verified'
`);

const updateMilestoneReviewApproveStmt = db.prepare(`
  UPDATE milestones
  SET status = 'verified',
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status IN ('needs_review', 'rejected')
`);

const updateMilestoneReviewRejectStmt = db.prepare(`
  UPDATE milestones
  SET status = 'rejected',
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status = 'needs_review'
`);

function parsePayPalErrorIssue(error) {
  try {
    const jsonStart = error.message.indexOf('{');
    if (jsonStart !== -1) {
      const parsed = JSON.parse(error.message.slice(jsonStart));
      const issue = parsed.details?.[0]?.issue || parsed.name || parsed.issue;

      // Note: PREVIOUSLY_CAPTURED is confirmed in PayPal's OpenAPI spec;
      // other codes are best-effort fallbacks based on runtime error patterns.
      if (issue === 'PREVIOUSLY_CAPTURED' || issue === 'AUTHORIZATION_ALREADY_CAPTURED') {
        return 'The PayPal authorization was already captured.';
      }
      if (issue === 'AUTHORIZATION_EXPIRED') {
        return "The PayPal authorization has expired, so the payment can't be captured. The client needs to fund the milestone again.";
      }
      if (
        issue === 'PREVIOUSLY_VOIDED' ||
        issue === 'AUTHORIZATION_VOIDED' ||
        issue === 'AUTHORIZATION_ALREADY_VOIDED'
      ) {
        return 'The PayPal authorization was previously voided and cannot be captured.';
      }
    }
  } catch (parseErr) {
    // Non-JSON error string
  }
  return 'Payment capture failed due to a payment processor error. Please retry.';
}

/**
 * Shared helper to capture authorized funds and transition milestone to paid.
 * Handles COMPLETED, PENDING, concurrent paid status, and friendly PayPal error mapping.
 */
async function captureAndMarkPaid(milestone, approvedBy = 'ai_verifier') {
  const captureKey = `${milestone.id}_${milestone.authorization_id}_capture`;

  try {
    const captureResult = await captureAuthorization(milestone.authorization_id, {
      requestId: captureKey,
    });

    if (captureResult.status === 'COMPLETED') {
      const markPaidTx = db.transaction(() => {
        const updateRes = updateMilestonePaidStmt.run(captureResult.captureId, milestone.id);
        if (updateRes.changes === 0) return false;

        recordAuditLog({
          entityType: 'milestone',
          entityId: milestone.id,
          action: 'captured_and_paid',
          previousState: { status: 'verified' },
          newState: { status: 'paid', capture_id: captureResult.captureId },
          details: {
            capture_id: captureResult.captureId,
            capture_status: captureResult.status,
            amount: captureResult.amount,
            approved_by: approvedBy,
          },
        });
        return true;
      });

      const updated = markPaidTx();
      if (!updated) {
        // Re-read milestone to check if concurrent worker already marked it paid
        const freshMilestone = selectMilestoneStmt.get(milestone.id);
        if (freshMilestone && freshMilestone.status === 'paid') {
          return {
            statusCode: 200,
            body: {
              status: 'paid',
              captureId: freshMilestone.capture_id || captureResult.captureId,
              milestone: freshMilestone,
            },
          };
        }

        console.error(
          `capture succeeded but milestone status mismatch: milestone ${milestone.id} status is '${freshMilestone?.status}'`
        );
        return {
          statusCode: 409,
          body: {
            error: 'Payment was captured, but milestone status could not be updated. Please contact support.',
            captureId: captureResult.captureId,
            milestone: freshMilestone,
          },
        };
      }

      return {
        statusCode: 200,
        body: {
          status: 'paid',
          captureId: captureResult.captureId,
          milestone: selectMilestoneStmt.get(milestone.id),
        },
      };
    }

    // Capture is PENDING
    return {
      statusCode: 200,
      body: {
        status: 'verified',
        message: 'Payment capture is pending in PayPal; you can retry capture once processed.',
        milestone: selectMilestoneStmt.get(milestone.id),
      },
    };
  } catch (captureError) {
    console.error('PayPal capture error:', captureError);
    const friendlyMessage = parsePayPalErrorIssue(captureError);
    return {
      statusCode: 409,
      body: {
        error: friendlyMessage,
        status: 'verified',
        milestone: selectMilestoneStmt.get(milestone.id),
      },
    };
  }
}

const countSubmissionsStmt = db.prepare(`
  SELECT COUNT(*) AS count FROM submissions WHERE milestone_id = ?
`);

const updateMilestoneSubmittedStmt = db.prepare(`
  UPDATE milestones
  SET status = 'submitted',
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status IN ('funded', 'needs_review', 'rejected')
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
  let { deliverable_url, content, notes } = req.body;

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

  // Limit freelancer submissions to 3 per milestone
  const { count: submissionCount } = countSubmissionsStmt.get(id);
  if (submissionCount >= 3) {
    return res.status(409).json({
      error: 'Maximum submission limit (3) reached for this milestone.',
    });
  }

  // Trim inputs first
  deliverable_url = typeof deliverable_url === 'string' ? deliverable_url.trim() : null;
  content = typeof content === 'string' ? content.trim() : null;
  notes = typeof notes === 'string' ? notes.trim() : null;

  if (!deliverable_url && !content) {
    return res.status(400).json({
      error: 'Submission must provide at least a non-empty deliverable_url or content.',
    });
  }

  if (deliverable_url) {
    if (!deliverable_url.startsWith('http://') && !deliverable_url.startsWith('https://')) {
      return res.status(400).json({ error: 'deliverable_url must start with http:// or https://' });
    }
    if (deliverable_url.length > 2048) {
      return res.status(400).json({ error: 'deliverable_url cannot exceed 2048 characters.' });
    }
  }

  if (content && content.length > 50000) {
    return res.status(400).json({ error: 'content cannot exceed 50000 characters.' });
  }

  if (notes && notes.length > 5000) {
    return res.status(400).json({ error: 'notes cannot exceed 5000 characters.' });
  }

  const submissionId = crypto.randomUUID();

  const submitTx = db.transaction(() => {
    const updateResult = updateMilestoneSubmittedStmt.run(id);
    if (updateResult.changes === 0) {
      return false;
    }

    insertSubmissionStmt.run(
      submissionId,
      id,
      deliverable_url || null,
      content || null,
      notes || null
    );

    recordAuditLog({
      entityType: 'milestone',
      entityId: id,
      action: 'submitted',
      previousState: { status: milestone.status },
      newState: { status: 'submitted' },
      details: {
        submission_id: submissionId,
        submission_number: submissionCount + 1,
        has_url: Boolean(deliverable_url),
        has_content: Boolean(content),
      },
    });

    return true;
  });

  try {
    const success = submitTx();
    if (!success) {
      return res.status(409).json({
        error: 'Milestone state changed concurrently; cannot submit work.',
      });
    }

    const updatedMilestone = selectMilestoneStmt.get(id);
    return res.status(201).json({
      message: 'Work submitted successfully.',
      submission_id: submissionId,
      milestone: updatedMilestone,
    });
  } catch (error) {
    console.error('Failed to record submission:', error);
    return res.status(500).json({ error: 'Failed to record submission' });
  }
});

/**
 * POST /api/milestones/:id/verify
 * Evaluate submitted work using the AI verifier and process escrow.
 */
router.post('/:id/verify', async (req, res) => {
  const { id } = req.params;

  const milestone = selectMilestoneStmt.get(id);
  if (!milestone) {
    return res.status(404).json({ error: 'Milestone not found.' });
  }

  if (milestone.status !== 'submitted') {
    return res.status(409).json({
      error: `Cannot verify milestone with status '${milestone.status}'. Status must be 'submitted'.`,
    });
  }

  if (!milestone.authorization_id) {
    return res.status(409).json({
      error: 'Milestone lacks a valid authorization_id. Funding authorization must be confirmed first.',
    });
  }

  if (activeMoneyOps.has(id)) {
    return res.status(409).json({
      error: 'Another payment operation is in progress for this milestone.',
    });
  }

  activeMoneyOps.add(id);

  try {
    const latestSubmission = selectLatestSubmissionStmt.get(id);
    if (!latestSubmission) {
      return res.status(404).json({ error: 'No submissions found for this milestone.' });
    }

    // If latest submission has no content (URL only), skip AI call and set needs_review
    if (!latestSubmission.content || latestSubmission.content.trim() === '') {
      const reasonText = 'only a link was submitted; the AI verifier cannot open links';
      const verificationId = crypto.randomUUID();

      const transitionTx = db.transaction(() => {
        const updateResult = updateMilestoneStatusStmt.run('needs_review', id, 'submitted');
        if (updateResult.changes === 0) {
          return false;
        }

        insertVerificationStmt.run(
          verificationId,
          id,
          latestSubmission.id,
          'needs_review',
          'needs_review',
          0.0,
          JSON.stringify([]),
          reasonText,
          reasonText,
          0
        );

        recordAuditLog({
          entityType: 'milestone',
          entityId: id,
          action: 'verified_url_only',
          previousState: { status: 'submitted' },
          newState: { status: 'needs_review' },
          details: {
            verification_id: verificationId,
            submission_id: latestSubmission.id,
            reason: reasonText,
          },
        });

        return true;
      });

      const success = transitionTx();
      if (!success) {
        return res.status(409).json({ error: 'Milestone state changed concurrently.' });
      }

      const updatedMilestone = selectMilestoneStmt.get(id);
      return res.json({
        message: 'Milestone marked for review: only link was submitted.',
        decision: 'needs_review',
        reason: reasonText,
        milestone: updatedMilestone,
      });
    }

    // Call AI verifier service
    const verifierResult = await verifySubmission({
      brief: milestone.brief,
      acceptanceCriteria: milestone.acceptance_criteria,
      submissionContent: latestSubmission.content,
    });

    const verificationId = crypto.randomUUID();

    // If AI service failed: leave status 'submitted', atomic save verification & audit, return 503
    if (verifierResult.serviceError) {
      const serviceErrorTx = db.transaction(() => {
        insertVerificationStmt.run(
          verificationId,
          id,
          latestSubmission.id,
          verifierResult.decision,
          verifierResult.modelDecision,
          verifierResult.confidence,
          JSON.stringify(verifierResult.requirements),
          verifierResult.feedback,
          verifierResult.reason,
          1
        );

        recordAuditLog({
          entityType: 'milestone',
          entityId: id,
          action: 'verification_service_error',
          previousState: { status: 'submitted' },
          newState: { status: 'submitted' },
          details: {
            verification_id: verificationId,
            reason: verifierResult.reason,
          },
        });
      });

      serviceErrorTx();

      return res.status(503).json({
        error: 'AI verification service is temporarily unavailable. Please retry shortly.',
      });
    }

    // 1. REJECT Branch
    if (verifierResult.decision === 'reject') {
      const rejectTx = db.transaction(() => {
        const updateResult = updateMilestoneStatusStmt.run('rejected', id, 'submitted');
        if (updateResult.changes === 0) return false;

        insertVerificationStmt.run(
          verificationId,
          id,
          latestSubmission.id,
          verifierResult.decision,
          verifierResult.modelDecision,
          verifierResult.confidence,
          JSON.stringify(verifierResult.requirements),
          verifierResult.feedback,
          verifierResult.reason,
          0
        );

        recordAuditLog({
          entityType: 'milestone',
          entityId: id,
          action: 'rejected_by_verifier',
          previousState: { status: 'submitted' },
          newState: { status: 'rejected' },
          details: {
            verification_id: verificationId,
            model_decision: verifierResult.modelDecision,
            reason: verifierResult.reason,
            confidence: verifierResult.confidence,
          },
        });
        return true;
      });

      if (!rejectTx()) {
        return res.status(409).json({ error: 'Milestone state changed concurrently.' });
      }

      return res.json({
        decision: 'reject',
        milestone: selectMilestoneStmt.get(id),
        verification: verifierResult,
      });
    }

    // 2. NEEDS_REVIEW Branch
    if (verifierResult.decision === 'needs_review') {
      const reviewTx = db.transaction(() => {
        const updateResult = updateMilestoneStatusStmt.run('needs_review', id, 'submitted');
        if (updateResult.changes === 0) return false;

        insertVerificationStmt.run(
          verificationId,
          id,
          latestSubmission.id,
          verifierResult.decision,
          verifierResult.modelDecision,
          verifierResult.confidence,
          JSON.stringify(verifierResult.requirements),
          verifierResult.feedback,
          verifierResult.reason,
          0
        );

        recordAuditLog({
          entityType: 'milestone',
          entityId: id,
          action: 'needs_review_by_verifier',
          previousState: { status: 'submitted' },
          newState: { status: 'needs_review' },
          details: {
            verification_id: verificationId,
            model_decision: verifierResult.modelDecision,
            reason: verifierResult.reason,
            confidence: verifierResult.confidence,
          },
        });
        return true;
      });

      if (!reviewTx()) {
        return res.status(409).json({ error: 'Milestone state changed concurrently.' });
      }

      return res.json({
        decision: 'needs_review',
        milestone: selectMilestoneStmt.get(id),
        verification: verifierResult,
      });
    }

    // 3. APPROVE Branch: submitted -> verified -> capture -> paid
    const markVerifiedTx = db.transaction(() => {
      const updateResult = updateMilestoneStatusStmt.run('verified', id, 'submitted');
      if (updateResult.changes === 0) return false;

      insertVerificationStmt.run(
        verificationId,
        id,
        latestSubmission.id,
        verifierResult.decision,
        verifierResult.modelDecision,
        verifierResult.confidence,
        JSON.stringify(verifierResult.requirements),
        verifierResult.feedback,
        verifierResult.reason,
        0
      );

      recordAuditLog({
        entityType: 'milestone',
        entityId: id,
        action: 'approved_by_verifier',
        previousState: { status: 'submitted' },
        newState: { status: 'verified' },
        details: {
          verification_id: verificationId,
          model_decision: verifierResult.modelDecision,
          reason: verifierResult.reason,
          confidence: verifierResult.confidence,
        },
      });
      return true;
    });

    if (!markVerifiedTx()) {
      return res.status(409).json({ error: 'Milestone state changed concurrently.' });
    }

    const updatedMilestone = selectMilestoneStmt.get(id);
    const captureOutcome = await captureAndMarkPaid(updatedMilestone, 'ai_verifier');
    return res.status(captureOutcome.statusCode).json({
      ...captureOutcome.body,
      decision: 'approve',
      verification: verifierResult,
    });
  } catch (error) {
    console.error('Unhandled error in POST /verify:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    activeMoneyOps.delete(id);
  }
});

const resetMilestonePendingStmt = db.prepare(`
  UPDATE milestones
  SET status = 'pending_funding',
      authorization_id = NULL,
      paypal_order_id = NULL,
      authorized_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status IN ('funded', 'rejected', 'needs_review')
`);

/**
 * POST /api/milestones/:id/release-authorization
 * Voids the PayPal authorization and resets the milestone to pending_funding.
 * Allowed for: funded, rejected, needs_review.
 */
router.post('/:id/release-authorization', async (req, res) => {
  const { id } = req.params;

  const milestone = selectMilestoneStmt.get(id);
  if (!milestone) {
    return res.status(404).json({ error: 'Milestone not found.' });
  }

  const allowedStatuses = ['funded', 'rejected', 'needs_review'];
  if (!allowedStatuses.includes(milestone.status)) {
    return res.status(409).json({
      error: `Cannot release authorization for milestone with status '${milestone.status}'. Allowed statuses: ${allowedStatuses.join(', ')}.`,
    });
  }

  if (!milestone.authorization_id) {
    return res.status(409).json({
      error: 'Milestone lacks a valid authorization_id.',
    });
  }

  if (activeMoneyOps.has(id)) {
    return res.status(409).json({
      error: 'Another payment operation is in progress for this milestone.',
    });
  }
  activeMoneyOps.add(id);

  let alreadyVoidedOrExpired = false;

  try {
    try {
      await voidAuthorization(milestone.authorization_id);
    } catch (voidError) {
      let issue = null;
      try {
        const jsonStart = voidError.message.indexOf('{');
        if (jsonStart !== -1) {
          const parsed = JSON.parse(voidError.message.slice(jsonStart));
          issue = parsed.details?.[0]?.issue || parsed.name || parsed.issue;
        }
      } catch (e) {
        // non-JSON error
      }

      // Note: PREVIOUSLY_CAPTURED is confirmed in PayPal's OpenAPI spec;
      // other codes are best-effort fallbacks based on runtime error patterns.
      if (issue === 'PREVIOUSLY_CAPTURED' || issue === 'AUTHORIZATION_ALREADY_CAPTURED') {
        return res.status(409).json({
          error: 'The PayPal authorization has already been captured and cannot be voided.',
        });
      }

      if (
        issue === 'PREVIOUSLY_VOIDED' ||
        issue === 'AUTHORIZATION_VOIDED' ||
        issue === 'AUTHORIZATION_ALREADY_VOIDED' ||
        issue === 'AUTHORIZATION_EXPIRED'
      ) {
        alreadyVoidedOrExpired = true;
      } else {
        console.error('PayPal void authorization error:', issue || voidError);
        return res.status(409).json({
          error: 'Failed to void PayPal authorization. Payment processor error.',
        });
      }
    }

    const resetTx = db.transaction(() => {
      const result = resetMilestonePendingStmt.run(id);
      if (result.changes === 0) return false;

      recordAuditLog({
        entityType: 'milestone',
        entityId: id,
        action: 'authorization_released',
        previousState: {
          status: milestone.status,
          authorization_id: milestone.authorization_id,
          paypal_order_id: milestone.paypal_order_id,
        },
        newState: {
          status: 'pending_funding',
          authorization_id: null,
          paypal_order_id: null,
        },
        details: {
          old_order_id: milestone.paypal_order_id,
          old_authorization_id: milestone.authorization_id,
          paypal_already_voided_or_expired: alreadyVoidedOrExpired,
        },
      });
      return true;
    });

    const resetSuccess = resetTx();
    if (!resetSuccess) {
      console.error(`void succeeded but milestone status reset failed for milestone ${id}`);
      return res.status(409).json({
        error: 'Authorization was voided, but milestone state changed concurrently.',
      });
    }

    return res.json({
      message: 'Authorization released successfully. Milestone has returned to pending_funding.',
      milestone: selectMilestoneStmt.get(id),
    });
  } catch (error) {
    console.error('Unhandled error in POST /release-authorization:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    activeMoneyOps.delete(id);
  }
});

/**
 * POST /api/milestones/:id/review
 * Client's human override decision for milestones in needs_review or rejected.
 */
router.post('/:id/review', async (req, res) => {
  const { id } = req.params;
  const { decision, note } = req.body;

  if (decision !== 'approve' && decision !== 'reject') {
    return res.status(400).json({
      error: "decision must be either 'approve' or 'reject'.",
    });
  }

  const cleanNote = typeof note === 'string' ? note.trim().slice(0, 5000) : null;

  const milestone = selectMilestoneStmt.get(id);
  if (!milestone) {
    return res.status(404).json({ error: 'Milestone not found.' });
  }

  // Explicit status checks before taking the lock
  if (decision === 'reject') {
    if (milestone.status !== 'needs_review') {
      return res.status(409).json({
        error: `Cannot reject milestone with status '${milestone.status}'. Status must be 'needs_review'.`,
      });
    }
  } else if (decision === 'approve') {
    if (milestone.status !== 'needs_review' && milestone.status !== 'rejected') {
      return res.status(409).json({
        error: `Cannot approve milestone with status '${milestone.status}'. Status must be 'needs_review' or 'rejected'.`,
      });
    }
  }

  if (activeMoneyOps.has(id)) {
    return res.status(409).json({
      error: 'Another payment operation is in progress for this milestone.',
    });
  }
  activeMoneyOps.add(id);

  try {
    if (decision === 'reject') {
      const rejectTx = db.transaction(() => {
        const result = updateMilestoneReviewRejectStmt.run(id);
        if (result.changes === 0) return false;

        recordAuditLog({
          entityType: 'milestone',
          entityId: id,
          action: 'human_review_reject',
          previousState: { status: 'needs_review' },
          newState: { status: 'rejected' },
          details: { note: cleanNote },
        });
        return true;
      });

      if (!rejectTx()) {
        return res.status(409).json({ error: 'Milestone state changed concurrently.' });
      }

      return res.json({
        decision: 'reject',
        message: 'Milestone rejected by client review.',
        milestone: selectMilestoneStmt.get(id),
      });
    }

    // decision === 'approve'
    if (!milestone.authorization_id) {
      return res.status(409).json({
        error: 'Milestone lacks a valid authorization_id.',
      });
    }

    const approveTx = db.transaction(() => {
      const result = updateMilestoneReviewApproveStmt.run(id);
      if (result.changes === 0) return false;

      recordAuditLog({
        entityType: 'milestone',
        entityId: id,
        action: 'human_review_approve',
        previousState: { status: milestone.status },
        newState: { status: 'verified' },
        details: { note: cleanNote },
      });
      return true;
    });

    if (!approveTx()) {
      return res.status(409).json({ error: 'Milestone state changed concurrently.' });
    }

    // Capture payment via helper
    const updatedMilestone = selectMilestoneStmt.get(id);
    const result = await captureAndMarkPaid(updatedMilestone, 'human_review');
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    console.error('Unhandled error in POST /review:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    activeMoneyOps.delete(id);
  }
});

/**
 * POST /api/milestones/:id/retry-capture
 * Retries capturing payment for a milestone in 'verified' status.
 */
router.post('/:id/retry-capture', async (req, res) => {
  const { id } = req.params;

  const milestone = selectMilestoneStmt.get(id);
  if (!milestone) {
    return res.status(404).json({ error: 'Milestone not found.' });
  }

  if (milestone.status !== 'verified') {
    return res.status(409).json({
      error: `Cannot retry capture on milestone with status '${milestone.status}'. Status must be 'verified'.`,
    });
  }

  if (!milestone.authorization_id) {
    return res.status(409).json({
      error: 'Milestone lacks a valid authorization_id.',
    });
  }

  if (activeMoneyOps.has(id)) {
    return res.status(409).json({
      error: 'Another payment operation is in progress for this milestone.',
    });
  }
  activeMoneyOps.add(id);

  try {
    const outcome = await captureAndMarkPaid(milestone, 'retry');
    return res.status(outcome.statusCode).json(outcome.body);
  } catch (error) {
    console.error('Unhandled error in POST /retry-capture:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    activeMoneyOps.delete(id);
  }
});

export default router;

