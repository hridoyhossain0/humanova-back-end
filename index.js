import app from './app.js';

// This file is only used for local development (`npm run dev`).
// On Vercel the app is served by api/index.js.
const port = process.env.PORT || 8000;

app.listen(port, () => {
    console.log(`we are running on port: ${port}`);
});
