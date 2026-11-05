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
`);

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

