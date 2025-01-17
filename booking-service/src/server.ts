import express from 'express';
import cors from 'cors';
import { db, redis, lock, constants, bookingQueue, cleanup } from './config';
import { v4 as uuidv4 } from 'uuid';
import { BookingRequest, BookingStatus } from './types';

const app = express();

app.use(cors());
app.use(express.json());

// Queue processor
bookingQueue.process(async (job) => {
  const { showId, seatIds, userId } = job.data;
  const locks = [];
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // Check if seats are available using FOR UPDATE to lock the rows
    const { rows } = await client.query(
      `SELECT id, status FROM show_seats 
       WHERE show_id = $1 AND seat_id = ANY($2) 
       FOR UPDATE SKIP LOCKED`,
      [showId, seatIds]
    );

    if (rows.length !== seatIds.length || rows.some(row => row.status !== 'AVAILABLE')) {
      throw new Error('Seats not available');
    }

    // Acquire distributed locks
    for (const seatId of seatIds) {
      const lockKey = `lock:${showId}:${seatId}`;
      const lockInstance = await lock.acquire([lockKey], constants.LOCK_TTL);
      locks.push({ lock: lockInstance, key: lockKey });
    }

    // Update seat status to LOCKED
    await client.query(
      'UPDATE show_seats SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE show_id = $2 AND seat_id = ANY($3)',
      ['LOCKED', showId, seatIds]
    );

    // Store the result of the job in Redis
    const jobResult = { success: true, message: 'Seats locked successfully' };
    await redis.set(`job:${job.id}`, JSON.stringify(jobResult), 'EX', 300); // Expire after 5 minutes

    await client.query('COMMIT');
    return jobResult;

  } catch (error) {
    await client.query('ROLLBACK');

    // Store failure result in Redis
    const errorResult = { success: false, message: error };
    await redis.set(`job:${job.id}`, JSON.stringify(errorResult), 'EX', 300); // Expire after 5 minutes

    throw error;
  } finally {
    // Release all locks
    for (const lock of locks) {
      try {
        await lock.lock.release();
      } catch (error) {
        console.error('Error releasing lock:', error);
      }
    }
    client.release();
  }
});

// API Endpoints

// Lock seats (adds to queue)
app.post('/api/bookings/lock', async (req, res): Promise<void> => {
  const { showId, seatIds, userId } = req.body;

  if (!showId || !seatIds || !userId || !Array.isArray(seatIds) || seatIds.length === 0) {
    res.status(400).json({ error: 'Invalid request parameters' });
    return;
  }

  try {
    const job = await bookingQueue.add({
      showId,
      seatIds,
      userId
    });

    res.status(202).json({ 
      message: 'Booking request queued',
      jobId: job.id
    });
  } catch (error) {
    console.error('Error queuing booking request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check lock status
app.get('/api/bookings/lock/:jobId', async (req, res): Promise<void> => {
  const { jobId } = req.params;

  try {
    // First check Redis for the job result
    const jobResult = await redis.get(`job:${jobId}`);
    if (jobResult) {
      res.json(JSON.parse(jobResult));
      return;
    }

    // Fallback to checking the Bull queue
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
  const bookingRequest: BookingRequest = req.body;
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // Verify lock exists and is valid
    const lockKey = `booking:${bookingRequest.showId}:${bookingRequest.userId}`;
    const lockData = await redis.get(lockKey);

    if (!lockData) {
      throw new Error('Seat lock expired or not found');
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
      ['BOOKED', bookingRequest.showId, bookingRequest.seatIds]
    );

    await client.query('COMMIT');
    res.status(201).json({ bookingId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
    // Remove lock from Redis
    await redis.del(`booking:${bookingRequest.showId}:${bookingRequest.userId}`);
  }
});

// Release seats (if payment fails or timeout)
app.post('/api/bookings/release', async (req, res) => {
  const { showId, seatIds } = req.body;
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      'UPDATE show_seats SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE show_id = $2 AND seat_id = ANY($3)',
      ['AVAILABLE', showId, seatIds]
    );

    await client.query('COMMIT');
    res.status(200).json({ message: 'Seats released successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error releasing seats:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('Starting graceful shutdown...');
  await cleanup();
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
app.listen(constants.PORT, () => {
  console.log(`Booking service running on port ${constants.PORT}`);
});
