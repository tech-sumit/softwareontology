// Shared module list for the production server + worker entrypoints.
// The kernel loads these in dependency order, so array order is not significant.
import auth from '@so/auth';
import datasets from '@so/datasets';
import ontology from '@so/ontology';
import actions from '@so/actions';
import admin from '@so/admin';
import connectorsDb from '@so/connectors-db';
import connectorsCloud from '@so/connectors-cloud';
import connectorsAirflow from '@so/connectors-airflow';
import pipelines from '@so/pipelines';
import catalog from '@so/catalog';
import lineage from '@so/lineage';
import dashboards from '@so/dashboards';
import governance from '@so/governance';
import aip from '@so/aip';
import automations from '@so/automations';
import apps from '@so/apps';
import openapi from '@so/openapi';

export const modules = [
  auth,
  datasets,
  ontology,
  actions,
  admin,
  connectorsDb,
  connectorsCloud,
  connectorsAirflow,
  pipelines,
  catalog,
  lineage,
  dashboards,
  governance,
  aip,
  automations,
  apps,
  openapi,
];
