import type { FastifyInstance } from 'fastify';

export async function healthRoute(app: FastifyInstance) {
  app.get('/health', { schema: { hide: true } }, async () => ({
    ok: true,
    service: 'brightloop-api',
    time: new Date().toISOString(),
  }));
}
