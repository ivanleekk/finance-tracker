import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config({ path: `.env.${process.env.NODE_ENV}` });

const redisClient = createClient({
    password: process.env.REDIS_PASSWORD,
    socket: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT)
    }
});

async function connectRedis() {
    await redisClient.connect();
}

connectRedis().catch(console.error);

export default redisClient;