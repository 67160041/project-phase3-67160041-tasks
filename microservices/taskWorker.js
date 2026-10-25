const { Worker } = require("bullmq");
const redisConnection = require("../config/redis");
const db = require("../db"); // นำเข้า DB Connection ที่มีอยู่แล้ว[cite: 9]

const taskWorker = new Worker(
  "taskProcessingQueue",
  async (job) => {
    const { taskId, userId, action } = job.data;
    console.log(
      `[Worker] กำลังประมวลผล Task ID: ${taskId} สำหรับ Action: ${action}`,
    );

    if (action === "COMPLETE_TASK") {
      // 1. อัปเดตสถานะงานใน Database เป็น 'DONE'
      await db.query("UPDATE tasks SET status = ? WHERE id = ?", [
        "DONE",
        taskId,
      ]);

      // 2. คำนวณและเพิ่มคะแนน Ranking ให้กับผู้รับผิดชอบงาน
      await db.query("UPDATE users SET points = points + 10 WHERE id = ?", [
        userId,
      ]);
      console.log(`[Worker] เพิ่มคะแนนให้ User ID: ${userId} เรียบร้อยแล้ว`);
    }
  },
  { connection: redisConnection },
);

taskWorker.on("completed", (job) => {
  console.log(`[Worker] Task ID: ${job.id} ประมวลผลเสร็จสิ้น`);
});

taskWorker.on("failed", (job, err) => {
  console.error(`[Worker] Task ID: ${job.id} ล้มเหลว: ${err.message}`);
});
