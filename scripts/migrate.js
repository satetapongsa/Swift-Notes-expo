// Applies db/schema.sql to the database in DATABASE_URL.
// Usage: npm run db:migrate
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL && fs.existsSync(path.join(__dirname, '..', '.env'))) {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

// Strip comments, then run each statement on its own.
const statements = schema
  .replace(/--.*$/gm, '')
  .split(';')
  .map(s => s.trim())
  .filter(Boolean);

(async () => {
  for (const statement of statements) {
    await sql.query(statement);
  }
  console.log(`Applied ${statements.length} statements.`);
})().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
