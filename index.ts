import 'dotenv/config';

import express from 'express';
import cors from 'cors';

import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';

import { auth } from './auth.js';
import {
    connectToMongoDB,
    closeMongoDB,
} from './config/mongodb.js';

const app = express();

const PORT = Number(process.env.PORT || 5000);
const WEB_URL = process.env.WEB_URL?.trim() || 'http://localhost:3000';

// CORS
app.use(
    cors({
        origin: WEB_URL,
        credentials: true,
    })
);

// Better Auth handler MUST come before express.json()
app.all('/api/auth/{*any}', toNodeHandler(auth));

// Express middleware
app.use(express.json());

// Test route
app.get('/', (req, res) => {
    res.send('Humanova API is running!');
});

// Get current logged-in user
app.get('/api/me', async (req, res) => {
    try {
        const session = await auth.api.getSession({
            headers: fromNodeHeaders(req.headers),
        });

        if (!session) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized',
            });
        }

        return res.status(200).json({
            success: true,
            user: session.user,
            session: session.session,
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
});

// Start server
const startServer = async () => {
    try {
        await connectToMongoDB();

        const server = app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`API: http://localhost:${PORT}`);
        });

        const shutdown = async () => {
            server.close(async () => {
                await closeMongoDB();
                process.exit(0);
            });
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

    } catch (error) {
        console.error('Server startup failed:', error);
        process.exit(1);
    }
};

startServer();
