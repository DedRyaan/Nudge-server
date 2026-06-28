import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load dotenv relative to this file's location to ensure it finds the root .env
dotenv.config({ path: join(__dirname, '../../.env') });
