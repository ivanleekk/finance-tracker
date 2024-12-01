import { createClient } from 'redis';
import dotenv from 'dotenv';
import { RedisKeys } from './redisKeys';
import { requireUserSession } from './auth.server';

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

export const redisGet = async (request: Request, key: RedisKeys) => {
    const sessionUser = await requireUserSession(request);
    return await redisClient.get(key + sessionUser.uid);
}

export const redisSet = async (request: Request, key: RedisKeys, value: string, duration?: number) => {
    const sessionUser = await requireUserSession(request);
    // default duration is 1 hour
    return await redisClient.set(key + sessionUser.uid, value,  { EX: duration ? duration: 60*60 } );
}

export const redisDel = async (request: Request, key: RedisKeys) => {
    const sessionUser = await requireUserSession(request);
    return await redisClient.del(key + sessionUser.uid);
}

export const redisReset = async (request: Request) => {
    const sessionUser = await requireUserSession(request);
    const promises = [];
    for (const key of Object.values(RedisKeys)) {
        promises.push(redisClient.del(key + sessionUser.uid));
    }
    await Promise.all(promises)
    return ;
}