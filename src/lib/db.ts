import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(db.$on as any)('error', (e: { message: string }) => logger.error('Database error', { message: e.message }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(db.$on as any)('warn', (e: { message: string }) => logger.warn('Database warning', { message: e.message }));

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}

export async function connectDb() {
  await db.$connect();
  logger.info('Database connected');
}

export async function disconnectDb() {
  await db.$disconnect();
  logger.info('Database disconnected');
}
