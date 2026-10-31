import { MongoClient } from 'mongodb';

const mongoUrl = process.env.MONGODB_URL;

if (!mongoUrl) {
    throw new Error('MONGODB_URL is missing in .env');
}

export const client = new MongoClient(mongoUrl);

export const db = client.db('humanova_data');

export const connectToMongoDB = async () => {
    try {
        await client.connect();

        await db.command({ ping: 1 });

        console.log('MongoDB connected successfully!');

        return db;
    } catch (error) {
        console.error('MongoDB connection failed:', error);
        throw error;
    }
};

export const closeMongoDB = async () => {
    await client.close();
    console.log('MongoDB connection closed');
};