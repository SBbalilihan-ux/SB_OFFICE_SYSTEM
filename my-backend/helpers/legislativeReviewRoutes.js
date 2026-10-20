const express = require('express')
const supabase = require('../config/supabase')
const { verifyToken, secretaryOnly, viceMayorOnly } = require('../middleware/auth')
const { canArchiveLegislativeRecord, escapeHtml, yearInManila, parseApprovedDay } = require('./utils')
const { logActivity } = require('./logger')
const { findDuplicateRecord } = require('./duplicates')
const { notify, notifyByPosition, notifyAllStaff, notificationEmailHtml } = require('./notify')
const { STAGE_LABELS, stageForStatus, authorOf, approvalFor } = require('./authorApprovals')
const { memberForUser, userForMember } = require('./accountLinks')
const { nextNumberFor, sequentialNumberError, latestPublishedYear } = require('./recordNumbers')
const { HISTORY_VIEWER_POSITIONS, recordHistory, historyFor } = require('./recordHistory')

// Builds the shared review-workflow routes — accept / request-changes /
// vm-approve / publish / archive (plus advance-reading for ordinances/
// resolutions) — for one legislative record type (ordinances, resolutions,
// or session_minutes). These endpoints implement the same
//   pending → needs_revision → pending → first_reading → second_reading →
//     third_reading → ready_to_publish → approved → published
// (session_minutes skips the three reading statuses — see `hasReadings`)
// state machine across all three record types; hand-applying a change to
// each copy separately is exactly how bugs have slipped through before —
// see useLegislativeReview.js's note on the Pending tab's loading flag, and
// the officials-relink fix, which needed the same edit made twice by hand.
// Only the table name, a few labels, and the archive RPC name actually
// differ per type — everything else here is identical.
//
// `singularLabel` drives every status/permission error message
// ("Ordinance not found.", "Session minutes is not pending review.", etc.)
// and the archive-related messages ("You are not allowed to archive this
// ordinance.", "Archived session minutes: ..."). The pre-extraction code
// had two one-off exceptions to that pattern for session_minutes ("session
// record" / "session" instead of "session minutes") — those looked like
// incidental copy-paste drift rather than a deliberate distinction, so they
// were normalized here rather than carried forward as permanent config.
// `numberField`/`numberLabel` are set only for ordinances/resolutions —
// session_minutes assigns its number at creation time and publishes with no
// extra input, same as before. When set, the record's official number is no
// longer collected at draft-upload time (see routes/ordinances.js and
// routes/resolutions.js — the field there is now optional and unvalidated):
// at upload time nobody yet knows which draft the Vice-Mayor will approve
// first, so requiring a number then produced out-of-order/duplicate numbers
// that had to be hand-corrected later. Requiring it here instead, at the
// moment Secretary actually publishes, means the number reflects the real
// publish order.
// The three readings an ordinance/resolution draft goes through in session
// (RA 7160), inserted into the state machine as three extra `status` values
// between "Secretary accepted" and "ready for Vice-Mayor" — Accept (below)
// now lands on 'first_reading' instead of jumping straight to
// 'ready_to_publish', and /advance-reading walks it the rest of the way:
//   pending → needs_revision → pending → first_reading → second_reading →
//     third_reading → ready_to_publish → approved → published
// session_minutes has no reading requirement, so it keeps the original
// direct pending → ready_to_publish jump on Accept (see `hasReadings` below).
const READING_STATUSES = ['first_reading', 'second_reading', 'third_reading']
// Accept now lands on 'accepted' first (migrations/033): the author approves
// the draft before its first reading starts, then the Secretary clicks
// "Proceed to First Reading", which is /advance-reading's first step:
//   pending → accepted → first_reading → second_reading → third_reading →
//     ready_to_publish → approved → published
const REVIEW_STATUSES = ['accepted', ...READING_STATUSES]

// Author approval (panel recommendation, Author_Approval_Workflow_v2.docx):
// for hasReadings types, the record's Author must approve the accepted draft
// and each completed reading before /advance-reading moves it on, and give a final approval
// before /publish. Tracked in `author_approvals` (migrations/031), one row per
// (record, stage), rather than as extra `status` values — the state machine
// above stays exactly as it was. Only records accepted after this shipped
// carry author_approval_required = true; older ones finish under the old rules.

