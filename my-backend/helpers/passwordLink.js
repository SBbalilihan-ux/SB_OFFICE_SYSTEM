const crypto = require('crypto')
const supabase = require('../config/supabase')
const { sendEmail } = require('./email')
const { escapeHtml } = require('./utils')

// Base URL for links embedded in emails — same localhost-fallback pattern as
// the frontend's own API constant (AdminContext.jsx), since there's no
// deployed URL configured yet.
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

const COPY = {
  // Requested by the account holder themselves — Forgot Password on the
  // login page, or My Profile's "Email Me a Reset Link".
  self: {
    subject: 'Reset your password',
    intro: (u) => `You asked to reset the password for your account (<strong>${escapeHtml(u.username)}</strong>). Click the button below to set a new password:`,
    button: 'Reset Password',
    hours: 1,
  },
  // Accounts created from Officials → Add Council Member (Option A in
  // Author_Approval_Workflow_v2.docx) — nobody ever types a password for
  // them, so the official sets their own through this link.
  welcome: {
    subject: 'Your Sangguniang Bayan account is ready',
    intro: (u) => `An account was created for you (username: <strong>${escapeHtml(u.username)}</strong>). Click the button below to set your password and sign in. You'll use this account to review and approve the ordinances and resolutions you author.`,
    button: 'Set My Password',
    hours: 72,
  },
}

// Emails `user` a time-limited, single-use link (migrations/022) to set a
// new password. The email is sent BEFORE the token is stored, not after — if
// the send failed after storing, the account would be left with a live
// token nobody received a link for. Throws { status, message } on failure.
async function sendPasswordLink(user, kind = 'self') {
  const copy = COPY[kind]
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + copy.hours * 60 * 60 * 1000)
  const link = `${FRONTEND_URL}/reset-password?token=${token}`
  const expiry = copy.hours === 1 ? '1 hour' : `${copy.hours} hours`

  try {
    await sendEmail({
      to: [{ email: user.email, name: user.name }],
      subject: copy.subject,
      htmlContent: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;border:1px solid #e0e0e0;border-radius:12px;">
          <div style="text-align:center;margin-bottom:24px;">
            <h2 style="color:#2e7d32;margin:0 0 4px;">Office of Sangguniang Bayan</h2>
            <p style="color:#888;font-size:13px;margin:0;">Municipality of Balilihan, Bohol</p>
          </div>
          <p style="color:#555;font-size:15px;">${copy.intro(user)}</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${link}" style="display:inline-block;padding:14px 28px;background:#2e7d32;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">${copy.button}</a>
          </div>
          <p style="color:#888;font-size:13px;">This link expires in <strong>${expiry}</strong> and can only be used once. If you didn't expect this, contact the office immediately and ignore this email.</p>
        </div>
      `,
    })
  } catch (emailErr) {
    console.error(`Password ${kind} email failed:`, emailErr.message)
    throw { status: 502, message: 'Could not send the email. Please try again.' }
  }

  const { error } = await supabase
    .from('users')
    .update({ reset_token: token, reset_token_expires: expiresAt.toISOString() })
    .eq('id', user.id)
  if (error) throw { status: 500, message: error.message }
}

// Tells `user` that `resetBy` (the Secretary/admin) set a new password on
// their account from User Management. Deliberately contains NO password and
// no link — the office hands the new temporary password over in person, and
// this email just makes sure the owner knows it happened (and can raise the
// alarm if they didn't ask for it). Throws on send failure; the caller
// decides whether that's fatal.
async function sendPasswordResetNotice(user, resetBy) {
  const when = new Date().toLocaleString('en-PH', {
    timeZone: 'Asia/Manila', dateStyle: 'long', timeStyle: 'short',
  })
  await sendEmail({
    to: [{ email: user.email, name: user.name }],
    subject: 'Your password was reset',
    htmlContent: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;border:1px solid #e0e0e0;border-radius:12px;">
        <div style="text-align:center;margin-bottom:24px;">
          <h2 style="color:#2e7d32;margin:0 0 4px;">Office of Sangguniang Bayan</h2>
          <p style="color:#888;font-size:13px;margin:0;">Municipality of Balilihan, Bohol</p>
        </div>
        <p style="color:#555;font-size:15px;">Hello ${escapeHtml(user.name)},</p>
        <p style="color:#555;font-size:15px;">The password for your account (<strong>${escapeHtml(user.username)}</strong>) was reset by <strong>${escapeHtml(resetBy.name)}</strong> on <strong>${escapeHtml(when)}</strong>.</p>
        <p style="color:#555;font-size:15px;">Please get your temporary password from the Sangguniang Bayan office. You'll be asked to set your own new password the next time you log in.</p>
        <div style="text-align:center;margin:24px 0;">
          <a href="${FRONTEND_URL}/" style="display:inline-block;padding:14px 28px;background:#2e7d32;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Go to Login</a>
        </div>
        <p style="color:#888;font-size:13px;">If you did not ask for your password to be reset, contact the office immediately.</p>
      </div>
    `,
  })
}

module.exports = { sendPasswordLink, sendPasswordResetNotice }
