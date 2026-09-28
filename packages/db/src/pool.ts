import pg from 'pg';

// int8 (bigint) arrives as a string by default. Cents stay far below 2^53, so a JS number is exact.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString });
}
