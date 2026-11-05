import './loadEnv.js';
import app from './app.js';
import db from './db/database.js';

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`MilestonePay Server is running on port ${PORT}`);
});

function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}. Closing server and database connection...`);
  server.close(() => {
    try {
      db.close();
      console.log('Database connection closed.');
    } catch (err) {
      console.error('Error closing database:', err.message);
    }
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

