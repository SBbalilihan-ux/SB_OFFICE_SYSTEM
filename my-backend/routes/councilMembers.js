const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const bcrypt = require('bcrypt')

const supabase = require('../config/supabase')
const { verifyToken, adminOnly, secretaryOnly, secretaryOrClerk } = require('../middleware/auth')
const { upload, handleMulterError } = require('../middleware/multer')
const { uploadToStorage, deleteFromStorage } = require('../helpers/storage')
const { logActivity, autoEndTerms } = require('../helpers/logger')
const {
  resolveCouncilId,
  shouldAutoMarkReelected,
  SINGULAR_POSITIONS,
  COUNCILOR_SEAT_CAP,
  findSingularPositionConflict,
  countActiveCouncilors,
  autoUpdateCouncilStatuses,
} = require('../helpers/councils')
const { isValidEmail, USERNAME_ERROR, normalizeUsername, isValidUsername } = require('../helpers/utils')
const { sendPasswordLink } = require('../helpers/passwordLink')
const {
  TERM_TO_USER_POSITION, LINKABLE_USER_POSITIONS, autoLinkMember, suggestLinks,
} = require('../helpers/accountLinks')

// Sorts members by their current term: newer council first, then the
// council's saved display_order. An unplaced term (display_order NULL — a
// member added since the last drag) goes to the end of its council.
const councilYear = (term) => {
  const label = term?.council?.term_label || term?.term_period || ''
  const year = parseInt((label.match(/\d{4}/) || [''])[0])
  return Number.isNaN(year) ? new Date(term?.term_start || 0).getFullYear() : year
}
const compareByCouncilOrder = (a, b) => {
  const ta = a.active_term, tb = b.active_term
  if (!ta || !tb) return (ta ? 0 : 1) - (tb ? 0 : 1)
  return (
    councilYear(tb) - councilYear(ta) ||
    (ta.council_id ?? 0) - (tb.council_id ?? 0) ||
    (ta.display_order ?? Infinity) - (tb.display_order ?? Infinity) ||
    new Date(a.created_at) - new Date(b.created_at)
  )
}

