import { pool } from '../../config/db.js';

export const createTicket = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { subject, category, priority, message } = req.body;
    if (!subject || !message) return res.status(400).json({ success: false, message: 'Subject and message required.' });
    const [admins] = await pool.query('SELECT fullName, email, gymName FROM user WHERE id = ?', [adminId]);
    if (!admins.length) return res.status(404).json({ success: false, message: 'Admin not found.' });
    const admin = admins[0];
    const ticketNumber = 'TKT-' + Date.now() + '-' + adminId;
    const [result] = await pool.query(
      `INSERT INTO support_ticket (adminId, adminName, adminEmail, gymName, ticketNumber, subject, category, priority, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Open', NOW(), NOW())`,
      [adminId, admin.fullName || '', admin.email || '', admin.gymName || '', ticketNumber, subject, category || 'General', priority || 'Medium']
    );
    const ticketId = result.insertId;
    await pool.query('INSERT INTO support_ticket_reply (ticketId, senderId, senderRole, message, createdAt) VALUES (?, ?, ?, ?, NOW())', [ticketId, adminId, 'Admin', message]);
    return res.json({ success: true, message: 'Ticket created.', ticketId, ticketNumber });
  } catch (err) { console.error(err); return res.status(500).json({ success: false, message: err.message }); }
};

export const getMyTickets = async (req, res) => {
  try {
    const adminId = req.user.id;
    const [tickets] = await pool.query('SELECT * FROM support_ticket WHERE adminId = ? ORDER BY updatedAt DESC', [adminId]);
    return res.json({ success: true, tickets });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

export const getAllTickets = async (req, res) => {
  try {
    const { status, priority } = req.query;
    let query = 'SELECT * FROM support_ticket WHERE 1=1';
    const params = [];
    if (status) { query += ' AND status = ?'; params.push(status); }
    if (priority) { query += ' AND priority = ?'; params.push(priority); }
    query += ' ORDER BY updatedAt DESC';
    const [tickets] = await pool.query(query, params);
    return res.json({ success: true, tickets });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

export const getTicketById = async (req, res) => {
  try {
    const { id } = req.params;
    const [tickets] = await pool.query('SELECT * FROM support_ticket WHERE id = ?', [id]);
    if (!tickets.length) return res.status(404).json({ success: false, message: 'Ticket not found.' });
    const [replies] = await pool.query('SELECT * FROM support_ticket_reply WHERE ticketId = ? ORDER BY createdAt ASC', [id]);
    return res.json({ success: true, ticket: tickets[0], replies });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

export const replyToTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    const senderId = req.user.id;
    const senderRole = req.user.role || 'Admin';
    if (!message) return res.status(400).json({ success: false, message: 'Message required.' });
    const [tickets] = await pool.query('SELECT * FROM support_ticket WHERE id = ?', [id]);
    if (!tickets.length) return res.status(404).json({ success: false, message: 'Ticket not found.' });
    await pool.query('INSERT INTO support_ticket_reply (ticketId, senderId, senderRole, message, createdAt) VALUES (?, ?, ?, ?, NOW())', [id, senderId, senderRole, message]);
    const isSuperAdmin = (senderRole || '').toLowerCase().includes('superadmin') || (senderRole || '').toLowerCase().includes('subadmin');
    const newStatus = isSuperAdmin ? 'Replied' : tickets[0].status;
    await pool.query('UPDATE support_ticket SET status = ?, updatedAt = NOW() WHERE id = ?', [newStatus, id]);
    return res.json({ success: true, message: 'Reply sent.' });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

export const updateTicketStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['Open', 'Replied', 'Closed'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid status.' });
    await pool.query('UPDATE support_ticket SET status = ?, updatedAt = NOW() WHERE id = ?', [status, id]);
    return res.json({ success: true, message: 'Status updated.' });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

export const getTicketCounts = async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT COUNT(*) as total, SUM(status='Open') as open_count, SUM(status='Replied') as replied_count, SUM(status='Closed') as closed_count FROM support_ticket`);
    return res.json({ success: true, counts: rows[0] });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
