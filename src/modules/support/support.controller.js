import { pool } from '../../config/db.js';
import { dispatchNotification } from '../../utils/notificationDispatcher.js';
import { notifySuperAdmin } from '../notifications/notif.service.js';

export const createTicket = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { subject, category, priority, message } = req.body;
    if (!subject || !message) return res.status(400).json({ success: false, message: 'Subject and message required.' });
    
    const [admins] = await pool.query('SELECT fullName, email, gymName, phone FROM user WHERE id = ?', [adminId]);
    if (!admins.length) return res.status(404).json({ success: false, message: 'Admin not found.' });
    const admin = admins[0];
    const ticketNumber = 'TKT-' + Date.now() + '-' + adminId;

    const [result] = await pool.query(
      `INSERT INTO support_ticket (adminId, adminName, adminEmail, gymName, ticketNumber, subject, category, priority, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Open', NOW(), NOW())`,
      [adminId, admin.fullName || '', admin.email || '', admin.gymName || '', ticketNumber, subject, category || 'General', priority || 'Medium']
    );
    const ticketId = result.insertId;
    await pool.query('INSERT INTO support_ticket_reply (ticketId, senderId, senderRole, message, createdAt) VALUES (?, ?, ?, ?, NOW())', [ticketId, adminId, 'Admin', message]);

    // 1. Email to Admin who raised ticket
    dispatchNotification({
      category: 'support_ticket_created',
      toEmail: admin.email,
      toPhone: admin.phone || null,
      toUserId: adminId,
      softwareName: admin.gymName || 'Gym Management',
      subject: `Support Ticket #${ticketNumber} Created - ${admin.gymName || 'Gym Management'}`,
      message: `Hello ${admin.fullName || 'Admin'},\n\nYour support ticket has been successfully created.\n\nTicket Details:\nTicket ID: #${ticketNumber}\nSoftware: ${admin.gymName || 'Gym Management'}\nSubject: ${subject}\nCategory: ${category || 'General'}\nPriority: ${priority || 'Medium'}\n\nIssue Description:\n${message}\n\nOur support team will review and get back to you shortly.\n\nThank you,\nKiaan Technology Pvt Ltd`,
      isSystemEvent: true,
      customChannels: ['EMAIL', 'IN_APP']
    }).catch(err => console.error("❌ Email to Admin failed on ticket create:", err.message));

    // 2. Email & Alert to SuperAdmin
    notifySuperAdmin(
      `🚨 New Support Ticket Alert!\n\nAdmin Name: ${admin.fullName || 'Admin'}\nAdmin Email: ${admin.email}\nSoftware: ${admin.gymName || 'Gym Management'}\nTicket ID: #${ticketNumber}\nSubject: ${subject}\nCategory: ${category || 'General'}\nPriority: ${priority || 'Medium'}\nCreated Date/Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n\nIssue Description:\n${message}\n\nDashboard Link: https://gymsoftware.space/superadmin/support`,
      "NEW_SUPPORT_TICKET",
      { subject: `New Support Ticket #${ticketNumber} - ${admin.gymName || 'Gym Management'}` }
    ).catch(err => console.error("❌ Email to SuperAdmin failed on ticket create:", err.message));

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
    const ticket = tickets[0];

    await pool.query('INSERT INTO support_ticket_reply (ticketId, senderId, senderRole, message, createdAt) VALUES (?, ?, ?, ?, NOW())', [id, senderId, senderRole, message]);
    
    const isSuperAdmin = (senderRole || '').toLowerCase().includes('superadmin') || (senderRole || '').toLowerCase().includes('subadmin');
    const newStatus = isSuperAdmin ? 'Replied' : ticket.status;
    await pool.query('UPDATE support_ticket SET status = ?, updatedAt = NOW() WHERE id = ?', [newStatus, id]);

    const softwareTitle = ticket.gymName || 'Gym Management';

    if (isSuperAdmin) {
      // SuperAdmin replied -> Send Email to Admin
      dispatchNotification({
        category: 'support_ticket_replied',
        toEmail: ticket.adminEmail,
        toUserId: ticket.adminId,
        softwareName: softwareTitle,
        subject: `Support Ticket #${ticket.ticketNumber} Updated - ${softwareTitle}`,
        message: `Hello ${ticket.adminName || 'Admin'},\n\nYour support ticket has been updated by our support team.\n\nTicket:\n#${ticket.ticketNumber}\n\nIssue:\n${ticket.subject}\n\nResponse:\n${message}\n\nStatus:\n${newStatus}\n\nYou can view the complete ticket from your dashboard:\nhttps://gymsoftware.space/admin/support\n\nThank you,\nKiaan Technology Pvt Ltd`,
        isSystemEvent: true,
        customChannels: ['EMAIL', 'IN_APP']
      }).catch(err => console.error("❌ Email to Admin failed on ticket reply:", err.message));
    } else {
      // Admin replied -> Send Email to SuperAdmin
      notifySuperAdmin(
        `📩 Admin Reply on Support Ticket #${ticket.ticketNumber}\n\nAdmin Name: ${ticket.adminName || 'Admin'}\nAdmin Email: ${ticket.adminEmail}\nSoftware: ${softwareTitle}\nSubject: ${ticket.subject}\nStatus: ${newStatus}\n\nAdmin Response:\n${message}\n\nDashboard Link: https://gymsoftware.space/superadmin/support`,
        "TICKET_REPLY",
        { subject: `Support Ticket #${ticket.ticketNumber} Updated - ${softwareTitle}` }
      ).catch(err => console.error("❌ Email to SuperAdmin failed on ticket reply:", err.message));
    }

    return res.json({ success: true, message: 'Reply sent.' });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

