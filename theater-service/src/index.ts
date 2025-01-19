import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { createClient } from 'redis';
import { Theater, Screen, Show } from './types';

const app = express();
app.use(express.json());

const pool = new Pool({
  user: 'movieapp',
  password: 'secretpass',
  host: 'postgres',
  database: 'moviebooking',
  port: 5432
});

const redis = createClient({
  url: process.env.REDIS_URL
});
redis.connect().catch(console.error);

app.post('/api/theaters', async (req: Request, res: Response) => {
  const { name, location } = req.body;

  try {
    const result = await pool.query<Theater>(
      'INSERT INTO theaters (name, location) VALUES ($1, $2) RETURNING *',
      [name, location]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/theaters/:theaterId/screens', async (req: Request, res: Response) => {
  const { theaterId } = req.params;
  const { screenNumber, layout } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const screenResult = await client.query<Screen>(
      'INSERT INTO screens (screen_number, theater_id, layout) VALUES ($1, $2, $3) RETURNING *',
      [screenNumber, theaterId, layout]
    );

    const screen = screenResult.rows[0];
    const { rows, seatsPerRow } = layout;

    const seatData: { screenId: string; number: string }[] = [];
    for (let row = 1; row <= rows; row++) {
      for (let seat = 1; seat <= seatsPerRow; seat++) {
        seatData.push({
          screenId: screen.id,
          number: `R${row}S${seat}`,
        });
      }
    }

    const CHUNK_SIZE = 1000;
    const chunks = Array.from({ length: Math.ceil(seatData.length / CHUNK_SIZE) }, (_, i) =>
      seatData.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
    );

    const insertPromises = chunks.map(chunk => {
      const values: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      chunk.forEach(({ screenId, number }) => {
        values.push(`($${paramIndex}, $${paramIndex + 1})`);
        params.push(screenId, number);
        paramIndex += 2;
      });

      const query = `
        INSERT INTO seats (screen_id, number)
        VALUES ${values.join(', ')}
      `;
      return client.query(query, params);
    });

    await Promise.all(insertPromises);

    await client.query('COMMIT');

    const response = {
      ...screen,
      totalSeats: rows * seatsPerRow,
    };

    res.status(201).json(response);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

app.post('/api/shows', async (req: Request, res: Response) => {
  const {
    movieId,
    theaterId,
    screenId,
    screenNumber,
    adultPrice,
    childPrice,
    startTime,
    endTime
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const showResult = await client.query<Show>(
      `INSERT INTO shows (
        movie_id, theater_id, screen_id, screen_number,
        adult_price, child_price, start_time, end_time
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [movieId, theaterId, screenId, screenNumber, adultPrice, childPrice, startTime, endTime]
    );

    const show = showResult.rows[0];

    const seatResult = await client.query(
      'SELECT id FROM seats WHERE screen_id = $1',
      [screenId]
    );

    for (const seat of seatResult.rows) {
      await client.query(
        'INSERT INTO show_seats (show_id, seat_id, status) VALUES ($1, $2, $3)',
        [show.id, seat.id, 'AVAILABLE']
      );
    }

    await client.query('COMMIT');
    res.status(201).json(show);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

app.get('/api/movies/:movieId/theaters', async (req: Request, res: Response) => {
  const { movieId } = req.params;
  const cacheKey = `movie:${movieId}:theaters`;

  try {
    const cachedTheaters = await redis.get(cacheKey);
    if (cachedTheaters) {
      res.json({ source: 'cache', data: JSON.parse(cachedTheaters) });
      return;
    }

    const result = await pool.query(
      `SELECT DISTINCT t.* 
       FROM theaters t
       JOIN shows s ON t.id = s.theater_id
       WHERE s.movie_id = $1
       AND s.start_time > NOW()
       ORDER BY t.name`,
      [movieId]
    );

    await redis.set(cacheKey, JSON.stringify(result.rows), { EX: 1800 });
    res.json({ source: 'db', data: result.rows });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/movies/:movieId/theaters/:theaterId/shows', async (req: Request, res: Response) => {
  const { movieId, theaterId } = req.params;
  const cacheKey = `movie:${movieId}:theater:${theaterId}:shows`;

  try {
    const cachedShows = await redis.get(cacheKey);
    if (cachedShows) {
      res.json({ source: 'cache', data: JSON.parse(cachedShows) });
      return;
    }

    const result = await pool.query(
      `SELECT s.*, sc.screen_number
       FROM shows s
       JOIN screens sc ON s.screen_id = sc.id
       WHERE s.movie_id = $1 
       AND s.theater_id = $2
       AND s.start_time > NOW()
       ORDER BY s.start_time`,
      [movieId, theaterId]
    );

    await redis.set(cacheKey, JSON.stringify(result.rows), { EX: 1800 });
    res.json({ source: 'db', data: result.rows });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/shows/:showId/seats', async (req: Request, res: Response) => {
  const { showId } = req.params;
  const cacheKey = `show:${showId}:seats`;

  try {
    const cachedSeats = await redis.get(cacheKey);
    if (cachedSeats) {
      res.json({ source: 'cache', data: JSON.parse(cachedSeats) });
      return;
    }

    const result = await pool.query(
      `SELECT sc.layout, ss.id as show_seat_id, s.id as seat_id, s.number as seat_number, 
              COALESCE(ss.status, 'AVAILABLE') as status
       FROM shows sh
       JOIN screens sc ON sh.screen_id = sc.id
       JOIN seats s ON s.screen_id = sc.id
       LEFT JOIN show_seats ss ON ss.show_id = sh.id AND ss.seat_id = s.id
       WHERE sh.id = $1
       ORDER BY s.number`,
      [showId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Show not found' });
      return;
    }

    const response = {
      layout: result.rows[0].layout,
      seats: result.rows.map(row => ({
        id: row.seat_id,
        showSeatId: row.show_seat_id,
        number: row.seat_number,
        status: row.status
      }))
    };

    await redis.set(cacheKey, JSON.stringify(response), { EX: 1800 });
    res.json({ source: 'db', data: response });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`Theater service running on port ${PORT}`);
});

process.on('SIGINT', async () => {
  await redis.quit();
  await pool.end();
  process.exit();
});