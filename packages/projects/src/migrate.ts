import { applyMigrations, type Db } from '@so/sdk';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS projects (
    id text PRIMARY KEY,
    org_id text NOT NULL,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
  )`,
  `INSERT INTO projects(id, org_id, name) VALUES ('project_default', 'org_default', 'Default') ON CONFLICT DO NOTHING`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS description text`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS project_members (
    project_id text NOT NULL,
    user_id    text NOT NULL,
    role       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
  )`,
  `INSERT INTO project_members(project_id,user_id,role)
     SELECT p.id, u.id, 'editor' FROM projects p JOIN users u ON u.org_id = p.org_id
     ON CONFLICT DO NOTHING`,
  `UPDATE project_members SET role='owner'
     WHERE user_id IN (SELECT ur.user_id FROM user_roles ur
                       JOIN role_permissions rp ON rp.role_id = ur.role_id
                       WHERE rp.permission_key = '*')`,
];

export async function runMigrations(db: Db): Promise<void> {
  await applyMigrations(db, 'projects', MIGRATIONS);
}