// GET /api/sb-council-members
router.get('/', async (req, res) => {
  try {
    await autoEndTerms()
    await autoUpdateCouncilStatuses()
    const { data, error } = await supabase
      .from('sb_council_members')
      .select(`
        *,
        sb_council_member_terms (
          id, term_period, term_start, term_end, status, is_reelected, notes, created_at,
          council_id, position, display_order,
          council:councils ( id, term_label, status )
        )
      `)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })

    const enriched = data.map(member => {
      const terms = member.sb_council_member_terms || []
      const sorted = [...terms].sort((a, b) => new Date(b.term_start) - new Date(a.term_start))
      const activeTerm = sorted.find(t => t.status === 'active') || sorted[0] || null
      return {
        ...member,
        // Overrides the now-frozen legacy sb_council_members.position column
        // (see 002_add_council_id_and_position_to_terms.sql) with the
        // current term's position, so nothing accidentally reads stale data.
        position: activeTerm?.position || null,
        sb_council_member_terms: undefined,
        terms: sorted,
        active_term: activeTerm,
        term_period: activeTerm?.term_period || null,
        term_status: activeTerm?.status || null,
      }
    })
    // Official order (migrations/032): newest council first, then the order
    // the Secretary/Clerk set by dragging cards in Councilor Management. Every
    // author/sponsor picker reads this list, so they all follow that order.
    enriched.sort(compareByCouncilOrder)
    res.json(enriched)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/sb-council-members/link-suggestions
// One-time cleanup for members and accounts that existed before account
// linking (Author_Approval_Workflow_v2.docx, Section 3.4): unlinked members
// paired with similarly named unlinked accounts. Nothing is linked here —
// the Admin confirms each pair via PUT /:id/account. Registered before
// GET /:id so the path isn't read as an id.
router.get('/link-suggestions', verifyToken, adminOnly, secretaryOrClerk, async (req, res) => {
  try {
    res.json(await suggestLinks())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/sb-council-members/:id
router.get('/:id', async (req, res) => {
  try {
    await autoEndTerms()
    await autoUpdateCouncilStatuses()
    const { data, error } = await supabase
      .from('sb_council_members')
      .select(`
        *,
        sb_council_member_terms (
          id, term_period, term_start, term_end, status, is_reelected, notes, created_at,
          council_id, position, display_order,
          council:councils ( id, term_label, status )
        )
      `)
      .eq('id', req.params.id)
      .single()
    if (error) return res.status(500).json({ error: error.message })
    if (!data) return res.status(404).json({ error: 'Council member not found.' })

    const terms = data.sb_council_member_terms || []
    const sorted = [...terms].sort((a, b) => new Date(b.term_start) - new Date(a.term_start))
    const activeTerm = sorted.find(t => t.status === 'active') || sorted[0] || null

    res.json({
      ...data,
      position: activeTerm?.position || null,
      sb_council_member_terms: undefined,
      terms: sorted,
      active_term: activeTerm,
      term_period: activeTerm?.term_period || null,
      term_status: activeTerm?.status || null,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/sb-council-members/add
router.post('/add', verifyToken, adminOnly, secretaryOrClerk, upload.single('photo'), handleMulterError, async (req, res) => {
  const { full_name, position, term_period, term_start, term_end, is_reelected, notes, force } = req.body
  if (!full_name)
    return res.status(400).json({ error: 'Full name is required.' })
  // Option A (Author_Approval_Workflow_v2.docx, Section 3.2): "Create login
  // account" creates the member's account in the same step, already linked,
  // so a new councilor never needs manual linking. The account's position
  // comes from the member's current term, so a term is required with it.
  const createAccount = req.body.create_account === true || req.body.create_account === 'true'
  const accountUsername = normalizeUsername(req.body.account_username)
  const accountEmail = (req.body.account_email || '').trim().toLowerCase()
  const accountPosition = TERM_TO_USER_POSITION[position] || null
  if (createAccount) {
    if (!term_period || !term_start || !accountPosition)
      return res.status(400).json({ error: 'A current term with a position is required to create a login account.' })
    if (!isValidUsername(accountUsername))
      return res.status(400).json({ error: USERNAME_ERROR })
    if (!isValidEmail(accountEmail))
      return res.status(400).json({ error: 'Valid email is required.' })
  }
  // position is now a per-term attribute (see 002_add_council_id_and_...
  // migration) — it only means anything alongside the term it belongs to,
  // so require all three together, or none at all (member added with no
  // term yet, position added later via "+ Add Term").
  if ((term_period || term_start) && (!term_period || !term_start || !position))
    return res.status(400).json({ error: 'Term period, start date, and position are required together.' })
  try {
    // Same singular-position / Councilor-seat-cap rules as POST/PUT
    // .../terms — validated here too, and before creating anything, since
    // this route can also place a brand-new member straight into a
    // conflicting seat via its bundled initial term.
    let council_id = null
    if (term_period && term_start) {
      council_id = await resolveCouncilId(term_period)

      const conflict = await findSingularPositionConflict({ councilId: council_id, position })
      if (conflict) {
        return res.status(409).json({
          error: `${position} is already held by ${conflict.sb_council_members?.full_name || 'another member'} for this council.`,
        })
      }
      if (position === 'Councilor' && !force) {
        const currentCount = await countActiveCouncilors({ councilId: council_id })
        if (currentCount >= COUNCILOR_SEAT_CAP) {
          return res.status(409).json({
            error: `This council already has ${currentCount} active Councilor${currentCount === 1 ? '' : 's'}.`,
            seatCapExceeded: true,
          })
        }
      }
    }

    // Checked before anything is created, so a taken username/email can't
    // leave a half-made member behind (the DB's unique indexes from
    // migrations/011 still catch a race below).
    if (createAccount) {
      for (const [field, value] of [['username', accountUsername], ['email', accountEmail]]) {
        const { data: taken, error: takenErr } = await supabase.from('users').select('id').ilike(field, value).limit(1)
        if (takenErr) return res.status(500).json({ error: takenErr.message })
        if (taken.length > 0) return res.status(400).json({ error: `That ${field} is already in use by another account.` })
      }
    }

    let photo = null
    let photo_path = null
    if (req.file) {
      const { fileName, publicUrl } = await uploadToStorage(req.file, 'council-members')
      photo = publicUrl
      photo_path = fileName
    }
    const { data: member, error: memberErr } = await supabase
      .from('sb_council_members')
      .insert({ full_name, photo, photo_path })
      .select().single()
    if (memberErr) return res.status(500).json({ error: memberErr.message })

    // Option A: the account is created and linked right after the member.
    // If the account can't be created, the member is removed again so the
    // two are saved together or not at all. Nobody types a password — the
    // official sets their own through the emailed link (helpers/passwordLink.js).
    let account = null
    if (createAccount) {
      const undoMember = async () => {
        await supabase.from('sb_council_members').delete().eq('id', member.id)
        if (photo_path) await deleteFromStorage(photo_path)
      }
      const { data: user, error: userErr } = await supabase
        .from('users')
        .insert({
          name: full_name, username: accountUsername, email: accountEmail,
          password: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10),
          role: 'user', position: accountPosition,
        })
        .select('id, name, username, email').single()
      if (userErr) {
        await undoMember()
        if (userErr.code === '23505') return res.status(400).json({ error: 'Username or email already exists.' })
        return res.status(500).json({ error: userErr.message })
      }
      const { error: linkErr } = await supabase
        .from('sb_council_members').update({ user_id: user.id }).eq('id', member.id)
      if (linkErr) {
        await supabase.from('users').delete().eq('id', user.id)
        await undoMember()
        return res.status(500).json({ error: linkErr.message })
      }
      account = { id: user.id, username: user.username, email: user.email, emailSent: true }
      try {
        await sendPasswordLink(user, 'welcome')
      } catch {
        // The account exists and is linked; the Secretary can resend the
        // link any time with Users → Reset Password.
        account.emailSent = false
      }
      await logActivity(req, 'CREATE', 'Users', `Created and linked account ${user.username} for council member: ${full_name}`)
    }

    if (term_period && term_start) {
      // Flagged re-elected automatically when this person sat in the council
      // right before this one, even if the admin didn't tick the box. The
      // member row was just inserted above, so its own (new) term doesn't
      // exist yet and can't match itself.
      const reelected =
        is_reelected === 'true' || is_reelected === true ||
        (await shouldAutoMarkReelected({ fullName: full_name, term_period, term_start }))
      const { error: termErr } = await supabase
        .from('sb_council_member_terms')
        .insert({
          council_member_id: member.id,
          council_id,
          term_period,
          position,
          term_start,
          term_end: term_end || null,
          status: 'active',
          is_reelected: reelected,
          notes: notes || null,
        })
      if (termErr) console.error('Term insert error:', termErr.message)
    }
    await logActivity(req, 'CREATE', 'Officials', `Added council member: ${full_name}`)

    // Option B (safety net): no account was created here, but the office
    // may have registered one first — link it if it's a certain match.
    let linkedUser = null
    if (!createAccount && term_period && term_start) {
      try {
        linkedUser = await autoLinkMember({ memberId: member.id, fullName: full_name, termPosition: position })
        if (linkedUser) {
          await logActivity(req, 'LINK_ACCOUNT', 'Officials', `Auto-linked council member ${full_name} to account: ${linkedUser.username}`)
        }
      } catch (linkErr) {
        console.error('Auto-link on member create failed:', linkErr.message)
      }
    }
    res.json({ success: true, id: member.id, data: member, account, linkedUser })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/sb-council-members/reorder
// Saves the official order of one council's members after the Secretary or
// Clerk drags the cards in Councilor Management. Body: { council_id,
// term_ids } with term_ids in the new order. Registered before PUT /:id so
// "reorder" isn't read as a member id.
router.put('/reorder', verifyToken, adminOnly, secretaryOrClerk, async (req, res) => {
  const councilId = Number(req.body?.council_id)
  const termIds = Array.isArray(req.body?.term_ids) ? req.body.term_ids.map(Number) : null
  if (!Number.isInteger(councilId) || !termIds || termIds.length === 0 || termIds.some((n) => !Number.isInteger(n)))
    return res.status(400).json({ error: 'council_id and a list of term_ids are required.' })
  if (new Set(termIds).size !== termIds.length)
    return res.status(400).json({ error: 'term_ids contains duplicates.' })
  try {
    const { data: terms, error: tErr } = await supabase
      .from('sb_council_member_terms').select('id').eq('council_id', councilId)
    if (tErr) return res.status(500).json({ error: tErr.message })
    const inCouncil = new Set((terms || []).map((t) => t.id))
    if (termIds.some((id) => !inCouncil.has(id)))
      return res.status(400).json({ error: 'Some of these members do not belong to this council. Refresh the page and try again.' })

    const results = await Promise.all(termIds.map((id, i) =>
      supabase.from('sb_council_member_terms').update({ display_order: i + 1 }).eq('id', id)
    ))
    const failed = results.find((r) => r.error)
    if (failed) return res.status(500).json({ error: failed.error.message })

    const { data: council } = await supabase.from('councils').select('term_label').eq('id', councilId).single()
    await logActivity(req, 'UPDATE', 'Officials', `Rearranged the order of council members (${council?.term_label || `council ${councilId}`})`)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/sb-council-members/:id
router.put('/:id', verifyToken, adminOnly, secretaryOrClerk, upload.single('photo'), handleMulterError, async (req, res) => {
  const { id } = req.params
  const { full_name } = req.body
  if (!full_name)
    return res.status(400).json({ error: 'Full name is required.' })
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('sb_council_members').select('*').eq('id', id).single()
    if (fetchErr || !existing) return res.status(404).json({ error: 'Council member not found.' })

    const updateData = { full_name }
    if (req.file) {
      if (existing.photo_path) await deleteFromStorage(existing.photo_path)
      const { fileName, publicUrl } = await uploadToStorage(req.file, 'council-members')
      updateData.photo = publicUrl
      updateData.photo_path = fileName
    }
    const { data, error } = await supabase
      .from('sb_council_members').update(updateData).eq('id', id).select().single()
    if (error) return res.status(500).json({ error: error.message })

    await logActivity(req, 'UPDATE', 'Officials', `Updated council member: ${full_name}`)
    res.json({ success: true, data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/sb-council-members/:id/account — { user_id } links, { user_id: null } unlinks.
// The manual path for the rare cases auto-linking can't settle (two members
// with the same name, a name typed differently) and for confirming the
// one-time "Suggest matches" cleanup. Only Councilor / Vice-Mayor / Liga /
// SK accounts can be linked — never Secretary or Clerk.
router.put('/:id/account', verifyToken, adminOnly, secretaryOrClerk, async (req, res) => {
  const { id } = req.params
  const userId = req.body.user_id == null || req.body.user_id === '' ? null : Number(req.body.user_id)
  try {
    const { data: member } = await supabase
      .from('sb_council_members').select('id, full_name, user_id').eq('id', id).single()
    if (!member) return res.status(404).json({ error: 'Council member not found.' })

    if (userId === null) {
      // Pending approvals addressed to this member can't be answered by the
      // old account anymore — the client warns first (see pendingApprovals).
      const { error } = await supabase.from('sb_council_members').update({ user_id: null }).eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      await logActivity(req, 'UNLINK_ACCOUNT', 'Officials', `Unlinked login account from council member: ${member.full_name}`)
      return res.json({ success: true, data: { ...member, user_id: null } })
    }

    const { data: user } = await supabase
      .from('users').select('id, username, position, is_archived').eq('id', userId).single()
    if (!user || user.is_archived) return res.status(404).json({ error: 'Account not found.' })
    if (!LINKABLE_USER_POSITIONS.includes(user.position))
      return res.status(400).json({ error: 'Only Councilor, Vice-Mayor, Liga, or SK Federated accounts can be linked to a council member.' })

    const { error } = await supabase.from('sb_council_members').update({ user_id: userId }).eq('id', id)
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'That account is already linked to another council member.' })
      return res.status(500).json({ error: error.message })
    }
    await logActivity(req, 'LINK_ACCOUNT', 'Officials', `Linked council member ${member.full_name} to account: ${user.username}`)
    res.json({ success: true, data: { ...member, user_id: userId } })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/sb-council-members/:id/pending-approvals — how many author
// approvals are still waiting on this member, so unlinking can warn first.
router.get('/:id/pending-approvals', verifyToken, adminOnly, async (req, res) => {
  const { count, error } = await supabase
    .from('author_approvals').select('id', { count: 'exact', head: true })
    .eq('official_id', req.params.id).eq('decision', 'pending')
  if (error) return res.status(500).json({ error: error.message })
  res.json({ count: count || 0 })
})

// DELETE /api/sb-council-members/:id
// Archives the council member instead of a hard delete: the row stays in place
// (so already-published ordinances/resolutions keep showing their name/photo)
// and is just hidden from active lists and "select author" pickers.
router.delete('/:id', verifyToken, adminOnly, secretaryOrClerk, async (req, res) => {
  try {
    const { data: member } = await supabase
      .from('sb_council_members')
      .select('id, full_name')
      .eq('id', req.params.id).single()
    if (!member) return res.status(404).json({ error: 'Council member not found.' })
    const { error } = await supabase
      .from('sb_council_members')
      .update({ is_archived: true, archived_at: new Date().toISOString(), archived_by: req.user.id })
      .eq('id', req.params.id)
    if (error) return res.status(500).json({ error: error.message })
    await logActivity(req, 'ARCHIVE', 'Officials', `Archived council member: ${member.full_name}`)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/sb-council-members/:id/restore
// Only reachable from the Archives page, which is secretary-gated on the
// frontend (canViewArchives) — secretaryOnly here closes the gap where any
// admin-role account could otherwise call this directly.
router.put('/:id/restore', verifyToken, adminOnly, secretaryOnly, async (req, res) => {
  try {
    const { data: member } = await supabase
      .from('sb_council_members').select('id, full_name').eq('id', req.params.id).single()
    if (!member) return res.status(404).json({ error: 'Council member not found.' })
    const { error } = await supabase
      .from('sb_council_members')
      .update({ is_archived: false, archived_at: null, archived_by: null })
      .eq('id', req.params.id)
    if (error) return res.status(500).json({ error: error.message })
    await logActivity(req, 'RESTORE', 'Officials', `Restored council member: ${member.full_name}`)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ---- TERMS ----

// GET /api/sb-council-members/:id/terms
router.get('/:id/terms', async (req, res) => {
  try {
    await autoEndTerms()
    const { data, error } = await supabase
      .from('sb_council_member_terms')
      .select('*')
      .eq('council_member_id', req.params.id)
      .order('term_start', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/sb-council-members/:id/terms
router.post('/:id/terms', verifyToken, adminOnly, secretaryOrClerk, async (req, res) => {
  const { id } = req.params
  const { term_period, term_start, term_end, status, position, is_reelected, notes, force } = req.body
  if (!term_period || !term_start)
    return res.status(400).json({ error: 'term_period and term_start are required.' })
  if (status && !['active', 'terms_ended'].includes(status))
    return res.status(400).json({ error: 'status must be active or terms_ended.' })
  try {
    const { data: member, error: mErr } = await supabase
      .from('sb_council_members').select('id, full_name').eq('id', id).single()
    if (mErr || !member) return res.status(404).json({ error: 'Council member not found.' })

    const council_id = await resolveCouncilId(term_period)
    const resolvedStatus = status || 'active'

    // Validate BEFORE mutating anything below — these checks used to run
    // after the auto-close loop, which meant a rejected request could still
    // leave the member's previous term closed with no new one to replace
    // it (worse than before the request). Order matters here.
    if (resolvedStatus === 'active') {
      // Vice Mayor / Liga President / SK Federated President are singular by
      // law — mirrors migrations/005's DB-level constraint so a conflict
      // surfaces as a clean error here instead of a raw constraint violation.
      const conflict = await findSingularPositionConflict({ councilId: council_id, position, excludeMemberId: id })
      if (conflict) {
        return res.status(409).json({
          error: `${position} is already held by ${conflict.sb_council_members?.full_name || 'another member'} for this council.`,
        })
      }

      // Councilor is multi-seat, so this is a soft cap, not a hard rule —
      // pass force:true in the request body to add beyond it anyway (e.g. a
      // contested seat under recount, a holdover pending a court ruling).
      if (position === 'Councilor' && !force) {
        const currentCount = await countActiveCouncilors({ councilId: council_id, excludeMemberId: id })
        if (currentCount >= COUNCILOR_SEAT_CAP) {
          return res.status(409).json({
            error: `This council already has ${currentCount} active Councilor${currentCount === 1 ? '' : 's'}.`,
            seatCapExceeded: true,
          })
        }
      }
    }

    // A member can only be serving one term at a time. Backfilling a past
    // (terms_ended) term shouldn't touch anything else, but starting a new
    // *active* term — typically a re-election — must close out whatever
    // term they were still marked active on, or both would show as
    // "Active" across council groups indefinitely (autoEndTerms only closes
    // terms with a past term_end, so a still-open one never self-corrects).
    let closedCount = 0
    if (resolvedStatus === 'active') {
      const { data: openTerms, error: openErr } = await supabase
        .from('sb_council_member_terms')
        .select('id, term_end')
        .eq('council_member_id', id)
        .eq('status', 'active')
      if (openErr) return res.status(500).json({ error: openErr.message })
      for (const t of openTerms || []) {
        const { error: closeErr } = await supabase
          .from('sb_council_member_terms')
          .update({ term_end: t.term_end || term_start, status: 'terms_ended' })
          .eq('id', t.id)
        if (closeErr) return res.status(500).json({ error: closeErr.message })
        closedCount++
      }
    }

    // Flagged re-elected automatically when this person (matched by name, so a
    // fresh member row for the same person counts too) sat in the council
    // right before this one, even if the admin forgot to tick the box.
    const reelected =
      is_reelected === true || is_reelected === 'true' ||
      (await shouldAutoMarkReelected({ fullName: member.full_name, term_period, term_start }))

    const { data, error } = await supabase
      .from('sb_council_member_terms')
      .insert({
        council_member_id: id,
        council_id,
        term_period,
        position: position || null,
        term_start,
        term_end: term_end || null,
        status: resolvedStatus,
        is_reelected: reelected,
        notes: notes || null,
      })
      .select().single()
    if (error) return res.status(500).json({ error: error.message })

    const closedNote = closedCount > 0 ? ` (auto-closed ${closedCount} prior active term${closedCount > 1 ? 's' : ''})` : ''
    await logActivity(req, 'CREATE', 'Officials', `Added term for: ${member.full_name} (${term_period})${closedNote}`)
    res.json({ success: true, data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/sb-council-members/:memberId/terms/:termId
router.put('/:memberId/terms/:termId', verifyToken, adminOnly, secretaryOrClerk, async (req, res) => {
  const { memberId, termId } = req.params
  const { term_period, term_start, term_end, status, position, is_reelected, notes, force } = req.body
  if (!term_period || !term_start)
    return res.status(400).json({ error: 'term_period and term_start are required.' })
  if (status && !['active', 'terms_ended'].includes(status))
    return res.status(400).json({ error: 'status must be active or terms_ended.' })
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('sb_council_member_terms')
      .select('id').eq('id', termId).eq('council_member_id', memberId).single()
    if (fetchErr || !existing) return res.status(404).json({ error: 'Term not found.' })

    const council_id = await resolveCouncilId(term_period)
    const resolvedStatus = status || 'active'

    if (resolvedStatus === 'active') {
      // Same rules as POST .../terms — see the comments there. excludeTermId
      // here (not excludeMemberId) since this route edits one term in place
      // rather than auto-closing a separate one.
      const conflict = await findSingularPositionConflict({ councilId: council_id, position, excludeTermId: termId })
      if (conflict) {
        return res.status(409).json({
          error: `${position} is already held by ${conflict.sb_council_members?.full_name || 'another member'} for this council.`,
        })
      }
      if (position === 'Councilor' && !force) {
        const currentCount = await countActiveCouncilors({ councilId: council_id, excludeTermId: termId })
        if (currentCount >= COUNCILOR_SEAT_CAP) {
          return res.status(409).json({
            error: `This council already has ${currentCount} active Councilor${currentCount === 1 ? '' : 's'}.`,
            seatCapExceeded: true,
          })
        }
      }
    }

    const { data, error } = await supabase
      .from('sb_council_member_terms')
      .update({
        term_period,
        council_id,
        position: position || null,
        term_start,
        term_end: term_end || null,
        status: status || 'active',
        is_reelected: is_reelected === true || is_reelected === 'true',
        notes: notes || null,
      })
      .eq('id', termId)
      .select().single()
    if (error) return res.status(500).json({ error: error.message })

    await logActivity(req, 'UPDATE', 'Officials', `Updated term ID ${termId} for member ID ${memberId}`)
    res.json({ success: true, data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/sb-council-members/:memberId/terms/:termId
router.delete('/:memberId/terms/:termId', verifyToken, adminOnly, secretaryOrClerk, async (req, res) => {
  const { memberId, termId } = req.params
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('sb_council_member_terms')
      .select('id, term_period').eq('id', termId).eq('council_member_id', memberId).single()
    if (fetchErr || !existing) return res.status(404).json({ error: 'Term not found.' })

    const { error } = await supabase
      .from('sb_council_member_terms').delete().eq('id', termId)
    if (error) return res.status(500).json({ error: error.message })

    await logActivity(req, 'DELETE', 'Officials', `Deleted term "${existing.term_period}" for member ID ${memberId}`)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/sb-council-members/run-auto-end-terms
router.post('/run-auto-end-terms', verifyToken, adminOnly, async (req, res) => {
  try {
    await autoEndTerms()
    await logActivity(req, 'UPDATE', 'Officials', 'Manually ran auto_end_terms')
    res.json({ success: true, message: 'auto_end_terms executed.' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
