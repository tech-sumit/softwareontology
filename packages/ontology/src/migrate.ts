import type { Db } from '@so/sdk';

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
];

export async function runMigrations(db: Db): Promise<void> {
  for (const sql of MIGRATIONS) await db.query(sql);
}
