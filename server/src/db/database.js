import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve db path from environment or default to server/data/milestonepay.db
const defaultDbPath = path.resolve(__dirname, '../../data/milestonepay.db');
const dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : defaultDbPath;

// Ensure target directory exists
const targetDir = path.dirname(dbPath);
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const db = new Database(dbPath);

// Enable foreign key constraints
db.pragma('foreign_keys = ON');

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    client_email TEXT,
    freelancer_email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS milestones (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    brief TEXT,
    acceptance_criteria TEXT,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_funding' CHECK (status IN ('pending_funding', 'funded', 'submitted', 'verified', 'rejected', 'needs_review', 'paid')),
    fund_attempt_count INTEGER NOT NULL DEFAULT 0,
    paypal_order_id TEXT,
    authorization_id TEXT,
    capture_id TEXT,
    authorized_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    milestone_id TEXT NOT NULL,
    deliverable_url TEXT,
    content TEXT,
    notes TEXT,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS verifications (
    id TEXT PRIMARY KEY,
    milestone_id TEXT NOT NULL,
    submission_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    model_decision TEXT,
    confidence REAL,
    requirements TEXT,
    feedback TEXT,
    reason TEXT,
    service_error INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE CASCADE,
    FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    previous_state TEXT,
    new_state TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_milestones_project_id ON milestones(project_id);
  CREATE INDEX IF NOT EXISTS idx_submissions_milestone_id ON submissions(milestone_id);
  CREATE INDEX IF NOT EXISTS idx_verifications_milestone_id ON verifications(milestone_id);
`);

// Migration: check if capture_id exists via PRAGMA table_info, only ALTER TABLE if missing
const milestoneCols = db.prepare('PRAGMA table_info(milestones)').all();
const hasCaptureId = milestoneCols.some((col) => col.name === 'capture_id');
if (!hasCaptureId) {
  db.exec('ALTER TABLE milestones ADD COLUMN capture_id TEXT');
}

// Prepared statement for writing audit log entries
const insertAuditLogStmt = db.prepare(`
  INSERT INTO audit_log (id, entity_type, entity_id, action, previous_state, new_state, details)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

/**
 * Record an audit log entry using a prepared statement.
 */
export function recordAuditLog({
  entityType,
  entityId,
  action,
  previousState = null,
  newState = null,
  details = null,
}) {
  const id = crypto.randomUUID();
  insertAuditLogStmt.run(
    id,
    entityType,
    entityId,
    action,
    previousState ? JSON.stringify(previousState) : null,
    newState ? JSON.stringify(newState) : null,
    details ? JSON.stringify(details) : null
  );
}

export default db;

