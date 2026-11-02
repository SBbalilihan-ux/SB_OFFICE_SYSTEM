const isValidEmail = (str) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)

// Usernames: letters, numbers, and ñ/Ñ (Filipino names like Paña, Peñaflor).
// Always normalize to NFC first — an "ñ" can arrive as one character (U+00F1)
// or as "n" + a combining tilde (U+0303) depending on the keyboard/OS, and
// the two must be stored and looked up identically or login would miss.
const USERNAME_RE = /^[A-Za-z0-9ñÑ]+$/
const USERNAME_ERROR = 'Username may only contain letters (including ñ) and numbers.'
const normalizeUsername = (str) => String(str ?? '').normalize('NFC').trim()
const isValidUsername = (str) => USERNAME_RE.test(normalizeUsername(str))

const getIP = (req) => req.headers['x-forwarded-for'] || req.socket.remoteAddress

const safeParseJSON = (str, fallback = []) => {
  try { return JSON.parse(str) }
  catch { return fallback }
}

// For interpolating DB/user-supplied values into hand-built HTML strings
// (print views, outbound emails) — those aren't templated through a library
// that escapes by default, so every interpolation needs this explicitly.
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c])

// Legislative-records RBAC: editing content (title/number/category, or
// replacing the file — see middleware/auth.js's pendingEditors) is
// Secretary/Clerk only, regardless of which bucket the record is in.
// Councilor and Vice-Mayor may originate a draft (canCreateDraft) and
// withdraw their own not-yet-published one (canArchiveLegislativeRecord
// below), but not edit its content — Secretary/Clerk own that on their
// behalf. Shared across ordinances/resolutions/session-minutes since all
// three run the same review pipeline.
const canEditLegislativeRecord = (position) => ['secretary', 'clerk'].includes(position)

// Archiving/withdrawing: Secretary/Clerk may archive any record, in any
// bucket. Councilor and Vice-Mayor may only withdraw a record they
// themselves created, and only while it's still unpublished — once
// published, archiving is Secretary/Clerk's call alone.
const canArchiveLegislativeRecord = (position, status, isOwner) => {
  if (['secretary', 'clerk'].includes(position)) return true
  if (status === 'published') return false
  return isOwner && ['councilor', 'vice_mayor', 'liga_ng_mga_barangay', 'sk_federated'].includes(position)
}

// Builds one `column.ilike."%value%"` clause for use inside a Supabase/
// PostgREST `.or()` filter string (e.g. to search title OR a record
// number in one query). `.or()` takes a raw filter string where commas and
// parentheses are structural — an unescaped comma in the search term would
// otherwise be parsed as the start of a second condition. Wrapping the
// value in double quotes (with literal backslashes/quotes inside it
// backslash-escaped, per PostgREST's filter grammar) keeps the whole term
// as one opaque value no matter what punctuation it contains.
const orIlikeClause = (column, value) => {
  const escaped = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `${column}.ilike."%${escaped}%"`
}

// Words that say what kind of record it is rather than which one — typing
// "regular session minutes" shouldn't require "session"/"minutes" to appear in
// the record's own text.
const SEARCH_FILLER_WORDS = new Set([
  'session', 'sessions', 'minutes', 'agenda', 'order', 'of', 'business', 'no', 'no.', 'number', 'the',
])

// A search box's text as separate words: punctuation-only pieces ("-", "&")
// and filler words are dropped, so "MINUTES NO. 03 - 2026" is just "03" + "2026".
const searchTokens = (search) =>
  String(search ?? '')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => /[\p{L}\p{N}]/u.test(t) && !SEARCH_FILLER_WORDS.has(t.toLowerCase()))

// Adds a "every word must appear in at least one of these columns" filter to a
// Supabase query — word order and spacing don't matter, and a number written
// "03-2026" or "03 - 2026" is found either way. Each word is one .or() call;
// PostgREST ANDs separate .or() filters together.
const applyTokenSearch = (query, search, columns) => {
  for (const token of searchTokens(search)) {
    query = query.or(columns.map((c) => orIlikeClause(c, token)).join(','))
  }
  return query
}

// Validates+parses a submitted "year" form field (ordinances/resolutions
// upload and edit). A bare `year ? parseInt(year) : null` silently turns
// garbage input ("abc", "12/2024") into NaN and stores that as-is instead
// of rejecting the request — this makes "not provided" (year: null) and
// "provided but invalid" (an error) two distinct, explicit outcomes.
const parseYearField = (raw) => {
  if (raw === undefined || raw === null || raw === '') return { year: null }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1900 || n > 2100)
    return { error: 'Year must be a valid year between 1900 and 2100.' }
  return { year: n }
}

