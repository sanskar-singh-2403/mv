import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { createClient } from 'redis';
import { Movie, MovieStatus } from './types';

const app = express();
app.use(express.json());

const pool = new Pool({
  user: 'movieapp',
  password: 'secretpass',
  host: 'localhost',
  database: 'moviebooking',
  port: 5432
});

const redis = createClient({
  url: process.env.REDIS_URL
});
redis.connect().catch(console.error);


// Get movie by ID
app.get('/api/movies/:id', async (req: Request, res: Response):Promise<void> => {
  const { id } = req.params;
  const cacheKey = `movie:${id}`;

  try {
    const cachedMovie = await redis.get(cacheKey);
    if (cachedMovie) {
      res.json({ source: 'cache', data: JSON.parse(cachedMovie) });
      return;
    }

    const result = await pool.query<Movie>(
      'SELECT * FROM movies WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Movie not found' });
      return;
    }

    await redis.set(cacheKey, JSON.stringify(result.rows[0]), {
      EX: 3600
    });
    res.json({ source: 'db', data: result.rows[0] });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/movies/status/:status', async (req: Request<{ status: MovieStatus }>, res: Response): Promise<void> => {
  const { status } = req.params;
  const { page = '1', limit = '10' } = req.query as { page: string; limit: string };
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const cacheKey = `movies:status:${status}:page:${page}:limit:${limit}`;

  try {
    const cachedMovies = await redis.get(cacheKey);
    if (cachedMovies) {
      res.json({ source: 'cache', data: JSON.parse(cachedMovies) });
      return;
    }

    const result = await pool.query<Movie>(
      'SELECT * FROM movies WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [status, limit, offset]
    );

    await redis.set(cacheKey, JSON.stringify(result.rows), {EX: 600});
    res.json({ source: 'db', data: result.rows });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
});

// Add a movie
app.post('/api/movies', async (req: Request, res: Response) => {
  const {
    title,
    description,
    duration,
    releaseDate,
    posterUrl,
    trailerUrl,
    imdbRating,
    appRating,
    status
  } = req.body;

  try {
    const result = await pool.query<Movie>(
      `INSERT INTO movies (
        title, description, duration, release_date, 
        poster_url, trailer_url, imdb_rating, app_rating, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        title, description, duration, releaseDate,
        posterUrl, trailerUrl, imdbRating, appRating, status
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`Movie service running on port ${PORT}`);
});

process.on('SIGINT', async () => {
  await redis.quit();
  await pool.end();
  process.exit();
});