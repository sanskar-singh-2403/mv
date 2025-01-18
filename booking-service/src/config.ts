// config.ts
import { Pool, PoolConfig } from 'pg';
import Redis from 'ioredis';
import Redlock from 'redlock';
import Bull from 'bull';
import dotenv from 'dotenv';

dotenv.config();

// Environment validation
const requiredEnvVars = [
  'DATABASE_URL',
  'REDIS_URL',
  'LOCK_TTL',
  'BOOKING_TIMEOUT',
  'QUEUE_JOB_TIMEOUT',
  'QUEUE_JOB_ATTEMPTS'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// PostgreSQL configuration
const poolConfig: PoolConfig = {
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_SIZE || '20'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

export const db = new Pool(poolConfig);

// Test database connection
db.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

db.on('connect', () => {
  console.log('Database connected successfully');
});

// Redis configuration
const redisConfig = {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  retryStrategy(times: number) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  reconnectOnError(err: Error) {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      return true;
    }
    return false;
  },
};

// Redis client for general operations
export const redis = new Redis(process.env.REDIS_URL!, redisConfig);

// Redis client for Redlock
const redlockClient = new Redis(process.env.REDIS_URL!, redisConfig);

// Configure Redlock for distributed locking
export const lock = new Redlock(
  [redlockClient],
  {
    driftFactor: 0.01,
    retryCount: parseInt(process.env.REDLOCK_RETRY_COUNT || '10'),
    retryDelay: parseInt(process.env.REDLOCK_RETRY_DELAY || '200'),
    retryJitter: parseInt(process.env.REDLOCK_RETRY_JITTER || '200'),
    automaticExtensionThreshold: 500,
  }
);

// Configure Bull queue
const bullConfig = {
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: true,
    timeout: parseInt(process.env.QUEUE_JOB_TIMEOUT!),
    attempts: parseInt(process.env.QUEUE_JOB_ATTEMPTS!),
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
  settings: {
    stalledInterval: 30000,
    maxStalledCount: 3,
  },
};

export const bookingQueue = new Bull('booking-requests', process.env.REDIS_URL!, bullConfig);

// Environment constants
export const constants = {
  LOCK_TTL: parseInt(process.env.LOCK_TTL!),
  BOOKING_TIMEOUT: parseInt(process.env.BOOKING_TIMEOUT!),
  PORT: parseInt(process.env.PORT || '3004'),
  CLEANUP_INTERVAL: parseInt(process.env.CLEANUP_INTERVAL || '60000'),
  BATCH_SIZE: parseInt(process.env.CLEANUP_BATCH_SIZE || '100'),
};

// Redis event handlers with error handling
redis.on('error', (err) => {
  console.error('Redis Error:', err);
  // Implement your error monitoring/alerting here
});

redis.on('connect', () => {
  console.log('Redis Connected');
});

redis.on('ready', () => {
  console.log('Redis Ready');
});

// Redlock event handlers
redlockClient.on('error', (err) => {
  console.error('Redlock Error:', err);
  // Implement your error monitoring/alerting here
});

// Queue event handlers with proper logging
bookingQueue.on('error', (err) => {
  console.error('Bull Queue Error:', err);
  // Implement your error monitoring/alerting here
});

bookingQueue.on('waiting', (jobId) => {
  console.log(`Job ${jobId} is waiting`);
});

bookingQueue.on('active', (job) => {
  console.log(`Job ${job.id} has started`);
});

bookingQueue.on('completed', (job) => {
  console.log(`Job ${job.id} has completed`);
});

bookingQueue.on('failed', (job, err) => {
  console.error(`Job ${job?.id} has failed:`, err);
  // Implement your error monitoring/alerting here
});

bookingQueue.on('stalled', (job) => {
  console.warn(`Job ${job?.id} has stalled`);
  // Implement your monitoring/alerting here
});

// Cleanup function for graceful shutdown
export const cleanup = async () => {
  try {
    console.log('Cleaning up resources...');
    
    const dbPromise = db.end().catch(err => {
      console.error('Error closing database pool:', err);
    });

    const redisPromise = redis.quit().catch(err => {
      console.error('Error closing Redis connection:', err);
    });

    const redlockPromise = redlockClient.quit().catch(err => {
      console.error('Error closing Redlock connection:', err);
    });

    const queuePromise = bookingQueue.close().catch(err => {
      console.error('Error closing Bull queue:', err);
    });

    await Promise.allSettled([
      dbPromise,
      redisPromise,
      redlockPromise,
      queuePromise
    ]);

    console.log('Cleanup completed');
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  }
};