export const updateTicketStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['Open', 'Replied', 'Closed'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid status.' });

    const [tickets] = await pool.query('SELECT * FROM support_ticket WHERE id = ?', [id]);
    if (!tickets.length) return res.status(404).json({ success: false, message: 'Ticket not found.' });
    const ticket = tickets[0];

    await pool.query('UPDATE support_ticket SET status = ?, updatedAt = NOW() WHERE id = ?', [status, id]);

    const isClosed = status === 'Closed';
    const statusText = isClosed ? 'Closed / Resolved' : status;
    const softwareTitle = ticket.gymName || 'Gym Management';

    // Email to Admin
    dispatchNotification({
      category: 'support_ticket_status',
      toEmail: ticket.adminEmail,
      toUserId: ticket.adminId,
      softwareName: softwareTitle,
      subject: `Support Ticket #${ticket.ticketNumber} Updated - ${softwareTitle}`,
      message: `Hello ${ticket.adminName || 'Admin'},\n\nYour support ticket status has been updated.\n\nTicket:\n#${ticket.ticketNumber}\n\nIssue:\n${ticket.subject}\n\nStatus:\n${statusText}\n\nYou can view the complete ticket from your dashboard:\nhttps://gymsoftware.space/admin/support\n\nThank you,\nKiaan Technology Pvt Ltd`,
      isSystemEvent: true,
      customChannels: ['EMAIL', 'IN_APP']
    }).catch(err => console.error("❌ Email to Admin failed on ticket status update:", err.message));

    // Email to SuperAdmin
    notifySuperAdmin(
      `🔔 Support Ticket Status Alert!\n\nTicket ID: #${ticket.ticketNumber}\nAdmin Name: ${ticket.adminName || 'Admin'}\nSoftware: ${softwareTitle}\nSubject: ${ticket.subject}\nNew Status: ${statusText}\nUpdated At: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
      "TICKET_STATUS_UPDATE",
      { subject: `Support Ticket #${ticket.ticketNumber} Updated - ${softwareTitle}` }
    ).catch(err => console.error("❌ Email to SuperAdmin failed on ticket status update:", err.message));

    return res.json({ success: true, message: 'Status updated.' });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

export const getTicketCounts = async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT COUNT(*) as total, SUM(status='Open') as open_count, SUM(status='Replied') as replied_count, SUM(status='Closed') as closed_count FROM support_ticket`);
    return res.json({ success: true, counts: rows[0] });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
