import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    // El DDL lo genera y aplica el rol dueno del esquema.
    url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
  },
  // El SQL se revisa antes de aplicarlo: es un ledger de dinero.
  verbose: true,
  strict: true,
});
