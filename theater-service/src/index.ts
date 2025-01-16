import express from 'express';
import dotenv from 'dotenv';
import theaterRoutes from './routes/theaterRoutes';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3003;

// Register routes
app.use('/api/theaters', theaterRoutes);

// Start the server
app.listen(PORT, () => {
  console.log(`Theater Service running on port ${PORT}`);
});
