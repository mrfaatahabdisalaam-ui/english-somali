const db = require('./db');

function userFromRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    phone: row.phone,
    role: row.role || 'user',
    freeAccess: row.free_access === true,
    locked: row.locked === true,
    expiresAt: row.expires_at
      ? new Date(row.expires_at).toISOString()
      : null,
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString()
      : null
  };
}

function paymentFromRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    phone: row.phone,
    amount: Number(row.amount),
    currency: row.currency,
    paymentMethod: row.payment_method,
    paymentNumber: row.payment_number,
    paymentName: row.payment_name,
    senderPhone: row.sender_phone,
    reference: row.reference,
    status: row.status,
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString()
      : null,
    approvedAt: row.approved_at
      ? new Date(row.approved_at).toISOString()
      : null,
    rejectedAt: row.rejected_at
      ? new Date(row.rejected_at).toISOString()
      : null
  };
}

function lessonFromRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    video: row.video || '',
    videoUrl: row.video_url || '',
    videoPublicId: row.video_public_id || '',
    lines: Array.isArray(row.lines) ? row.lines : [],
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString()
      : null
  };
}

module.exports = {
  db,
  userFromRow,
  paymentFromRow,
  lessonFromRow
};
