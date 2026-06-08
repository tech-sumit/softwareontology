import { applyMigrations, type Db } from '@so/sdk';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS object_types (
     id text PRIMARY KEY,
     org_id text NOT NULL,
     api_name text NOT NULL,
     dataset_id text NOT NULL,
     primary_key text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (org_id, api_name)
   )`,
  `CREATE TABLE IF NOT EXISTS object_properties (
     object_type_id text NOT NULL REFERENCES object_types(id),
     ordinal int NOT NULL,
     api_name text NOT NULL,
     column_name text NOT NULL,
     prop_type text NOT NULL,
     PRIMARY KEY (object_type_id, ordinal)
   )`,
  `CREATE TABLE IF NOT EXISTS link_types (
     id text PRIMARY KEY,
     org_id text NOT NULL,
     api_name text NOT NULL,
     from_object_type_id text NOT NULL REFERENCES object_types(id),
     to_object_type_id text NOT NULL REFERENCES object_types(id),
     foreign_key_property text NOT NULL,
     UNIQUE (org_id, api_name)
   )`,
  `CREATE TABLE IF NOT EXISTS object_functions (
     object_type_id text NOT NULL REFERENCES object_types(id),
     ordinal int NOT NULL,
     api_name text NOT NULL,
     expression text NOT NULL,
     prop_type text NOT NULL,
     PRIMARY KEY (object_type_id, ordinal)
   )`,
  // Write-back overlay — the resolution contract. Resolver (@so/query) reads these;
  // the actions module (Plan 7) writes them. Created here so resolution works with
  // an empty overlay even before actions exist.
  `CREATE TABLE IF NOT EXISTS object_writeback (
     org_id text NOT NULL DEFAULT 'org_default',
     object_type text NOT NULL,
     primary_key text NOT NULL,
     property text NOT NULL,
     value text,
     version int NOT NULL DEFAULT 1,
     updated_by text,
     updated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (org_id, object_type, primary_key, property, version)
   )`,
  `CREATE TABLE IF NOT EXISTS object_created (
     org_id text NOT NULL DEFAULT 'org_default',
     object_type text NOT NULL,
     primary_key text NOT NULL,
     payload jsonb NOT NULL,
     created_by text,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (org_id, object_type, primary_key)
   )`,
  `ALTER TABLE object_properties ADD COLUMN IF NOT EXISTS required_permission text`,
  `ALTER TABLE object_writeback ADD COLUMN IF NOT EXISTS branch text NOT NULL DEFAULT 'main'`,
  `ALTER TABLE object_created ADD COLUMN IF NOT EXISTS branch text NOT NULL DEFAULT 'main'`,
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.key_column_usage WHERE table_name='object_created' AND constraint_name='object_created_pkey' AND column_name='primary_key')
        AND NOT EXISTS (SELECT 1 FROM information_schema.key_column_usage WHERE table_name='object_created' AND constraint_name='object_created_pkey' AND column_name='branch') THEN
       ALTER TABLE object_created DROP CONSTRAINT object_created_pkey;
       ALTER TABLE object_created ADD PRIMARY KEY (org_id, object_type, primary_key, branch);
     END IF;
   END $$`,
  `CREATE TABLE IF NOT EXISTS branches (
     id text PRIMARY KEY, org_id text NOT NULL, name text NOT NULL,
     status text NOT NULL DEFAULT 'open', created_by text,
     created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (org_id, name)
   )`,
];

export async function runMigrations(db: Db): Promise<void> {
  await applyMigrations(db, 'ontology', MIGRATIONS);
}
