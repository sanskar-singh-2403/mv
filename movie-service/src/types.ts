export enum MovieStatus {
    UPCOMING = 'UPCOMING',
    NOW_SHOWING = 'NOW_SHOWING',
    ENDED = 'HIGHLIGHTS'
  }
  
  export enum SeatStatus {
    AVAILABLE = 'AVAILABLE',
    BOOKED = 'BOOKED',
    LOCKED = 'LOCKED'
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
    layout: any;
    created_at: Date;
    updated_at: Date;
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