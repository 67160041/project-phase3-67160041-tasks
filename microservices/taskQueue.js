const { Queue } = require("bullmq");
const redisConnection = require("../config/redis");

// สร้าง Queue สำหรับจัดการงาน Task
const taskQueue = new Queue("taskProcessingQueue", {
  connection: redisConnection,
});

module.exports = taskQueue;
