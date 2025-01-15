import express from 'express';
import { AuthController } from '../controllers/authController';
import { validateRegistration } from "../middleware/validate";

const router = express.Router();
const authController = new AuthController();

router.post('/register', validateRegistration, authController.register.bind(authController));
router.post('/login', validateRegistration, authController.login.bind(authController));

export default router;