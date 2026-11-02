import express from 'express';
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const app = express();

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
// The connection is created lazily and cached. On Vercel every cold start must
// be able to create the client inside the request handler instead of at module
// load, otherwise one bad/missing env var crashes the whole function.
let dbPromise;

export function getDb() {
    if (!dbPromise) {
        const url = process.env.MONGODB_URL;

        if (!url) {
            return Promise.reject(
                new Error('MONGODB_URL is not set in the environment.')
            );
        }

        const client = new MongoClient(url, {
            serverSelectionTimeoutMS: 10000,
        });

        dbPromise = client
            .connect()
            .then((connectedClient) => {
                console.log('You successfully connected to MongoDB!');
                return connectedClient.db('humanova_data');
            })
            .catch((error) => {
                // Allow the next request to retry instead of caching a
                // permanently rejected promise.
                dbPromise = undefined;
                throw error;
            });
    }

    return dbPromise;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const asyncHandler = (handler) => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
};

function flattenEvent(doc) {
    if (!doc) return null;

    const form = doc.form || doc.event || {};

    return {
        ...form,
        _id: doc._id,
        createdAt: doc.createdAt ?? form.createdAt,
    };
}

function toObjectId(id) {
    return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(
    cors({
        origin: true,
        credentials: true,
    })
);
app.use(express.json({ limit: '2mb' }));

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------
// Better Auth exposes the JWKS endpoint on the frontend deployment.
// Set CLIENT_URL to the deployed frontend URL on Vercel.
let jwks;

function getJwks() {
    const clientUrl =
        process.env.CLIENT_URL || process.env.BETTER_AUTH_URL;

    if (!clientUrl) {
        throw new Error(
            'CLIENT_URL (or BETTER_AUTH_URL) is not set in the environment.'
        );
    }

    if (!jwks) {
        jwks = createRemoteJWKSet(
            new URL(
                `${clientUrl.replace(/\/+$/, '')}/api/auth/jwks`
            )
        );
    }

    return jwks;
}

function readToken(req) {
    const authHeader = req.headers.authorization;

    if (!authHeader) return null;

    // Accept both "Bearer <token>" and a bare token, because different parts
    // of the frontend send the token in different formats.
    return authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : authHeader.trim();
}

const verifyToken = asyncHandler(async (req, res, next) => {
    const token = readToken(req);

    if (!token) {
        return res.status(401).send({ message: 'Unauthorized!' });
    }

    try {
        const { payload } = await jwtVerify(token, getJwks());
        req.user = payload;
        next();
    } catch (error) {
        console.error('Token verification failed:', error.message);
        return res.status(401).send({ message: 'Unauthorized!' });
    }
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
    res.send('welcome to server');
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
// Public list used by the homepage and /upcoming-events.
app.get(
    '/events',
    asyncHandler(async (req, res) => {
        const db = await getDb();
        const events = await db
            .collection('create_event')
            .find({})
            .sort({ _id: -1 })
            .toArray();

        res.send(events);
    })
);

// Alias so both /events and /api/events work.
app.get(
    '/api/events',
    asyncHandler(async (req, res) => {
        const db = await getDb();
        const events = await db
            .collection('create_event')
            .find({})
            .sort({ _id: -1 })
            .toArray();

        res.send(events);
    })
);

// Public event details. Logged-out visitors can view an event before joining.
app.get(
    '/events/:id',
    asyncHandler(async (req, res) => {
        const id = toObjectId(req.params.id);

        if (!id) {
            return res.status(400).send({ message: 'Invalid event id.' });
        }

        const db = await getDb();
        const event = await db
            .collection('create_event')
            .findOne({ _id: id });

        if (!event) {
            return res.status(404).send({ message: 'Event not found.' });
        }

        res.send(event);
    })
);

// Public list of people going to an event (used by the event details page).
app.get(
    '/events/:id/participants',
    asyncHandler(async (req, res) => {
        const id = toObjectId(req.params.id);

        if (!id) {
            return res.status(400).send({ message: 'Invalid event id.' });
        }

        const db = await getDb();
        const joinedEvents = db.collection('joined_events');

        const records = await joinedEvents
            .find({
                $or: [
                    { eventId: req.params.id },
                    { eventId: id },
                ],
            })
            .sort({ _id: 1 })
            .project({ username: 1, image: 1, email: 1 })
            .toArray();

        // Keep one entry per user even if older duplicate join records exist.
        const seen = new Set();
        const participants = [];

        for (const record of records) {
            const key = record.email || String(record._id);

            if (seen.has(key)) continue;

            seen.add(key);

            participants.push({
                _id: record._id,
                username: record.username || 'Guest',
                image: record.image || null,
            });
        }

        res.send({
            registeredCount: participants.length,
            participants,
        });
    })
);

// Events created by the signed-in user (used by /manage-events).
app.get(
    '/api/events/my',
    verifyToken,
    asyncHandler(async (req, res) => {
        const email = req.user?.email;

        if (!email) {
            return res
                .status(401)
                .send({ message: 'Unauthorized!' });
        }

        const db = await getDb();
        const events = await db
            .collection('create_event')
            .find({
                $or: [
                    { 'form.email': email },
                    { email },
                ],
            })
            .sort({ _id: -1 })
            .toArray();

        res.send(
            events.map((event) => ({
                ...flattenEvent(event),
                form: event.form || event.event || {},
            }))
        );
    })
);

app.get(
    '/create-event',
    asyncHandler(async (req, res) => {
        const db = await getDb();
        const events = await db
            .collection('create_event')
            .find({})
            .sort({ _id: -1 })
            .toArray();

        res.send(events);
    })
);

app.post(
    '/create-event',
    verifyToken,
    asyncHandler(async (req, res) => {
        const body = req.body || {};
        const form = body.form || body;

        if (!form.title || !form.eventDate) {
            return res.status(400).send({
                message: 'An event title and date are required.',
            });
        }

        const event = {
            ...body,
            form: {
                ...form,
                // The signed-in user is the organizer. Never trust a
                // different email sent from the browser.
                username: form.username || req.user?.name,
                email: req.user?.email || form.email,
            },
            createdAt: new Date(),
        };

        const db = await getDb();
        const result = await db
            .collection('create_event')
            .insertOne(event);

        res.status(201).send({
            success: true,
            event: {
                ...event,
                _id: result.insertedId,
            },
            insertedId: result.insertedId,
        });
    })
);

// Update an event (only the organizer can update it).
app.put(
    '/api/events/:id',
    verifyToken,
    asyncHandler(async (req, res) => {
        const id = toObjectId(req.params.id);

        if (!id) {
            return res.status(400).send({ message: 'Invalid event id.' });
        }

        const db = await getDb();
        const events = db.collection('create_event');
        const event = await events.findOne({ _id: id });

        if (!event) {
            return res.status(404).send({ message: 'Event not found.' });
        }

        const ownerEmail =
            event.form?.email || event.email || null;

        if (
            ownerEmail &&
            req.user?.email &&
            ownerEmail !== req.user.email
        ) {
            return res.status(403).send({
                message: 'You can only edit your own events.',
            });
        }

        const body = req.body || {};
        const updates = body.form || body;
        const existingForm = event.form || event.event || {};

        if (
            updates.title !== undefined &&
            !String(updates.title).trim()
        ) {
            return res
                .status(400)
                .send({ message: 'Event title is required.' });
        }

        const allowedFields = [
            'title',
            'description',
            'eventType',
            'imageUrl',
            'location',
            'eventDate',
        ];

        const form = { ...existingForm };

        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                form[field] = updates[field];
            }
        }

        // Keep the original organizer identity.
        form.username = existingForm.username || event.username;
        form.email = existingForm.email || event.email;
        form.createdAt = existingForm.createdAt || event.createdAt;

        await events.updateOne(
            { _id: id },
            { $set: { form, updatedAt: new Date() } }
        );

        const updated = await events.findOne({ _id: id });

        res.send({
            success: true,
            event: updated,
        });
    })
);

// Delete an event (only the organizer can delete it).
app.delete(
    '/api/events/:id',
    verifyToken,
    asyncHandler(async (req, res) => {
        const id = toObjectId(req.params.id);

        if (!id) {
            return res.status(400).send({ message: 'Invalid event id.' });
        }

        const db = await getDb();
        const events = db.collection('create_event');
        const event = await events.findOne({ _id: id });

        if (!event) {
            return res.status(404).send({ message: 'Event not found.' });
        }

        const ownerEmail =
            event.form?.email || event.email || null;

        if (
            ownerEmail &&
            req.user?.email &&
            ownerEmail !== req.user.email
        ) {
            return res.status(403).send({
                message: 'You can only delete your own events.',
            });
        }

        await events.deleteOne({ _id: id });

        // Keep the joined records in sync with the deleted event.
        await db.collection('joined_events').deleteMany({
            $or: [
                { eventId: req.params.id },
                { eventId: new ObjectId(req.params.id) },
            ],
        });

        res.send({ success: true, deletedId: req.params.id });
    })
);

// ---------------------------------------------------------------------------
// Joined events
// ---------------------------------------------------------------------------
app.get(
    '/joined-events',
    asyncHandler(async (req, res) => {
        const db = await getDb();
        const joined = await db
            .collection('joined_events')
            .find({})
            .sort({ _id: -1 })
            .toArray();

        res.send(joined);
    })
);

// Details page under /joined-events/[id]. The id can be either the original
// event id or the id of the joined record.
app.get(
    '/joined-events/:id',
    asyncHandler(async (req, res) => {
        const id = toObjectId(req.params.id);

        if (!id) {
            return res.status(400).send({ message: 'Invalid event id.' });
        }

        const db = await getDb();
        const events = db.collection('create_event');
        const joinedEvents = db.collection('joined_events');

        const event = await events.findOne({ _id: id });

        if (event) {
            const registeredCount = await joinedEvents.countDocuments({
                $or: [
                    { eventId: req.params.id },
                    { eventId: id },
                ],
            });

            return res.send({
                event: {
                    ...flattenEvent(event),
                    registeredCount,
                },
            });
        }

        const joined = await joinedEvents.findOne({ _id: id });

        if (!joined) {
            return res.status(404).send({ message: 'Event not found.' });
        }

        const form = joined.form || joined.event || {};

        res.send({
            event: {
                ...form,
                _id: joined.eventId || joined._id,
                registeredCount: 0,
            },
        });
    })
);

// Joined records for the signed-in user. The frontend passes ?email= as well,
// but the token is the source of truth.
app.get(
    '/joined',
    verifyToken,
    asyncHandler(async (req, res) => {
        const email =
            req.user?.email || req.query.email;

        if (!email) {
            return res.status(401).send({ message: 'Unauthorized!' });
        }

        const db = await getDb();
        const joined = await db
            .collection('joined_events')
            .find({ email })
            .sort({ _id: -1 })
            .toArray();

        res.send(joined);
    })
);

app.post(
    '/joined',
    verifyToken,
    asyncHandler(async (req, res) => {
        const body = req.body || {};
        const eventId = body.eventId || body.form?._id;
        const email = req.user?.email;

        if (!eventId) {
            return res
                .status(400)
                .send({ message: 'eventId is required.' });
        }

        if (!email) {
            return res.status(401).send({ message: 'Unauthorized!' });
        }

        const db = await getDb();
        const joinedEvents = db.collection('joined_events');

        const existing = await joinedEvents.findOne({
            eventId: String(eventId),
            email,
        });

        if (existing) {
            return res.send({
                success: true,
                alreadyJoined: true,
                joined: existing,
            });
        }

        const joined = {
            username: body.username || req.user?.name,
            email,
            image: body.image ?? req.user?.image ?? null,
            eventId: String(eventId),
            event: body.event || body.form || {},
            form: body.form || body.event || {},
            registeringDate:
                body.registeringDate || new Date().toISOString(),
        };

        const result = await joinedEvents.insertOne(joined);

        res.status(201).send({
            success: true,
            joined: { ...joined, _id: result.insertedId },
            insertedId: result.insertedId,
        });
    })
);

// Leave an event.
app.delete(
    '/joined/:id',
    verifyToken,
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        const email = req.user?.email;

        if (!email) {
            return res.status(401).send({ message: 'Unauthorized!' });
        }

        const objectId = toObjectId(id);
        const filters = [
            { eventId: id, email },
        ];

        if (objectId) {
            filters.push({ _id: objectId, email });
        }

        const db = await getDb();
        const result = await db
            .collection('joined_events')
            .deleteMany({ $or: filters });

        res.send({
            success: true,
            deletedCount: result.deletedCount,
        });
    })
);

// ---------------------------------------------------------------------------
// 404 + error handling
// ---------------------------------------------------------------------------
app.use((req, res) => {
    res.status(404).send({
        message: 'Route not found.',
        path: req.path,
    });
});

app.use((error, req, res, next) => {
    console.error('Unhandled API error:', error);

    if (res.headersSent) {
        return next(error);
    }

    res.status(500).send({
        message:
            process.env.NODE_ENV === 'production'
                ? 'Internal server error.'
                : error.message,
    });
});

export default app;
