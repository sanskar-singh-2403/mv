import express from 'express';
import cors from 'cors';
import { db, redis, lock, constants, bookingQueue, cleanup } from './config';
import { v4 as uuidv4 } from 'uuid';
import { BookingRequest, BookingStatus, SeatStatus } from './types';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

const app = express();

app.use(cors());
app.use(express.json());

// Add rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use(limiter);

// Validation schemas
const BookingRequestSchema = z.object({
  showId: z.string().uuid(),
  seatIds: z.array(z.string().uuid()).min(1).max(10), // Maximum 10 seats per booking
  userId: z.string().uuid(),
  isChild: z.array(z.boolean())
});

const ReleaseSeatSchema = z.object({
  showId: z.string().uuid(),
  seatIds: z.array(z.string().uuid()).min(1)
});

// Helper functions
const validateShowTime = async (showId: string, client: any): Promise<boolean> => {
  const { rows } = await client.query(
    'SELECT start_time FROM shows WHERE id = $1 AND start_time > NOW()',
    [showId]
  );
  return rows.length > 0;
};

const validateSeatsForShow = async (showId: string, seatIds: string[], client: any): Promise<boolean> => {
  const { rows } = await client.query(
    'SELECT COUNT(*) as count FROM show_seats WHERE show_id = $1 AND seat_id = ANY($2)',
    [showId, seatIds]
  );
  console.log(rows[0].count);
  // console.log(seatIds);
  console.log(seatIds.length);
  return parseInt(rows[0].count) === seatIds.length;
};

const releaseLocks = async (locks: Array<{lock: any, key: string}>) => {
  await Promise.allSettled(
    locks.map(async ({lock}) => {
      try {
        await lock.release();
      } catch (error) {
        console.error('Lock release error:', error);
        // Implement monitoring alert
      }
    })
  );
};

// Queue processor
bookingQueue.process(async (job) => {
  const { showId, seatIds, userId } = job.data;
  const locks: Array<{lock: any, key: string}> = [];
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');

    // Validate show timing
    const isValidShow = await validateShowTime(showId, client);
    if (!isValidShow) {
      throw new Error('Show has already started or does not exist');
    }

    // Validate seats belong to show
    const areValidSeats = await validateSeatsForShow(showId, seatIds, client);
    if (!areValidSeats) {
      throw new Error('Invalid seats for this show');
    }

    // Acquire locks first
    for (const seatId of seatIds) {
      const lockKey = `lock:${showId}:${seatId}`;
      const lockInstance = await lock.acquire([lockKey], constants.LOCK_TTL);
      locks.push({ lock: lockInstance, key: lockKey });
    }

    // Check seat availability after acquiring locks
    const { rows } = await client.query(
      `SELECT id, status FROM show_seats 
       WHERE show_id = $1 AND seat_id = ANY($2) 
       FOR UPDATE`,
      [showId, seatIds]
    );

    if (rows.length !== seatIds.length || rows.some(row => row.status !== SeatStatus.AVAILABLE)) {
      throw new Error('Seats not available');
    }

    // Update seat status to locked
    await client.query(
      'UPDATE show_seats SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE show_id = $2 AND seat_id = ANY($3)',
      [SeatStatus.LOCKED, showId, seatIds]
    );

    await redis.del(`show:${showId}:seats`);

    const lockInfo = {
      userId,
      seatIds,
      timestamp: Date.now(),
    };

    // Store lock info in Redis with timeout
    const lockKey = `booking:${showId}:${userId}`;
    await redis.setex(
      lockKey,
      constants.BOOKING_TIMEOUT,
      JSON.stringify(lockInfo)
    );

    const jobResult = { success: true, message: 'Seats locked successfully' };
    await redis.set(`job:${job.id}`, JSON.stringify(jobResult), 'EX', 300);

    await client.query('COMMIT');
    return jobResult;

  } catch (error) {
    await client.query('ROLLBACK');
    const errorResult = { 
      success: false, 
      message: error instanceof Error ? error.message : 'Unknown error'
    };
    await redis.set(`job:${job.id}`, JSON.stringify(errorResult), 'EX', 300);
    throw error;
  } finally {
    await releaseLocks(locks);
    client.release();
  }
});

// API Endpoints

