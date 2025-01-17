// src/config.ts
import { Pool } from 'pg';
import Redis from 'ioredis';
import Redlock from 'redlock';
import Bull from 'bull';
import dotenv from 'dotenv';

dotenv.config();

// PostgreSQL configuration
export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Test database connection
db.query('SELECT NOW()', (err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Database connected successfully');
  }
});

// Redis client for general operations
export const redis = new Redis(process.env.REDIS_URL!);

// Redis client for Redlock
const redlockClient = new Redis(process.env.REDIS_URL!);

// Configure Redlock for distributed locking
export const lock = new Redlock(
  [redlockClient],
  {
    driftFactor: 0.01,
    retryCount: 10,
    retryDelay: 200,
    retryJitter: 200,
    automaticExtensionThreshold: 500,
  }
);

// Create Bull queue for booking requests
export const bookingQueue = new Bull('booking-requests', process.env.REDIS_URL!, {
  defaultJobOptions: {
    removeOnComplete: true,   // Remove jobs from queue once completed
    removeOnFail: true,       // Remove jobs from queue even if they fail
    timeout: parseInt(process.env.QUEUE_JOB_TIMEOUT || '5000'),
    attempts: parseInt(process.env.QUEUE_JOB_ATTEMPTS || '3')
  }
});

// Environment constants
export const constants = {
  LOCK_TTL: parseInt(process.env.LOCK_TTL || '300000'),
  BOOKING_TIMEOUT: parseInt(process.env.BOOKING_TIMEOUT || '300'),
  PORT: parseInt(process.env.PORT || '3004')
};

// Redis event handlers
redis.on('error', (err) => console.error('Redis Error:', err));
redis.on('connect', () => console.log('Redis Connected'));

// Redlock event handlers
redlockClient.on('error', (err) => console.error('Redlock Error:', err));
redlockClient.on('connect', () => console.log('Redlock Connected'));

// Queue event handlers
bookingQueue.on('error', (err) => {
  console.error('Bull Queue Error:', err);
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
});

// Export cleanup function for graceful shutdown
export const cleanup = async () => {
  await db.end();
  await redis.quit();
  await redlockClient.quit();
  await bookingQueue.close();
};