// Turns a plain "YYYY-MM-DD" (the Date filter on Ordinances/Resolutions,
// matched against `uploaded_at`) into the [start, end) timestamp bounds for
// that whole calendar day, for a `.gte(start).lt(end)` range query — day
// boundaries in UTC, same simplicity level as the rest of this codebase's
// date handling (nothing here is PH-timezone-exact).
const dayBoundsUTC = (dateStr) => {
  const start = `${dateStr}T00:00:00.000Z`
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { start, end: end.toISOString() }
}

// Calendar year of a timestamp as observed in the Philippines (UTC+8) — a
// plain getUTCFullYear() would call an approval at 6am on 1 January "the
// previous year", since that moment is still 31 December in UTC.
const yearInManila = (value) =>
  Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric' }).format(new Date(value)))

// Parses the "Approved date" a Secretary types (YYYY-MM-DD) into the Date
// stored for it — noon UTC, so it reads as the same calendar day in any
// timezone the office might view it from. Returns null for anything that
// isn't a real calendar date between 1900 and 2100.
const parseApprovedDay = (value) => {
  const day = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const parsed = new Date(`${day}T12:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return null
  const year = parsed.getUTCFullYear()
  return year >= 1900 && year <= 2100 ? parsed : null
}

// Year and sequence out of a record number in any of the office's formats:
//   "Municipal Ordinance No. 2025-04"  -> year 2025, seq 4
//   "RESOLUTION NO. 02 - 2025"         -> year 2025, seq 2
//   "RES-2025-045"                     -> year 2025, seq 45
// The 4-digit group between 1900 and 2100 is the year. The sequence is the
// group joined to the year by only "-", "/", "." or spaces (after the year
// first, then before it), so a stray digit typed elsewhere — e.g.
// "2MUNICIPAL ORDINANCE NO. 2026-04" — isn't mistaken for the sequence.
// Without such a neighbour, the first other group is the sequence.
// A number with no digits sorts as year 0 / seq 0 (last, newest-first).
const YEAR_SEQ_JOIN = /^[\s\-–—/.]*$/
const recordNumberParts = (number) => {
  const text = String(number ?? '')
  const groups = [...text.matchAll(/\d+/g)].map((m) => ({ digits: m[0], index: m.index, value: Number(m[0]) }))
  const yearIndex = groups.findIndex((g) => g.digits.length === 4 && g.value >= 1900 && g.value <= 2100)
  const joined = (a, b) => YEAR_SEQ_JOIN.test(text.slice(a.index + a.digits.length, b.index))
  let seqIndex = -1
  if (yearIndex >= 0) {
    const year = groups[yearIndex]
    const after = groups[yearIndex + 1]
    const before = groups[yearIndex - 1]
    if (after && joined(year, after)) seqIndex = yearIndex + 1
    else if (before && joined(before, year)) seqIndex = yearIndex - 1
  }
  if (seqIndex < 0) seqIndex = groups.findIndex((_, i) => i !== yearIndex)
  return { groups, yearIndex, seqIndex }
}

const recordNumberKey = (number) => {
  const { groups, yearIndex, seqIndex } = recordNumberParts(number)
  return {
    year: yearIndex >= 0 ? groups[yearIndex].value : 0,
    seq: seqIndex >= 0 ? groups[seqIndex].value : 0,
  }
}

// Newest/highest number first: by year, then sequence — so 2025-09 and 2025-08
// come before 2025-04, and 2026-01 before all of 2025. Records that tie (or
// have no number) keep their incoming order, which the callers already have
// newest-approved-first. Returns a new array.
const sortByRecordNumber = (rows, numberField) =>
  rows
    .map((row, index) => ({ row, index, key: recordNumberKey(row[numberField]) }))
    .sort((a, b) => b.key.year - a.key.year || b.key.seq - a.key.seq || a.index - b.index)
    .map((x) => x.row)

// Where Sangguniang Bayan sessions are held — the venue saved for new session
// minutes / order of business when none is given.
const SESSION_VENUE = 'Governor Lino I. Chatto Memorial Session Hall'

module.exports = {
  searchTokens,
  applyTokenSearch,
  SESSION_VENUE,
  recordNumberKey,
  recordNumberParts,
  sortByRecordNumber,
  parseApprovedDay,
  yearInManila,
  isValidEmail, getIP, safeParseJSON, escapeHtml,
  USERNAME_ERROR, normalizeUsername, isValidUsername,
  canEditLegislativeRecord, canArchiveLegislativeRecord, orIlikeClause, dayBoundsUTC,
  parseYearField,
}
