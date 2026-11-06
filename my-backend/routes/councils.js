const express = require('express')
const router = express.Router()

const supabase = require('../config/supabase')
const { verifyToken, adminOnly } = require('../middleware/auth')
const { logActivity } = require('../helpers/logger')
const { normalizeTermLabel, autoUpdateCouncilStatuses } = require('../helpers/councils')

// council_number (migrations/037): 12 = "12th Sangguniang Bayan". Empty = not
// set. Returns { value } or { error }.
const parseCouncilNumber = (raw) => {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { value: null }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 999) return { error: 'Council number must be a whole number from 1 to 999.' }
  return { value: n }
}

// Both the term label and the number are unique; say which one clashed.
const duplicateMessage = (error) =>
  /council_number/.test(`${error.message} ${error.details}`)
    ? 'Another council already has this number.'
    : 'A council with this term label already exists.'

// GET /api/councils
router.get('/', async (req, res) => {
  try {
    await autoUpdateCouncilStatuses()
    const { data, error } = await supabase
      .from('councils')
      .select('*')
      .order('term_start', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/councils
// Explicit "Add Council" entry point — most councils actually get created
// implicitly the first time someone types a new term_period into Add/Edit
// Term (see helpers/councils.js resolveCouncilId), but this lets an admin
// stand up an empty council ahead of adding its first member.
router.post('/', verifyToken, adminOnly, async (req, res) => {
  const { term_label, term_start, term_end, status } = req.body
  const label = normalizeTermLabel(term_label)
  if (!label) return res.status(400).json({ error: 'Term label is required.' })
  const number = parseCouncilNumber(req.body.council_number)
  if (number.error) return res.status(400).json({ error: number.error })
  if (status &&!['upcoming', 'active', 'concluded'].includes(status))
    return res.status(400).json({ error: 'status must be upcoming, active, or concluded.' })
  try {
    const { data, error } = await supabase
      .from('councils')
      .insert({
        term_label: label,
        council_number: number.value,
        term_start: term_start || null,
        term_end: term_end || null,
        status: status || 'active',
      })
      .select().single()
    if (error) {
      if (error.code === '23505')
        return res.status(409).json({ error: duplicateMessage(error) })
      return res.status(500).json({ error: error.message })
    }
    await logActivity(req, 'CREATE', 'Officials', `Added council: ${label}`)
    res.json({ success: true, data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/councils/:id — rename a council's term label and/or set its
// number (council_number changes only when it's sent). term_start/term_end
// and status aren't editable here since nothing in the UI collects or
// displays them for an existing council (status is auto-managed by
// autoUpdateCouncilStatuses).
router.put('/:id', verifyToken, adminOnly, async (req, res) => {
  const { id } = req.params
  const label = normalizeTermLabel(req.body.term_label)
  if (!label) return res.status(400).json({ error: 'Term label is required.' })
  const changes = { term_label: label }
  if ('council_number' in req.body) {
    const number = parseCouncilNumber(req.body.council_number)
    if (number.error) return res.status(400).json({ error: number.error })
    changes.council_number = number.value
  }
  try {
    const { data, error } = await supabase
      .from('councils')
      .update(changes)
      .eq('id', id)
      .select().single()
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Council not found.' })
      if (error.code === '23505')
        return res.status(409).json({ error: duplicateMessage(error) })
      return res.status(500).json({ error: error.message })
    }
    await logActivity(req, 'UPDATE', 'Officials', `Updated council: ${label}`)
    res.json({ success: true, data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/councils/:id — refuses if any member term still points at it
// (sb_council_member_terms.council_id has no ON DELETE CASCADE, by design —
// term history shouldn't silently vanish because someone deleted the
// council it happened under) rather than letting a raw FK violation bubble
// up as an opaque 500.
router.delete('/:id', verifyToken, adminOnly, async (req, res) => {
  const { id } = req.params
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('councils').select('term_label').eq('id', id).single()
    if (fetchErr || !existing) return res.status(404).json({ error: 'Council not found.' })

    const { count, error: countErr } = await supabase
      .from('sb_council_member_terms')
      .select('id', { count: 'exact', head: true })
      .eq('council_id', id)
    if (countErr) return res.status(500).json({ error: countErr.message })
    if (count > 0) {
      return res.status(400).json({
        error: `Cannot delete this council — ${count} member term${count === 1 ? '' : 's'} still reference it. Remove or reassign ${count === 1 ? 'that term' : 'those terms'} first.`,
      })
    }

    const { error } = await supabase.from('councils').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    await logActivity(req, 'DELETE', 'Officials', `Deleted council: ${existing.term_label}`)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
