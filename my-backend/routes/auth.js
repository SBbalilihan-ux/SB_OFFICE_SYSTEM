const express = require('express')
const router = express.Router()
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const { body } = require('express-validator')
const SibApiV3Sdk = require('sib-api-v3-sdk')

const supabase = require('../config/supabase')
const { verifyToken, adminOnly, validate } = require('../middleware/auth')
const { loginLimiter, otpLimiter, accountCreationLimiter } = require('../middleware/rateLimiter')
const { upload, handleMulterError } = require('../middleware/multer')
const { uploadToStorage } = require('../helpers/storage')
const { logActivity } = require('../helpers/logger')
const { isValidEmail, getIP } = require('../helpers/utils')
const { ROLE_POSITIONS } = require('../helpers/roles')
const { emailShell, BRAND_PRIMARY } = require('../helpers/notify')

const JWT_SECRET = process.env.JWT_SECRET
const SALT_ROUNDS = 10

// ---- BREVO CLIENT ----
const brevoClient = SibApiV3Sdk.ApiClient.instance
brevoClient.authentications['api-key'].apiKey = process.env.BREVO_API_KEY
const emailApi = new SibApiV3Sdk.TransactionalEmailsApi()

// ---- OTP STORE (in-memory) ----
const otpStore = new Map()

// POST /api/send-otp
router.post('/send-otp', otpLimiter, async (req, res) => {
  const { email } = req.body
  if (!email || !/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(email.trim())) {
    return res.status(400).json({ error: 'A valid Gmail address (@gmail.com) is required.' })
  }
  const otp = crypto.randomInt(100000, 999999).toString()
  const expiresAt = Date.now() + 10 * 60 * 1000
  otpStore.set(email.trim().toLowerCase(), { otp, expiresAt })
  try {
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail()
    sendSmtpEmail.sender = { name: 'Sangguniang Bayan Balilihan', email: process.env.BREVO_SENDER_EMAIL }
    sendSmtpEmail.to = [{ email: email.trim() }]
    sendSmtpEmail.subject = 'Your Registration Verification Code'
    sendSmtpEmail.htmlContent = emailShell({
      icon: '🔐',
      heading: 'Your Verification Code',
      bodyHtml: `
        <div style="text-align:center;">
          <p style="color:#555;font-size:14px;margin:0 0 8px;">Enter this code to continue:</p>
          <div style="font-size:38px;font-weight:800;letter-spacing:12px;color:${BRAND_PRIMARY};text-align:center;margin:16px 0;padding:16px;background:#eef2ff;border-radius:10px;">${otp}</div>
          <p style="color:#888;font-size:13px;margin-top:16px;">This code expires in <strong>10 minutes</strong>.<br/>Do not share this code with anyone.</p>
        </div>
      `,
      footerNote: 'If you did not request this, please ignore this email.',
    })
    await emailApi.sendTransacEmail(sendSmtpEmail)
    res.json({ success: true, message: 'OTP sent successfully.' })
  } catch (err) {
    console.error('Brevo error:', JSON.stringify(err, null, 2))
    res.status(500).json({ error: 'Failed to send verification email. Please try again.' })
  }
})

// POST /api/verify-otp
router.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body
  const key = email?.trim().toLowerCase()
  const record = otpStore.get(key)
  if (!record)
    return res.status(400).json({ error: 'No verification code found. Please request a new one.' })
  if (Date.now() > record.expiresAt) {
    otpStore.delete(key)
    return res.status(400).json({ error: 'Code has expired. Please request a new one.' })
  }
  if (record.otp !== otp)
    return res.status(400).json({ error: 'Incorrect code. Please try again.' })
  otpStore.delete(key)
  res.json({ success: true, message: 'Email verified successfully.' })
})

