import express from 'express'
import cors from 'cors'
import type { Request, Response } from 'express'
import { MongoClient } from 'mongodb';
import 'dotenv/config' 
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';

const app = express();
const port = process.env.PORT || 5000;


app.use(express.json());
app.use(cookieParser());
app.use(cors({
    origin: process.env.WEB_URL as string,
    credentials: true
}));


interface UserPayload {
  id: number;
  name: string;
}


const mongoUrl = process.env.MONGODB_URL;

if (!mongoUrl) {
  throw new Error('MONGODB_URL is not set. Add it to your .env file.');
}

const client = new MongoClient(mongoUrl);

export async function connectToMongoDB(): Promise<MongoClient> {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.error('MongoDB connection failed:', err);
    throw err;
  }
}


const connectedMongos = await connectToMongoDB();
const db = connectedMongos.db('humanova_data')
const destinationCollection = db.collection('data')





app.get('/', (req: Request, res: Response) => {
     res.send('Hello World!');
});


app.listen(port, () => {
    console.log(`server is running on port: ${port}`)
})
