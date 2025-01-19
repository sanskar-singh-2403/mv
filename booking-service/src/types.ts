export enum MovieStatus {
  UPCOMING = 'UPCOMING',
  NOW_SHOWING = 'NOW_SHOWING',
  ENDED = 'ENDED'
}

export enum SeatStatus {
  AVAILABLE = 'AVAILABLE',
  BOOKED = 'BOOKED',
  LOCKED = 'LOCKED'
}

export enum BookingStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED'
}

export interface Movie {
  id: string;
  title: string;
  description: string;
  duration: number;
  release_date: Date;
  poster_url: string;
  trailer_url: string;
  imdb_rating: number;
  app_rating: number;
  status: MovieStatus;
  created_at: Date;
  updated_at: Date;
}

export interface Theater {
  id: string;
  name: string;
  location: string;
  created_at: Date;
  updated_at: Date;
}

export interface Screen {
  id: string;
  screen_number: number;
  theater_id: string;
  layout: ScreenLayout;
  created_at: Date;
  updated_at: Date;
}

export interface ScreenLayout {
  rows: number;
  seatsPerRow: number;
  aisles?: number[];
  gapRows?: number[];
}

export interface Show {
  id: string;
  movie_id: string;
  theater_id: string;
  screen_id: string;
  screen_number: number;
  adult_price: number;
  child_price: number;
  start_time: Date;
  end_time: Date;
  created_at: Date;
  updated_at: Date;
}

export interface Seat {
  id: string;
  screen_id: string;
  number: string;
  created_at: Date;
  updated_at: Date;
}

export interface ShowSeat {
  id: string;
  show_id: string;
  seat_id: string;
  status: SeatStatus;
  created_at: Date;
  updated_at: Date;
}

export interface BookingRequest {
  showId: string;
  userId: string;
  seatIds: string[];
  isChild: boolean[];
}

export interface Booking {
  id: string;
  show_id: string;
  user_id: string;
  seat_ids: string[];
  total_amount: number;
  status: BookingStatus;
  created_at: Date;
  updated_at: Date;
}

export interface LockInfo {
  userId: string;
  seatIds: string[];
  timestamp: number;
}

export interface JobResult {
  success: boolean;
  message: string;
}

export interface ApiResponse<T> {
  source?: 'cache' | 'db';
  data?: T;
  error?: string;
  details?: any;
}

export interface BookingLockResponse {
  message: string;
  jobId: string;
}

export interface JobStatusResponse {
  state?: string;
  result?: JobResult;
  error?: string;
}

export interface BookingConfirmationResponse {
  bookingId: string;
}