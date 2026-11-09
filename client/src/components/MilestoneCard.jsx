import React, { useState, useEffect, useRef } from 'react';
import StatusBadge from './StatusBadge';
import AIReportPanel from './AIReportPanel';
import {
  fundMilestone,
  confirmMilestone,
  submitMilestone,
  verifyMilestone,
  reviewMilestone,
  retryCaptureMilestone,
  releaseAuthorization,
} from '../api/client';

function parseUtcDate(dateStr) {
  if (!dateStr) return '';
  const isoStr = dateStr.includes('T') ? dateStr : `${dateStr.replace(' ', 'T')}Z`;
  return new Date(isoStr).toLocaleString();
}

export function MilestoneCard({ milestone, role, onRefresh }) {
  const [loadingAction, setLoadingAction] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [approvalUrl, setApprovalUrl] = useState(null);

  // Submit form state
  const [deliverableUrl, setDeliverableUrl] = useState('');
  const [content, setContent] = useState('');
  const [notes, setNotes] = useState('');
  const [submitError, setSubmitError] = useState(null);

  // Review note state
  const [reviewNote, setReviewNote] = useState('');

  // Confirmation modal state
  const [pendingConfirm, setPendingConfirm] = useState(null);
  const cancelBtnRef = useRef(null);

  // Focus cancel button and listen for Escape key on confirmation modal
  useEffect(() => {
    if (pendingConfirm) {
      cancelBtnRef.current?.focus();
      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          setPendingConfirm(null);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [pendingConfirm]);

  const amountDollars = (milestone.amount_cents / 100).toFixed(2);
  const submissions = milestone.submissions || [];
  const submissionCount = submissions.length;
  const submissionsRemaining = Math.max(0, 3 - submissionCount);

  const handleFund = async () => {
    setLoadingAction('fund');
    setErrorMessage(null);
    try {
      const res = await fundMilestone(milestone.id);
      setApprovalUrl(res.approvalUrl);
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleConfirm = async () => {
    setLoadingAction('confirm');
    setErrorMessage(null);
    try {
      await confirmMilestone(milestone.id);
      setApprovalUrl(null);
      onRefresh();
    } catch (err) {
      setErrorMessage(err.message);
      onRefresh();
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSubmitWork = async (e) => {
    e.preventDefault();
    setSubmitError(null);

    const trimmedUrl = deliverableUrl.trim();
    const trimmedContent = content.trim();
    const trimmedNotes = notes.trim();

    if (!trimmedUrl && !trimmedContent) {
      setSubmitError('Please provide either work content or a deliverable link.');
      return;
    }

    if (trimmedUrl && !trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      setSubmitError('Link must start with http:// or https://');
      return;
    }

    setLoadingAction('submit');
    try {
      await submitMilestone(milestone.id, {
        deliverable_url: trimmedUrl || undefined,
        content: trimmedContent || undefined,
        notes: trimmedNotes || undefined,
      });
      setDeliverableUrl('');
      setContent('');
      setNotes('');
      onRefresh();
    } catch (err) {
      setSubmitError(err.message);
      onRefresh();
    } finally {
      setLoadingAction(null);
    }
  };

  const handleVerify = async () => {
    setLoadingAction('verify');
    setErrorMessage(null);
    try {
      await verifyMilestone(milestone.id);
      onRefresh();
    } catch (err) {
      setErrorMessage(err.message);
      onRefresh();
    } finally {
      setLoadingAction(null);
    }
  };

  const handleExecuteReview = async (decision) => {
    setLoadingAction(decision === 'approve' ? 'review_approve' : 'review_reject');
    setErrorMessage(null);
    try {
      await reviewMilestone(milestone.id, {
        decision,
        note: reviewNote.trim() || undefined,
      });
      setReviewNote('');
      onRefresh();
    } catch (err) {
      setErrorMessage(err.message);
      onRefresh();
    } finally {
      setLoadingAction(null);
    }
  };

  const handleRetryCapture = async () => {
    setLoadingAction('retry_capture');
    setErrorMessage(null);
    try {
      await retryCaptureMilestone(milestone.id);
      onRefresh();
    } catch (err) {
      setErrorMessage(err.message);
      onRefresh();
    } finally {
      setLoadingAction(null);
    }
  };

  const handleRelease = async () => {
    setLoadingAction('release');
    setErrorMessage(null);
    try {
      await releaseAuthorization(milestone.id);
      onRefresh();
    } catch (err) {
      setErrorMessage(err.message);
      onRefresh();
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div className="card stack" style={{ marginBottom: '1.5rem' }}>
      {/* Card Header */}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>{milestone.title}</h3>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)', marginTop: '0.2rem' }}>
            ${amountDollars} USD
          </div>
        </div>
        <StatusBadge status={milestone.status} />
      </div>

      {/* Brief & Acceptance Criteria */}
      {milestone.brief && (
        <div>
          <div className="muted" style={{ fontSize: '0.8rem', fontWeight: 600 }}>BRIEF:</div>
          <div className="pre-wrap" style={{ fontSize: '0.875rem' }}>{milestone.brief}</div>
        </div>
      )}

      {milestone.acceptance_criteria && (
        <div style={{ backgroundColor: '#f8fafc', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
          <div className="muted" style={{ fontSize: '0.8rem', fontWeight: 600 }}>ACCEPTANCE CRITERIA:</div>
          <div className="pre-wrap" style={{ fontSize: '0.85rem' }}>{milestone.acceptance_criteria}</div>
        </div>
      )}

      {/* Submissions Section */}
      {submissions.length > 0 && (
        <div style={{ fontSize: '0.85rem' }}>
          <div className="muted" style={{ fontWeight: 600, marginBottom: '0.4rem' }}>
            Submissions ({submissionCount} of 3 used):
          </div>
          <ul className="stack" style={{ listStyle: 'none', paddingLeft: 0, gap: '0.5rem' }}>
            {submissions.map((sub, sIdx) => {
              const hasValidLink =
                sub.deliverable_url &&
                (sub.deliverable_url.startsWith('http://') || sub.deliverable_url.startsWith('https://'));

              return (
                <li key={sub.id || sIdx} style={{ padding: '0.5rem', backgroundColor: '#f1f5f9', borderRadius: '4px' }}>
                  <div className="row" style={{ justifyContent: 'space-between', fontSize: '0.75rem' }}>
                    <span style={{ fontWeight: 600 }}>Submission #{sIdx + 1}</span>
                    <span className="muted">{parseUtcDate(sub.submitted_at)}</span>
                  </div>
                  {sub.deliverable_url && (
                    <div style={{ marginTop: '0.25rem' }}>
                      {hasValidLink ? (
                        <a href={sub.deliverable_url} target="_blank" rel="noopener noreferrer">
                          {sub.deliverable_url}
                        </a>
                      ) : (
                        <span className="pre-wrap">{sub.deliverable_url}</span>
                      )}
                    </div>
                  )}
                  {sub.content && (
                    <div className="pre-wrap muted" style={{ marginTop: '0.25rem', maxHeight: '100px', overflowY: 'auto' }}>
                      {sub.content}
                    </div>
                  )}
                  {sub.notes && (
                    <div className="pre-wrap" style={{ fontSize: '0.75rem', fontStyle: 'italic', marginTop: '0.25rem' }}>
                      Notes: {sub.notes}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* General Action Error Alert */}
      {errorMessage && (
        <div className="alert-error pre-wrap">
          {errorMessage}
        </div>
      )}

      {/* ACTION CONTROLS */}

      {/* 1. Client: pending_funding */}
      {role === 'Client' && milestone.status === 'pending_funding' && (
        <div className="stack" style={{ gap: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
          {approvalUrl ? (
            <div className="stack" style={{ gap: '0.75rem' }}>
              <div className="alert-info" style={{ fontSize: '0.85rem' }}>
                Order created! Please approve authorization on PayPal, then click confirm.
              </div>
              <div className="row">
                <a
                  href={approvalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary"
                >
                  Open PayPal to approve
                </a>
                <button
                  className="btn-secondary"
                  onClick={handleConfirm}
                  disabled={loadingAction !== null}
                  aria-busy={loadingAction === 'confirm'}
                >
                  {loadingAction === 'confirm' ? 'Confirming...' : "I've approved the payment, confirm"}
                </button>
              </div>
            </div>
          ) : milestone.paypal_order_id ? (
            <div className="stack" style={{ gap: '0.75rem' }}>
              <div className="alert-info" style={{ fontSize: '0.85rem' }}>
                An existing PayPal order is attached to this milestone. If you already approved it, click confirm.
              </div>
              <div className="row">
                <button
                  className="btn-primary"
                  onClick={handleConfirm}
                  disabled={loadingAction !== null}
                  aria-busy={loadingAction === 'confirm'}
                >
                  {loadingAction === 'confirm' ? 'Confirming...' : "I've approved the payment, confirm"}
                </button>
                <button
                  className="btn-secondary"
                  onClick={handleFund}
                  disabled={loadingAction !== null}
                  aria-busy={loadingAction === 'fund'}
                >
                  {loadingAction === 'fund' ? 'Creating Order...' : 'Start over with a new PayPal order'}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn-primary"
              onClick={handleFund}
              disabled={loadingAction !== null}
              aria-busy={loadingAction === 'fund'}
            >
              {loadingAction === 'fund' ? 'Creating Order...' : 'Fund milestone'}
            </button>
          )}
        </div>
      )}

      {/* 2. Client: submitted -> Run AI verification */}
      {role === 'Client' && milestone.status === 'submitted' && (
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
          <button
            className="btn-primary"
            onClick={handleVerify}
            disabled={loadingAction !== null}
            aria-busy={loadingAction === 'verify'}
          >
            {loadingAction === 'verify' ? 'Running AI Verification...' : 'Run AI verification'}
          </button>
          <div className="muted" style={{ fontSize: '0.75rem', marginTop: '0.35rem' }}>
            This can take up to a minute
          </div>
        </div>
      )}

      {/* 3. Client: needs_review or rejected */}
      {role === 'Client' && (milestone.status === 'needs_review' || milestone.status === 'rejected') && (
        <div className="stack" style={{ gap: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
          <div>
            <label htmlFor={`review-note-${milestone.id}`}>Optional review note:</label>
            <input
              id={`review-note-${milestone.id}`}
              type="text"
              placeholder="e.g. Approved after verifying test suite"
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              disabled={loadingAction !== null}
            />
          </div>

          <div className="row">
            {milestone.status === 'needs_review' ? (
              <>
                <button
                  className="btn-primary"
                  onClick={() =>
                    setPendingConfirm({
                      title: 'Approve Milestone Payment',
                      message: `Are you sure you want to approve this milestone and release $${amountDollars} USD to the freelancer?`,
                      onConfirm: () => handleExecuteReview('approve'),
                    })
                  }
                  disabled={loadingAction !== null}
                >
                  Approve and pay
                </button>
                <button
                  className="btn-danger"
                  onClick={() => handleExecuteReview('reject')}
                  disabled={loadingAction !== null}
                >
                  Reject
                </button>
              </>
            ) : (
              <button
                className="btn-primary"
                onClick={() =>
                  setPendingConfirm({
                    title: 'Approve Milestone Payment',
                    message: `This milestone was previously rejected. Are you sure you want to approve anyway and release $${amountDollars} USD?`,
                    onConfirm: () => handleExecuteReview('approve'),
                  })
                }
                disabled={loadingAction !== null}
              >
                Approve anyway
              </button>
            )}

            {/* Release hold option */}
            <button
              className="btn-danger"
              onClick={() =>
                setPendingConfirm({
                  title: 'Release Authorization Hold',
                  message: `Are you sure you want to cancel and void the hold for $${amountDollars} USD? The milestone will return to pending funding.`,
                  onConfirm: handleRelease,
                })
              }
              disabled={loadingAction !== null}
            >
              Release the hold
            </button>
          </div>
        </div>
      )}

      {/* 4. Client: funded -> Release hold option */}
      {role === 'Client' && milestone.status === 'funded' && (
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
          <button
            className="btn-danger"
            onClick={() =>
              setPendingConfirm({
                title: 'Release Authorization Hold',
                message: `Are you sure you want to cancel and release the authorized hold for $${amountDollars} USD?`,
                onConfirm: handleRelease,
              })
            }
            disabled={loadingAction !== null}
          >
            Release the hold
          </button>
        </div>
      )}

      {/* 5. Client: verified (approved, pending capture) */}
      {role === 'Client' && milestone.status === 'verified' && (
        <div className="stack" style={{ gap: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
          <div className="alert-warning" style={{ fontSize: '0.85rem' }}>
            Work is approved, but payment capture is pending.
          </div>
          <button
            className="btn-primary"
            onClick={handleRetryCapture}
            disabled={loadingAction !== null}
            aria-busy={loadingAction === 'retry_capture'}
          >
            {loadingAction === 'retry_capture' ? 'Retrying Capture...' : 'Retry payment capture'}
          </button>
        </div>
      )}

      {/* 6. Success State: paid */}
      {milestone.status === 'paid' && (
        <div className="alert-info" style={{ borderTop: '1px solid var(--border-color)' }}>
          <div style={{ fontWeight: 600, color: 'var(--status-paid-text)' }}>Payment Released</div>
          <div style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
            Funds have been captured via PayPal.
            {milestone.capture_id && (
              <span className="mono" style={{ display: 'block', marginTop: '0.25rem' }}>
                Capture ID: {milestone.capture_id}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 7. Freelancer: Submit work form (funded, rejected, needs_review) */}
      {role === 'Freelancer' && (milestone.status === 'funded' || milestone.status === 'rejected' || milestone.status === 'needs_review') && (
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
            Submit Deliverable ({submissionsRemaining} submission{submissionsRemaining === 1 ? '' : 's'} remaining)
          </div>

          {submissionsRemaining === 0 ? (
            <div className="alert-warning" style={{ fontSize: '0.85rem' }}>
              Maximum of 3 submissions reached for this milestone. Please wait for client review.
            </div>
          ) : (
            <form onSubmit={handleSubmitWork} className="stack" style={{ gap: '0.75rem' }}>
              <div>
                <label htmlFor={`content-${milestone.id}`}>Deliverable Content / Code:</label>
                <textarea
                  id={`content-${milestone.id}`}
                  rows={4}
                  placeholder="Paste work deliverables, source code, or completion proof here..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  disabled={loadingAction !== null}
                />
              </div>

              <div>
                <label htmlFor={`link-${milestone.id}`}>Deliverable Link (optional):</label>
                <input
                  id={`link-${milestone.id}`}
                  type="url"
                  placeholder="https://github.com/... or https://..."
                  value={deliverableUrl}
                  onChange={(e) => setDeliverableUrl(e.target.value)}
                  disabled={loadingAction !== null}
                />
              </div>

              <div>
                <label htmlFor={`notes-${milestone.id}`}>Notes for Client (optional):</label>
                <input
                  id={`notes-${milestone.id}`}
                  type="text"
                  placeholder="Brief note about this submission"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={loadingAction !== null}
                />
              </div>

              {submitError && (
                <div className="field-error">{submitError}</div>
              )}

              <button
                type="submit"
                className="btn-primary"
                disabled={loadingAction !== null}
                aria-busy={loadingAction === 'submit'}
              >
                {loadingAction === 'submit' ? 'Submitting...' : 'Submit work'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* AI Report Section */}
      <AIReportPanel verifications={milestone.verifications} />

      {/* Confirmation Modal */}
      {pendingConfirm && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby={`modal-title-${milestone.id}`}>
          <div className="modal-content stack" style={{ gap: '1rem' }}>
            <h4 id={`modal-title-${milestone.id}`} style={{ fontSize: '1rem', fontWeight: 600 }}>
              {pendingConfirm.title}
            </h4>
            <p className="pre-wrap" style={{ fontSize: '0.875rem' }}>{pendingConfirm.message}</p>
            <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                ref={cancelBtnRef}
                className="btn-secondary"
                onClick={() => setPendingConfirm(null)}
                disabled={loadingAction !== null}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  const action = pendingConfirm.onConfirm;
                  setPendingConfirm(null);
                  action();
                }}
                disabled={loadingAction !== null}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MilestoneCard;
