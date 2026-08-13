import express from "express";
import { handleAiChat } from "./ai.controller.js";
import { verifyToken } from "../../middlewares/authMiddleware.js";

const router = express.Router();

// AI Chat Route for Gym Admins & Superadmins
router.post(
  "/chat",
  verifyToken([
    "ADMIN", "Admin", "admin",
    "SUPERADMIN", "Superadmin", "SuperAdmin"
  ]),
  handleAiChat
);

export default router;
