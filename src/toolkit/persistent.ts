/**
 * Small durable JSON record store for domain data. It deliberately exposes no
 * listing operation: callers keep their own indexes in each record.
 *
 * Node uses the platform Redis connection; Workers use the per-chat Durable
 * Object's durable storage endpoint. A missing store is reported to callers so
 * the bot can give a clear setup message instead of silently using memory.
 */
type WorkerStore = {
  CHAT_DO?: { idFromName(name: string): unknown; get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> } };
};

interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}

let redisClient: Promise<RedisClient | null> | undefined;

async function redis(): Promise<RedisClient | null> {
  if (redisClient) return redisClient;
  const url = typeof process === "undefined" ? undefined : process.env.REDIS_URL;
  if (!url) return (redisClient = Promise.resolve(null));
  redisClient = (async () => {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    // Loaded only in the Node runtime. Workers take the Durable Object path.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pkg: any = require("ioredis");
    const Redis = pkg.default ?? pkg.Redis ?? pkg;
    return new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false }) as RedisClient;
  })();
  return redisClient;
}

export async function readPersistent<T>(ctx: unknown, key: string): Promise<T | undefined> {
  const env = (ctx as { env?: WorkerStore }).env;
  if (env?.CHAT_DO) {
    const stub = env.CHAT_DO.get(env.CHAT_DO.idFromName("chat:" + key));
    const response = await stub.fetch("https://do/data/value", { method: "GET" });
    return response.status === 204 ? undefined : (await response.json()) as T;
  }
  const client = await redis();
  if (!client) return undefined;
  const raw = await client.get("groupguard:" + key);
  return raw === null ? undefined : JSON.parse(raw) as T;
}

export async function writePersistent<T>(ctx: unknown, key: string, value: T): Promise<boolean> {
  const env = (ctx as { env?: WorkerStore }).env;
  if (env?.CHAT_DO) {
    const stub = env.CHAT_DO.get(env.CHAT_DO.idFromName("chat:" + key));
    const response = await stub.fetch("https://do/data/value", {
      method: "PUT",
      body: JSON.stringify(value),
    });
    return response.ok;
  }
  const client = await redis();
  if (!client) return false;
  await client.set("groupguard:" + key, JSON.stringify(value));
  return true;
}
