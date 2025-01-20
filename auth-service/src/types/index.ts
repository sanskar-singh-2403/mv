export enum UserStatus {
    PENDING = 'PENDING',
    ACTIVE = 'ACTIVE',
    SUSPENDED = 'SUSPENDED'
  }
  
  export enum UserRole {
    USER = 'USER',
    ADMIN = 'ADMIN'
  }
  
  export interface User {
    id: string;
    email: string;
    status: UserStatus;
    role: UserRole;
    created_at: Date;
    updated_at: Date;
  }
  
  export interface UserOTP {
    id: string;
    user_id: string;
    otp: string;
    expires_at: Date;
    verified: boolean;
    created_at: Date;
  }
  
  export interface UserSession {
    id: string;
    user_id: string;
    refresh_token_hash: string;
    expires_at: Date;
    created_at: Date;
  }

  interface JWTTokenConfig {
    secret: string;
    expiresIn: string;  // e.g., '15m', '7d'
  }
  
  interface JWTConfig {
    accessToken: JWTTokenConfig;
    refreshToken: JWTTokenConfig;
  }
  
  export const JWT_CONFIG: JWTConfig = {
    accessToken: {
      secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
      expiresIn: '15m'
    },
    refreshToken: {
      secret: process.env.JWT_REFRESH_SECRET || 'refresh_secret',
      expiresIn: '7d'
    }
  };