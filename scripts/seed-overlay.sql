CREATE TABLE IF NOT EXISTS object_writeback (
  org_id      text        NOT NULL DEFAULT 'org_default',
  object_type text        NOT NULL,
  primary_key text        NOT NULL,
  property    text        NOT NULL,
  value       text,
  version     int         NOT NULL DEFAULT 1,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, object_type, primary_key, property, version)
);

CREATE TABLE IF NOT EXISTS object_created (
  org_id      text        NOT NULL DEFAULT 'org_default',
  object_type text        NOT NULL,
  primary_key text        NOT NULL,
  payload     jsonb       NOT NULL,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, object_type, primary_key)
);

-- deterministic seed for the spike: wipe then insert
TRUNCATE object_writeback;
TRUNCATE object_created;

-- an Action edited FL-204's status from base 'On time' to 'Delayed'
INSERT INTO object_writeback (object_type, primary_key, property, value)
VALUES ('SpikeFlight', 'FL-204', 'status', 'Delayed');

-- an Action created a net-new flight not present in the base dataset
INSERT INTO object_created (object_type, primary_key, payload)
VALUES ('SpikeFlight', 'FL-900',
  '{"flightNumber":"FL-900","status":"Scheduled","departureAt":"2026-05-29 14:00:00","seats":120}');
