import express, { Response } from 'express';
import dotenv from 'dotenv';
import movieRoutes from './routes/movieRoutes';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3002;

// Routes
app.use('/api/movies', movieRoutes);

// Error-handling middleware
app.use(
  (err: any, res: Response) => {
    console.error(err.stack); // Log the error
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
);

app.listen(PORT, () => {
  console.log(`Movie Service running on port ${PORT}`);
});
