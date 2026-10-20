const express = require('express')
const router = express.Router()
const bcrypt = require('bcrypt')
const { body } = require('express-validator')

const supabase = require('../config/supabase')
const { verifyToken, adminOnly, secretaryOnly, validate } = require('../middleware/auth')
const { resetLinkLimiter } = require('../middleware/rateLimiter')
const { upload, handleMulterError } = require('../middleware/multer')
const { uploadToStorage, deleteFromStorage } = require('../helpers/storage')
const { logActivity } = require('../helpers/logger')
const { sendPasswordLink } = require('../helpers/passwordLink')
const { ROLE_POSITIONS, ALL_POSITIONS, isValidPositionForRole } = require('../helpers/roles')
const { autoLinkUser, memberForUser, LINKABLE_USER_POSITIONS } = require('../helpers/accountLinks')

const SALT_ROUNDS = 10

// POST /api/users
// Admin-gated creation of a role:'user' account (councilor/vice_mayor) —
// this is what the admin dashboard's "Add User" button actually calls now.
// It used to reuse POST /api/register (auth.js), which has no auth at all
// since it's the public self-registration endpoint — meaning the "Add User"
// button's protection was purely cosmetic (any unauthenticated caller could
// hit /register directly). /register stays as-is for public self-signup;
// this route is the admin-initiated equivalent with real access control.
router.post('/', verifyToken, adminOnly, upload.single('photo'), handleMulterError, [
  body('name').trim().notEmpty().withMessage('Name is required.'),
  body('username').trim().notEmpty().isAlphanumeric().withMessage('Username must be alphanumeric.'),
  body('email').trim().normalizeEmail().isEmail().withMessage('Valid email is required.'),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .matches(/[A-Z]/).withMessage('Password must contain at least 1 uppercase letter.')
    .matches(/\d/).withMessage('Password must contain at least 1 number.'),
  body('position').isIn(ROLE_POSITIONS.user)
    .withMessage(`Position must be one of: ${ROLE_POSITIONS.user.join(', ')}.`),
], validate, async (req, res) => {
  const { name, username, email, password, position } = req.body
  try {
    let photo = null, photo_path = null
    if (req.file) {
      const { fileName, publicUrl } = await uploadToStorage(req.file, 'users')
      photo = publicUrl
      photo_path = fileName
    }
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS)
    const { data, error } = await supabase
      .from('users')
      .insert({ name, username, email, password: hashedPassword, role: 'user', position, photo, photo_path })
      .select().single()
    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'Username or email already exists.' })
      return res.status(500).json({ error: error.message })
    }
    await logActivity(req, 'CREATE', 'Users', `Added new user: ${username}`)

    // Option B (safety net): if the office registered the account before
    // adding the council member through Officials, link it now — but only
    // on a certain match (see autoLinkUser). A failed lookup never fails the
    // account creation itself; the account just stays "Not linked".
    let linkedMember = null
    try {
      linkedMember = await autoLinkUser(data)
      if (linkedMember) {
        await logActivity(req, 'LINK_ACCOUNT', 'Officials', `Auto-linked account ${username} to council member: ${linkedMember.full_name}`)
      }
    } catch (linkErr) {
      console.error('Auto-link on user create failed:', linkErr.message)
    }
    res.json({ success: true, userId: data.id, linkedMember })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/users
router.get('/', verifyToken, adminOnly, async (req, res) => {
  const { data, error } = await supabase
    .from('users').select('id, name, username, email, role, position, photo')
    .eq('is_archived', false)
    .order('id', { ascending: true })
  if (error) return res.status(500).json({ error: error.message })
  // Which council member each account is linked to (null = "Not linked"),
  // so User Management can flag the rare account auto-linking couldn't place.
  const { data: links } = await supabase
    .from('sb_council_members').select('id, full_name, user_id').not('user_id', 'is', null)
  const byUser = new Map((links || []).map((m) => [m.user_id, { id: m.id, full_name: m.full_name }]))
  res.json(data.map((u) => ({ ...u, linked_member: byUser.get(u.id) || null })))
})

