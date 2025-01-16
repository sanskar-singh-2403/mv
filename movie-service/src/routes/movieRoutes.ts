import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { cacheGet, cacheSet, cacheDelete } from '../redis';

const prisma = new PrismaClient();
const router = Router();

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const cacheKey = `movie:${id}`;

    const cachedMovie = await cacheGet(cacheKey);
    if (cachedMovie) {
      res.json({ source: 'cache', data: cachedMovie });
      return;
    }

    const movie = await prisma.movie.findUnique({ where: { id } });
    if (!movie) {
      res.status(404).json({ error: 'Movie not found' });
      return;
    }

    await cacheSet(cacheKey, movie, 3600);
    res.json({ source: 'database', data: movie });
  });


  router.get('/status/:status', async (req: Request<{ status: string }>, res: Response): Promise<void> => {
    const { status } = req.params;
    const { page = 1, limit = 10 } = req.query as { page: string; limit: string };
    const cacheKey = `movies:status:${status}:page:${page}:limit:${limit}`;
  
    try {
      // Check cache
      const cachedMovies = await cacheGet(cacheKey);
      if (cachedMovies) {
        res.json({ source: 'cache', data: cachedMovies });
        return;
      }
  
      // Fetch from DB with pagination
      const movies = await prisma.movie.findMany({
        where: { status: status.toUpperCase() as any },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        select: {
          id: true,
          title: true,
          description: true,
          posterUrl: true,
          imdbRating: true,
          appRating: true,
          releaseDate: true,
        },
      });

      await cacheSet(cacheKey, movies, 600);
  
      res.json({ source: 'database', data: movies });
    } catch (error) {
      res.status(500).json({ error: 'Error fetching movies', details: error.message });
    }
  });

router.post('/', async (req: Request, res: Response): Promise<void> => {
    const { title, description, duration, releaseDate, posterUrl, trailerUrl, imdbRating, appRating, status } = req.body;

    const newMovie = await prisma.movie.create({
      data: { title, description, duration, releaseDate, posterUrl, trailerUrl, imdbRating, appRating, status },
    });

    await cacheDelete('movies:all');

    res.status(201).json(newMovie);
  });

export default router;
