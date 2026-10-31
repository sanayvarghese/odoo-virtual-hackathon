import type { FastifyError, FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart, { type FastifyMultipartOptions } from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';

import { corsOrigins } from './env.js';
import { AppError } from './lib/errors.js';
import { authDecorators } from './plugins/auth.js';

import authRoutes from './routes/auth.routes.js';
import productRoutes from './routes/products.routes.js';
import variantRoutes from './routes/variants.routes.js';
import planRoutes from './routes/plans.routes.js';
import taxRoutes from './routes/tax-rules.routes.js';
import discountRoutes from './routes/discount.routes.js';
import customerRoutes from './routes/customers.routes.js';
import staffRoutes from './routes/staff.routes.js';
import quoteTemplateRoutes from './routes/qtemplates.routes.js';
import subscriptionRoutes from './routes/subscription.routes.js';
import billingRoutes from './routes/billing.routes.js';
import invoiceRoutes from './routes/invoice.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import reportRoutes from './routes/report.routes.js';
import aiRoutes from './routes/ai.routes.js';
import devRoutes from './routes/dev.routes.js';

import { healthRoute } from './routes/health.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });

  app.register(cors, { origin: corsOrigins, credentials: true });
  app.register(cookie, { secret: undefined, parseOptions: {} });
  app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    attachFieldsToBody: 'key-values',
  } as unknown as FastifyMultipartOptions);

  app.setErrorHandler((err: unknown, _req, reply) => {
    const e = err as FastifyError;
    if (e instanceof AppError) {
      reply.status(e.statusCode).send({
        error: { message: e.message, code: e.code, ...(e.details ? { details: e.details } : {}) },
      });
      return;
    }
    if (e.validation) {
      reply.status(400).send({
        error: {
          message: 'Validation failed on the request.',
          code: 'validation_error',
          details: e.validation.map((v: { instancePath?: string; message?: string }) => ({
            path: String(v.instancePath ?? ''),
            message: v.message ?? 'invalid',
          })),
        },
      });
      return;
    }
    const statusCode = e.statusCode ?? 500;
    if (statusCode >= 500) console.error('[unhandled]', err);
    reply.status(statusCode).send({
      error: {
        message: statusCode >= 500 ? 'Something went wrong on our side. Please retry.' : e.message,
        code: statusCode >= 500 ? 'internal' : 'validation_error',
      },
    });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: { message: 'Route not found.', code: 'not_found' } });
  });

  await app.register(swagger, {
    openapi: {
      info: { title: 'Brightloop API', version: '1.0.0', description: 'Subscription Management System' },
      servers: [{ url: '/api/v1' }],
      tags: [
        { name: 'auth' }, { name: 'products' }, { name: 'plans' }, { name: 'taxes' },
        { name: 'discounts' }, { name: 'customers' }, { name: 'staff' }, { name: 'templates' },
        { name: 'subscriptions' }, { name: 'billing' }, { name: 'invoices' }, { name: 'payments' },
        { name: 'reports' }, { name: 'ai' }, { name: 'dev' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  authDecorators(app);

  // every route module mounts under /api/v1 (plugin prefix encapsulation)
  for (const plugin of [
    healthRoute,
    authRoutes,
    productRoutes,
    variantRoutes,
    planRoutes,
    taxRoutes,
    discountRoutes,
    customerRoutes,
    staffRoutes,
    quoteTemplateRoutes,
    subscriptionRoutes,
    billingRoutes,
    invoiceRoutes,
    paymentRoutes,
    reportRoutes,
    aiRoutes,
    devRoutes,
  ]) {
    app.register(plugin, { prefix: '/api/v1' });
  }

  return app;
}
