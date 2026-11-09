import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getProject } from '../api/client.js';
import MilestoneCard from '../components/MilestoneCard.jsx';

const ROLE_KEY = 'milestonepay_demo_role';

function loadRole() {
    try {
        return localStorage.getItem(ROLE_KEY) === 'Freelancer' ? 'Freelancer' : 'Client';
    } catch (e) {
        return 'Client';
    }
}

// Database times are UTC without a marker, so add one before formatting.
function formatTime(value) {
    if (!value) return '';
    const d = new Date(String(value).replace(' ', 'T') + 'Z');
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function dollars(cents) {
    return (Number(cents || 0) / 100).toFixed(2);
}

function describeAudit(entry) {
    const action = String(entry.action || '').replace(/_/g, ' ');
    const from = entry.previous_state && entry.previous_state.status;
    const to = entry.new_state && entry.new_state.status;
    return from && to && from !== to ? `${action} (${from} to ${to})` : action;
}

export default function ProjectPage() {
    const { id } = useParams();
    const [project, setProject] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [role, setRole] = useState(loadRole);
    const [copied, setCopied] = useState(false);
    const requestCounter = useRef(0);

    const load = useCallback(
        async ({ silent = false } = {}) => {
            const requestId = ++requestCounter.current;
            if (!silent) setLoading(true);
            try {
                const data = await getProject(id);
                if (requestId !== requestCounter.current) return;
                setProject(data);
                setError(null);
            } catch (err) {
                if (requestId !== requestCounter.current) return;
                setError({ message: err.message, notFound: err.status === 404 });
            } finally {
                if (requestId === requestCounter.current) setLoading(false);
            }
        },
        [id]
    );

    useEffect(() => {
        setProject(null);
        setError(null);
        load();
    }, [load]);

    useEffect(() => {
        try {
            localStorage.setItem(ROLE_KEY, role);
        } catch (e) {
            // Ignore storage problems
        }
    }, [role]);

    const refresh = useCallback(() => load({ silent: true }), [load]);

    const copyId = async () => {
        try {
            await navigator.clipboard.writeText(id);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (e) {
            setCopied(false);
        }
    };

    if (loading && !project) {
        return (
            <div className="container" aria-busy="true">
                <p className="muted">Loading project...</p>
            </div>
        );
    }

    if (!project) {
        return (
            <div className="container stack" style={{ maxWidth: '680px' }}>
                <div className="card stack">
                    <h1 style={{ fontSize: '1.3rem', fontWeight: 700 }}>
                        {error && error.notFound ? 'Project not found' : 'Could not load the project'}
                    </h1>
                    <p className="muted pre-wrap">
                        {error && error.notFound
                            ? 'Check the project ID and try again.'
                            : error
                                ? error.message
                                : 'Something went wrong.'}
                    </p>
                    <div className="row">
                        {!(error && error.notFound) && (
                            <button className="btn-primary" onClick={() => load()}>
                                Try again
                            </button>
                        )}
                        <Link to="/" className="btn-secondary" style={{ textDecoration: 'none' }}>
                            Back to home
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    const milestones = project.milestones || [];
    const totalCents = milestones.reduce((sum, m) => sum + (m.amount_cents || 0), 0);
    const paidCents = milestones
        .filter((m) => m.status === 'paid')
        .reduce((sum, m) => sum + (m.amount_cents || 0), 0);

    const titleById = {};
    milestones.forEach((m) => {
        titleById[m.id] = m.title;
    });
    const auditEntries = [...(project.audit_log || [])].reverse().slice(0, 60);

    return (
        <div className="container stack" style={{ maxWidth: '820px' }}>
            <div className="card stack">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <h1 style={{ fontSize: '1.4rem', fontWeight: 700 }}>{project.title}</h1>
                        {project.description && (
                            <p className="pre-wrap muted" style={{ marginTop: '0.25rem' }}>
                                {project.description}
                            </p>
                        )}
                    </div>
                    <Link to="/" className="btn-secondary" style={{ textDecoration: 'none', fontSize: '0.8rem' }}>
                        Home
                    </Link>
                </div>

                <div className="row" style={{ gap: '0.5rem' }}>
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                        Project ID:
                    </span>
                    <span className="mono" style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>
                        {id}
                    </span>
                    <button className="btn-secondary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }} onClick={copyId}>
                        {copied ? 'Copied' : 'Copy ID'}
                    </button>
                </div>

                <div className="row" style={{ gap: '1.5rem' }}>
                    <div>
                        <div className="muted" style={{ fontSize: '0.75rem' }}>Total</div>
                        <div className="mono" style={{ fontWeight: 600 }}>${dollars(totalCents)} USD</div>
                    </div>
                    <div>
                        <div className="muted" style={{ fontSize: '0.75rem' }}>Paid out</div>
                        <div className="mono" style={{ fontWeight: 600 }}>${dollars(paidCents)} USD</div>
                    </div>
                    <div>
                        <div className="muted" style={{ fontSize: '0.75rem' }}>Milestones</div>
                        <div className="mono" style={{ fontWeight: 600 }}>{milestones.length}</div>
                    </div>
                </div>

                <div className="stack" style={{ gap: '0.4rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                    <div className="row" style={{ gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Viewing as:</span>
                        <div role="group" aria-label="Demo role" className="row" style={{ gap: '0.4rem' }}>
                            <button
                                className={role === 'Client' ? 'btn-primary' : 'btn-secondary'}
                                aria-pressed={role === 'Client'}
                                onClick={() => setRole('Client')}
                            >
                                Client
                            </button>
                            <button
                                className={role === 'Freelancer' ? 'btn-primary' : 'btn-secondary'}
                                aria-pressed={role === 'Freelancer'}
                                onClick={() => setRole('Freelancer')}
                            >
                                Freelancer
                            </button>
                        </div>
                    </div>
                    <div className="muted" style={{ fontSize: '0.75rem' }}>
                        Demo only: this app has no login. Use the switch to act as the client (funds, verifies, approves)
                        or the freelancer (submits work).
                    </div>
                </div>
            </div>

            {error && (
                <div className="alert-error row" role="alert" style={{ justifyContent: 'space-between' }}>
                    <span className="pre-wrap">Could not refresh the project: {error.message}</span>
                    <button className="btn-secondary" onClick={() => load({ silent: true })}>
                        Try again
                    </button>
                </div>
            )}

            <div className="stack" style={{ gap: '0.5rem' }}>
                {milestones.map((m) => (
                    <MilestoneCard key={m.id} milestone={m} role={role} onRefresh={refresh} />
                ))}
            </div>

            <details className="card">
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                    Activity log ({auditEntries.length})
                </summary>
                <ul className="stack" style={{ listStyle: 'none', paddingLeft: 0, gap: '0.4rem', marginTop: '0.75rem' }}>
                    {auditEntries.map((entry) => (
                        <li key={entry.id} style={{ fontSize: '0.8rem' }}>
                            <span className="muted">{formatTime(entry.created_at)}</span>{' '}
                            <span style={{ fontWeight: 600 }}>
                                {entry.entity_type === 'milestone' ? titleById[entry.entity_id] || 'Milestone' : 'Project'}
                            </span>
                            : <span className="pre-wrap">{describeAudit(entry)}</span>
                        </li>
                    ))}
                </ul>
            </details>
        </div>
    );
}