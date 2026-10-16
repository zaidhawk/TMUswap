// Production sets DATABASE_URL; locally we fall back to the Docker database.
export const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://tmuswap:tmuswap@localhost:5432/tmuswap";
