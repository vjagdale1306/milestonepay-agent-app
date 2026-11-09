import React from 'react';

function DecisionBadge({ decision }) {
  if (decision === 'approve') {
    return <span className="badge badge-paid">Approved</span>;
  }
  if (decision === 'reject') {
    return <span className="badge badge-rejected">Rejected</span>;
  }
  return <span className="badge badge-needs_review">Needs human review</span>;
}

function parseUtcDate(dateStr) {
  if (!dateStr) return '';
  const isoStr = dateStr.includes('T') ? dateStr : `${dateStr.replace(' ', 'T')}Z`;
  return new Date(isoStr).toLocaleString();
}

export function AIReportPanel({ verifications = [] }) {
  if (!verifications || verifications.length === 0) {
    return null;
  }

  // Show latest verification first using reverse of the chronological list
  const displayVerifications = [...verifications].reverse();

  return (
    <div className="stack" style={{ marginTop: '1rem' }}>
      <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)' }}>
        AI Verification Reports ({verifications.length})
      </h4>

      {displayVerifications.map((v, index) => {
        const confidencePct = Math.round((v.confidence || 0) * 100);
        const hasOverride = v.model_decision && v.decision && v.model_decision !== v.decision;
        const requirements = Array.isArray(v.requirements) ? v.requirements : [];

        return (
          <div
            key={v.id || index}
            className="card"
            style={{
              backgroundColor: '#fafbfc',
              borderLeft: '4px solid var(--accent-primary)',
            }}
          >
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div className="row" style={{ gap: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Decision:</span>
                <DecisionBadge decision={v.decision} />
                {index === 0 && (
                  <span className="badge" style={{ backgroundColor: '#e2e8f0', color: '#475569' }}>
                    Latest
                  </span>
                )}
              </div>
              <span className="muted" style={{ fontSize: '0.75rem' }}>
                {parseUtcDate(v.created_at)}
              </span>
            </div>

            {/* If service error occurred */}
            {v.service_error ? (
              <div className="alert-warning" style={{ fontSize: '0.8rem' }}>
                The AI service was unavailable for this check. Nothing was changed.
              </div>
            ) : (
              <>
                {/* Confidence progressbar */}
                <div style={{ marginBottom: '1rem' }}>
                  <div className="row" style={{ justifyContent: 'space-between', fontSize: '0.75rem' }}>
                    <span className="muted">Confidence Score</span>
                    <span style={{ fontWeight: 600 }}>{confidencePct}%</span>
                  </div>
                  <div
                    className="confidence-meter"
                    role="progressbar"
                    aria-label="Confidence"
                    aria-valuenow={confidencePct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className="confidence-fill" style={{ width: `${confidencePct}%` }} />
                  </div>
                </div>

                {/* Rule override notice */}
                {hasOverride && (
                  <div className="alert-warning" style={{ marginBottom: '0.75rem' }}>
                    <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>Policy Rule Override:</div>
                    <div style={{ fontSize: '0.8rem' }}>
                      Model proposed <span className="mono">{v.model_decision}</span>, but system rules determined <span className="mono">{v.decision}</span>.
                      {v.reason && <span className="pre-wrap"> Reason: {v.reason}</span>}
                    </div>
                  </div>
                )}

                {/* Requirements checklist */}
                {requirements.length > 0 && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                      Requirements Checklist:
                    </div>
                    <ul className="stack" style={{ listStyle: 'none', paddingLeft: 0, gap: '0.5rem' }}>
                      {requirements.map((req, rIdx) => (
                        <li
                          key={rIdx}
                          style={{
                            padding: '0.5rem 0.75rem',
                            backgroundColor: '#ffffff',
                            border: '1px solid var(--border-color)',
                            borderRadius: '4px',
                            fontSize: '0.8rem',
                          }}
                        >
                          <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                            <span style={{ fontWeight: 500 }}>{req.requirement}</span>
                            <span
                              style={{
                                fontWeight: 600,
                                color: req.met ? 'var(--status-paid-text)' : 'var(--status-rejected-text)',
                              }}
                            >
                              {req.met ? '[MET]' : '[UNMET]'}
                            </span>
                          </div>
                          {req.evidence && (
                            <div className="muted pre-wrap" style={{ fontSize: '0.75rem' }}>
                              Evidence: {req.evidence}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* AI Feedback */}
                {v.feedback && (
                  <div style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
                    <span style={{ fontWeight: 600 }}>Feedback: </span>
                    <span className="pre-wrap">{v.feedback}</span>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default AIReportPanel;
