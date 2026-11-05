import express from 'express';
import cors from 'cors';
import projectsRouter from './routes/projects.js';
import milestonesRouter from './routes/milestones.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Basic health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount resource routers
app.use('/api/projects', projectsRouter);
app.use('/api/milestones', milestonesRouter);

// 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` });
});

// Centralized error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    return res.status(status).json({ error: 'Internal server error' });
  }
  return res.status(status).json({ error: err.message || 'Client error' });
});

export default app;

