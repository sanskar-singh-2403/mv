import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

export const cacheSet = async (key: string, value: any, ttl: number) => {
  await redis.set(key, JSON.stringify(value), 'EX', ttl);
};

export const cacheGet = async (key: string) => {
  const data = await redis.get(key);
  return data ? JSON.parse(data) : null;
};

export const cacheDelete = async (key: string) => {
  await redis.del(key);
};
