import express from 'express'
import cors from 'cors'
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config';
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const port = process.env.PORT || 8000;


const client = new MongoClient(process.env.MONGODB_URL);

export async function connectToMongoDB() {
    try {
        await client.connect();
        console.log("You successfully connected to MongoDB!");
        return client;
    } catch (err) {
        console.dir(err);
    }
}



app.use(express.json())
app.use(cors())



const mongoClient = await connectToMongoDB();
const db = mongoClient.db('humanova_data');
const joinedEvent = db.collection('joined_events')
const createEvent = db.collection('create_event')

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ msg: "Unauthorized!" });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).send({ msg: "Unauthorized!" });
    }

    const JWTS = createRemoteJWKSet(
        new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
    )

    try {
        const { payload } = await jwtVerify(token, JWTS);
        next();
    } catch (error) {
        return res.status(500).send({ msg: "Server Error!" });
    }
}


app.get('/', (req, res) => {
    res.send('welcome to server')
})

app.get('/joined-events', async (req, res) => {
    const cursor = joinedEvent.find({});
    const allJoined = await cursor.toArray();
    res.send(allJoined);
})

app.get('/create-event', async (req, res) => {
    const cursor = createEvent.find({});
    const allCreate = await cursor.toArray();
    res.send(allCreate);
})

app.post('/create-event', verifyToken , async (req, res) => {
    const newEvent = req.body;
    const result = await createEvent.insertOne(newEvent);
    res.send(result);

})


app.post("/joined",  verifyToken,  async (req, res) => {
  const data = req.body;
  const result = await joinedEvent.insertOne(data);
  res.send(result);
});

app.get('/joined', async (req, res) => {
    const cursor = joinedEvent.find({});
    const allJoin = await cursor.toArray();
    res.send(allJoin);
})


app.get("/events/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const result = await createEvent.findOne({
    _id: new ObjectId(id),
  });
  res.send(result);
});




app.get('/events', async(req, res) => {
    const cursor = createEvent.find({});
    const allCreated = await cursor.toArray();
    res.send(allCreated)
})



app.listen(port, () => {
    console.log(`we are running on port: ${port}`)
})