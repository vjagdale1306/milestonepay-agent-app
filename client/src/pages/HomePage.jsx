import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export function HomePage() {
  const [projectIdInput, setProjectIdInput] = useState('');
  const [recentProjects, setRecentProjects] = useState([]);
  const [inputError, setInputError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    try {
      const stored = localStorage.getItem('milestonepay_recent_projects');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          // Filter to objects with valid string id, cap at 10
          const valid = parsed
            .filter((p) => p && typeof p.id === 'string' && p.id.trim().length > 0)
            .slice(0, 10);
          setRecentProjects(valid);
        }
      }
    } catch (e) {
      // Ignore corrupt localStorage
    }
  }, []);

  const handleOpenById = (e) => {
    e.preventDefault();
    const trimmed = projectIdInput.trim();
    if (!trimmed) {
      setInputError('Please enter a project ID.');
      return;
    }
    navigate(`/projects/${encodeURIComponent(trimmed)}`);
  };

  return (
    <div className="container stack" style={{ maxWidth: '680px', marginTop: '2rem' }}>
      {/* Product Pitch */}
      <div className="card stack" style={{ padding: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
          MilestonePay Agent
        </h1>
        <p style={{ fontSize: '1rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>
          The client funds a milestone, the freelancer submits work, an AI agent checks it against the acceptance criteria, and PayPal releases the payment.
        </p>

        <div className="alert-info" style={{ fontSize: '0.85rem' }}>
          This demo runs in the PayPal sandbox. All payments use test money.
        </div>

        {/* How it works 3-step row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '1rem',
            margin: '0.5rem 0',
          }}
        >
          <div style={{ padding: '0.75rem', backgroundColor: '#f8fafc', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--accent-primary)', marginBottom: '0.2rem' }}>STEP 1</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>Fund the milestone</div>
          </div>
          <div style={{ padding: '0.75rem', backgroundColor: '#f8fafc', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--accent-primary)', marginBottom: '0.2rem' }}>STEP 2</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>Freelancer submits work</div>
          </div>
          <div style={{ padding: '0.75rem', backgroundColor: '#f8fafc', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--accent-primary)', marginBottom: '0.2rem' }}>STEP 3</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>AI checks it and PayPal pays out</div>
          </div>
        </div>

        <div style={{ marginTop: '0.5rem' }}>
          <Link
            to="/projects/new"
            className="btn-primary"
            style={{ display: 'inline-block', textDecoration: 'none' }}
          >
            Create project
          </Link>
        </div>
      </div>

      {/* Open by Project ID */}
      <div className="card stack">
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Open Project by ID</h2>
        <form onSubmit={handleOpenById} className="row">
          <div style={{ flex: '1', minWidth: '220px' }}>
            <input
              type="text"
              placeholder="e.g. 7c9e6679-7425-40de-944b-e07fc1f90ae7"
              value={projectIdInput}
              onChange={(e) => {
                setProjectIdInput(e.target.value);
                if (inputError) setInputError(null);
              }}
              aria-label="Project ID"
              aria-describedby={inputError ? 'project-id-error' : undefined}
            />
            {inputError && (
              <div id="project-id-error" className="field-error" role="alert">
                {inputError}
              </div>
            )}
          </div>
          <button type="submit" className="btn-secondary">
            Open
          </button>
        </form>
      </div>

      {/* Recent Projects */}
      {recentProjects.length > 0 && (
        <div className="card stack">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Recent Projects</h2>
          <ul className="stack" style={{ listStyle: 'none', paddingLeft: 0, gap: '0.5rem' }}>
            {recentProjects.map((p) => (
              <li
                key={p.id}
                style={{
                  padding: '0.75rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  backgroundColor: '#ffffff',
                }}
              >
                <div>
                  <Link
                    to={`/projects/${encodeURIComponent(p.id)}`}
                    style={{ fontWeight: 600, display: 'block' }}
                  >
                    {p.title || 'Untitled Project'}
                  </Link>
                  <div className="mono muted" style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>
                    {p.id}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default HomePage;
