import pool from "../../config/db.js";

/**
 * Service to generate AI response for Gym Admins using Google Gemini 1.5 Flash API
 */
export const processAiChatService = async (adminId, userPrompt) => {
  if (!userPrompt || !userPrompt.trim()) {
    throw { status: 400, message: "Prompt is required" };
  }

  // 1. Gather Gym Context Data from Database
  let gymContext = "";
  try {
    const [memberRows] = await pool.query(
      `SELECT COUNT(*) as totalMembers, 
              SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) as activeMembers,
              SUM(CASE WHEN status = 'Inactive' OR status = 'Expired' THEN 1 ELSE 0 END) as inactiveMembers
       FROM user WHERE adminId = ? OR roleId = 3`,
      [adminId]
    );

    const [paymentRows] = await pool.query(
      `SELECT SUM(amount) as totalRevenue, COUNT(*) as totalTransactions
       FROM payment WHERE adminId = ?`,
      [adminId]
    );

    const [attendanceRows] = await pool.query(
      `SELECT COUNT(*) as todayAttendance
       FROM attendance WHERE DATE(checkInTime) = CURDATE()`
    );

    const total = memberRows[0]?.totalMembers || 0;
    const active = memberRows[0]?.activeMembers || 0;
    const inactive = memberRows[0]?.inactiveMembers || 0;
    const revenue = paymentRows[0]?.totalRevenue || 0;
    const todayAtt = attendanceRows[0]?.todayAttendance || 0;

    gymContext = `
GYM REAL-TIME STATS:
- Total Members: ${total}
- Active Members: ${active}
- Inactive/Expired Members: ${inactive}
- Total Revenue Collected: ₹${revenue}
- Today's Check-ins: ${todayAtt}
`;
  } catch (err) {
    console.error("Notice: Gym Context Fetch error:", err.message);
  }

  // 2. Prepare Gemini System Prompt & Body
  const apiKey = process.env.GEMINI_API_KEY || "AIzaSyD-placeholder-key";

  const systemInstruction = `You are Kiaan AI Assistant, a friendly, highly intelligent AI gym management consultant and assistant integrated directly into Kiaan Gym Software.
Answer gym owners and admins clearly, concisely, and professionally in English or Hinglish based on their query.
Use the provided gym real-time stats when answering questions about their gym's performance, members, attendance, or revenue.

${gymContext}`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          { text: `${systemInstruction}\n\nUser Question: ${userPrompt}` }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 800
    }
  };

  // 3. Send request to Google Gemini API
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API Error Response:", errText);
      // Fallback smart response if API key is unconfigured or rate limited
      return generateFallbackResponse(userPrompt, gymContext);
    }

    const data = await response.json();
    const replyText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (replyText) {
      return replyText;
    } else {
      return generateFallbackResponse(userPrompt, gymContext);
    }
  } catch (error) {
    console.error("Gemini API Request Failed:", error.message);
    return generateFallbackResponse(userPrompt, gymContext);
  }
};

/**
 * Intelligent fallback response when Gemini key is unconfigured or rate-limited
 */
function generateFallbackResponse(prompt, gymContext) {
  const p = prompt.toLowerCase();
  if (p.includes("summary") || p.includes("stats") || p.includes("gym") || p.includes("performance")) {
    return `📊 **Gym Real-Time Summary:**\n${gymContext}\n\nEverything is running smoothly! Let me know if you need help with specific member details, attendance, or billing.`;
  } else if (p.includes("revenue") || p.includes("payment") || p.includes("earning") || p.includes("money")) {
    return `💰 **Revenue Overview:**\nYour gym has collected total revenue. You can view itemized payment receipts under the **Payments & Billing** tab in your admin dashboard.`;
  } else if (p.includes("attendance") || p.includes("check-in") || p.includes("checkin")) {
    return `🏋️ **Attendance Update:**\nToday's check-ins are tracked live via QR & Biometric. Check the **Attendance** section for full member logs.`;
  } else if (p.includes("member") || p.includes("active") || p.includes("expired")) {
    return `👥 **Member Status:**\nYou have active & enrolled members. You can send automated WhatsApp payment reminders from the **Members** list.`;
  }

  return `🤖 Hello! I am **Kiaan AI Assistant**.\n\nI can help you analyze gym revenue, member retention, attendance logs, and automated workflows. How can I assist you today?`;
}
