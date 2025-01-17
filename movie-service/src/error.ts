export class AppError extends Error {
    public statusCode: number;
  
    constructor(message: string, statusCode: number = 500) {
      super(message);
      this.statusCode = statusCode;
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  export class NotFoundError extends AppError {
    constructor(message: string) {
      super(message, 404);
    }
  }
  
  export class ConflictError extends AppError {
    constructor(message: string) {
      super(message, 409);
    }
  }