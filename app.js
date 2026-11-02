import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();

// =====================================================
// DATABASE
// =====================================================

let dbPromise;

export function getDb() {
    if (!dbPromise) {
        const url = process.env.MONGODB_URL;

        if (!url) {
            return Promise.reject(
                new Error("MONGODB_URL is missing.")
            );
        }

        const client = new MongoClient(url, {
            serverSelectionTimeoutMS: 10000,
        });

        dbPromise = client
            .connect()
            .then((connectedClient) => {
                console.log("MongoDB connected successfully!");
                return connectedClient.db("humanova_data");
            })
            .catch((error) => {
                dbPromise = undefined;
                throw error;
            });
    }

    return dbPromise;
}

// =====================================================
// HELPERS
// =====================================================

const asyncHandler = (handler) => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
};

function toObjectId(id) {
    return ObjectId.isValid(id)
        ? new ObjectId(id)
        : null;
}

function getTodayInBangladesh() {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Dhaka",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
}

function flattenEvent(doc) {
    if (!doc) return null;

    const form = doc.form || doc.event || {};

    return {
        ...form,
        _id: doc._id,
        createdAt: doc.createdAt || form.createdAt,
    };
}

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(
    cors({
        origin: [
            process.env.WEB_URL,
            process.env.CLIENT_URL,
            "http://localhost:3000",
        ].filter(Boolean),
        credentials: true,
    })
);

app.use(express.json({ limit: "2mb" }));

// =====================================================
// BETTER AUTH JWT VERIFICATION
// =====================================================

let jwks;

function getJwks() {
    const clientUrl =
        process.env.CLIENT_URL ||
        process.env.BETTER_AUTH_URL;

    if (!clientUrl) {
        throw new Error("CLIENT_URL is missing.");
    }

    if (!jwks) {
        jwks = createRemoteJWKSet(
            new URL(
                `${clientUrl.replace(/\/+$/, "")}/api/auth/jwks`
            )
        );
    }

    return jwks;
}

const verifyToken = asyncHandler(async (req, res, next) => {
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
        return res.status(401).send({
            message: "Unauthorized!",
        });
    }

    const token = authorization.slice(7).trim();

    try {
        const { payload } = await jwtVerify(
            token,
            getJwks()
        );

        req.user = payload;
        next();
    } catch (error) {
        console.error("JWT verification failed:", error.message);

        return res.status(401).send({
            message: "Invalid or expired token.",
        });
    }
});

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/", (req, res) => {
    res.status(200).send({
        success: true,
        message: "Humanova API is running!",
    });
});

// =====================================================
// NEWSLETTER
// =====================================================

const subscribeToNewsletter = asyncHandler(
    async (req, res) => {
        const email = String(
            req.body?.email || ""
        ).trim().toLowerCase();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).send({
                message: "Please enter a valid email address.",
            });
        }

        const db = await getDb();
        const collection = db.collection(
            "newsletter_subscribers"
        );

        const existing = await collection.findOne({ email });

        if (existing) {
            return res.send({
                success: true,
                alreadySubscribed: true,
                message: "You are already subscribed.",
            });
        }

        await collection.insertOne({
            email,
            source: String(
                req.body?.source || "homepage"
            ).slice(0, 60),
            createdAt: new Date(),
        });

        res.status(201).send({
            success: true,
            alreadySubscribed: false,
            message: "Subscribed successfully.",
        });
    }
);

app.post("/newsletter", subscribeToNewsletter);
app.post("/api/newsletter", subscribeToNewsletter);

// =====================================================
// UPCOMING EVENTS — ONLY 6
// =====================================================

const getUpcomingEvents = asyncHandler(
    async (req, res) => {
        const db = await getDb();

        const today = getTodayInBangladesh();

        const events = await db
            .collection("create_event")
            .find({
                "form.eventDate": {
                    $gte: today,
                },
            })
            .sort({
                "form.eventDate": 1,
                _id: 1,
            })
            .limit(6)
            .toArray();

        res.status(200).send(events);
    }
);

// Homepage: only six closest upcoming events
app.get("/events/upcoming", getUpcomingEvents);
app.get("/api/events/upcoming", getUpcomingEvents);

// =====================================================
// ALL EVENTS
// =====================================================

// All events for the Upcoming Events page
app.get(
    "/events",
    asyncHandler(async (req, res) => {
        const db = await getDb();

        const events = await db
            .collection("create_event")
            .find({})
            .sort({ "form.eventDate": 1 })
            .toArray();

        res.send(events);
    })
);

