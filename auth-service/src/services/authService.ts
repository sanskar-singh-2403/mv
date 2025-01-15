import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { hashPassword, comparePasswords } from '../utils/password';
import { RegisterUserDto, LoginUserDto, JWTPayload } from '../types';

export class AuthService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async register(userData: RegisterUserDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: userData.email }
    });

    if (existingUser) {
      throw new Error('User already exists');
    }

    const hashedPassword = await hashPassword(userData.password);

    const user = await this.prisma.user.create({
      data: {
        email: userData.email,
        password_hash: hashedPassword
      }
    });

    const token = this.generateToken(user);

    return {
      user: {
        id: user.id,
        email: user.email
      },
      token
    };
  }

  async login(loginData: LoginUserDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: loginData.email }
    });

    if (!user) {
      throw new Error('Invalid credentials');
    }

    const isPasswordValid = await comparePasswords(
      loginData.password, 
      user.password_hash
    );

    if (!isPasswordValid) {
      throw new Error('Invalid credentials');
    }

    const token = this.generateToken(user);

    return {
      user: {
        id: user.id,
        email: user.email
      },
      token
    };
  }

  private generateToken(user: { id: string; email: string }): string {
    const payload: JWTPayload = {
      userId: user.id,
      email: user.email
    };

    return jwt.sign(payload, process.env.JWT_SECRET!, {
      expiresIn: process.env.JWT_EXPIRES_IN
    });
  }
}
