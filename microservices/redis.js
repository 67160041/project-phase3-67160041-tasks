const Redis = require("ioredis");

const redisConnection = {
  host: process.env.REDIS_HOST || "localhost",
  port: process.env.REDIS_PORT || 6379,
};

module.exports = redisConnection;
