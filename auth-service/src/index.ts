import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/authRoutes';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});