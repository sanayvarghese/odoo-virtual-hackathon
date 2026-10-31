import { db, pool } from './db/client.js';
import { buildApp } from './app.js';
import { env, corsOrigins } from './env.js';

async function main() {
  const app = await buildApp();

  app.listen({ port: env.PORT, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`\n🟢 Brightloop API ready at ${address}`);
    console.log(`   Docs   : ${address}/docs`);
    console.log(`   Health : ${address}/api/v1/health`);
    console.log(`   CORS   : ${corsOrigins.join(', ')}`);
    console.log(`   AI     : ${env.OLLAMA_URL} (${env.OLLAMA_MODEL})\n`);
  });

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      await app.close();
      await pool.end();
      process.exit(0);
    });
  }
}

// fail fast if db unreachable
try {
  await db.execute('SELECT 1');
} catch (e) {
  console.error('\n❌ Cannot reach PostgreSQL. Is it running? (.env: DATABASE_URL)');
  console.error((e as Error).message);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