// POST /api/register
router.post('/register', accountCreationLimiter, upload.single('photo'), handleMulterError, [
  body('name').trim().notEmpty().withMessage('Full name is required.'),
  body('username').trim().escape().notEmpty().isAlphanumeric().withMessage('Username must be alphanumeric.'),
  body('email').trim().normalizeEmail().isEmail().withMessage('Invalid email format.'),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .matches(/[A-Z]/).withMessage('Password must contain at least 1 uppercase letter.')
    .matches(/\d/).withMessage('Password must contain at least 1 number.'),
  body('position').optional({ checkFalsy: true }).isIn(ROLE_POSITIONS.user)
    .withMessage(`Position must be one of: ${ROLE_POSITIONS.user.join(', ')}.`),
], validate, async (req, res) => {
  const { name, username, email, password, position } = req.body
  try {
    let photo = null
    let photo_path = null
    if (req.file) {
      const { fileName, publicUrl } = await uploadToStorage(req.file, 'users')
      photo = publicUrl
      photo_path = fileName
    }
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS)
    const { data, error } = await supabase
  .from('users')
  .insert({ name, username, email, password: hashedPassword, role: 'user', position: position || 'councilor', photo, photo_path })
  .select().single()
    if (error) {
      if (error.code === '23505')
        return res.status(400).json({ error: 'Username or email already exists.' })
      return res.status(500).json({ error: error.message })
    }
    // Routed through the shared logActivity() helper (like /admin/add)
    // instead of a raw insert, with the new account's identity passed as an
    // override since there's no req.user here — the caller isn't logged in,
    // they ARE the new account. This also means a logging hiccup no longer
    // throws into the outer catch and reports a false 500 for a
    // registration that actually already succeeded (logActivity swallows
    // its own errors instead of propagating them).
    await logActivity(req, 'REGISTER', 'Auth', `New user registered: ${username}`, 'success', {
      userId: data.id, userName: name, userRole: 'user',
    })
    res.json({ success: true, userId: data.id })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/login
router.post('/login', loginLimiter, [
  body('identifier').trim().notEmpty().withMessage('Username or email is required.'),
  body('password').notEmpty().withMessage('Password is required.'),
], validate, async (req, res) => {
  const { identifier, password } = req.body
  try {
    const isEmail = isValidEmail(identifier)
    const { data: users, error } = await supabase
      .from('users').select('*')
      .eq(isEmail ? 'email' : 'username', identifier).limit(1)
    if (error) return res.status(500).json({ error: error.message })
    if (!users || users.length === 0) {
      await supabase.from('activity_logs').insert({
        user_name: identifier, user_role: 'unknown',
        action: 'LOGIN', module: 'Auth',
        description: `Failed login attempt: ${identifier}`,
        ip_address: getIP(req), status: 'failed'
      })
      return res.json({ success: false, message: 'Invalid username/email.' })
    }
    const user = users[0]
    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      await supabase.from('activity_logs').insert({
        user_id: user.id, user_name: user.name, user_role: user.role,
        action: 'LOGIN', module: 'Auth',
        description: `Wrong password for: ${identifier}`,
        ip_address: getIP(req), status: 'failed'
      })
      return res.json({ success: false, message: 'Invalid password.' })
    }
    const token = jwt.sign(
  { id: user.id, username: user.username, email: user.email, role: user.role, name: user.name, position: user.position },
  JWT_SECRET,
  { expiresIn: '8h', issuer: 'sangguniang-bayan-system', audience: 'sb-client' }
)
    await supabase.from('activity_logs').insert({
      user_id: user.id, user_name: user.name, user_role: user.role,
      action: 'LOGIN', module: 'Auth',
      description: `${user.name} logged in`,
      ip_address: getIP(req), status: 'success'
    })
    res.json({
  success: true, token,
  user: { id: user.id, name: user.name, username: user.username, email: user.email, role: user.role, position: user.position, photo: user.photo, mustChangePassword: user.must_change_password, tourCompleted: user.tour_completed }
})
  } catch (err) {
    console.error('LOGIN ERROR:', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/logout
router.post('/logout', verifyToken, async (req, res) => {
  await logActivity(req, 'LOGOUT', 'Auth', `${req.user.name} logged out`)
  res.json({ success: true })
})

// POST /api/admin/add
// Like POST /api/users, the password is temporary — must_change_password
// makes the new staff account set its own on first login.
router.post('/admin/add', accountCreationLimiter, verifyToken, adminOnly, upload.single('photo'), handleMulterError, [
  body('name').trim().notEmpty().withMessage('Name is required.'),
  body('username').trim().escape().notEmpty().isAlphanumeric().withMessage('Username must be alphanumeric.'),
  body('email').trim().normalizeEmail().isEmail().withMessage('Invalid email format.'),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .matches(/[A-Z]/).withMessage('Password must contain at least 1 uppercase letter.')
    .matches(/\d/).withMessage('Password must contain at least 1 number.'),
  body('position').optional({ checkFalsy: true }).isIn(ROLE_POSITIONS.admin)
    .withMessage(`Position must be one of: ${ROLE_POSITIONS.admin.join(', ')}.`),
], validate, async (req, res) => {
  const { name, username, email, password, position } = req.body
try {
  let photo = null
  let photo_path = null
  if (req.file) {
    const { fileName, publicUrl } = await uploadToStorage(req.file, 'users')
    photo = publicUrl
    photo_path = fileName
  }
  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS)
  const { data, error } = await supabase
    .from('users')
    .insert({ name, username, email, password: hashedPassword, role: 'admin', position: position || 'secretary', photo, photo_path, must_change_password: true })
    .select().single()
    if (error) {
      if (error.code === '23505')
        return res.status(400).json({ error: 'Username or email already exists.' })
      return res.status(500).json({ error: error.message })
    }
    await logActivity(req, 'CREATE', 'Users', `Added new admin: ${username}`)
    res.json({ success: true, userId: data.id })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Password reset (link-based) ────────────────────────────────────────────
// Unauthenticated by design — the token itself, emailed only to the account
// owner by POST /api/users/:id/reset-password, is the credential. Shared
// lookup so both routes below (checking a link, then submitting it) treat
// "not found" and "expired" identically.
const findValidResetToken = async (token) => {
  const { data: user } = await supabase
    .from('users').select('id, reset_token_expires').eq('reset_token', token).single()
  if (!user || !user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
    return null
  }
  return user
}

// GET /api/reset-password/:token — lets the reset page confirm the link is
// still good before showing the "set a new password" form, rather than the
// account filling it out only to be told at submit time that it expired.
router.get('/reset-password/:token', async (req, res) => {
  try {
    const user = await findValidResetToken(req.params.token)
    if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired.' })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/reset-password/:token
// The emailed token alone authorizes the change — it does not ask for the
// current password, so an account whose owner has forgotten it can still
// recover through the link. The token is single-use and expires after an hour.
router.post('/reset-password/:token', loginLimiter, [
  body('newPassword')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .matches(/[A-Z]/).withMessage('Password must contain at least 1 uppercase letter.')
    .matches(/\d/).withMessage('Password must contain at least 1 number.'),
], validate, async (req, res) => {
  try {
    const user = await findValidResetToken(req.params.token)
    if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired.' })

    const hashedPassword = await bcrypt.hash(req.body.newPassword, SALT_ROUNDS)
    const { error } = await supabase
      .from('users')
      // Single-use: the token is cleared the moment it's redeemed, so the
      // same email link can't be replayed to set the password again later.
      .update({ password: hashedPassword, reset_token: null, reset_token_expires: null, must_change_password: false })
      .eq('id', user.id)
    if (error) return res.status(500).json({ error: error.message })

    await logActivity(req, 'RESET_PASSWORD', 'Users', 'Password reset via emailed link', 'success', {
      userId: user.id,
    })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
