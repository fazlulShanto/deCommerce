import { QdrantClient } from '@qdrant/js-client-rest';
import * as dotenv from 'dotenv';


dotenv.config();

const qClient = new QdrantClient({
  url: process.env.QDRANT_API_URL,
  apiKey: process.env.QDRANT_API_KEY,
  port: null,
});

const collection = await qClient.getCollection(process.env.QDRANT_MEMORY_COLLECTION);


import { searchDuckDuckGo } from 'ts-duckduckgo-search';
const results = await searchDuckDuckGo('who won 2026 worlcup', {
  maxResults: 4,
});

console.log(results);

// [
//   {
//     title: 'DuckDuckGo — Privacy, simplified.',
//     url: 'https://duckduckgo.com/',
//     description: 'DuckDuckGo is an internet search engine...'
//   },
//   ...
// ]

// maxResults – Maximum number of results to return (default 10).
// locale – Locale string passed as the kl parameter (us-en, pt-pt, etc.).
// safeSearch – Safe-search level (off, moderate, strict).
// offset – Result offset in multiples of 50, passed as the s parameter.
// userAgent – Custom user-agent header.
// signal – AbortSignal used to cancel the underlying fetch.