// Lock seats (adds to queue)
app.post('/api/bookings/lock', async (req, res) => {
  try {
    const validatedData = BookingRequestSchema.parse(req.body);
    const { showId, seatIds, userId } = validatedData;

    const job = await bookingQueue.add({
      showId,
      seatIds,
      userId
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    });

    res.status(202).json({ 
      message: 'Booking request queued',
      jobId: job.id
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request parameters', details: error.errors });
    } else {
      console.error('Error queuing booking request:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Check lock status
app.get('/api/bookings/lock/:jobId', async (req, res) => {
  const { jobId } = req.params;

  try {
    const jobResult = await redis.get(`job:${jobId}`);
    if (jobResult) {
      res.json(JSON.parse(jobResult));
      return;
    }

    const job = await bookingQueue.getJob(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    const state = await job.getState();
    res.json({ state, result: job.returnvalue });
  } catch (error) {
    console.error('Error checking job status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Confirm booking
app.post('/api/bookings', async (req, res) => {
  const client = await db.connect();
  
  try {
    const bookingRequest = BookingRequestSchema.parse(req.body);
    await client.query('BEGIN');
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');

    // Verify lock exists and is valid
    const lockKey = `booking:${bookingRequest.showId}:${bookingRequest.userId}`;
    const lockData = await redis.get(lockKey);

    if (!lockData) {
      throw new Error('Seat lock expired or not found');
    }

    const parsedLockData = JSON.parse(lockData);
    
    // Verify seats match the locked seats
    if (!bookingRequest.seatIds.every(id => parsedLockData.seatIds.includes(id))) {
      throw new Error('Seat selection does not match locked seats');
    }

    // Get show details for pricing
    const { rows: [show] } = await client.query(
      'SELECT adult_price, child_price FROM shows WHERE id = $1',
      [bookingRequest.showId]
    );

    if (!show) {
      throw new Error('Show not found');
    }

    // Calculate total amount
    const totalAmount = bookingRequest.isChild.reduce((sum, isChild) => 
      sum + (isChild ? show.child_price : show.adult_price), 0);

    // Create booking
    const bookingId = uuidv4();
    await client.query(
      `INSERT INTO bookings (id, show_id, user_id, seat_ids, total_amount, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [bookingId, bookingRequest.showId, bookingRequest.userId, bookingRequest.seatIds, 
       totalAmount, BookingStatus.CONFIRMED]
    );

    // Update seat status to BOOKED
    await client.query(
      'UPDATE show_seats SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE show_id = $2 AND seat_id = ANY($3)',
      [SeatStatus.BOOKED, bookingRequest.showId, bookingRequest.seatIds]
    );

    await client.query('COMMIT');

    // Invalidate relevant caches
    await redis.del(`show:${bookingRequest.showId}:seats`);

    res.status(201).json({ bookingId });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request parameters', details: error.errors });
    } else {
      console.error('Error creating booking:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  } finally {
    client.release();
    // Remove lock from Redis
    const lockKey = `booking:${req.body.showId}:${req.body.userId}`;
    await redis.del(lockKey);
  }
});

// Release seats
app.post('/api/bookings/release', async (req, res) => {
  const client = await db.connect();

  try {
    const validatedData = ReleaseSeatSchema.parse(req.body);
    const { showId, seatIds } = validatedData;

    await client.query('BEGIN');
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');

    const { rows } = await client.query(
      'UPDATE show_seats SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE show_id = $2 AND seat_id = ANY($3) AND status = $4 RETURNING id',
      [SeatStatus.AVAILABLE, showId, seatIds, SeatStatus.LOCKED]
    );

    await redis.del(`show:${showId}:seats`);

    if (rows.length !== seatIds.length) {
      throw new Error('Some seats could not be released');
    }

    await client.query('COMMIT');

    // Invalidate relevant caches
    await redis.del(`show:${showId}:seats`);

    res.status(200).json({ message: 'Seats released successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request parameters', details: error.errors });
    } else {
      console.error('Error releasing seats:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  } finally {
    client.release();
  }
});

// Cleanup expired locks
const cleanUpExpiredLocks = async () => {
  const client = await db.connect();
  try {
    // Get locks that are more than BOOKING_TIMEOUT old
    const { rows: expiredLocks } = await client.query(
      `SELECT show_id, seat_id 
       FROM show_seats 
       WHERE status = $1 
       AND updated_at < NOW() - INTERVAL '${constants.BOOKING_TIMEOUT} seconds'`,
      [SeatStatus.LOCKED]
    );

    if (expiredLocks.length > 0) {
      // Group by show_id for efficient updates
      const showSeatsMap = expiredLocks.reduce((acc, lock) => {
        if (!acc[lock.show_id]) {
          acc[lock.show_id] = [];
        }
        acc[lock.show_id].push(lock.seat_id);
        return acc;
      }, {});

      await client.query('BEGIN');

      // Update each show's expired seats
      for (const [showId, seatIds] of Object.entries(showSeatsMap)) {
        await client.query(
          `UPDATE show_seats 
           SET status = $1, updated_at = CURRENT_TIMESTAMP 
           WHERE show_id = $2 AND seat_id = ANY($3::uuid[])`,
          [SeatStatus.AVAILABLE, showId, seatIds]
        );

        // Invalidate theater service cache
        await redis.del(`show:${showId}:seats`);
      }

      await client.query('COMMIT');
      console.log(`Released ${expiredLocks.length} expired locks`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error during lock cleanup:', error);
  } finally {
    client.release();
  }
};

// Run cleanup every minute
const cleanupInterval = setInterval(cleanUpExpiredLocks, 60000);

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('Starting graceful shutdown...');
  clearInterval(cleanupInterval);
  await cleanup();
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
app.listen(constants.PORT, () => {
  console.log(`Booking service running on port ${constants.PORT}`);
});