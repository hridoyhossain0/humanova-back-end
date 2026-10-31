import { betterAuth } from 'better-auth';
import { mongodbAdapter } from '@better-auth/mongo-adapter';

import { client, db } from './config/mongodb.js';

export const auth = betterAuth({
    database: mongodbAdapter(db, {
        client,
    }),

    baseURL: process.env.BETTER_AUTH_URL as string,

    secret: process.env.BETTER_AUTH_SECRET as string,

    trustedOrigins: [
        process.env.WEB_URL as string,
    ],

    emailAndPassword: {
        enabled: true,
    },
});