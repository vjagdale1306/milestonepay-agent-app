import React from 'react';

const STATUS_LABELS = {
  pending_funding: 'Pending Funding',
  funded: 'Funded',
  submitted: 'Submitted',
  verified: 'Approved, payment pending',
  needs_review: 'Needs Review',
  rejected: 'Rejected',
  paid: 'Paid',
};

export function StatusBadge({ status }) {
  const safeStatus = status || 'pending_funding';
  const label = STATUS_LABELS[safeStatus] || safeStatus;
  const badgeClass = `badge badge-${safeStatus}`;

  return (
    <span className={badgeClass}>
      {label}
    </span>
  );
}

export default StatusBadge;
