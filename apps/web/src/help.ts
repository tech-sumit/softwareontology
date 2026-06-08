export type HelpEntry = { title: string; steps: string[] };
export const HELP: Record<string, HelpEntry> = {
  // ---- Project context ----
  'project:overview': { title: 'the project overview', steps: [
    'This is your project home. The KPI cards count its datasets, pipelines, and apps.',
    'The activity feed shows recent pipeline runs; recent datasets show what has landed.',
    'On a new project, use the “Get started” cards to upload data, build a pipeline, add a connector, or build an app.',
    'Switch projects from the colored avatars in the far-left rail; the ⌂ icon opens the shared Console.',
  ]},
  'project:data': { title: 'Data', steps: [
    'Lists the datasets in this project. Click one to preview its rows and schema.',
    'To add data, use “Upload & model” for a CSV, or pull from a source under “Connectors”.',
    'Datasets are immutable Parquet; transforming them in Pipelines creates new derived datasets.',
  ]},
  'project:setup': { title: 'Upload & model', steps: [
    'Upload a CSV — it is stored as Parquet and registered as a dataset.',
    'Then model it: set an API name, pick the primary-key column, and map columns to typed properties.',
    'Modeled object types appear org-wide in the Console’s Ontology Explorer and Object Explorer.',
  ]},
  'project:pipelines': { title: 'Pipelines', steps: [
    'Create a pipeline: name it, choose a single SQL transform or a multi-step DAG, and set the output dataset.',
    'Add data-quality expectations (e.g. not-null, row-count) that gate the build.',
    'Run it manually, or set a cron schedule to run it automatically via the worker.',
    'Every run is recorded — open the runs list to see status, row counts, and build health.',
  ]},
  'project:connectors': { title: 'Connectors', steps: [
    'Connect an external source to ingest into a dataset: a Postgres table, an S3 object, a REST endpoint, or Airflow.',
    'Fill the connection form, create the connector, then click Sync to pull data.',
    'Each sync writes or updates a dataset you can preview under Data and model in the ontology.',
  ]},
  'project:apps': { title: 'Apps', steps: [
    'Build a low-code app by composing widgets (tables, metrics) over your object types.',
    'Save the app definition, then Run it to see the live, data-bound result.',
    'Apps are project-scoped; the ontology they read from is shared org-wide.',
  ]},
  'project:automations': { title: 'Automations', steps: [
    'An automation runs a follow-up action when an event fires (for example, after an action executes).',
    'Create one by choosing the trigger event and the action to run.',
    'Use automations to keep derived state in sync without manual steps.',
  ]},
  'project:settings': { title: 'project settings', steps: [
    'Rename the project or edit its description, then click “Save changes”.',
    'Add teammates under Members and set each one as viewer, editor, or owner.',
    'Only owners (and admins) can rename, archive, or manage members.',
    'Archiving hides a project from the workspace but preserves all its data.',
    'Restore an archived project anytime from the Console’s Archived section.',
    'The Default project cannot be archived.',
  ]},
  // ---- Console context ----
  'console:home': { title: 'the Console', steps: [
    'The Console is your shared workspace across all projects.',
    'Click a project card to open it; “New project” starts the creation flow.',
    'The platform tiles and the sidebar reach shared assets: ontology, lineage, catalog, dashboards, governance, API & SDK, and admin.',
  ]},
  'console:ontology': { title: 'the Ontology Explorer', steps: [
    'The ontology is shared across all projects. Pick an object type to manage it.',
    'Add computed functions (SQL expressions), define links to other types, and define actions.',
    'Click “Secure” on a property to require a permission to read it (property-level security).',
    'Use “New object type” to model a type from any project’s dataset.',
  ]},
  'console:explorer': { title: 'the Object Explorer', steps: [
    'Browse the actual objects of a type. Pick a type, then click a row to open its detail.',
    'The detail view resolves linked objects and lets you run actions on the object.',
    'Running an action is an ACID write-back; the new value shows on reload.',
  ]},
  'console:lineage': { title: 'Lineage', steps: [
    'Trace an object type back to its source dataset, the actions that write to it, and its links.',
    'Use this to understand impact before you change a dataset or pipeline.',
  ]},
  'console:catalog': { title: 'the Catalog', steps: [
    'Search across datasets, object types, and other assets from one box.',
    'The audit log records who did what — uploads, action executions, and more.',
    'The global search in the top bar lands you here.',
  ]},
  'console:dashboards': { title: 'Dashboards', steps: [
    'Build a group-by aggregation over an object set (count, sum, average) and view it as a bar chart.',
    'Pick the object type, the property to group by, and the metric.',
  ]},
  'console:governance': { title: 'Governance', steps: [
    'Markings are mandatory access controls. Create a marking (e.g. PII), apply it to a dataset, and grant clearance to roles.',
    'Reading a marked dataset requires clearance for every marking on it — not even an admin bypasses this.',
    'Markings propagate: derived datasets automatically inherit their sources’ markings.',
  ]},
  'console:apisdk': { title: 'API & SDK', steps: [
    'The platform publishes an OpenAPI 3.1 spec covering every endpoint.',
    'Generate a fully-typed client with `pnpm gen:client`, or call the REST API directly.',
    'Use this page to view the spec and copy endpoint details.',
  ]},
  'console:ask': { title: 'Ask', steps: [
    'Ask a natural-language question over your ontology.',
    'The AIP gateway routes to the configured LLM provider and answers grounded in your objects.',
    'Under Semantic search, pick a type, click Index once, then search it by meaning.',
  ]},
  'console:admin': { title: 'Admin', steps: [
    'Manage users, roles, and permissions here.',
    'Create a role with a set of permissions, then create users and assign them roles.',
    'Permissions gate every module — for example datasets:write or ontology:edit.',
  ]},
};