app.get(
    "/api/events",
    asyncHandler(async (req, res) => {
        const db = await getDb();

        const events = await db
            .collection("create_event")
            .find({})
            .sort({ "form.eventDate": 1 })
            .toArray();

        res.send(events);
    })
);

// =====================================================
// SINGLE EVENT DETAILS
// =====================================================

app.get(
    "/events/:id",
    asyncHandler(async (req, res) => {
        const id = toObjectId(req.params.id);

        if (!id) {
            return res.status(400).send({
                message: "Invalid event ID.",
            });
        }

        const db = await getDb();

        const event = await db
            .collection("create_event")
            .findOne({ _id: id });

        if (!event) {
            return res.status(404).send({
                message: "Event not found.",
            });
        }

        res.send(event);
    })
);

// =====================================================
// CREATE EVENT
// =====================================================

app.post(
    "/create-event",
    verifyToken,
    asyncHandler(async (req, res) => {
        const body = req.body || {};
        const form = body.form || body;

        const requiredFields = [
            "title",
            "description",
            "eventType",
            "imageUrl",
            "location",
            "eventDate",
        ];

        for (const field of requiredFields) {
            if (
                typeof form[field] !== "string" ||
                !form[field].trim()
            ) {
                return res.status(400).send({
                    message: `${field} is required.`,
                });
            }
        }

        const today = getTodayInBangladesh();

        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(form.eventDate) ||
            form.eventDate < today ||
            Number.isNaN(
                new Date(
                    `${form.eventDate}T00:00:00Z`
                ).getTime()
            )
        ) {
            return res.status(400).send({
                message: "Please select a valid upcoming event date.",
            });
        }

        const event = {
            form: {
                title: form.title.trim(),
                description: form.description.trim(),
                eventType: form.eventType.trim(),
                imageUrl: form.imageUrl.trim(),
                location: form.location.trim(),
                eventDate: form.eventDate,
                username: req.user?.name || "Community Member",
                email: req.user?.email,
            },
            createdAt: new Date(),
        };

        const db = await getDb();

        const result = await db
            .collection("create_event")
            .insertOne(event);

        res.status(201).send({
            success: true,
            message: "Event created successfully.",
            event: {
                ...event,
                _id: result.insertedId,
            },
        });
    })
);

// =====================================================
// MY CREATED EVENTS
// =====================================================

app.get(
    "/api/events/my",
    verifyToken,
    asyncHandler(async (req, res) => {
        const email = req.user?.email;

        if (!email) {
            return res.status(401).send({
                message: "Unauthorized!",
            });
        }

        const db = await getDb();

        const events = await db
            .collection("create_event")
            .find({
                "form.email": email,
            })
            .sort({ createdAt: -1 })
            .toArray();

        res.send(
            events.map((event) => ({
                ...flattenEvent(event),
                form: event.form || {},
            }))
        );
    })
);

// =====================================================
// UPDATE EVENT
// =====================================================

app.put(
    "/api/events/:id",
    verifyToken,
    asyncHandler(async (req, res) => {
        const id = toObjectId(req.params.id);

        if (!id) {
            return res.status(400).send({
                message: "Invalid event ID.",
            });
        }

        const db = await getDb();
        const collection = db.collection("create_event");

        const event = await collection.findOne({
            _id: id,
        });

        if (!event) {
            return res.status(404).send({
                message: "Event not found.",
            });
        }

        if (event.form?.email !== req.user?.email) {
            return res.status(403).send({
                message: "You cannot edit this event.",
            });
        }

        const updates = req.body?.form || req.body;
        const allowedFields = [
            "title",
            "description",
            "eventType",
            "imageUrl",
            "location",
            "eventDate",
        ];

        const updatedForm = {
            ...event.form,
        };

        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                if (
                    typeof updates[field] !== "string" ||
                    !updates[field].trim()
                ) {
                    return res.status(400).send({
                        message: `Invalid ${field}.`,
                    });
                }

                updatedForm[field] = updates[field].trim();
            }
        }

        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(updatedForm.eventDate) ||
            Number.isNaN(
                new Date(
                    `${updatedForm.eventDate}T00:00:00Z`
                ).getTime()
            )
        ) {
            return res.status(400).send({
                message: "Invalid event date.",
            });
        }

        await collection.updateOne(
            { _id: id },
            {
                $set: {
                    form: updatedForm,
                    updatedAt: new Date(),
                },
            }
        );

        const updated = await collection.findOne({
            _id: id,
        });

        res.send({
            success: true,
            event: updated,
        });
    })
);

