import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db, redis, JWT_CONFIG, OTP_CONFIG, RATE_LIMIT, cleanup } from './config';
import { UserStatus } from './types';

const app = express();

app.use(cors({
  origin: ['http://localhost:3000'],
  methods: 'GET,POST,PUT,DELETE',
  allowedHeaders: 'Content-Type,Authorization'
}));
app.use(express.json());

// Validation schemas
const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const SigninSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

const VerifyOTPSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(OTP_CONFIG.length)
});

// Rate limiters
const signupLimiter = rateLimit(RATE_LIMIT.signup);
const signinLimiter = rateLimit(RATE_LIMIT.signin);
const verifyOTPLimiter = rateLimit(RATE_LIMIT.verifyOTP);

// Generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Cleanup job for expired OTPs and sessions
const cleanup_job = async () => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Delete expired OTPs
    await client.query(
      'DELETE FROM user_otps WHERE expires_at < NOW()'
    );

    // Delete expired sessions
    await client.query(
      'DELETE FROM user_sessions WHERE expires_at < NOW()'
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Cleanup job error:', error);
  } finally {
    client.release();
  }
};

// Start cleanup job
setInterval(cleanup_job, 60 * 60 * 1000); // Run every hour

// Signup endpoint
app.post('/api/auth/signup', signupLimiter, async (req, res):Promise<void> => {
  const client = await db.connect();
  
  try {
    const { email, password } = SignupSchema.parse(req.body);

    await client.query('BEGIN');

    // Check if email exists
    const existingUser = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      res.status(400).json({ error: 'Email already registered' });
      return;
    }

    // Create user
    const passwordHash = await bcrypt.hash(password, 10);
    const { rows: [user] } = await client.query(
      `INSERT INTO users (email, password_hash, status)
       VALUES ($1, $2, $3)
       RETURNING id, email`,
      [email, passwordHash, UserStatus.PENDING]
    );

    // Generate and store OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_CONFIG.expiresIn * 1000);

    await client.query(
      `INSERT INTO user_otps (user_id, otp, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, otp, expiresAt]
    );

    await client.query('COMMIT');

    // TODO: Send OTP via email service
    console.log(`OTP for ${email}: ${otp}`);

    res.status(201).json({
      message: 'User registered. Please verify your email with the OTP sent.',
      email: user.email
    });
  } catch (error) {
    await client.query('ROLLBACK');
    
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Verify OTP endpoint
app.post('/api/auth/verify', verifyOTPLimiter, async (req, res):Promise<void> => {
  const client = await db.connect();
  
  try {
    const { email, otp } = VerifyOTPSchema.parse(req.body);

    await client.query('BEGIN');

    // Get user and OTP
    const { rows: [user] } = await client.query(
      'SELECT id, status FROM users WHERE email = $1',
      [email]
    );

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (user.status === UserStatus.ACTIVE) {
      res.status(400).json({ error: 'Email already verified' });
      return;
    }

    const { rows: [userOTP] } = await client.query(
      `SELECT id, expires_at 
       FROM user_otps 
       WHERE user_id = $1 AND otp = $2 AND verified = false
       ORDER BY created_at DESC 
       LIMIT 1`,
      [user.id, otp]
    );

    if (!userOTP) {
      res.status(400).json({ error: 'Invalid OTP' });
      return;
    }

    if (new Date() > userOTP.expires_at) {
      res.status(400).json({ error: 'OTP expired' });
      return;
    }

    // Mark OTP as verified and activate user
    await client.query(
      'UPDATE user_otps SET verified = true WHERE id = $1',
      [userOTP.id]
    );

    await client.query(
      'UPDATE users SET status = $1 WHERE id = $2',
      [UserStatus.ACTIVE, user.id]
    );

    await client.query('COMMIT');

    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    
    console.error('Verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Signin endpoint
app.post('/api/auth/signin', signinLimiter, async (req, res):Promise<void> => {
  try {
    const { email, password } = SigninSchema.parse(req.body);

    // Get user
    const { rows: [user] } = await db.query(
      `SELECT id, email, password_hash, status, role 
       FROM users WHERE email = $1`,
      [email]
    );

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (user.status !== UserStatus.ACTIVE) {
      res.status(401).json({ error: 'Please verify your email first' });
      return;
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Generate tokens
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_CONFIG.accessToken.secret,
      { expiresIn: JWT_CONFIG.accessToken.expiresIn }
    );

    const refreshToken = jwt.sign(
      { userId: user.id },
      JWT_CONFIG.refreshToken.secret,
      { expiresIn: JWT_CONFIG.refreshToken.expiresIn }
    );

    // Store refresh token
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    await db.query(
      `INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, refreshTokenHash, expiresAt]
    );

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    console.error('Signin error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Resend OTP endpoint
app.post('/api/auth/resend-otp', verifyOTPLimiter, async (req, res):Promise<void> => {
  const client = await db.connect();
  
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);

    await client.query('BEGIN');

    // Get user
    const { rows: [user] } = await client.query(
      'SELECT id, status FROM users WHERE email = $1',
      [email]
    );

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (user.status === UserStatus.ACTIVE) {
      res.status(400).json({ error: 'Email already verified' });
      return;
    }

    // Check last OTP request
    const { rows: [lastOTP] } = await client.query(
      `SELECT created_at FROM user_otps 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [user.id]
    );

    if (lastOTP) {
      const timeSinceLastOTP = (Date.now() - lastOTP.created_at.getTime()) / 1000;
      if (timeSinceLastOTP < OTP_CONFIG.resendDelay) {
        res.status(400).json({ 
          error: `Please wait ${Math.ceil(OTP_CONFIG.resendDelay - timeSinceLastOTP)} seconds before requesting a new OTP`
        });
        return;
      }
    }

    // Generate and store new OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_CONFIG.expiresIn * 1000);

    await client.query(
      `INSERT INTO user_otps (user_id, otp, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, otp, expiresAt]
    );

    await client.query('COMMIT');

    // TODO: Send OTP via email service
    console.log(`New OTP for ${email}: ${otp}`);

    res.json({ message: 'New OTP sent successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    
    console.error('Resend OTP error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Signout endpoint
app.post('/api/auth/signout', async (req, res):Promise<void> => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400).json({ error: 'Refresh token required' });
    return;
  }

  try {
    const decoded = jwt.verify(refreshToken, JWT_CONFIG.refreshToken.secret) as { userId: string };

    // Delete session
    await db.query(
      'DELETE FROM user_sessions WHERE user_id = $1',
      [decoded.userId]
    );

    // Add token to blacklist in Redis
    const blacklistKey = `blacklist:${refreshToken}`;
    const expiresInMatch = JWT_CONFIG.refreshToken.expiresIn.match(/\d+/);
    if (!expiresInMatch) {
      throw new Error('Invalid expiresIn format');
    }
    const expiresIn = parseInt(expiresInMatch[0]);
    await redis.set(blacklistKey, '1', {
      EX: expiresIn
    });

    res.json({ message: 'Signed out successfully' });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    console.error('Signout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3005;

app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});

// Handle graceful shutdown
const gracefulShutdown = async () => {
  console.log('Starting graceful shutdown...');
  await cleanup();
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);