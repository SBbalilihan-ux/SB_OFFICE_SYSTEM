const jwt = require('jsonwebtoken')
const { validationResult } = require('express-validator')
const supabase = require('../config/supabase')

const JWT_SECRET = process.env.JWT_SECRET

const isAllowedBeforePasswordChange = (req, userId) => {
  const path = req.originalUrl.split('?')[0].replace(/\/+$/, '')
  return (req.method === 'PUT' && path === `/api/users/${userId}/password`)
    || (req.method === 'POST' && path === '/api/logout')
}

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'No token provided.' })
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'sangguniang-bayan-system',
      audience: 'sb-client'
    })
    const { data: user, error: dbError } = await supabase
      .from('users').select('is_archived, role, position, must_change_password').eq('id', decoded.id).single()
    // A Supabase query failure (no internet reaching it, a timeout, a 5xx)
    // is not the same thing as an invalid token — Supabase is a remote
    // service, so this can fail even when the token itself is perfectly
    // valid and the browser-to-backend hop (often just localhost) is fine.
    // PGRST116 means the query genuinely found zero rows (real "no such
    // account"); anything else is infrastructure trouble the client should
    // retry, not a reason to wipe their session — see authFetch in
    // AdminContext.jsx, which force-logs-out on any 401 from here.
    if (dbError && dbError.code !== 'PGRST116') {
      return res.status(503).json({ error: 'Unable to verify your session right now. Please check your connection and try again.' })
    }
    if (!user)
      return res.status(401).json({ error: 'Account not found.' })
    if (user.is_archived)
      return res.status(401).json({ error: 'This account has been archived.' })
    // Still on the temporary password the office handed out — the only
    // things this token may do are set a real password or log out. Enforced
    // here rather than just by LogIn.jsx's forced-change screen, so the
    // step can't be skipped by calling the API directly with the token.
    if (user.must_change_password && !isAllowedBeforePasswordChange(req, decoded.id))
      return res.status(403).json({ error: 'You must change your temporary password before continuing.', code: 'PASSWORD_CHANGE_REQUIRED' })
    // role/position are re-read live rather than trusted from the JWT
    // payload, so a permission change (de-admin'ing someone, reassigning
    // their position) takes effect on their very next request instead of
    // waiting out the token's up-to-8h lifetime.
    req.user = { ...decoded, role: user.role, position: user.position }
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' })
  }
}

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ error: 'Admins only.' })
  next()
}

const secretaryOnly = (req, res, next) => {
  if (req.user?.position !== 'secretary')
    return res.status(403).json({ error: 'Secretary only.' })
  next()
}

const secretaryOrClerk = (req, res, next) => {
  if (!['secretary', 'clerk'].includes(req.user?.position))
    return res.status(403).json({ error: 'Secretary or Clerk only.' })
  next()
}

const clerkOnly = (req, res, next) => {
  if (req.user?.position !== 'clerk')
    return res.status(403).json({ error: 'Clerk only.' })
  next()
}

const viceMayorOnly = (req, res, next) => {
  if (req.user?.position !== 'vice_mayor')
    return res.status(403).json({ error: 'Vice-Mayor only.' })
  next()
}

// Legislative-records RBAC: who may create a brand-new draft. All four
// positions can originate one — Clerk/Councilor are the primary drafters,
// but Secretary and Vice-Mayor both sometimes draft the ordinance/
// resolution/session minutes directly rather than only reviewing/approving
// what someone else submitted.
const canCreateDraft = (req, res, next) => {
  if (!['secretary', 'clerk', 'councilor', 'vice_mayor', 'liga_ng_mga_barangay', 'sk_federated'].includes(req.user?.position))
    return res.status(403).json({ error: 'Secretary, Clerk, Councilor, or Vice-Mayor only.' })
  next()
}

// Legislative-records RBAC: who may replace/revise a not-yet-published
// record's file — Secretary/Clerk only. Councilor and Vice-Mayor may
// originate a draft (canCreateDraft) and withdraw their own via DELETE, but
// not edit its content — see helpers/utils.js's canEditLegislativeRecord.
const pendingEditors = (req, res, next) => {
  if (!['secretary', 'clerk'].includes(req.user?.position))
    return res.status(403).json({ error: 'Secretary or Clerk only.' })
  next()
}

const validate = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty())
    return res.status(400).json({ errors: errors.array() })
  next()
}

module.exports = {
  verifyToken, adminOnly, secretaryOnly, secretaryOrClerk, clerkOnly, viceMayorOnly,
  canCreateDraft, pendingEditors, validate,
}