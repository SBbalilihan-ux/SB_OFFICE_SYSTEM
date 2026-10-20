// scripts/bulk-import.js
//
// Bulk-imports existing (paper/scanned) ordinances and resolutions straight
// into Supabase, so the office doesn't have to upload old records one at a
// time through the app. Does what POST /api/ordinances/upload (and the
// resolutions twin) does — stores the file in the `assets` bucket, inserts
// the record row, links the authors, writes record_history — but reads the
// records from a CSV manifest instead of a form.
//
// Usage (from my-backend/):
//   node scripts/bulk-import.js <folder> --as <username>            (dry run)
//   node scripts/bulk-import.js <folder> --as <username> --commit   (writes)
//
// <folder> holds records.csv plus the files it names. --as is the account
// credited as uploader (normally the Secretary). Without --commit nothing is
// written: every row is only validated, so run that first and fix what it
// reports.
//
// records.csv columns (header row required, Excel "CSV UTF-8" is fine):
//   type         ordinance | resolution
//   number       official number, e.g. "RESOLUTION NO. 03-2019" (required when published)
//   title        required
//   year         e.g. 2019 (defaults to the approved_on year)
//   category     optional
//   approved_on  YYYY-MM-DD, the date it was approved (required when published)
//   status       published (default) | pending
//   authors      council member full names, separated by ;  (must match Council Management)
//   file         file name inside <folder> (.pdf, .docx, .doc, .jpg, .png)
//
// Rows that clash with an existing record (same number or title — same rule
// as the app's duplicate trap) are skipped, so re-running after a partial
// import is safe.

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') })
const fs = require('fs')
const path = require('path')
const os = require('os')
const Tesseract = require('tesseract.js')
const supabase = require('../config/supabase')
const { uploadToStorage, deleteFromStorage } = require('../helpers/storage')
const { findDuplicateRecord } = require('../helpers/duplicates')
const { resolveCurrentTermId } = require('../helpers/officials')
const { parseYearField, parseApprovedDay } = require('../helpers/utils')
const { logActivity } = require('../helpers/logger')
const { recordHistory } = require('../helpers/recordHistory')

const TYPES = {
  ordinance: { table: 'ordinances', numberField: 'ordinance_number', linkTable: 'ordinance_officials', linkId: 'ordinance_id', module: 'Ordinances', folder: 'ordinances', upper: false },
  resolution: { table: 'resolutions', numberField: 'resolution_number', linkTable: 'resolution_officials', linkId: 'resolution_id', module: 'Resolutions', folder: 'resolutions', upper: true },
}

const MIME = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
}

// Minimal RFC 4180 CSV reader (quoted fields, "" escapes, commas/newlines in quotes).
function parseCsv(text) {
  text = text.replace(/^﻿/, '')
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const [header, ...body] = rows.filter((r) => r.some((v) => v.trim()))
  const keys = header.map((h) => h.trim().toLowerCase())
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}

// Same as the upload route: OCR images, store PDFs/Word files as-is.
async function extractText(filePath, mime) {
  if (!mime.startsWith('image/')) return null
  try {
    const { data: { text } } = await Tesseract.recognize(filePath, 'eng')
    return text.trim() || null
  } catch (err) {
    console.error('  OCR failed:', err.message)
    return null
  }
}

// Old records should credit the seat the author held when the record was
// approved, not whatever they hold today.
async function termIdAt(memberId, day) {
  if (day) {
    const d = day.toISOString().slice(0, 10)
    const { data } = await supabase
      .from('sb_council_member_terms').select('id')
      .eq('council_member_id', memberId)
      .lte('term_start', d)
      .or(`term_end.is.null,term_end.gte.${d}`)
      .order('term_start', { ascending: false }).limit(1)
    if (data?.length) return data[0].id
  }
  return resolveCurrentTermId(memberId)
}

