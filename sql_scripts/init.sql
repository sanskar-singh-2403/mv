CREATE TYPE movie_status AS ENUM ('UPCOMING', 'NOW_SHOWING', 'HIGHLIGHTS');
CREATE TYPE seat_status AS ENUM ('AVAILABLE', 'BOOKED', 'LOCKED');
CREATE TYPE booking_status AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

CREATE TABLE movies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    duration INTEGER NOT NULL,
    release_date TIMESTAMP NOT NULL,
    poster_url TEXT NOT NULL,
    trailer_url TEXT NOT NULL,
    imdb_rating FLOAT NOT NULL,
    app_rating FLOAT NOT NULL,
    status movie_status NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE theaters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    location TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE screens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    screen_number INTEGER NOT NULL,
    theater_id UUID NOT NULL REFERENCES theaters(id),
    layout JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE seats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    screen_id UUID NOT NULL REFERENCES screens(id),
    number VARCHAR(10) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE shows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movie_id UUID NOT NULL,
    theater_id UUID NOT NULL REFERENCES theaters(id),
    screen_id UUID NOT NULL REFERENCES screens(id),
    screen_number INTEGER NOT NULL,
    adult_price FLOAT NOT NULL,
    child_price FLOAT NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE show_seats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL REFERENCES shows(id),
    seat_id UUID NOT NULL REFERENCES seats(id),
    status seat_status NOT NULL DEFAULT 'AVAILABLE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL REFERENCES shows(id),
    user_id UUID NOT NULL,
    seat_ids UUID[] NOT NULL,
    total_amount FLOAT NOT NULL,
    status booking_status NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_movies_status ON movies(status);

CREATE INDEX idx_seats_screen_id ON seats (screen_id);

CREATE INDEX idx_shows_theater ON shows(theater_id);
CREATE INDEX idx_shows_screen ON shows(screen_id);
CREATE INDEX idx_shows_timing ON shows(start_time, end_time);

CREATE INDEX idx_show_seats_show ON show_seats(show_id);
CREATE INDEX idx_show_seats_status ON show_seats(status);

CREATE INDEX idx_bookings_user ON bookings(user_id);
CREATE INDEX idx_bookings_show ON bookings(show_id);
CREATE INDEX idx_bookings_status ON bookings(status);
