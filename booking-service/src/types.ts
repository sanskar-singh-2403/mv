// src/types.ts
export interface BookingRequest {
    showId: string;
    seatIds: string[];
    userId: string;
    isChild: boolean[];
  }
  
  export interface SeatLock {
    showId: string;
    seatId: string;
    userId: string;
    timestamp: number;
  }
  
  export enum BookingStatus {
    PENDING = 'PENDING',
    CONFIRMED = 'CONFIRMED',
    CANCELLED = 'CANCELLED'
  }
  
  // Schema for bookings table (to be used if table doesn't exist)
  export const bookingTableSchema = `
  CREATE TYPE booking_status AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');
  
  CREATE TABLE IF NOT EXISTS bookings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      show_id UUID NOT NULL REFERENCES shows(id),
      user_id UUID NOT NULL,
      seat_ids UUID[] NOT NULL,
      total_amount FLOAT NOT NULL,
      status booking_status NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
  CREATE INDEX IF NOT EXISTS idx_bookings_show ON bookings(show_id);
  CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
  `;