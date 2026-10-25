require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const YAML = require("js-yaml");

const db = require("./db"); // ตัวเชื่อมต่อ MySQL

// ---------------- 1. ตั้งค่า BullMQ & Redis Connection ----------------
const { Queue } = require("bullmq");

const redisOptions = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
};

let taskQueue;
try {
  taskQueue = new Queue("taskQueue", { connection: redisOptions });
  console.log("✅ เชื่อมต่อ Redis Task Queue เรียบร้อยแล้ว");
} catch (err) {
  console.error("❌ ตั้งค่า Redis Task Queue ไม่สำเร็จ:", err.message);
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// ---------------- 2. Setup Swagger UI ----------------
const possibleYamlPaths = [
  path.join(__dirname, "../openapi.yaml"),
  path.join(__dirname, "../swagger.yaml"),
  path.join(__dirname, "./openapi.yaml"),
  path.join(__dirname, "./swagger.yaml"),
];

let openapiDocument = null;
for (const yamlPath of possibleYamlPaths) {
  if (fs.existsSync(yamlPath)) {
    try {
      openapiDocument = YAML.load(fs.readFileSync(yamlPath, "utf8"));
      break;
    } catch (e) {
      console.error(`❌ ไม่สามารถอ่านไฟล์ ${yamlPath}:`, e.message);
    }
  }
}

if (openapiDocument) {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiDocument));
  console.log("📖 Swagger UI พร้อมใช้งานที่ http://localhost:3000/api-docs");
}

// ---------------- 3. Routes (รวม 6 Endpoints) ----------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Route 1: GET /api/v1/tasks - ดึงรายการงานทั้งหมด
app.get("/api/v1/tasks", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        t.id, 
        t.title, 
        t.dueDate, 
        t.status, 
        u.name AS user_name, 
        c.name AS category_name
      FROM tasks t
      JOIN users u ON t.user_id = u.id
      JOIN categories c ON t.category_id = c.id
    `);
    res.status(200).json({ message: "สำเร็จ", data: rows });
  } catch (error) {
    res
      .status(500)
      .json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล", error: error.message });
  }
});

// Route 2: GET /api/v1/tasks/stats/overview - ดึงสถิติภาพรวมระบบ (แทนการใช้คำคม)
app.get("/api/v1/tasks/stats/overview", async (req, res) => {
  try {
    const [totalRows] = await db.query("SELECT COUNT(*) AS total FROM tasks");
    const [doneRows] = await db.query(
      "SELECT COUNT(*) AS done FROM tasks WHERE UPPER(status) = 'DONE' OR status = 'เสร็จแล้ว'",
    );
    const [pendingRows] = await db.query(
      "SELECT COUNT(*) AS pending FROM tasks WHERE UPPER(status) != 'DONE' AND status != 'เสร็จแล้ว'",
    );

    res.status(200).json({
      message: "สำเร็จ",
      data: {
        totalTasks: totalRows[0].total,
        doneTasks: doneRows[0].done,
        pendingTasks: pendingRows[0].pending,
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "เกิดข้อผิดพลาดในการดึงสถิติ", error: error.message });
  }
});

// Route 3: GET /api/v1/tasks/:id - ดึงข้อมูลงานเฉพาะ ID
app.get("/api/v1/tasks/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await db.query(
      `
      SELECT 
        t.id, 
        t.title, 
        t.dueDate, 
        t.status, 
        u.name AS user_name, 
        c.name AS category_name
      FROM tasks t
      JOIN users u ON t.user_id = u.id
      JOIN categories c ON t.category_id = c.id
      WHERE t.id = ?
    `,
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลงานที่ต้องการ" });
    }

    res.status(200).json({ message: "สำเร็จ", data: rows[0] });
  } catch (error) {
    res
      .status(500)
      .json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล", error: error.message });
  }
});

// Route 4: POST /api/v1/tasks - มอบหมายงานใหม่
app.post("/api/v1/tasks", async (req, res) => {
  try {
    const { title, dueDate, status, user_id, category_id } = req.body;

    if (!title || !dueDate || !status || !user_id || !category_id) {
      return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
    }

    let finalUserId = user_id;
    let finalCategoryId = category_id;

    if (isNaN(user_id)) {
      const [users] = await db.query("SELECT id FROM users WHERE name LIKE ?", [
        `%${user_id}%`,
      ]);
      if (users.length === 0)
        return res.status(400).json({ message: `ไม่พบผู้ใช้ '${user_id}'` });
      finalUserId = users[0].id;
    }

    if (isNaN(category_id)) {
      const [categories] = await db.query(
        "SELECT id FROM categories WHERE name LIKE ?",
        [`%${category_id}%`],
      );
      if (categories.length === 0)
        return res
          .status(400)
          .json({ message: `ไม่พบหมวดหมู่ '${category_id}'` });
      finalCategoryId = categories[0].id;
    }

    let cleanDueDate = dueDate.includes("T") ? dueDate.split("T")[0] : dueDate;

    const [result] = await db.query(
      "INSERT INTO tasks (title, dueDate, status, user_id, category_id) VALUES (?, ?, ?, ?, ?)",
      [title, cleanDueDate, status, finalUserId, finalCategoryId],
    );

    const newTaskId = result.insertId;

    if (taskQueue) {
      taskQueue
        .add("TASK_CREATED", {
          taskId: newTaskId,
          userId: finalUserId,
          title,
          action: "NOTIFY_ASSIGNED_USER",
        })
        .catch((qErr) => console.warn("⚠️ Task Queue Warning:", qErr.message));
    }

    res
      .status(201)
      .json({ message: "เพิ่มข้อมูลสำเร็จ", data: { id: newTaskId } });
  } catch (error) {
    res
      .status(500)
      .json({
        message: "เกิดข้อผิดพลาดในการเพิ่มข้อมูล",
        error: error.message,
      });
  }
});

// Route 5: PUT /api/v1/tasks/:id - อัปเดตสถานะงาน
app.put("/api/v1/tasks/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    const targetStatus = status || "Done";

    const [result] = await db.query(
      "UPDATE tasks SET status = ? WHERE id = ?",
      [targetStatus, id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลงานที่ต้องการแก้ไข" });
    }

    if (
      targetStatus.toUpperCase() === "DONE" ||
      targetStatus === "Done" ||
      targetStatus === "เสร็จแล้ว"
    ) {
      try {
        const [taskRows] = await db.query(
          "SELECT user_id FROM tasks WHERE id = ?",
          [id],
        );
        const userId = taskRows[0]?.user_id;

        if (taskQueue) {
          taskQueue
            .add("CALCULATE_RANKING", {
              taskId: id,
              userId: userId,
              completedAt: new Date(),
              action: "UPDATE_USER_POINTS",
            })
            .catch((qErr) =>
              console.warn("⚠️ Task Queue Warning:", qErr.message),
            );
        }
      } catch (dbErr) {}
    }

    return res.status(200).json({ message: "แก้ไขข้อมูลสำเร็จ" });
  } catch (error) {
    return res
      .status(500)
      .json({
        message: "เกิดข้อผิดพลาดในการแก้ไขข้อมูล",
        error: error.message,
      });
  }
});

// Route 6: DELETE /api/v1/tasks/:id - ลบรายการงาน
app.delete("/api/v1/tasks/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [result] = await db.query("DELETE FROM tasks WHERE id = ?", [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลงานที่ต้องการลบ" });
    }

    res.status(200).json({ message: "ลบข้อมูลสำเร็จ" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "เกิดข้อผิดพลาดในการลบข้อมูล", error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server กำลังทำงานที่ http://localhost:${PORT}`);
});