async function main() {
  const args = process.argv.slice(2)
  const folder = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--as')
  const asUser = args[args.indexOf('--as') + 1]
  const commit = args.includes('--commit')
  if (!folder || !args.includes('--as') || !asUser) {
    console.log('Usage: node scripts/bulk-import.js <folder> --as <username> [--commit]')
    process.exit(1)
  }

  const csvPath = path.join(folder, 'records.csv')
  if (!fs.existsSync(csvPath)) throw new Error(`No records.csv in ${folder}`)
  const records = parseCsv(fs.readFileSync(csvPath, 'utf8'))

  const { data: user, error: userErr } = await supabase
    .from('users').select('id, username, name, role, position').ilike('username', asUser).maybeSingle()
  if (userErr) throw new Error(userErr.message)
  if (!user) throw new Error(`No account with username "${asUser}".`)
  // logActivity/recordHistory expect an Express req; this stands in for one.
  const req = { user, headers: {}, socket: { remoteAddress: 'bulk-import' } }

  const { data: members, error: memErr } = await supabase.from('sb_council_members').select('id, full_name')
  if (memErr) throw new Error(memErr.message)
  const memberByName = new Map(members.map((m) => [m.full_name.trim().toLowerCase().replace(/\s+/g, ' '), m.id]))

  console.log(`${commit ? 'IMPORTING' : 'DRY RUN —'} ${records.length} row(s) from ${csvPath} as ${user.name}\n`)
  const seen = { number: new Set(), title: new Set() }
  let ok = 0, skipped = 0, failed = 0

  for (const [i, r] of records.entries()) {
    const line = i + 2 // +1 header, +1 one-based
    const problems = []
    const cfg = TYPES[(r.type || '').toLowerCase()]
    if (!cfg) problems.push(`type must be "ordinance" or "resolution" (got "${r.type}")`)
    if (!r.title) problems.push('title is required')
    const status = (r.status || 'published').toLowerCase()
    if (!['published', 'pending'].includes(status)) problems.push('status must be "published" or "pending"')

    let number = r.number || ''
    if (cfg?.upper) number = number.toUpperCase()
    const approved = r.approved_on ? parseApprovedDay(r.approved_on) : null
    if (r.approved_on && !approved) problems.push(`approved_on "${r.approved_on}" is not a valid YYYY-MM-DD date`)
    if (status === 'published' && !number) problems.push('number is required for a published record')
    if (status === 'published' && !approved) problems.push('approved_on is required for a published record')

    const { year: parsedYear, error: yearError } = parseYearField(r.year)
    if (yearError) problems.push(yearError)
    const year = parsedYear ?? (approved ? approved.getUTCFullYear() : null)

    const filePath = r.file ? path.join(folder, r.file) : null
    const mime = filePath ? MIME[path.extname(filePath).toLowerCase()] : null
    if (!filePath) problems.push('file is required')
    else if (!fs.existsSync(filePath)) problems.push(`file not found: ${r.file}`)
    else if (!mime) problems.push(`unsupported file type: ${r.file}`)

    const authorIds = []
    for (const name of (r.authors || '').split(';').map((s) => s.trim()).filter(Boolean)) {
      const id = memberByName.get(name.toLowerCase().replace(/\s+/g, ' '))
      if (id) authorIds.push(id)
      else problems.push(`author "${name}" is not in Council Management`)
    }

    const label = `row ${line} [${r.type} ${number || '(no number)'}] ${r.title}`
    if (problems.length) {
      failed++
      console.log(`✗ ${label}\n    - ${problems.join('\n    - ')}`)
      continue
    }

    // Duplicates: against the database and against earlier rows of this CSV.
    const key = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim()
    const dup = await findDuplicateRecord({ table: cfg.table, numberField: cfg.numberField, title: r.title, number })
    const csvDup = (number && seen.number.has(`${cfg.table}|${key(number)}`)) || seen.title.has(`${cfg.table}|${key(r.title)}`)
    if (dup || csvDup) {
      skipped++
      console.log(`- ${label}\n    already exists (${dup ? `same ${dup.field} as record #${dup.record.id}` : 'repeated in this CSV'}) — skipped`)
      continue
    }
    if (number) seen.number.add(`${cfg.table}|${key(number)}`)
    seen.title.add(`${cfg.table}|${key(r.title)}`)

    if (!commit) { ok++; console.log(`✓ ${label}`); continue }

    let storedName = null
    try {
      const buffer = fs.readFileSync(filePath)
      const extracted_text = await extractText(filePath, mime)
      const { fileName } = await uploadToStorage({ originalname: path.basename(filePath), buffer, mimetype: mime }, cfg.folder)
      storedName = fileName

      const row = {
        [cfg.numberField]: number || null,
        title: r.title,
        year,
        category: r.category || null,
        filename: path.basename(filePath),
        filetype: mime,
        filepath: fileName,
        extracted_text,
        status,
        created_by: user.id,
      }
      if (approved) { row.approved_on = approved.toISOString(); row.reviewed_at = approved.toISOString() }

      const { data: rec, error } = await supabase.from(cfg.table).insert(row).select('id').single()
      if (error) throw new Error(error.message)

      if (authorIds.length) {
        const links = await Promise.all(authorIds.map(async (oid) => ({
          [cfg.linkId]: rec.id, official_id: oid, term_id: await termIdAt(oid, approved), role: 'author',
        })))
        const { error: relErr } = await supabase.from(cfg.linkTable).insert(links)
        if (relErr) console.error(`  author links failed: ${relErr.message}`)
      }

      const entityType = r.type.toLowerCase()
      await recordHistory(req, { entityType, entityId: rec.id, action: 'uploaded', comment: 'Bulk import of an existing record' })
      if (status === 'published') await recordHistory(req, { entityType, entityId: rec.id, action: 'published', comment: number })
      await logActivity(req, 'UPLOAD', cfg.module, `Bulk-imported ${entityType}: ${r.title}`)

      ok++
      console.log(`✓ ${label}  → id ${rec.id}`)
    } catch (err) {
      failed++
      if (storedName) await deleteFromStorage(storedName)
      console.log(`✗ ${label}\n    - ${err.message}`)
    }
  }

  console.log(`\n${commit ? 'Imported' : 'Ready to import'}: ${ok}   Skipped (duplicates): ${skipped}   Errors: ${failed}`)
  if (!commit && ok) console.log('Nothing was written. Re-run with --commit to import.')
  process.exit(failed && commit ? 1 : 0)
}

main().catch((err) => { console.error(err.message); process.exit(1) })