// =====================================================
// DELETE EVENT
// =====================================================

app.delete(
    "/api/events/:id",
    verifyToken,
    asyncHandler(async (req, res) => {
        const id = toObjectId(req.params.id);

        if (!id) {
            return res.status(400).send({
                message: "Invalid event ID.",
            });
        }

        const db = await getDb();
        const events = db.collection("create_event");

        const event = await events.findOne({
            _id: id,
        });

        if (!event) {
            return res.status(404).send({
                message: "Event not found.",
            });
        }

        if (event.form?.email !== req.user?.email) {
            return res.status(403).send({
                message: "You cannot delete this event.",
            });
        }

        await events.deleteOne({ _id: id });

        await db.collection("joined_events").deleteMany({
            eventId: id.toString(),
        });

        res.send({
            success: true,
            message: "Event deleted successfully.",
        });
    })
);

// =====================================================
// EVENT PARTICIPANTS
// =====================================================

app.get(
    "/events/:id/participants",
    asyncHandler(async (req, res) => {
        const id = toObjectId(req.params.id);

        if (!id) {
            return res.status(400).send({
                message: "Invalid event ID.",
            });
        }

        const db = await getDb();

        const records = await db
            .collection("joined_events")
            .find({
                eventId: id.toString(),
            })
            .project({
                username: 1,
                image: 1,
                email: 1,
            })
            .toArray();

        const unique = new Map();

        records.forEach((record) => {
            const key = record.email || String(record._id);

            if (!unique.has(key)) {
                unique.set(key, {
                    _id: record._id,
                    username: record.username || "Guest",
                    image: record.image || null,
                });
            }
        });

        const participants = Array.from(unique.values());

        res.send({
            registeredCount: participants.length,
            participants,
        });
    })
);

// =====================================================
// JOINED EVENTS
// =====================================================

// All joined events (public endpoint)
app.get(
    "/joined-events",
    asyncHandler(async (req, res) => {
        const db = await getDb();

        const joined = await db
            .collection("joined_events")
            .find({})
            .sort({ _id: -1 })
            .toArray();

        res.send(joined);
    })
);

// User's joined events
app.get(
    "/joined",
    verifyToken,
    asyncHandler(async (req, res) => {
        const email = req.user?.email;

        if (!email) {
            return res.status(401).send({
                message: "Unauthorized!",
            });
        }

        const db = await getDb();

        const joined = await db
            .collection("joined_events")
            .find({ email })
            .sort({ _id: -1 })
            .toArray();

        res.send(joined);
    })
);

// Join an event
app.post(
    "/joined",
    verifyToken,
    asyncHandler(async (req, res) => {
        const eventId = String(
            req.body?.eventId || ""
        );

        const id = toObjectId(eventId);
        const email = req.user?.email;

        if (!id || !email) {
            return res.status(400).send({
                message: "Valid eventId is required.",
            });
        }

        const db = await getDb();

        const events = db.collection("create_event");
        const joinedEvents = db.collection("joined_events");

        const event = await events.findOne({
            _id: id,
        });

        if (!event) {
            return res.status(404).send({
                message: "Event not found.",
            });
        }

        const existing = await joinedEvents.findOne({
            eventId,
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
            eventId,
            email,
            username: req.user?.name || "Community Member",
            image: req.user?.image || null,
            event: event.form,
            registeringDate: new Date().toISOString(),
        };

        const result = await joinedEvents.insertOne(joined);

        res.status(201).send({
            success: true,
            joined: {
                ...joined,
                _id: result.insertedId,
            },
        });
    })
);

// Leave an event
app.delete(
    "/joined/:id",
    verifyToken,
    asyncHandler(async (req, res) => {
        const id = req.params.id;
        const email = req.user?.email;

        if (!email) {
            return res.status(401).send({
                message: "Unauthorized!",
            });
        }

        const db = await getDb();

        const result = await db
            .collection("joined_events")
            .deleteOne({
                eventId: id,
                email,
            });

        res.send({
            success: true,
            deletedCount: result.deletedCount,
        });
    })
);

// =====================================================
// ERROR HANDLING
// =====================================================

app.use((req, res) => {
    res.status(404).send({
        message: "Route not found.",
        path: req.path,
    });
});

app.use((error, req, res, next) => {
    console.error("API Error:", error);

    if (res.headersSent) {
        return next(error);
    }

    res.status(500).send({
        success: false,
        message:
            process.env.NODE_ENV === "production"
                ? "Internal server error."
                : error.message,
    });
});

export default app;