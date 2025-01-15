-- CreateEnum
CREATE TYPE "MovieStatus" AS ENUM ('UPCOMING', 'NOW_SHOWING', 'ENDED');

-- CreateTable
CREATE TABLE "Movie" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "releaseDate" TIMESTAMP(3) NOT NULL,
    "posterUrl" TEXT NOT NULL,
    "trailerUrl" TEXT NOT NULL,
    "imdbRating" DOUBLE PRECISION NOT NULL,
    "appRating" DOUBLE PRECISION NOT NULL,
    "status" "MovieStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Movie_pkey" PRIMARY KEY ("id")
);
