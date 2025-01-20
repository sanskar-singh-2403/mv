import { Pool } from 'pg';
import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

// PostgreSQL configuration
export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Redis client
export const redis = createClient({
  url: process.env.REDIS_URL
});

redis.connect().catch(console.error);

// JWT Configuration
export const JWT_CONFIG = {
  accessToken: {
    secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
    expiresIn: '1h'
  },
  refreshToken: {
    secret: process.env.JWT_REFRESH_SECRET || 'refresh_secret',
    expiresIn: '7d'
  }
};

// OTP Configuration
export const OTP_CONFIG = {
  length: 6,
  expiresIn: 10 * 60, // 10 minutes in seconds
  resendDelay: 60 // 1 minute in seconds
};

// Rate limiting configuration
export const RATE_LIMIT = {
  signup: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5 // 5 attempts per hour
  },
  signin: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5 // 5 attempts per 15 minutes
  },
  verifyOTP: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3 // 3 attempts per 15 minutes
  }
};

// Export cleanup function
export const cleanup = async () => {
  await db.end();
  await redis.quit();
};