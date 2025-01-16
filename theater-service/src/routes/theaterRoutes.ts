import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { cacheGet, cacheSet, cacheDelete } from '../utils/cache';

const prisma = new PrismaClient();
const router = Router();

// Add a Theater
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { name, location } = req.body;
  try {
    const newTheater = await prisma.theater.create({ data: { name, location } });
    await cacheDelete('theaters:all');
    res.status(201).json(newTheater);
  } catch (error) {
    res.status(500).json({ error: 'Error creating theater', details: error.message });
  }
});

// Get all Theaters
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const cacheKey = 'theaters:all';
    const cachedTheaters = await cacheGet(cacheKey);
    if (cachedTheaters) {
      res.json({ source: 'cache', data: cachedTheaters });
      return;
    }

    const theaters = await prisma.theater.findMany();
    await cacheSet(cacheKey, theaters, 600);
    res.json({ source: 'database', data: theaters });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching theaters', details: error.message });
  }
});

// Add a Screen to a Theater
router.post('/:theaterId/screens', async (req: Request, res: Response): Promise<void> => {
  const { theaterId } = req.params;
  const { screenNumber, layout } = req.body;
  try {
    const newScreen = await prisma.screen.create({ data: { theaterId, screenNumber, layout } });
    await cacheDelete(`theater:${theaterId}:screens`);
    res.status(201).json(newScreen);
  } catch (error) {
    res.status(500).json({ error: 'Error creating screen', details: error.message });
  }
});

// Get Screens for a Theater
router.get('/:theaterId/screens', async (req: Request, res: Response): Promise<void> => {
  const { theaterId } = req.params;
  try {
    const cacheKey = `theater:${theaterId}:screens`;
    const cachedScreens = await cacheGet(cacheKey);
    if (cachedScreens) {
      res.json({ source: 'cache', data: cachedScreens });
      return;
    }

    const screens = await prisma.screen.findMany({ where: { theaterId } });
    await cacheSet(cacheKey, screens, 600);
    res.json({ source: 'database', data: screens });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching screens', details: error.message });
  }
});

// Add Seats to a Screen
router.post('/screens/:screenId/seats', async (req: Request, res: Response): Promise<void> => {
  const { screenId } = req.params;
  const { rows, seatsPerRow } = req.body;
  try {
    const seatData = [];
    for (let row = 1; row <= rows; row++) {
      for (let seat = 1; seat <= seatsPerRow; seat++) {
        const seatNumber = `R${row}S${seat}`;
        seatData.push({ screenId, number: seatNumber });
      }
    }

    const newSeats = await prisma.seat.createMany({ data: seatData });
    await cacheDelete(`screen:${screenId}:seats`);
    res.status(201).json({ message: 'Seats added successfully', count: newSeats.count });
  } catch (error) {
    res.status(500).json({ error: 'Error creating seats', details: error.message });
  }
});

// Add a Show
router.post('/:theaterId/screens/:screenId/shows', async (req: Request, res: Response): Promise<void> => {
  const { theaterId, screenId } = req.params;
  const { movieId, screenNumber, adultPrice, childPrice, startTime, endTime } = req.body;
  try {
    const newShow = await prisma.show.create({
      data: { theaterId, screenId, movieId, screenNumber, adultPrice, childPrice, startTime, endTime },
    });
    await cacheDelete(`theater:${theaterId}:shows`);
    res.status(201).json(newShow);
  } catch (error) {
    res.status(500).json({ error: 'Error creating show', details: error.message });
  }
});

// Get Shows for a Theater
router.get('/:theaterId/shows', async (req: Request, res: Response): Promise<void> => {
  const { theaterId } = req.params;
  try {
    const cacheKey = `theater:${theaterId}:shows`;
    const cachedShows = await cacheGet(cacheKey);
    if (cachedShows) {
      res.json({ source: 'cache', data: cachedShows });
      return;
    }

    const shows = await prisma.show.findMany({ where: { theaterId } });
    await cacheSet(cacheKey, shows, 600);
    res.json({ source: 'database', data: shows });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching shows', details: error.message });
  }
});

export default router;