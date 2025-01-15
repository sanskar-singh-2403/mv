export interface RegisterUserDto {
    email: string;
    password: string;
  }
  
  export interface LoginUserDto {
    email: string;
    password: string;
  }
  
  export interface JWTPayload {
    userId: string;
    email: string;
  }
  
  export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
  }
  