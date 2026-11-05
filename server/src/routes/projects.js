import express from 'express';
import crypto from 'crypto';
import db, { recordAuditLog } from '../db/database.js';

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Prepared statements for projects
const insertProjectStmt = db.prepare(`
  INSERT INTO projects (id, title, description, client_email, freelancer_email)
  VALUES (?, ?, ?, ?, ?)
`);

const insertMilestoneStmt = db.prepare(`
  INSERT INTO milestones (id, project_id, title, brief, acceptance_criteria, amount_cents)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const selectProjectStmt = db.prepare(`
  SELECT * FROM projects WHERE id = ?
`);

const selectMilestonesStmt = db.prepare(`
  SELECT * FROM milestones WHERE project_id = ? ORDER BY rowid ASC
`);

const selectSubmissionsStmt = db.prepare(`
  SELECT * FROM submissions WHERE milestone_id = ? ORDER BY rowid ASC
`);

const selectAuditLogsStmt = db.prepare(`
  SELECT * FROM audit_log WHERE entity_id = ? OR entity_id IN (
    SELECT id FROM milestones WHERE project_id = ?
  ) ORDER BY created_at ASC, rowid ASC
`);

/**
 * POST /api/projects
 * Create a project and its milestones.
 */
router.post('/', (req, res) => {
  const { title, description, client_email, freelancer_email, milestones } = req.body;

  if (!title || typeof title !== 'string' || title.trim() === '') {
    return res.status(400).json({ error: 'Project title is required and must be non-empty.' });
  }

  if (title.trim().length > 200) {
    return res.status(400).json({ error: 'Project title cannot exceed 200 characters.' });
  }

  if (description && (typeof description !== 'string' || description.length > 2000)) {
    return res.status(400).json({ error: 'Project description cannot exceed 2000 characters.' });
  }

  if (client_email) {
    if (typeof client_email !== 'string' || !EMAIL_REGEX.test(client_email.trim())) {
      return res.status(400).json({ error: 'Invalid client_email format.' });
    }
  }

  if (freelancer_email) {
    if (typeof freelancer_email !== 'string' || !EMAIL_REGEX.test(freelancer_email.trim())) {
      return res.status(400).json({ error: 'Invalid freelancer_email format.' });
    }
  }

  if (!Array.isArray(milestones) || milestones.length === 0) {
    return res.status(400).json({ error: 'At least one milestone is required.' });
  }

  // Validate milestones input
  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i];
    if (!m.title || typeof m.title !== 'string' || m.title.trim() === '') {
      return res.status(400).json({ error: `Milestone at index ${i} is missing a valid title.` });
    }
    if (m.title.trim().length > 200) {
      return res.status(400).json({ error: `Milestone at index ${i} title cannot exceed 200 characters.` });
    }
    if (m.brief && (typeof m.brief !== 'string' || m.brief.length > 5000)) {
      return res.status(400).json({ error: `Milestone at index ${i} brief cannot exceed 5000 characters.` });
    }
    if (m.acceptance_criteria && (typeof m.acceptance_criteria !== 'string' || m.acceptance_criteria.length > 5000)) {
      return res.status(400).json({
        error: `Milestone at index ${i} acceptance_criteria cannot exceed 5000 characters.`,
      });
    }
    if (!Number.isInteger(m.amount_cents) || m.amount_cents <= 0) {
      return res.status(400).json({
        error: `Milestone at index ${i} ('${m.title}') must have amount_cents as a positive integer.`,
      });
    }
  }

  const projectId = crypto.randomUUID();

  // Execute in a transaction
  const createProjectTx = db.transaction(() => {
    insertProjectStmt.run(
      projectId,
      title.trim(),
      description ? description.trim() : null,
      client_email ? client_email.trim() : null,
      freelancer_email ? freelancer_email.trim() : null
    );

    recordAuditLog({
      entityType: 'project',
      entityId: projectId,
      action: 'created',
      newState: {
        title: title.trim(),
        client_email: client_email ? client_email.trim() : null,
        freelancer_email: freelancer_email ? freelancer_email.trim() : null,
        milestone_count: milestones.length,
      },
    });

    const createdMilestones = [];

    for (const m of milestones) {
      const milestoneId = crypto.randomUUID();
      insertMilestoneStmt.run(
        milestoneId,
        projectId,
        m.title.trim(),
        m.brief ? m.brief.trim() : null,
        m.acceptance_criteria ? m.acceptance_criteria.trim() : null,
        m.amount_cents
      );

      recordAuditLog({
        entityType: 'milestone',
        entityId: milestoneId,
        action: 'created',
        newState: {
          project_id: projectId,
          title: m.title.trim(),
          amount_cents: m.amount_cents,
          status: 'pending_funding',
        },
      });

      createdMilestones.push({
        id: milestoneId,
        project_id: projectId,
        title: m.title.trim(),
        brief: m.brief ? m.brief.trim() : null,
        acceptance_criteria: m.acceptance_criteria ? m.acceptance_criteria.trim() : null,
        amount_cents: m.amount_cents,
        status: 'pending_funding',
      });
    }

    return createdMilestones;
  });

  try {
    const createdMilestones = createProjectTx();
    const project = selectProjectStmt.get(projectId);
    return res.status(201).json({
      ...project,
      milestones: createdMilestones,
    });
  } catch (error) {
    return res.status(500).json({ error: `Failed to create project: ${error.message}` });
  }
});

/**
 * GET /api/projects/:id
 * Retrieve project with milestones, submissions, and audit log.
 */
router.get('/:id', (req, res) => {
  const { id } = req.params;

  const project = selectProjectStmt.get(id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found.' });
  }

  const milestones = selectMilestonesStmt.all(id);

  // Attach submissions to each milestone
  const milestonesWithSubmissions = milestones.map((m) => {
    const submissions = selectSubmissionsStmt.all(m.id);
    return {
      ...m,
      submissions,
    };
  });

  const auditLogs = selectAuditLogsStmt.all(id, id).map((log) => ({
    ...log,
    previous_state: log.previous_state ? JSON.parse(log.previous_state) : null,
    new_state: log.new_state ? JSON.parse(log.new_state) : null,
    details: log.details ? JSON.parse(log.details) : null,
  }));

  return res.json({
    ...project,
    milestones: milestonesWithSubmissions,
    audit_log: auditLogs,
  });
});

export default router;

