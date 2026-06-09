import type { preHandlerHookHandler } from 'fastify';
import { activeProjectId } from '@so/sdk';
import { createAuthService, hasPermission, type AuthUser } from './service.js';
import { SESSION_COOKIE } from './routes.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/** Fastify preHandler: require a valid session AND the given permission. */
export function requirePermission(permission: string): preHandlerHookHandler {
  return async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return reply.code(401).send({ error: 'unauthenticated' });
    const auth = createAuthService(req.server.ctx.db);
    const user = await auth.validateSession(token);
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });
    if (!hasPermission(user.permissions, permission)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    req.user = user;
  };
}

/**
 * Fastify preHandler: require the authenticated user to be a member of the
 * active project (from the `X-Project` header). Must be chained AFTER
 * `requirePermission`, which populates `req.user`. Org-admins (wildcard `*`
 * permission) bypass the membership check.
 */
export function requireProjectMembership(): preHandlerHookHandler {
  return async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });
    if (user.permissions.includes('*')) return; // org-admin bypass
    const projectId = activeProjectId(req.headers);
    const rows = await req.server.ctx.db.query(
      `SELECT 1 AS ok FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, user.id],
    );
    if (!rows[0]) return reply.code(403).send({ error: 'not a member of this project' });
  };
}
