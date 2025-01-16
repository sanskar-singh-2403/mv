import express, { Response } from 'express';
import dotenv from 'dotenv';
import movieRoutes from './routes/movieRoutes';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3002;

app.use('/api/movies', movieRoutes);

app.use(
  (err: any, res: Response) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
);

app.listen(PORT, () => {
  console.log(`Movie Service running on port ${PORT}`);
});
