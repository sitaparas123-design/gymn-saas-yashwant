import { processAiChatService } from "./ai.service.js";

export const handleAiChat = async (req, res, next) => {
  try {
    const { prompt } = req.body;
    const adminId = req.user?.adminId || req.user?.id || 1;

    const reply = await processAiChatService(adminId, prompt);

    res.json({
      success: true,
      reply
    });
  } catch (error) {
    next(error);
  }
};
