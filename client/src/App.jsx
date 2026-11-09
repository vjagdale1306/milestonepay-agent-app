import React from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import HomePage from './pages/HomePage.jsx';
import CreateProjectPage from './pages/CreateProjectPage.jsx';
import ProjectPage from './pages/ProjectPage.jsx';

function NotFound() {
    return (
        <div className="container stack" style={{ maxWidth: '680px' }}>
            <div className="card stack">
                <h1 style={{ fontSize: '1.3rem', fontWeight: 700 }}>Page not found</h1>
                <p className="muted">That page does not exist.</p>
                <div>
                    <Link to="/" className="btn-primary" style={{ display: 'inline-block', textDecoration: 'none' }}>
                        Back to home
                    </Link>
                </div>
            </div>
        </div>
    );
}

export default function App() {
    return (
        <>
            <header style={{ background: '#ffffff', borderBottom: '1px solid var(--border-color)' }}>
                <div
                    className="container row"
                    style={{ justifyContent: 'space-between', paddingTop: '0.75rem', paddingBottom: '0.75rem' }}
                >
                    <Link to="/" style={{ fontWeight: 700, color: 'var(--text-main)', textDecoration: 'none' }}>
                        MilestonePay Agent
                    </Link>
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                        PayPal sandbox demo: test money only
                    </span>
                </div>
            </header>

            <main>
                <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/projects/new" element={<CreateProjectPage />} />
                    <Route path="/projects/:id" element={<ProjectPage />} />
                    <Route path="*" element={<NotFound />} />
                </Routes>
            </main>
        </>
    );
}