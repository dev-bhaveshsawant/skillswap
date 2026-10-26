import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

dotenv.config({ path: '.env.cloud', override: true });

const required = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_SSL_CA_PATH'];
const missing = required.filter(key => !process.env[key] || process.env[key].startsWith('replace-') || process.env[key].startsWith('your-'));
if (missing.length) {
  console.error(`Fill these settings in .env.cloud first: ${missing.join(', ')}`);
  process.exit(1);
}

let connection;
try {
  const ca = readFileSync(process.env.DB_SSL_CA_PATH);
  const schema = readFileSync('server/schema.sql', 'utf8');
  connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { ca, rejectUnauthorized: true },
    multipleStatements: true,
    charset: 'utf8mb4'
  });
  await connection.query(schema);
  console.log(`SkillSwap schema imported into the cloud database '${process.env.DB_NAME}'.`);
} catch (error) {
  console.error('Cloud database setup failed:', error.message);
  process.exitCode = 1;
} finally {
  await connection?.end();
}
