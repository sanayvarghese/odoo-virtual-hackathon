import type { FastifyInstance } from 'fastify';
import { requireAuth, requireRole, requireAuthHook } from '../plugins/auth.js';
import { runBilling } from '../services/billing.service.js';

/**
 * Scene: "Nobody should be typing invoices by hand."
 * One admin click fans out to every subscription due today; reruns are safe
 * (the (subscription_id, period_start) unique key makes double-billing impossible).
 */
export default async function billingRoutes(app: FastifyInstance) {
  app.post(
    '/run',
    { schema: { tags: ['billing'] }, preHandler: requireRole('admin', 'staff') },
    async (req) => {
      req.csrfValidate();
      const user = requireAuth(req);
      const result = await runBilling(user.id);
      return result;
    },
  );
}
