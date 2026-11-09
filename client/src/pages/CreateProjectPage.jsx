import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createProject } from '../api/client';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AMOUNT_REGEX = /^\d+(\.\d{1,2})?$/;

const createEmptyMilestone = () => ({
  id: crypto.randomUUID(),
  title: '',
  brief: '',
  acceptance_criteria: '',
  amount: '',
});

export function CreateProjectPage() {
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [freelancerEmail, setFreelancerEmail] = useState('');
  const [milestones, setMilestones] = useState([createEmptyMilestone()]);

  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState(null);

  const handleAddMilestone = () => {
    if (milestones.length >= 10) return;
    setMilestones((prev) => [...prev, createEmptyMilestone()]);
  };

  const handleRemoveMilestone = (milestoneId) => {
    if (milestones.length <= 1) return;
    setMilestones((prev) => prev.filter((m) => m.id !== milestoneId));
    // Clear errors associated with the removed milestone
    setErrors((prev) => {
      const updated = { ...prev };
      Object.keys(updated).forEach((key) => {
        if (key.startsWith(`m_${milestoneId}_`)) {
          delete updated[key];
        }
      });
      return updated;
    });
  };

  const handleMilestoneChange = (milestoneId, field, value) => {
    setMilestones((prev) =>
      prev.map((m) => (m.id === milestoneId ? { ...m, [field]: value } : m))
    );
  };

  const handleFillSample = () => {
    setTitle('Product description for a water bottle');
    setDescription('Creation of product copy for our upcoming eco-friendly drinkware line.');
    setClientEmail('client@example.com');
    setFreelancerEmail('freelancer@example.com');
    setMilestones([
      {
        id: crypto.randomUUID(),
        title: 'Water bottle product description',
        brief: 'Write a short product description for a reusable water bottle.',
        acceptance_criteria:
          '1. At least 3 sentences\n2. Mentions the word reusable\n3. Mentions a material such as steel, glass or plastic',
        amount: '3.00',
      },
    ]);
    setErrors({});
    setServerError(null);
  };

  const validateForm = () => {
    const newErrors = {};
    let firstInvalidFieldId = null;

    const recordError = (fieldKey, elementId, message) => {
      newErrors[fieldKey] = message;
      if (!firstInvalidFieldId) {
        firstInvalidFieldId = elementId;
      }
    };

    if (!title.trim()) {
      recordError('title', 'project-title', 'Project title is required.');
    } else if (title.trim().length > 200) {
      recordError('title', 'project-title', 'Project title cannot exceed 200 characters.');
    }

    if (description && description.length > 2000) {
      recordError('description', 'project-desc', 'Description cannot exceed 2000 characters.');
    }

    if (clientEmail.trim() && !EMAIL_REGEX.test(clientEmail.trim())) {
      recordError('clientEmail', 'client-email', 'Please enter a valid client email address.');
    }

    if (freelancerEmail.trim() && !EMAIL_REGEX.test(freelancerEmail.trim())) {
      recordError('freelancerEmail', 'freelancer-email', 'Please enter a valid freelancer email address.');
    }

    if (!milestones || milestones.length === 0) {
      newErrors.milestones = 'At least one milestone is required.';
    } else if (milestones.length > 10) {
      newErrors.milestones = 'Cannot create more than 10 milestones per project.';
    }

    milestones.forEach((m) => {
      const prefix = `m_${m.id}_`;

      if (!m.title.trim()) {
        recordError(`${prefix}title`, `m-title-${m.id}`, 'Milestone title is required.');
      } else if (m.title.trim().length > 200) {
        recordError(`${prefix}title`, `m-title-${m.id}`, 'Milestone title cannot exceed 200 characters.');
      }

      const trimmedAmount = String(m.amount).trim();
      if (!trimmedAmount) {
        recordError(`${prefix}amount`, `m-amount-${m.id}`, 'Amount is required.');
      } else if (!AMOUNT_REGEX.test(trimmedAmount)) {
        recordError(`${prefix}amount`, `m-amount-${m.id}`, 'Amount must be a number with up to 2 decimal places.');
      } else {
        const parsedAmount = parseFloat(trimmedAmount);
        if (parsedAmount <= 0) {
          recordError(`${prefix}amount`, `m-amount-${m.id}`, 'Amount must be greater than 0.');
        } else if (parsedAmount > 10000.0) {
          recordError(`${prefix}amount`, `m-amount-${m.id}`, 'Amount cannot exceed $10,000.00.');
        }
      }

      if (m.brief && m.brief.length > 5000) {
        recordError(`${prefix}brief`, `m-brief-${m.id}`, 'Brief cannot exceed 5000 characters.');
      }

      if (!m.acceptance_criteria.trim()) {
        recordError(
          `${prefix}criteria`,
          `m-criteria-${m.id}`,
          'Acceptance criteria is required so the AI agent can verify work.'
        );
      } else if (m.acceptance_criteria.trim().length > 5000) {
        recordError(`${prefix}criteria`, `m-criteria-${m.id}`, 'Acceptance criteria cannot exceed 5000 characters.');
      }
    });

    setErrors(newErrors);

    if (firstInvalidFieldId) {
      document.getElementById(firstInvalidFieldId)?.focus();
    }

    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    setServerError(null);

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      client_email: clientEmail.trim() || undefined,
      freelancer_email: freelancerEmail.trim() || undefined,
      milestones: milestones.map((m) => ({
        title: m.title.trim(),
        brief: m.brief.trim() || undefined,
        acceptance_criteria: m.acceptance_criteria.trim(),
        amount_cents: Math.round(parseFloat(m.amount) * 100),
      })),
    };

    try {
      const res = await createProject(payload);

      // Save to recent projects in localStorage
      try {
        const stored = localStorage.getItem('milestonepay_recent_projects');
        const existing = stored ? JSON.parse(stored) : [];
        const filtered = Array.isArray(existing) ? existing.filter((p) => p.id !== res.id) : [];
        filtered.unshift({ id: res.id, title: res.title });
        localStorage.setItem('milestonepay_recent_projects', JSON.stringify(filtered.slice(0, 10)));
      } catch (storageErr) {
        // Ignore localStorage quota errors
      }

      navigate(`/projects/${encodeURIComponent(res.id)}`);
    } catch (err) {
      setServerError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container stack" style={{ maxWidth: '720px' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700 }}>Create New Project</h1>
        <div className="row" style={{ gap: '0.5rem' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleFillSample}
            disabled={isSubmitting}
            style={{ fontSize: '0.8rem' }}
          >
            Fill with a sample project
          </button>
          <Link
            to="/"
            className="btn-secondary"
            style={{ fontSize: '0.8rem', textDecoration: 'none' }}
          >
            Back to Home
          </Link>
        </div>
      </div>

      {serverError && (
        <div className="alert-error pre-wrap">
          {serverError}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="stack" style={{ gap: '1.25rem' }}>
        {/* Project Meta Card */}
        <div className="card stack">
          <h2 style={{ fontSize: '1.05rem', fontWeight: 600 }}>Project Information</h2>

          <div>
            <label htmlFor="project-title">Project Title *</label>
            <input
              id="project-title"
              type="text"
              placeholder="e.g. Mobile Application MVP"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? 'err-project-title' : undefined}
            />
            {errors.title && <div id="err-project-title" className="field-error" role="alert">{errors.title}</div>}
          </div>

          <div>
            <label htmlFor="project-desc">Description (optional):</label>
            <textarea
              id="project-desc"
              rows={3}
              placeholder="Overview of the contract or goals..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? 'err-project-desc' : undefined}
            />
            {errors.description && <div id="err-project-desc" className="field-error" role="alert">{errors.description}</div>}
          </div>

          <div className="row" style={{ gap: '1rem' }}>
            <div style={{ flex: 1, minWidth: '220px' }}>
              <label htmlFor="client-email">Client Email (optional):</label>
              <input
                id="client-email"
                type="email"
                placeholder="client@example.com"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.clientEmail)}
                aria-describedby={errors.clientEmail ? 'err-client-email' : undefined}
              />
              {errors.clientEmail && <div id="err-client-email" className="field-error" role="alert">{errors.clientEmail}</div>}
            </div>

            <div style={{ flex: 1, minWidth: '220px' }}>
              <label htmlFor="freelancer-email">Freelancer Email (optional):</label>
              <input
                id="freelancer-email"
                type="email"
                placeholder="freelancer@example.com"
                value={freelancerEmail}
                onChange={(e) => setFreelancerEmail(e.target.value)}
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.freelancerEmail)}
                aria-describedby={errors.freelancerEmail ? 'err-freelancer-email' : undefined}
              />
              {errors.freelancerEmail && <div id="err-freelancer-email" className="field-error" role="alert">{errors.freelancerEmail}</div>}
            </div>
          </div>
        </div>

        {/* Milestones List */}
        <div className="stack" style={{ gap: '1rem' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 600 }}>
              Milestones ({milestones.length} of 10)
            </h2>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleAddMilestone}
              disabled={isSubmitting || milestones.length >= 10}
            >
              Add another milestone
            </button>
          </div>

          {errors.milestones && <div className="field-error" role="alert">{errors.milestones}</div>}

          {milestones.map((m, idx) => (
            <div key={m.id} className="card stack" style={{ position: 'relative' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Milestone #{idx + 1}</span>
                {milestones.length > 1 && (
                  <button
                    type="button"
                    className="btn-danger"
                    style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                    onClick={() => handleRemoveMilestone(m.id)}
                    disabled={isSubmitting}
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="row" style={{ gap: '1rem' }}>
                <div style={{ flex: 2, minWidth: '200px' }}>
                  <label htmlFor={`m-title-${m.id}`}>Milestone Title *</label>
                  <input
                    id={`m-title-${m.id}`}
                    type="text"
                    placeholder="e.g. Authentication & Database Setup"
                    value={m.title}
                    onChange={(e) => handleMilestoneChange(m.id, 'title', e.target.value)}
                    disabled={isSubmitting}
                    aria-invalid={Boolean(errors[`m_${m.id}_title`])}
                    aria-describedby={errors[`m_${m.id}_title`] ? `err-m-title-${m.id}` : undefined}
                  />
                  {errors[`m_${m.id}_title`] && (
                    <div id={`err-m-title-${m.id}`} className="field-error" role="alert">{errors[`m_${m.id}_title`]}</div>
                  )}
                </div>

                <div style={{ flex: 1, minWidth: '140px' }}>
                  <label htmlFor={`m-amount-${m.id}`}>Amount (USD, max $10,000) *</label>
                  <input
                    id={`m-amount-${m.id}`}
                    type="text"
                    placeholder="100.00"
                    value={m.amount}
                    onChange={(e) => handleMilestoneChange(m.id, 'amount', e.target.value)}
                    disabled={isSubmitting}
                    aria-invalid={Boolean(errors[`m_${m.id}_amount`])}
                    aria-describedby={errors[`m_${m.id}_amount`] ? `err-m-amount-${m.id}` : undefined}
                  />
                  {errors[`m_${m.id}_amount`] && (
                    <div id={`err-m-amount-${m.id}`} className="field-error" role="alert">{errors[`m_${m.id}_amount`]}</div>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor={`m-brief-${m.id}`}>Brief (optional):</label>
                <textarea
                  id={`m-brief-${m.id}`}
                  rows={2}
                  placeholder="Summary of what should be completed..."
                  value={m.brief}
                  onChange={(e) => handleMilestoneChange(m.id, 'brief', e.target.value)}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(errors[`m_${m.id}_brief`])}
                  aria-describedby={errors[`m_${m.id}_brief`] ? `err-m-brief-${m.id}` : undefined}
                />
                {errors[`m_${m.id}_brief`] && (
                  <div id={`err-m-brief-${m.id}`} className="field-error" role="alert">{errors[`m_${m.id}_brief`]}</div>
                )}
              </div>

              <div>
                <label htmlFor={`m-criteria-${m.id}`}>
                  Acceptance Criteria * (verified by AI agent):
                </label>
                <div className="muted" style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                  Provide concrete, checkable criteria (e.g. &quot;mentions X&quot;, &quot;at least 3 sentences&quot;, &quot;exports function Y&quot;).
                </div>
                <textarea
                  id={`m-criteria-${m.id}`}
                  rows={3}
                  placeholder="1. Users can register with email&#10;2. Passwords are hash-verified&#10;3. JWT token returned upon login"
                  value={m.acceptance_criteria}
                  onChange={(e) => handleMilestoneChange(m.id, 'acceptance_criteria', e.target.value)}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(errors[`m_${m.id}_criteria`])}
                  aria-describedby={errors[`m_${m.id}_criteria`] ? `err-m-criteria-${m.id}` : undefined}
                />
                {errors[`m_${m.id}_criteria`] && (
                  <div id={`err-m-criteria-${m.id}`} className="field-error" role="alert">{errors[`m_${m.id}_criteria`]}</div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button
            type="submit"
            className="btn-primary"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            style={{ minWidth: '160px' }}
          >
            {isSubmitting ? 'Creating Project...' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default CreateProjectPage;