function createLegislativeReviewRoutes({
  table,
  entityType,
  activityModule,
  singularLabel,
  archiveRpc,
  labelOf,
  numberField,
  numberLabel,
  // Store the published number in capitals (resolutions: "RESOLUTION NO. 02 - 2025").
  uppercaseNumber = false,
  approvedDateField,
  hasReadings,
  // (year, seq) => number in this type's usual wording, used for the next
  // number when no published record exists yet to copy the format from.
  defaultNumberFormat,
  // true → the suggested number always continues from the latest published
  // one (its year + 1), rather than restarting at 01 when the approved date
  // or today falls in a newer year. A year the Secretary types still wins.
  numberContinuesLatest = false,
}) {
  const router = express.Router()
  const lower = singularLabel.toLowerCase()

  async function loadInStatus(id, expectedStatus) {
    const { data, error } = await supabase.from(table).select('*').eq('id', id).single()
    if (error || !data) return { notFound: true }
    if (data.status !== expectedStatus) return { wrongStatus: true, data }
    return { data }
  }

  // Runs the actual status-changing UPDATE with the expected *current*
  // status baked into the WHERE clause, so two near-simultaneous actions on
  // the same record can't both succeed — loadInStatus above is only a
  // friendly pre-check for the common case (stale UI), not a lock; this is
  // what actually closes the check-then-act race window between that check
  // and the write. PGRST116 means the UPDATE matched zero rows because the
  // status had already moved on by the time this ran — exactly that race —
  // reported as a 409 rather than passed through as a raw Postgrest error.
  async function atomicUpdate(id, fromStatus, patch) {
    const { data, error } = await supabase
      .from(table)
      .update(patch)
      .eq('id', id)
      .eq('status', fromStatus)
      .select().single()
    if (error?.code === 'PGRST116') return { conflict: true }
    if (error) return { error }
    return { data }
  }
  const conflictResponse = (res) =>
    res.status(409).json({ error: `${singularLabel} was just updated by someone else — please refresh.` })

  // null when no author approval is needed right now; otherwise a 409 body
  // explaining what's still missing. Used as the gate in /advance-reading and
  // /publish.
  async function missingAuthorApproval(existing) {
    if (!hasReadings || !existing.author_approval_required) return null
    const stage = stageForStatus(existing.status)
    if (!stage) return null
    const approval = await approvalFor(entityType, existing.id, stage)
    if (approval?.decision === 'approved') return null
    const what = STAGE_LABELS[stage]
    if (approval?.decision === 'declined')
      return { error: `The author declined the ${what}. Request their approval again, or request changes / reject.`, authorApproval: 'declined' }
    if (approval?.decision === 'pending')
      return { error: `Waiting for the author's approval of the ${what}.`, authorApproval: 'pending' }
    return { error: `The author's approval of the ${what} is required first. Use "Request Author Approval".`, authorApproval: 'missing' }
  }

  // Marks `stage` as waiting on `author` (whose login is `account`), logs it,
  // and emails them. A declined stage goes back to 'pending' (same row).
  // Shared by POST /:id/author-approval/request and Accept.
  async function sendApprovalRequest({ req, existing, stage, author, account }) {
    const { data, error } = await supabase.from('author_approvals').upsert({
      entity_type: entityType, entity_id: Number(existing.id), stage, official_id: author.id,
      decision: 'pending', comment: null, on_behalf: false,
      requested_by: req.user.id, requested_at: new Date().toISOString(),
      decided_by_user_id: null, decided_at: null, reminder_sent_at: null,
    }, { onConflict: 'entity_type,entity_id,stage' }).select().single()
    if (error) return { error }
    await logActivity(req, 'REQUEST_AUTHOR_APPROVAL', activityModule,
      `Requested ${author.full_name}'s approval (${STAGE_LABELS[stage]}): ${labelOf(existing)}`)
    await recordHistory(req, { entityType, entityId: existing.id, action: 'author_approval_requested', stage })
    notify({
      recipientId: account.id,
      emailSubject: `Your Approval Is Needed: ${labelOf(existing)}`,
      emailHtml: notificationEmailHtml(
        'Your Approval Is Needed',
        `As the author of <strong>${escapeHtml(labelOf(existing))}</strong>, your approval of the <strong>${STAGE_LABELS[stage]}</strong> is needed before it can move forward. Sign in and open <em>My Profile → Needs My Approval</em>.`
      ),
    })
    return { data }
  }

  const notifyVmReadyForApproval = (existing, id) => notifyByPosition('vice_mayor', {
    message: `${singularLabel} ready for your approval: ${labelOf(existing)}`,
    entityType, entityId: id,
    emailSubject: `${singularLabel} Ready for Your Approval`,
    emailHtml: notificationEmailHtml(
      `${singularLabel} Ready for Your Approval`,
      `<strong>${escapeHtml(labelOf(existing))}</strong> was accepted by the Secretary and is now waiting on your Vice-Mayor approval.`
    ),
  })

  // PUT /:id/accept — Secretary. hasReadings types land on 'accepted' and the
  // author's approval is requested right away (emailed, if the author has a
  // linked account — otherwise the Secretary records it on their behalf from
  // the approval panel); /advance-reading then starts the first reading.
  // Others (session_minutes) jump straight to 'ready_to_publish' as before.
  router.put('/:id/accept', verifyToken, secretaryOnly, async (req, res) => {
    const { id } = req.params
    const { notFound, wrongStatus, data: existing } = await loadInStatus(id, 'pending')
    if (notFound) return res.status(404).json({ error: `${singularLabel} not found.` })
    if (wrongStatus) return res.status(400).json({ error: `${singularLabel} is not pending review.` })
    const targetStatus = hasReadings ? 'accepted' : 'ready_to_publish'
    try {
      const { data, conflict, error } = await atomicUpdate(id, 'pending', {
        status: targetStatus, reviewed_by: req.user.id, reviewed_at: new Date().toISOString(),
        ...(hasReadings && { author_approval_required: true }),
      })
      if (conflict) return conflictResponse(res)
      if (error) return res.status(500).json({ error: error.message })
      await logActivity(req, 'ACCEPT', activityModule, `Accepted draft: ${labelOf(existing)}`)
      await recordHistory(req, { entityType, entityId: id, action: 'accepted' })
      // hasReadings types don't notify the Vice-Mayor yet — that happens once
      // /advance-reading actually reaches 'ready_to_publish'.
      if (!hasReadings) notifyVmReadyForApproval(existing, id)
      // Ask the author to approve the accepted draft. Best effort: Accept has
      // already succeeded, and the panel still offers Request / on-behalf if
      // this can't be sent (no Author tagged, or no linked account).
      let authorApproval = null
      if (hasReadings) {
        try {
          const author = await authorOf(entityType, id)
          const account = author ? await userForMember(author.id) : null
          if (author && account) {
            const { error: reqErr } = await sendApprovalRequest({ req, existing: data, stage: 'accepted', author, account })
            if (reqErr) console.error(`Auto author-approval request failed for ${entityType} #${id}:`, reqErr.message)
            authorApproval = reqErr ? 'failed' : 'requested'
          } else {
            authorApproval = author ? 'no_account' : 'no_author'
          }
        } catch (reqErr) {
          console.error('Auto author-approval request failed:', reqErr.message)
          authorApproval = 'failed'
        }
      }
      res.json({ success: true, data, authorApproval })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // PUT /:id/advance-reading — Secretary only, hasReadings types only.
  // Walks accepted → first_reading → second_reading → third_reading →
  // ready_to_publish,
  // one status at a time; the last step is what actually notifies the
  // Vice-Mayor, since only then is the record really ready for them.
  if (hasReadings) {
    router.put('/:id/advance-reading', verifyToken, secretaryOnly, async (req, res) => {
      const { id } = req.params
      const { data: existing, error: fetchErr } = await supabase.from(table).select('*').eq('id', id).single()
      if (fetchErr || !existing) return res.status(404).json({ error: `${singularLabel} not found.` })
      const currentIndex = REVIEW_STATUSES.indexOf(existing.status)
      if (currentIndex === -1) return res.status(400).json({ error: `${singularLabel} is not currently in a reading stage.` })
      const isFinalReading = currentIndex === REVIEW_STATUSES.length - 1
      const nextStatus = isFinalReading ? 'ready_to_publish' : REVIEW_STATUSES[currentIndex + 1]
      try {
        const missing = await missingAuthorApproval(existing)
        if (missing) return res.status(409).json(missing)
        const { data, conflict, error } = await atomicUpdate(id, existing.status, { status: nextStatus })
        if (conflict) return conflictResponse(res)
        if (error) return res.status(500).json({ error: error.message })
        await logActivity(
          req, 'ADVANCE_READING', activityModule,
          `${isFinalReading ? 'Completed third reading' : `Marked ${nextStatus.replace('_', ' ')}`}: ${labelOf(existing)}`
        )
        await recordHistory(req, { entityType, entityId: id, action: 'advanced', stage: nextStatus })
        if (isFinalReading) notifyVmReadyForApproval(existing, id)
        res.json({ success: true, data })
      } catch (err) {
        res.status(500).json({ error: err.message })
      }
    })
  }

  // PUT /:id/reject — Secretary, hasReadings types only, any reading status
  // → rejected. Distinct from request-changes: that one sends a draft back
  // to the creator to fix and resubmit (pending → needs_revision → pending);
  // this is terminal — the record stays visible (never archived
  // automatically) as a record of what was turned down, but there's no path
  // back into the pipeline for it.
  //
  // A note explaining the rejection is required at every stage, so the
  // Author always learns why — it's saved to the record's comments and
  // history, shown under My Profile → Rejected, and quoted in the email.
  //
  // Also allowed while it waits on the Vice-Mayor ('ready_to_publish') and
  // once the Vice-Mayor has approved ('approved'), up until it's published —
  // the Secretary may still find a problem at the last steps before it goes
  // live.
  if (hasReadings) {
    router.put('/:id/reject', verifyToken, secretaryOnly, async (req, res) => {
      const { id } = req.params
      const comment = (req.body.comment || '').trim()
      const { data: existing, error: fetchErr } = await supabase.from(table).select('*').eq('id', id).single()
      if (fetchErr || !existing) return res.status(404).json({ error: `${singularLabel} not found.` })
      if (!REVIEW_STATUSES.includes(existing.status) && !['ready_to_publish', 'approved'].includes(existing.status)) {
        return res.status(400).json({ error: `${singularLabel} can only be rejected during a reading, while ready to publish, or after the Vice-Mayor's approval.` })
      }
      if (!comment) return res.status(400).json({ error: 'A note explaining the reason for rejection is required.' })
      try {
        const { error: commentErr } = await supabase.from('comments').insert({
          entity_type: entityType,
          entity_id: id,
          author_id: req.user.id,
          author_role: req.user.position || req.user.role,
          text: comment,
        })
        if (commentErr) return res.status(500).json({ error: commentErr.message })

        const { data, conflict, error } = await atomicUpdate(id, existing.status, {
          status: 'rejected', reviewed_by: req.user.id, reviewed_at: new Date().toISOString(),
        })
        if (conflict) return conflictResponse(res)
        if (error) return res.status(500).json({ error: error.message })
        await logActivity(req, 'REJECT', activityModule, `Rejected: ${labelOf(existing)}`)
        await recordHistory(req, { entityType, entityId: id, action: 'rejected', stage: existing.status, comment })
        // A rejected record is private to its Author (it shows only in their
        // My Profile), so the email goes to the Author's linked account — not
        // to whoever uploaded the draft. No linked account = no email.
        const author = await authorOf(entityType, id).catch(() => null)
        const authorAccount = author ? await userForMember(author.id).catch(() => null) : null
        notify({
          recipientId: authorAccount?.id,
          message: `Your ${lower} was rejected: ${labelOf(existing)} — Reason: ${comment}`,
          entityType, entityId: id,
          emailSubject: `Rejected: ${labelOf(existing)}`,
          emailHtml: notificationEmailHtml(
            'Rejected',
            `The Secretary rejected <strong>${escapeHtml(labelOf(existing))}</strong>.<br/>Reason: <em>"${escapeHtml(comment)}"</em>` +
              `<br/>You can find it under <em>My Profile → Rejected</em>.`
          ),
        })
        res.json({ success: true, data })
      } catch (err) {
        res.status(500).json({ error: err.message })
      }
    })
  }

  // PUT /:id/request-changes — Secretary, pending → needs_revision (comment required)
  router.put('/:id/request-changes', verifyToken, secretaryOnly, async (req, res) => {
    const { id } = req.params
    const { comment } = req.body
    const { notFound, wrongStatus, data: existing } = await loadInStatus(id, 'pending')
    if (notFound) return res.status(404).json({ error: `${singularLabel} not found.` })
    if (wrongStatus) return res.status(400).json({ error: `${singularLabel} is not pending review.` })
    try {
      // The comment can come with this request, or already be on the
      // thread (the Secretary posted it via the comment box first) — in
      // that case the latest comment is the one quoted in the email.
      let reason = comment?.trim()
      if (reason) {
        const { error: commentErr } = await supabase.from('comments').insert({
          entity_type: entityType,
          entity_id: id,
          author_id: req.user.id,
          author_role: req.user.position || req.user.role,
          text: reason,
        })
        if (commentErr) return res.status(500).json({ error: commentErr.message })
      } else {
        const { data: latest, error: latestErr } = await supabase.from('comments')
          .select('text')
          .eq('entity_type', entityType)
          .eq('entity_id', id)
          .order('created_at', { ascending: false })
          .limit(1)
        if (latestErr) return res.status(500).json({ error: latestErr.message })
        reason = latest?.[0]?.text?.trim()
        if (!reason) return res.status(400).json({ error: 'A comment is required when requesting changes.' })
      }

      const { data, conflict, error } = await atomicUpdate(id, 'pending', {
        status: 'needs_revision', reviewed_by: req.user.id, reviewed_at: new Date().toISOString(),
      })
      if (conflict) return conflictResponse(res)
      if (error) return res.status(500).json({ error: error.message })
      await logActivity(req, 'REQUEST_CHANGES', activityModule, `Requested changes on draft: ${labelOf(existing)}`)
      await recordHistory(req, { entityType, entityId: id, action: 'changes_requested', comment: reason })
      notify({
        recipientId: existing.created_by,
        message: `Changes requested on your ${lower}: ${labelOf(existing)}`,
        entityType, entityId: id,
        emailSubject: `Changes Requested: ${labelOf(existing)}`,
        emailHtml: notificationEmailHtml(
          'Changes Requested',
          `The Secretary requested changes on <strong>${escapeHtml(labelOf(existing))}</strong>:<br/><em>"${escapeHtml(reason)}"</em>`
        ),
      })
      res.json({ success: true, data })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // PUT /:id/vm-approve — Vice-Mayor, ready_to_publish → approved
  router.put('/:id/vm-approve', verifyToken, viceMayorOnly, async (req, res) => {
    const { id } = req.params
    const { notFound, wrongStatus, data: existing } = await loadInStatus(id, 'ready_to_publish')
    if (notFound) return res.status(404).json({ error: `${singularLabel} not found.` })
    if (wrongStatus) return res.status(400).json({ error: `${singularLabel} is not ready for Vice-Mayor approval.` })
    try {
      const approvedAt = new Date().toISOString()
      const { data, conflict, error } = await atomicUpdate(id, 'ready_to_publish', {
        status: 'approved', reviewed_by: req.user.id, reviewed_at: approvedAt,
        // The date a finished record carries — see migrations/026. Its `year`
        // follows the approval, not the upload: a draft entered in one year and
        // approved in the next belongs to the year it was approved.
        ...(approvedDateField && { [approvedDateField]: approvedAt, year: yearInManila(approvedAt) }),
      })
      if (conflict) return conflictResponse(res)
      if (error) return res.status(500).json({ error: error.message })
      await logActivity(req, 'VM_APPROVE', activityModule, `Vice-Mayor approved: ${labelOf(existing)}`)
      await recordHistory(req, { entityType, entityId: id, action: 'vm_approved' })
      notifyByPosition('secretary', {
        message: `Vice-Mayor approved, ready to publish: ${labelOf(existing)}`,
        entityType, entityId: id,
        emailSubject: `Approved — Ready to Publish: ${labelOf(existing)}`,
        emailHtml: notificationEmailHtml(
          'Ready to Publish',
          `<strong>${escapeHtml(labelOf(existing))}</strong> was approved by the Vice-Mayor and is ready for you to publish.`
        ),
      })
      res.json({ success: true, data })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // GET /:id/next-number?year=YYYY | ?date=YYYY-MM-DD — Secretary. The only
  // number this record may be published with for that year (latest published
  // + 1), in the office's usual format, so the Publish dialog can pre-fill it.
  // `year` is the numbering year the Secretary picked (any year — old records
  // included); else, with numberContinuesLatest, the year of the latest
  // published number; else the year of `date` (the approved date in the
  // dialog); else the Vice-Mayor's approval date, else today.
  if (numberField) {
    router.get('/:id/next-number', verifyToken, secretaryOnly, async (req, res) => {
      const { id } = req.params
      try {
        const { data: existing } = await supabase.from(table).select('*').eq('id', id).single()
        if (!existing) return res.status(404).json({ error: `${singularLabel} not found.` })
        const askedYear = Number(req.query.year)
        const parsed = typeof req.query.date === 'string' && req.query.date ? parseApprovedDay(req.query.date) : null
        const latestYear = numberContinuesLatest
          ? await latestPublishedYear({ table, numberField, excludeId: id })
          : null
        const year = Number.isInteger(askedYear) && askedYear >= 1900 && askedYear <= 2100
          ? askedYear
          : latestYear
          ? latestYear
          : parsed
          ? parsed.getUTCFullYear()
          : yearInManila(existing[approvedDateField] || new Date())
        const next = await nextNumberFor({ table, numberField, entityType, year, excludeId: id, defaultFormat: defaultNumberFormat })
        res.json({ success: true, data: { ...next, number: uppercaseNumber ? next.number.toUpperCase() : next.number } })
      } catch (err) {
        res.status(500).json({ error: err.message })
      }
    })
  }

  // PUT /:id/publish — Secretary, approved → published
  router.put('/:id/publish', verifyToken, secretaryOnly, async (req, res) => {
    const { id } = req.params
    const { notFound, wrongStatus, data: existing } = await loadInStatus(id, 'approved')
    if (notFound) return res.status(404).json({ error: `${singularLabel} not found.` })
    if (wrongStatus) return res.status(400).json({ error: `${singularLabel} is not approved for publishing.` })

    try {
      const missing = await missingAuthorApproval(existing)
      if (missing) return res.status(409).json(missing)
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }

    const patch = { status: 'published' }
    // The Secretary can set the record's approved date here (the dialog
    // pre-fills it from the document). Stored at noon UTC so it reads as the
    // same calendar day in any timezone the office might view it from.
    if (approvedDateField && typeof req.body[approvedDateField] === 'string' && req.body[approvedDateField].trim()) {
      const parsed = parseApprovedDay(req.body[approvedDateField])
      if (!parsed) return res.status(400).json({ error: 'Approved date must be a valid date (YYYY-MM-DD).' })
      patch[approvedDateField] = parsed.toISOString()
      patch.year = parsed.getUTCFullYear()
    }
    if (numberField) {
      let number = typeof req.body[numberField] === 'string' ? req.body[numberField].trim() : ''
      if (uppercaseNumber) number = number.toUpperCase()
      if (!number) return res.status(400).json({ error: `${numberLabel} is required to publish.` })

      // Numbers are sequential per year: if the latest published for the
      // year written in the number is 13, this one must be 14 (see
      // helpers/recordNumbers.js). Any year is allowed, so old records from
      // past years can be encoded — only the sequence is enforced.
      const fallbackYear = patch.year ?? yearInManila(existing[approvedDateField] || new Date())
      try {
        const seqError = await sequentialNumberError({
          table, numberField, entityType, excludeId: id, number, fallbackYear, lower, defaultFormat: defaultNumberFormat,
        })
        if (seqError) return res.status(400).json({ error: seqError, sequenceError: true })
      } catch (seqErr) {
        return res.status(500).json({ error: seqErr.message })
      }

      // Case-insensitive duplicate check across every other record of this
      // type, not just the currently loaded page — the frontend's own check
      // only sees what it already fetched, so this is the authoritative one.
      let isDuplicate
      try {
        isDuplicate = !!(await findDuplicateRecord({ table, numberField, number, excludeId: id }))
      } catch (dupErr) {
        return res.status(500).json({ error: dupErr.message })
      }
      if (isDuplicate) {
        return res.status(400).json({ error: `"${number}" is already in use by another ${lower}. Please choose a different number.` })
      }
      patch[numberField] = number
    }

    try {
      const { data, conflict, error } = await atomicUpdate(id, 'approved', patch)
      if (conflict) return conflictResponse(res)
      if (error) return res.status(500).json({ error: error.message })
      await logActivity(req, 'PUBLISH', activityModule, `Published: ${labelOf(existing)}`)
      await recordHistory(req, { entityType, entityId: id, action: 'published', comment: numberField ? patch[numberField] : null })
      // Broadcast to every active staff account (Secretary/Clerk/Councilor/
      // Vice-Mayor), same as "new session minutes recorded"/"new session
      // agenda posted" — publishing is the record going officially live, a
      // office-wide event, not a personal heads-up to whoever happened to
      // draft it. The old version only notified `created_by`, which (a)
      // silently notified no one at all for the many existing records with
      // no recorded drafter, and (b) never told anyone else that a new law
      // just went into effect.
      notifyAllStaff({
        message: `New ${lower} published: ${labelOf(existing)}`,
        entityType, entityId: id,
        emailSubject: `Published: ${labelOf(existing)}`,
        emailHtml: notificationEmailHtml(
          'Published',
          `<strong>${escapeHtml(labelOf(existing))}</strong> has been officially published.`
        ),
      })
      res.json({ success: true, data })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  if (hasReadings) {
    // GET /:id/author-approval — everything the View modal's approval panel
    // needs: whether approval applies, the current stage, every decision so
    // far (history for the panel/auditors), who the author is, and whether the
    // caller is that author (so only they see Approve/Decline).
    router.get('/:id/author-approval', verifyToken, async (req, res) => {
      const { id } = req.params
      try {
        const { data: existing } = await supabase
          .from(table).select('id, status, author_approval_required').eq('id', id).single()
        if (!existing) return res.status(404).json({ error: `${singularLabel} not found.` })
        const [author, myMember, { data: approvals, error }] = await Promise.all([
          authorOf(entityType, id),
          memberForUser(req.user.id),
          supabase.from('author_approvals')
            .select('id, stage, decision, comment, on_behalf, requested_at, decided_at, official_id')
            .eq('entity_type', entityType).eq('entity_id', id)
            .order('requested_at', { ascending: true }),
        ])
        if (error) return res.status(500).json({ error: error.message })
        const authorAccount = author ? await userForMember(author.id) : null
        res.json({
          required: !!existing.author_approval_required,
          current_stage: stageForStatus(existing.status),
          author,
          author_has_account: !!authorAccount,
          is_author: !!(author && myMember && myMember.id === author.id),
          approvals: approvals || [],
        })
      } catch (err) {
        res.status(500).json({ error: err.message })
      }
    })

    // GET /:id/history — the record's full trail, upload to publish/reject,
    // for its details view (helpers/recordHistory.js, migrations/034). Staff
    // positions only — never part of anything public.
    router.get('/:id/history', verifyToken, async (req, res) => {
      if (!HISTORY_VIEWER_POSITIONS.includes(req.user.position))
        return res.status(403).json({ error: 'You are not allowed to view this record history.' })
      try {
        const { data: existing } = await supabase.from(table).select('id').eq('id', req.params.id).maybeSingle()
        if (!existing) return res.status(404).json({ error: `${singularLabel} not found.` })
        res.json({ success: true, data: await historyFor(entityType, req.params.id) })
      } catch (err) {
        res.status(500).json({ error: err.message })
      }
    })

    // POST /:id/author-approval/request — Secretary, once a reading is done
    // (or after the Vice-Mayor's approval, for the final 'publish' stage).
    // Emails the author's linked account. A declined stage can be requested
    // again; the same row just goes back to 'pending'.
    router.post('/:id/author-approval/request', verifyToken, secretaryOnly, async (req, res) => {
      const { id } = req.params
      try {
        const { data: existing } = await supabase.from(table).select('*').eq('id', id).single()
        if (!existing) return res.status(404).json({ error: `${singularLabel} not found.` })
        const stage = stageForStatus(existing.status)
        if (!stage || !existing.author_approval_required)
          return res.status(400).json({ error: `${singularLabel} doesn't need author approval at this stage.` })
        const author = await authorOf(entityType, id)
        if (!author) return res.status(400).json({ error: `No Author is tagged on this ${lower}. Tag one first, or record the approval on the author's behalf.` })
        const account = await userForMember(author.id)
        if (!account)
          return res.status(400).json({ error: `${author.full_name} has no linked login account. Record the approval on their behalf instead.`, noAccount: true })
        const current = await approvalFor(entityType, id, stage)
        if (current?.decision === 'approved') return res.status(400).json({ error: 'The author already approved this stage.' })

        const { data, error } = await sendApprovalRequest({ req, existing, stage, author, account })
        if (error) return res.status(500).json({ error: error.message })
        res.json({ success: true, data })
      } catch (err) {
        res.status(500).json({ error: err.message })
      }
    })

    // PUT /:id/author-approval/decide — { decision: 'approved'|'declined', comment? }
    // Only the account linked to the record's Author may answer; having the
    // Councilor position isn't enough. The WHERE decision='pending' makes a
    // double-click or two tabs unable to both record a decision.
    router.put('/:id/author-approval/decide', verifyToken, async (req, res) => {
      const { id } = req.params
      const { decision } = req.body
      const comment = (req.body.comment || '').trim() || null
      if (!['approved', 'declined'].includes(decision))
        return res.status(400).json({ error: "decision must be 'approved' or 'declined'." })
      try {
        const { data: existing } = await supabase.from(table).select('*').eq('id', id).single()
        if (!existing) return res.status(404).json({ error: `${singularLabel} not found.` })
        const stage = stageForStatus(existing.status)
        const [author, myMember] = await Promise.all([authorOf(entityType, id), memberForUser(req.user.id)])
        if (!author || !myMember || myMember.id !== author.id)
          return res.status(403).json({ error: `Only the author of this ${lower} can approve or decline it.` })
        const current = stage ? await approvalFor(entityType, id, stage) : null
        if (!current || current.decision !== 'pending')
          return res.status(400).json({ error: 'There is no approval request waiting for you on this stage.' })

        const { data, error } = await supabase.from('author_approvals')
          .update({ decision, comment, decided_by_user_id: req.user.id, decided_at: new Date().toISOString() })
          .eq('id', current.id).eq('decision', 'pending')
          .select().single()
        if (error?.code === 'PGRST116') return res.status(409).json({ error: 'This request was just answered — please refresh.' })
        if (error) return res.status(500).json({ error: error.message })

        const verb = decision === 'approved' ? 'approved' : 'declined'
        await logActivity(req, decision === 'approved' ? 'AUTHOR_APPROVE' : 'AUTHOR_DECLINE', activityModule,
          `Author ${verb} (${STAGE_LABELS[stage]}): ${labelOf(existing)}`)
        await recordHistory(req, {
          entityType, entityId: id, action: decision === 'approved' ? 'author_approved' : 'author_declined',
          stage, comment, actorName: author.full_name,
        })
        notifyByPosition('secretary', {
          emailSubject: `Author ${decision === 'approved' ? 'Approved' : 'Declined'}: ${labelOf(existing)}`,
          emailHtml: notificationEmailHtml(
            `Author ${decision === 'approved' ? 'Approved' : 'Declined'}`,
            `${escapeHtml(author.full_name)} ${verb} the <strong>${STAGE_LABELS[stage]}</strong> of <strong>${escapeHtml(labelOf(existing))}</strong>.` +
              (comment ? `<br/><em>"${escapeHtml(comment)}"</em>` : '')
          ),
        })
        res.json({ success: true, data })
      } catch (err) {
        res.status(500).json({ error: err.message })
      }
    })

    // PUT /:id/author-approval/on-behalf — { note } (required). Secretary
    // records the author's approval for an author with no linked account
    // (past official, account not created yet) — e.g. "approved verbally
    // during the 3rd reading, session of Sept 22". Flagged on_behalf = true.
    router.put('/:id/author-approval/on-behalf', verifyToken, secretaryOnly, async (req, res) => {
      const { id } = req.params
      const note = (req.body.note || '').trim()
      if (!note) return res.status(400).json({ error: 'A note explaining how the author approved is required.' })
      try {
        const { data: existing } = await supabase.from(table).select('*').eq('id', id).single()
        if (!existing) return res.status(404).json({ error: `${singularLabel} not found.` })
        const stage = stageForStatus(existing.status)
        if (!stage || !existing.author_approval_required)
          return res.status(400).json({ error: `${singularLabel} doesn't need author approval at this stage.` })
        const author = await authorOf(entityType, id)
        if (author && (await userForMember(author.id)))
          return res.status(400).json({ error: `${author.full_name} has a linked account — request their approval so they can approve it themselves.` })
        const current = await approvalFor(entityType, id, stage)
        if (current?.decision === 'approved') return res.status(400).json({ error: 'This stage is already approved.' })

        const now = new Date().toISOString()
        const { data, error } = await supabase.from('author_approvals').upsert({
          entity_type: entityType, entity_id: Number(id), stage, official_id: author?.id || null,
          decision: 'approved', comment: note, on_behalf: true,
          requested_by: req.user.id, requested_at: current?.requested_at || now,
          decided_by_user_id: req.user.id, decided_at: now,
        }, { onConflict: 'entity_type,entity_id,stage' }).select().single()
        if (error) return res.status(500).json({ error: error.message })

        await logActivity(req, 'AUTHOR_APPROVE_ON_BEHALF', activityModule,
          `Recorded author approval on behalf of ${author?.full_name || 'the author'} (${STAGE_LABELS[stage]}): ${labelOf(existing)} — ${note}`)
        await recordHistory(req, { entityType, entityId: id, action: 'author_approved_on_behalf', stage, comment: note })
        res.json({ success: true, data })
      } catch (err) {
        res.status(500).json({ error: err.message })
      }
    })
  }

  // DELETE /:id — archive. Who may depends on which bucket the record is
  // currently in and, for Councilor/Vice-Mayor, whether they created it
  // (see canArchiveLegislativeRecord). Archives instead of a hard delete via
  // the `archiveRpc` Postgres function (see migrations/007), which
  // snapshots the row + its links into `archives` and removes them from the
  // live tables as one transaction.
  router.delete('/:id', verifyToken, async (req, res) => {
    try {
      const { data: existing, error: fetchErr } = await supabase
        .from(table).select('status, created_by').eq('id', req.params.id).single()
      if (fetchErr || !existing) return res.status(404).json({ error: `${singularLabel} not found.` })
      const isOwner = existing.created_by === req.user.id
      if (!canArchiveLegislativeRecord(req.user.position, existing.status, isOwner))
        return res.status(403).json({ error: `You are not allowed to archive this ${lower}.` })

      const { data: snapshot, error } = await supabase.rpc(archiveRpc, {
        p_id: req.params.id,
        p_archived_by: req.user.id,
      })
      if (error) {
        if (error.code === 'P0002') return res.status(404).json({ error: `${singularLabel} not found.` })
        return res.status(500).json({ error: error.message })
      }

      await logActivity(req, 'ARCHIVE', activityModule, `Archived ${lower}: ${labelOf(snapshot)}`)
      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  return router
}

module.exports = { createLegislativeReviewRoutes }
