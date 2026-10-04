import { Db, MongoClient } from "mongodb";

let clientPromise: Promise<MongoClient> | null = null;

function getUri() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not configured.");
  return uri;
}

export async function getDb(): Promise<Db> {
  if (!clientPromise) {
    const client = new MongoClient(getUri(), {
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000,
    });
    clientPromise = client.connect().catch((error: unknown) => {
      clientPromise = null;
      throw error;
    });
  }
  const client = await clientPromise;
  return client.db();
}

export async function getCollections() {
  const db = await getDb();
  return {
    db,
    users: db.collection<any>("users"),
    movies: db.collection<any>("movies"),
    settings: db.collection<any>("settings"),
  };
}
