import mongoose from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config();

const MONGODB_URL = process.env.MONGODB_URL;

if (!MONGODB_URL) {
  throw new Error('MONGODB_URL is not defined in environment variables');
}

export const connectToDatabase = async () => {
  const DATABASE_NAME = process.env.DATABASE_NAME;
  if (!DATABASE_NAME) {
    throw new Error('DATABASE_NAME is not defined in environment variables');
  }
  try {
    await mongoose.connect(MONGODB_URL, {
      dbName: DATABASE_NAME,
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
    });
    console.log(`✅ Connected to [\x1b[36m${DATABASE_NAME}\x1b[0m] database`);
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
};
