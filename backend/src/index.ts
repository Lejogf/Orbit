// Backend entry point.
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './lib/http.js';
import { resolveProvider } from './data/provider.js';
import { prisma } from './lib/prisma.js';
import { DEMO_USERNAME } from './data/sync.js';

export function createApp(): express.Express {
  const app = express();

  // credentials:true so the session cookie survives the dev-server origin hop.
  app.use(cors({ origin: true, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

async function main(): Promise<void> {
  await resolveProvider();

  // Databases seeded before usernames existed: give the demo account its handle.
  await prisma.customer.updateMany({
    where: { isDemoUser: true, username: null },
    data: { username: DEMO_USERNAME },
  });

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[server] Orbit API listening on http://localhost:${config.port}`);
    console.log(`[server] Health: http://localhost:${config.port}/api/health`);
  });

  // Close cleanly so a restart doesn't trip over a locked SQLite file.
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[server] ${signal} received, shutting down.`);
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[server] Failed to start:', error);
  process.exit(1);
});