// GET /api/users/check-availability?field=username|email&value=&excludeId=
// Registered before GET /:id so Express doesn't swallow this path as an :id
// param. Backs the live "already taken" hint in the Add/Edit user form —
// the DB unique index (migrations/011) is still the real enforcement at
// insert/update time; this is just a UX nicety, not a security boundary.
router.get('/check-availability', verifyToken, adminOnly, async (req, res) => {
  const { field, value, excludeId } = req.query
  if (!['username', 'email'].includes(field) || !value)
    return res.status(400).json({ error: 'field must be "username" or "email", and value is required.' })
  try {
    let query = supabase.from('users').select('id').ilike(field, value)
    if (excludeId) query = query.neq('id', excludeId)
    const { data, error } = await query.limit(1)
    if (error) return res.status(500).json({ error: error.message })
    res.json({ available: data.length === 0 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/users/me/records
// Backs "My Profile"'s record tabs. Resolves the caller's own council
// member through the account link (sb_council_members.user_id) — never by
// name, which broke whenever either side's name was edited — and returns
// every ordinance/resolution they're tagged on, grouped by role, plus the
// author approvals waiting on them. Secretary/Clerk and not-yet-linked
// accounts get member: null (the profile explains why instead of looking
// empty). Registered before GET /:id so "me" isn't read as an id.
const RECORD_TYPES = [
  { entityType: 'ordinance', table: 'ordinances', linkTable: 'ordinance_officials', idColumn: 'ordinance_id', numberField: 'ordinance_number' },
  { entityType: 'resolution', table: 'resolutions', linkTable: 'resolution_officials', idColumn: 'resolution_id', numberField: 'resolution_number' },
]

router.get('/me/records', verifyToken, async (req, res) => {
  try {
    const member = await memberForUser(req.user.id)
    const result = { member, authored: [], co_authored: [], sponsored: [], awaiting_my_approval: [] }
    if (!member) {
      const { data: me } = await supabase.from('users').select('position').eq('id', req.user.id).single()
      result.linkable = LINKABLE_USER_POSITIONS.includes(me?.position)
      return res.json(result)
    }

    const bucket = { author: result.authored, co_author: result.co_authored, sponsor: result.sponsored }
    const rejected = []
    for (const t of RECORD_TYPES) {
      const { data, error } = await supabase
        .from(t.linkTable)
        .select(`role, term:sb_council_member_terms ( term_period ),
          record:${t.table} ( id, title, ${t.numberField}, category, status, uploaded_at, approved_on, reviewed_at, filetype, filepath, filename )`)
        .eq('official_id', member.id)
      if (error) return res.status(500).json({ error: error.message })
      for (const link of data || []) {
        if (!link.record) continue
        const row = {
          entity_type: t.entityType,
          id: link.record.id,
          title: link.record.title,
          number: link.record[t.numberField] || null,
          category: link.record.category || null,
          status: link.record.status,
          uploaded_at: link.record.uploaded_at,
          approved_on: link.record.approved_on,
          reviewed_at: link.record.reviewed_at,
          term_period: link.term?.term_period || null,
          filetype: link.record.filetype,
          filepath: link.record.filepath,
          filename: link.record.filename,
        }
        // A rejected record is private to its Author — co-authors and
        // sponsors don't see it, even here.
        if (row.status === 'rejected' && link.role !== 'author') continue
        bucket[link.role]?.push(row)
        if (link.role === 'author' && row.status === 'rejected') rejected.push(row)
      }
    }

    // The Secretary's reason for each rejection = the note saved with the
    // 'rejected' history entry. Older rejections from before the note was
    // required fall back to the latest comment on the record.
    for (const t of RECORD_TYPES) {
      const ids = rejected.filter((r) => r.entity_type === t.entityType).map((r) => r.id)
      if (ids.length === 0) continue
      const [{ data: history }, { data: comments }] = await Promise.all([
        supabase.from('record_history').select('entity_id, comment, created_at')
          .eq('entity_type', t.entityType).eq('action', 'rejected').in('entity_id', ids)
          .order('created_at', { ascending: false }),
        supabase.from('comments').select('entity_id, text, created_at')
          .eq('entity_type', t.entityType).in('entity_id', ids)
          .order('created_at', { ascending: false }),
      ])
      for (const r of rejected.filter((x) => x.entity_type === t.entityType)) {
        r.rejection_reason =
          (history || []).find((h) => h.entity_id === r.id && h.comment)?.comment ||
          (comments || []).find((c) => c.entity_id === r.id)?.text ||
          null
      }
    }

    const { data: approvals, error: apErr } = await supabase
      .from('author_approvals')
      .select('id, entity_type, entity_id, stage, requested_at')
      .eq('official_id', member.id).eq('decision', 'pending')
      .order('requested_at', { ascending: true })
    if (apErr) return res.status(500).json({ error: apErr.message })
    const titleOf = new Map(result.authored.map((r) => [`${r.entity_type}:${r.id}`, r]))
    result.awaiting_my_approval = (approvals || []).map((a) => ({
      ...a,
      title: titleOf.get(`${a.entity_type}:${a.entity_id}`)?.title || null,
      number: titleOf.get(`${a.entity_type}:${a.entity_id}`)?.number || null,
    }))

    const byNewest = (a, b) => new Date(b.approved_on || b.uploaded_at || 0) - new Date(a.approved_on || a.uploaded_at || 0)
    result.authored.sort(byNewest)
    result.co_authored.sort(byNewest)
    result.sponsored.sort(byNewest)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/users/:id
router.get('/:id', verifyToken, adminOnly, async (req, res) => {
  const { data, error } = await supabase
    .from('users').select('id, name, username, email, role, position, photo').eq('id', req.params.id).single()
  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(404).json({ error: 'User not found.' })
  res.json(data)
})

// PUT /api/users/:id
router.put('/:id', verifyToken, adminOnly, upload.single('photo'), handleMulterError, [
  body('name').trim().notEmpty().withMessage('Name is required.'),
  body('username').trim().escape().notEmpty().isAlphanumeric().withMessage('Username must be alphanumeric.'),
  body('email').trim().normalizeEmail().isEmail().withMessage('Valid email is required.'),
  body('role').isIn(['admin', 'user']).withMessage('Role must be admin or user.'),
  body('position').optional({ checkFalsy: true }).isIn(ALL_POSITIONS)
    .withMessage(`Position must be one of: ${ALL_POSITIONS.join(', ')}.`),
], validate, async (req, res) => {
  const { id } = req.params
  const { name, username, email, role, position } = req.body
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('users').select('id, photo_path, position').eq('id', id).single()
    if (fetchErr || !existing) return res.status(404).json({ error: 'User not found.' })

    // position is optional on this route (an edit can leave it untouched),
    // so validate the role this update actually produces against whichever
    // position it actually ends up with — catching both a mismatched
    // position sent directly, and a role change that would leave a
    // now-stale position from before this update.
    const finalPosition = position || existing.position
    if (finalPosition && !isValidPositionForRole(role, finalPosition)) {
      return res.status(400).json({
        error: `"${finalPosition}" is not a valid position for role "${role}". Valid positions: ${ROLE_POSITIONS[role].join(', ')}.`,
      })
    }

    const updateData = { name, username, email, role }
    if (position) updateData.position = position
    if (req.file) {
      if (existing.photo_path) await deleteFromStorage(existing.photo_path)
      const { fileName, publicUrl } = await uploadToStorage(req.file, 'users')
      updateData.photo = publicUrl
      updateData.photo_path = fileName
    }

    const { error } = await supabase
      .from('users').update(updateData).eq('id', id)
    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'Username or email already in use.' })
      return res.status(500).json({ error: error.message })
    }
    // Secretary/Clerk accounts are never linked to a council member — if an
    // edit moves a linked account into one of those positions, drop the link.
    if (!LINKABLE_USER_POSITIONS.includes(finalPosition)) {
      await supabase.from('sb_council_members').update({ user_id: null }).eq('user_id', id)
    }
    await logActivity(req, 'UPDATE', 'Users', `Updated user ID: ${id}`)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/users/:id/name
// Self-or-admin, same permission shape as /:id/email — backs the "My
// Profile" modal's own name field (clicking your avatar), the one bit of
// their own account a non-admin user (Vice-Mayor/Councilor/Liga/SK
// Federated) can edit themselves; everything else about their account
// (username, email, role, position, photo) stays admin-only via PUT /:id.
router.put('/:id/name', verifyToken, [
  body('name').trim().notEmpty().withMessage('Name is required.')
    .matches(/^[A-Za-zÑñ.\s]+$/).withMessage('Name may only contain letters, spaces, a period, and ñ.'),
], validate, async (req, res) => {
  const { id } = req.params
  const { name } = req.body
  if (req.user.id !== parseInt(id) && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Forbidden.' })
  const { error } = await supabase.from('users').update({ name }).eq('id', id)
  if (error) return res.status(500).json({ error: error.message })
  await logActivity(req, 'UPDATE', 'Users', `Updated name for user ID: ${id}`)
  res.json({ success: true, name })
})

// PUT /api/users/:id/email
router.put('/:id/email', verifyToken, [
  body('email').trim().normalizeEmail().isEmail().withMessage('Valid email is required.'),
], validate, async (req, res) => {
  const { id } = req.params
  const { email } = req.body
  if (req.user.id !== parseInt(id) && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Forbidden.' })
  const { error } = await supabase.from('users').update({ email }).eq('id', id)
  if (error) {
    if (error.code === '23505') return res.status(400).json({ error: 'Email already in use.' })
    return res.status(500).json({ error: error.message })
  }
  await logActivity(req, 'UPDATE', 'Users', `Updated email for user ID: ${id}`)
  res.json({ success: true })
})

// PUT /api/users/:id/password
router.put('/:id/password', verifyToken, [
  body('newPassword')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .matches(/[A-Z]/).withMessage('Password must contain at least 1 uppercase letter.')
    .matches(/\d/).withMessage('Password must contain at least 1 number.'),
], validate, async (req, res) => {
  const { id } = req.params
  const { currentPassword, newPassword } = req.body
  if (req.user.id !== parseInt(id) && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Forbidden.' })
  try {
    // Anyone — admin or not — changing their OWN password must prove they
    // know the current one. This used to be skipped for admins changing
    // their own password (the condition below required role !== 'admin'
    // too), which meant an admin session could silently overwrite its own
    // password with no re-authentication — the same shape of gap a stolen
    // session would exploit to lock out the real owner. Only an admin
    // changing SOMEONE ELSE's password (id !== req.user.id) skips this.
    if (req.user.id === parseInt(id)) {
      if (!currentPassword)
        return res.status(400).json({ error: 'Current password is required.' })
      const { data: user } = await supabase
        .from('users').select('password').eq('id', id).single()
      const isMatch = await bcrypt.compare(currentPassword, user.password)
      if (!isMatch)
        return res.status(400).json({ error: 'Current password is incorrect.' })
    }
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS)
    const { error } = await supabase
      .from('users').update({ password: hashedPassword, must_change_password: false }).eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    await logActivity(req, 'UPDATE', 'Users', `Changed password for user ID: ${id}`)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/users/me/reset-password
// My Profile's "Email Me a Reset Link": sends the signed-in account a reset
// link to its own email address, the same single-use, 1-hour link the
// Secretary's Reset Password sends (helpers/passwordLink.js). Registered
// before /:id/reset-password so "me" isn't read as an id.
router.post('/me/reset-password', verifyToken, resetLinkLimiter, async (req, res) => {
  try {
    const { data: me } = await supabase
      .from('users').select('id, username, name, email').eq('id', req.user.id).single()
    if (!me) return res.status(404).json({ error: 'Account not found.' })
    if (!me.email) return res.status(400).json({ error: 'Your account has no email address. Please ask the Secretary to add one.' })
    try {
      await sendPasswordLink(me, 'self')
    } catch (linkErr) {
      return res.status(linkErr.status || 500).json({ error: linkErr.message })
    }
    await logActivity(req, 'RESET_PASSWORD', 'Users', `Sent own password reset link: ${me.username}`)
    res.json({ success: true, email: me.email })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/users/:id/reset-password
// Admin-initiated password reset: emails the account a time-limited,
// single-use link (see migrations/022_add_password_reset_token.sql) that
// lets them set their own new password directly, instead of the old
// flow of generating and emailing a temporary password they'd then have to
// log in with (see the now-superseded 012_add_must_change_password.sql).
//
// The email is sent BEFORE the token is stored, not after — if it were the
// other way around and the send failed (bad API key, Brevo outage, etc.),
// the account would be left with a live reset token nobody received a link
// for. Sending first means a failure here leaves the account untouched and
// safely retryable.
router.post('/:id/reset-password', verifyToken, adminOnly, async (req, res) => {
  const { id } = req.params
  try {
    const { data: existing } = await supabase
      .from('users').select('id, username, name, email').eq('id', id).single()
    if (!existing) return res.status(404).json({ error: 'User not found.' })

    try {
      await sendPasswordLink(existing, 'reset')
    } catch (linkErr) {
      return res.status(linkErr.status || 500).json({ error: linkErr.message })
    }

    await logActivity(req, 'RESET_PASSWORD', 'Users', `Sent password reset link to: ${existing.username}`)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/users/:id
// Archives the account instead of a hard delete: the row stays in place (so
// historical references like activity_logs.user_id still resolve) and is
// flagged is_archived, which also blocks the account from authenticating.
router.delete('/:id', verifyToken, adminOnly, async (req, res) => {
  const { id } = req.params
  try {
    const { data: existing } = await supabase
      .from('users').select('id, username').eq('id', id).single()
    if (!existing) return res.status(404).json({ error: 'User not found.' })
    if (req.user.id === parseInt(id))
      return res.status(400).json({ error: 'You cannot archive your own account.' })
    const { error } = await supabase
      .from('users')
      .update({ is_archived: true, archived_at: new Date().toISOString(), archived_by: req.user.id })
      .eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    await logActivity(req, 'ARCHIVE', 'Users', `Archived user: ${existing.username}`)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/users/:id/restore
// Only reachable from the Archives page, which is secretary-gated on the
// frontend (canViewArchives) — secretaryOnly here closes the gap where any
// admin-role account could otherwise call this directly.
router.put('/:id/restore', verifyToken, adminOnly, secretaryOnly, async (req, res) => {
  const { id } = req.params
  try {
    const { data: existing } = await supabase
      .from('users').select('id, username').eq('id', id).single()
    if (!existing) return res.status(404).json({ error: 'User not found.' })
    const { error } = await supabase
      .from('users')
      .update({ is_archived: false, archived_at: null, archived_by: null })
      .eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    await logActivity(req, 'RESTORE', 'Users', `Restored user: ${existing.username}`)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
