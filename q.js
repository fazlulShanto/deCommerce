import { QdrantClient } from '@qdrant/js-client-rest';
import * as dotenv from 'dotenv';

dotenv.config();

const qClient = new QdrantClient({
  url: process.env.QDRANT_API_URL,
  apiKey: process.env.QDRANT_API_KEY,
  port: null,
});

const collection = await qClient.getCollection(process.env.QDRANT_MEMORY_COLLECTION);

console.log(collection);
