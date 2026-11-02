import app from '../app.js';

// Vercel Node.js runtime entry point. Default-exporting the Express app lets
// Vercel forward every request to Express instead of trying to call
// app.listen() during a cold start.
export default app;
