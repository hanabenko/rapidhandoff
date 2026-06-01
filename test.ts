import { MongoClient } from "mongodb";
import "dotenv/config";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is required");
const client = new MongoClient(uri);

await client.connect();
console.log("Connected to MongoDB");
const db = client.db("er_system");

const collections = ["patients", "beds", "staff", "supplies", "events"];

for (const name of collections) {
    const count = await db.collection(name).countDocuments();
    console.log(name, count);
}

await client.close();
