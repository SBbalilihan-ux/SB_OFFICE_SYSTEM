import { useState, useMemo } from "react";
import {
  Users,
  Plus,
  Search,
  Pencil,
  Archive,
  Trash2,
  X,
  Eye,
  ChevronDown,
  ChevronRight,
  CalendarDays,
  UserPlus,
  GripVertical,
} from "lucide-react";
import styles from "./OfficialsPage.module.css";
import { ModalAlert } from "./AdminComponents";
import { useModalError } from "./AdminContext";
import LoadingModal from "./LoadingModal";
import { AccountLinkBadge } from "./AccountLinking";

// ── helpers ───────────────────────────────────────────────────────────────────

// 1 -> "1st", 2 -> "2nd", 11 -> "11th", 22 -> "22nd"
function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
}

// A council's title: "12th Sangguniang Bayan" once its number is set
// (councils.council_number, migrations/037), otherwise just its term.
function councilTitle(councilNumber, termPeriod) {
  return councilNumber ? `${ordinal(councilNumber)} Sangguniang Bayan` : termPeriod;
}

// What the page-wide search matches a council on: its title and its term.
const groupText = (g) => `${councilTitle(g.councilNumber, g.termPeriod)} ${g.termPeriod}`;

function initials(name = "") {
  return (
    name
      .split(" ")
      .filter((w) => w.length > 1)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

/**
 * Build council groups from officials' terms array.
 *
 * Each official has: { id, full_name, photo, terms: [...] }
 * Each term has:     { id, council_member_id, council_id, position,
 *                      term_period, term_start, term_end, status,
 *                      is_reelected, notes, council: { id, term_label } }
 *
 * Grouped by council_id (a real councils row — see migrations/001 and 002)
 * rather than matching the raw term_period string, so a typo'd label can no
 * longer silently split one council into two visual groups. A member who
 * served in two councils appears in BOTH groups. Members with no terms go
 * into an 'Unknown' bucket. Falls back to matching on the raw term_period
 * string only for a term row that somehow predates the council_id backfill.
 *
 * Returns: [{ key, councilId, termPeriod, entries: [{ member, term }] }]
 * newest-first.
 */
function buildCouncilGroups(officials) {
  const groups = new Map(); // key -> { councilId, termPeriod, sortYear, entries }
  const getYear = (s) => parseInt((s.match(/\d{4}/) || ["0"])[0]);

  officials.forEach((member) => {
    const terms = member.terms || [];
    if (terms.length === 0) {
      if (!groups.has("unknown"))
        groups.set("unknown", { councilId: null, termPeriod: "Unknown", sortYear: -1, entries: [] });
      groups.get("unknown").entries.push({ member, term: null });
    } else {
      terms.forEach((term) => {
        const key =
          term.council_id != null
            ? `council-${term.council_id}`
            : `legacy-${term.term_period || "unknown"}`;
        const label = term.council?.term_label || term.term_period || "Unknown";
        if (!groups.has(key)) {
          groups.set(key, {
            councilId: term.council_id ?? null,
            termPeriod: label,
            sortYear: getYear(label),
            entries: [],
          });
        }
        groups.get(key).entries.push({ member, term });
      });
    }
  });

  // Within a council: the official order the Secretary/Clerk set by dragging
  // (term.display_order, migrations/032). Unplaced terms (NULL — newly added
  // members) go last, oldest first.
  groups.forEach((g) =>
    g.entries.sort(
      (a, b) =>
        (a.term?.display_order ?? Infinity) - (b.term?.display_order ?? Infinity) ||
        new Date(a.member.created_at) - new Date(b.member.created_at)
    )
  );

  return Array.from(groups.entries())
    .sort(([keyA, a], [keyB, b]) => {
      if (keyA === "unknown") return 1;
      if (keyB === "unknown") return -1;
      return b.sortYear - a.sortYear;
    })
    .map(([key, { councilId, termPeriod, entries }]) => ({
      key,
      councilId,
      termPeriod,
      entries,
    }));
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ member, ringClass }) {
  return (
    <div className={`${styles.avatar} ${ringClass || ""}`}>
      {member.photo ? (
        <img src={member.photo} alt={member.full_name} />
      ) : (
        <span>{initials(member.full_name)}</span>
      )}
    </div>
  );
}

// ── MemberCard ────────────────────────────────────────────────────────────────

function MemberCard({
  member,
  term,
  onEdit,
  onDelete,
  onViewProfile,
  readOnly = false,
  dragProps = null,
  isDragging = false,
  isDragOver = false,
}) {
  const isActive = term?.status === "active";
  const hasTerm = !!term;

  const ringClass = !hasTerm
    ? styles.avatarNoTerm
    : isActive
    ? styles.avatarActive
    : styles.avatarEnded;

  const dotClass = !hasTerm
    ? styles.statusDotNoTerm
    : isActive
    ? styles.statusDotActive
    : styles.statusDotEnded;

  return (
    <div
      className={`${styles.memberCard} ${dragProps ? styles.memberCardDraggable : ""} ${
        isDragging ? styles.memberCardDragging : ""
      } ${isDragOver ? styles.memberCardDragOver : ""}`}
      {...(dragProps || {})}
    >
      {dragProps && (
        <span className={styles.dragHandle} title="Drag to rearrange">
          <GripVertical size={14} />
        </span>
      )}
      <div className={styles.avatarWrap}>
        <Avatar member={member} ringClass={ringClass} />
        <span className={`${styles.statusDot} ${dotClass}`} />
      </div>

      <div className={styles.memberName}>{member.full_name || "—"}</div>
      {/* term?.position, not member.position — this card is showing the
          member's seat *within this specific council*, which can differ
          from whatever their current/other-term position is. */}
      <div className={styles.memberPos}>{term?.position || member.position || "—"}</div>
      {/* Staff-only: whether this member can sign in and approve their own
          records (see AccountLinking.jsx). */}
      {!readOnly && <AccountLinkBadge member={member} />}

      {term ? (
        <span
          className={`${styles.badge} ${
            isActive ? styles.badgeActive : styles.badgeEnded
          }`}
        >
          {isActive ? "Active" : "Term ended"}
        </span>
      ) : (
        <span className={`${styles.badge} ${styles.badgeNoTerm}`}>No term</span>
      )}

      <div className={styles.cardActions}>
        <button
          className={styles.iconBtn}
          onClick={() => onViewProfile(member)}
        >
          <Eye size={13} /> View
        </button>
        {!readOnly && (
          <>
            <button className={styles.iconBtn} onClick={() => onEdit(member)}>
              <Pencil size={13} /> Edit
            </button>
            <button
              className={`${styles.iconBtn} ${styles.iconBtnDel}`}
              onClick={() => onDelete(member)}
              title="Archive"
            >
              <Archive size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── CouncilFormModal ─────────────────────────────────────────────────────────
// Shared by "Add Council" and "Edit Council" — identical shape (council
// number + term label), just a different starting value, title, and submit
// label depending on `mode`.

function CouncilFormModal({
  mode = "add",
  initialLabel = "",
  initialNumber = null,
  onClose,
  onConfirm,
}) {
  const [termPeriod, setTermPeriod] = useState(initialLabel);
  const [number, setNumber] = useState(initialNumber ? String(initialNumber) : "");
  const [error, showError, clearError] = useModalError();
  const [submitting, setSubmitting] = useState(false);
  const isEdit = mode === "edit";
  const parsedNumber = number ? parseInt(number, 10) : null;

  const handleSubmit = async () => {
    const val = termPeriod.trim();
    if (!val) {
      showError("Please enter the term period.");
      return;
    }
    if (parsedNumber !== null && (parsedNumber < 1 || parsedNumber > 999)) {
      showError("Council number must be from 1 to 999.");
      return;
    }
    setSubmitting(true);
    clearError();
    // onConfirm actually creates/updates the council server-side now
    // (POST/PUT /api/councils) instead of just tracking a client-only
    // placeholder — it resolves to { success, error? } so a duplicate-label
    // conflict (or any other server error) surfaces here instead of
    // silently vanishing.
    const result = await onConfirm(val, parsedNumber);
    setSubmitting(false);
    if (result && result.success === false) {
      showError(result.error || `Failed to ${isEdit ? "update" : "add"} council.`);
    }
  };

  return (
    <div className={styles.modalBg} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <ModalAlert message={error} type="error" />
        <div className={styles.modalHeader}>
          <h3>
            <CalendarDays
              size={16}
              style={{ verticalAlign: "middle", marginRight: 6 }}
            />
            {isEdit ? "Edit Council" : "Add Council"}
          </h3>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.formGroup}>
          <label>Council Number</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="e.g. 12"
            value={number}
            onChange={(e) => {
              setNumber(e.target.value.replace(/\D/g, "").slice(0, 3));
              clearError();
            }}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            autoFocus
          />
          <p className={styles.fieldHint}>
            {parsedNumber
              ? `Shown as "${ordinal(parsedNumber)} Sangguniang Bayan".`
              : "Which Sangguniang Bayan this is, e.g. 12 for the 12th. Leave blank if unknown."}
          </p>
        </div>

        <div className={styles.formGroup}>
          <label>
            Term Period / Year <span style={{ color: "#e53e3e" }}>*</span>
          </label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="e.g. 2022–2025 or 2022"
            value={termPeriod}
            onChange={(e) => {
              // Years and a range dash only — same filter as the Term
              // Period field in Add/Edit Term (AdminComponents.jsx's
              // TermFormFields) — strips any letter as it's typed or
              // pasted instead of catching it at submit time.
              setTermPeriod(e.target.value.replace(/[^0-9\-–\s]/g, ""));
              clearError();
            }}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
          <p className={styles.fieldHint}>
            Shown under the council's title. Members whose term records use
            this exact term period will appear here automatically.
          </p>
        </div>

        <div className={styles.modalActions}>
          <button className={styles.primaryBtn} onClick={handleSubmit} disabled={submitting}>
            <Plus size={14} />{" "}
            {submitting
              ? isEdit
                ? "Saving..."
                : "Creating..."
              : isEdit
              ? "Save Changes"
              : "Create Council"}
          </button>
        </div>
      </div>
      {submitting && <LoadingModal message={isEdit ? "Saving..." : "Creating..."} />}
    </div>
  );
}

// ── search ────────────────────────────────────────────────────────────────────

// Does this member/term entry match a typed query? Name or position, case-
// and spacing-insensitive. Shared by the page-wide search (which decides which
// councils to show) and each council's own box (which narrows within one).
const norm = (v) => String(v || "").toLowerCase().replace(/\s+/g, " ").trim();
function entryMatches({ member, term }, query) {
  const q = norm(query);
  if (!q) return true;
  return (
    norm(member.full_name).includes(q) ||
    norm(term?.position).includes(q) ||
    norm(member.position).includes(q)
  );
}

// ── CouncilGroup ──────────────────────────────────────────────────────────────

function CouncilGroup({
  termPeriod,
  councilNumber = null,
  councilId,
  entries,
  isOpen,
  onToggle,
  search,
  onSearch,
  globalSearch = "",
  onAddMember,
  onEdit,
  onDelete,
  onViewProfile,
  onEditCouncil,
  onDeleteCouncil,
  onReorder,
  readOnly = false,
}) {
  const activeCount = entries.filter((e) => e.term?.status === "active").length;

  // ── drag to rearrange (Secretary/Clerk only) ──
  // The saved order is the official order used by every author/sponsor
  // picker and the public website. Disabled while a search narrows the
  // list, since dropping between filtered cards would hide where the
  // missing ones end up.
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [orderError, setOrderError] = useState("");
  const isSearching = !!norm(search) || !!norm(globalSearch);
  const canDrag =
    !readOnly && councilId != null && !!onReorder && !isSearching && entries.length > 1;

  // onReorder moves the cards immediately (cached list) and saves in the
  // background, so nothing here waits — it only reports a failed save.
  const handleDrop = async (targetId) => {
    const fromId = dragId;
    setDragId(null);
    setOverId(null);
    if (fromId == null || fromId === targetId) return;
    const ids = entries.map((e) => e.term.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, fromId);
    setOrderError("");
    const result = await onReorder(councilId, ids);
    if (!result?.success) setOrderError(result?.error || "Failed to save the new order.");
  };

  const dragPropsFor = (term) =>
    canDrag && term
      ? {
          draggable: true,
          onDragStart: (e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(term.id));
            setDragId(term.id);
          },
          onDragOver: (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (overId !== term.id) setOverId(term.id);
          },
          onDrop: (e) => {
            e.preventDefault();
            handleDrop(term.id);
          },
          onDragEnd: () => {
            setDragId(null);
            setOverId(null);
          },
        }
      : null;

  // A page-wide search that matches the council's own label (say "2022")
  // keeps every member of it; otherwise only members matching the query stay.
  const title = councilTitle(councilNumber, termPeriod);
  const labelMatches =
    !!norm(globalSearch) && norm(`${title} ${termPeriod}`).includes(norm(globalSearch));
  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          (labelMatches || entryMatches(e, globalSearch)) && entryMatches(e, search)
      ),
    [entries, search, globalSearch, labelMatches]
  );

  return (
    <div
      className={`${styles.councilGroup} ${
        isOpen ? styles.councilGroupOpen : ""
      }`}
    >
      {/* ── header row ── */}
      <div className={styles.councilHeaderWrapper}>
        {/* left side: toggle */}
        <button className={styles.councilHeader} onClick={onToggle}>
          <span className={styles.councilChevron}>
            {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </span>
          <div className={styles.councilAccent} />
          <div className={styles.councilInfo}>
            <div className={styles.councilTermLabel}>{title}</div>
            {councilNumber && (
              <div className={styles.councilTermRange}>Term {termPeriod}</div>
            )}
            <div className={styles.councilMeta}>
              {entries.length} member{entries.length !== 1 ? "s" : ""}
              {activeCount > 0 && (
                <span className={styles.activeChip}>{activeCount} active</span>
              )}
            </div>
          </div>
        </button>

        {/* right side: council actions — separate from the toggle button.
            Edit/Delete only make sense for a real council row (councilId
            != null) — the "Unknown" bucket (members with no term at all)
            has none to act on. */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {!readOnly && councilId != null && (
            <>
              <button
                className={styles.councilActionBtn}
                onClick={() => onEditCouncil(councilId, termPeriod, councilNumber)}
                title={`Edit the ${title}`}
              >
                <Pencil size={13} />
              </button>
              <button
                className={`${styles.councilActionBtn} ${styles.councilActionBtnDanger}`}
                onClick={() =>
                  onDeleteCouncil(councilId, councilNumber ? `${title} (${termPeriod})` : termPeriod)
                }
                title={`Delete the ${title}`}
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
          {!readOnly && (
            <button
              className={styles.addMemberInlineBtn}
              onClick={() => onAddMember(termPeriod)}
              title={`Add a member to the ${title}`}
            >
              <UserPlus size={13} /> Add member
            </button>
          )}
        </div>
      </div>

      {/* ── expanded body ── */}
      {isOpen && (
        <div className={styles.councilBody}>
          {entries.length > 0 && (
            <div className={styles.searchBar}>
              <Search size={13} style={{ color: "#a0aec0", flexShrink: 0 }} />
              <input
                type="text"
                placeholder="Search by name or position…"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
              />
              {search && (
                <button
                  className={styles.clearSearch}
                  onClick={() => onSearch("")}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}

          {filtered.length > 0 ? (
            <>
              <div className={styles.resultInfo}>
                {filtered.length} member{filtered.length !== 1 ? "s" : ""}
                {search ? " found" : ""}
                {!readOnly && councilId != null && onReorder && entries.length > 1 && (
                  <span className={styles.dragHint}>
                    {isSearching
                      ? " · Clear the search to rearrange"
                      : " · Drag the cards to arrange the official order"}
                  </span>
                )}
              </div>
              {orderError && <div className={styles.orderError}>{orderError}</div>}
              <div className={styles.memberGrid}>
                {filtered.map(({ member, term }) => (
                  <MemberCard
                    key={`${member.id}-${term?.id ?? "noterm"}`}
                    member={member}
                    term={term}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onViewProfile={onViewProfile}
                    readOnly={readOnly}
                    dragProps={dragPropsFor(term)}
                    isDragging={term != null && dragId === term.id}
                    isDragOver={term != null && overId === term.id && dragId !== term.id}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className={styles.empty}>
              {search
                ? "No members match your search."
                : 'No members in this council yet. Click "Add member" to add one.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── OfficialsPage ─────────────────────────────────────────────────────────────

export default function OfficialsPage({
  officials = [],
  councils = [],
  onAddCouncil,
  onEditCouncil,
  onReorderCouncil,
  showSuccessModal,
  setDeleteTarget,
  onViewProfile,
  onEditMember,
  onAddMember,
  onSuggestMatches,
  readOnly = false,
}) {
  const [openGroups, setOpenGroups] = useState({});
  const [groupSearch, setGroupSearch] = useState({});
  // Page-wide search — finds a member by name across every council, for when
  // nobody remembers which term they were elected in.
  const [globalSearch, setGlobalSearch] = useState("");
  const [showAddCouncil, setShowAddCouncil] = useState(false);
  // { id, label } of the council currently being renamed, or null.
  const [editCouncilTarget, setEditCouncilTarget] = useState(null);

  const grouped = useMemo(() => buildCouncilGroups(officials), [officials]);

  // Councils with no current members don't show up in `grouped` at all
  // (buildCouncilGroups only ever sees officials' terms) — merge in the
  // rest of the real councils list so a freshly-created empty council is
  // still visible, and persists across a refresh (it's a real row now, not
  // client-only state).
  const allGroups = useMemo(() => {
    const existingCouncilIds = new Set(
      grouped.filter((g) => g.councilId != null).map((g) => g.councilId)
    );
    const emptyOnes = councils
      .filter((c) => !existingCouncilIds.has(c.id))
      .map((c) => ({
        key: `council-${c.id}`,
        councilId: c.id,
        termPeriod: c.term_label,
        entries: [],
      }));
    // One newest-first sort over empty and populated councils together —
    // otherwise an empty council (e.g. a freshly added 1990 one) would always
    // sit above every populated council regardless of its year. The
    // "Unknown" bucket for members with no terms stays last.
    const sortKey = (g) => {
      const [start = 0, end = start] = (g.termPeriod || "").match(/\d{4}/g)?.map(Number) ?? [];
      return [start, end];
    };
    const numberById = new Map(councils.map((c) => [c.id, c.council_number ?? null]));
    return [...emptyOnes, ...grouped]
      .map((g) => ({ ...g, councilNumber: numberById.get(g.councilId) ?? null }))
      .sort((a, b) => {
        if (a.key === "unknown") return 1;
        if (b.key === "unknown") return -1;
        const [aStart, aEnd] = sortKey(a);
        const [bStart, bEnd] = sortKey(b);
        return bStart - aStart || bEnd - aEnd;
      });
  }, [grouped, councils]);

  // Add Council pre-fills the next number after the highest one in use.
  const nextCouncilNumber = useMemo(() => {
    const max = Math.max(0, ...councils.map((c) => c.council_number || 0));
    return max > 0 ? max + 1 : null;
  }, [councils]);

  const searching = !!norm(globalSearch);
  const visibleGroups = useMemo(() => {
    if (!searching) return allGroups;
    return allGroups.filter(
      (g) =>
        norm(groupText(g)).includes(norm(globalSearch)) ||
        g.entries.some((e) => entryMatches(e, globalSearch))
    );
  }, [allGroups, globalSearch, searching]);
  const matchCount = useMemo(
    () =>
      visibleGroups.reduce((n, g) => {
        if (norm(groupText(g)).includes(norm(globalSearch))) return n + g.entries.length;
        return n + g.entries.filter((e) => entryMatches(e, globalSearch)).length;
      }, 0),
    [visibleGroups, globalSearch]
  );

  const toggleGroup = (key) =>
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleAddCouncilConfirm = async (tp, number) => {
    if (!onAddCouncil) return { success: false, error: "Not available." };
    const result = await onAddCouncil(tp, number);
    if (result.success) {
      const key = result.data?.id != null ? `council-${result.data.id}` : null;
      if (key) setOpenGroups((prev) => ({ ...prev, [key]: true }));
      setShowAddCouncil(false);
      showSuccessModal?.("Council added!");
    }
    return result;
  };

  const handleEditCouncilConfirm = async (tp, number) => {
    if (!onEditCouncil || !editCouncilTarget)
      return { success: false, error: "Not available." };
    const result = await onEditCouncil(editCouncilTarget.id, tp, number);
    if (result.success) {
      setEditCouncilTarget(null);
      showSuccessModal?.("Council updated!");
    }
    return result;
  };

  const handleDeleteCouncilClick = (id, label) =>
    setDeleteTarget({ id, type: "council", name: label });

  const handleDelete = (member) =>
    setDeleteTarget({
      id: member.id,
      type: "official",
      name: member.full_name,
    });

  // Stats
  const totalCouncils = allGroups.filter(
    (g) => g.termPeriod !== "Unknown"
  ).length;
  const totalMembers = officials.length;
  const activeMembers = officials.filter((o) =>
    (o.terms || []).some((t) => t.status === "active")
  ).length;

  return (
    <div className={styles.page}>
      {/* ── hero ── */}
      <div className={styles.hero}>
        <Users
          size={28}
          strokeWidth={1.2}
          style={{ color: "rgba(255,255,255,0.7)", flexShrink: 0 }}
        />
        <div style={{ flex: 1 }}>
          <h1 className={styles.heroTitle}>Members of the Council</h1>
          <p className={styles.heroSub}>
            Sangguniang Bayan ng Balilihan, Bohol
          </p>
        </div>
        <div className={styles.heroStats}>
          <div className={styles.heroStat}>
            <span className={styles.heroStatNum}>{totalCouncils}</span>
            <span className={styles.heroStatLabel}>Councils</span>
          </div>
          <div className={styles.heroStatDivider} />
          <div className={styles.heroStat}>
            <span className={styles.heroStatNum}>{totalMembers}</span>
            <span className={styles.heroStatLabel}>Members</span>
          </div>
          <div className={styles.heroStatDivider} />
          <div className={styles.heroStat}>
            <span className={styles.heroStatNum}>{activeMembers}</span>
            <span className={styles.heroStatLabel}>Active</span>
          </div>
        </div>
      </div>

      {/* ── toolbar ── */}
      <div className={styles.toolbar}>
        <span className={styles.sectionLabel} style={{ marginBottom: 0 }}>
          {allGroups.length} council{allGroups.length !== 1 ? "s" : ""}
        </span>
        {!readOnly && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {onSuggestMatches && (
              <button
                className={styles.primaryBtn}
                style={{ background: "#fff", color: "#1a365d", border: "1px solid #cbd5e0" }}
                title="One-time cleanup: link existing members to their login accounts"
                onClick={onSuggestMatches}
              >
                Suggest Account Matches
              </button>
            )}
            <button
              className={styles.primaryBtn}
              onClick={() => setShowAddCouncil(true)}
            >
              <Plus size={14} /> Add Council
            </button>
          </div>
        )}
      </div>

      {/* ── page-wide search ── */}
      {allGroups.length > 0 && (
        <>
          <div className={styles.searchBar} style={{ marginBottom: 12 }}>
            <Search size={14} style={{ color: "#a0aec0", flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Search any official by name or position, across all councils…"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
            />
            {globalSearch && (
              <button className={styles.clearSearch} onClick={() => setGlobalSearch("")}>
                <X size={12} />
              </button>
            )}
          </div>
          {searching && (
            <div className={styles.resultInfo}>
              {matchCount} match{matchCount !== 1 ? "es" : ""} in {visibleGroups.length}{" "}
              council{visibleGroups.length !== 1 ? "s" : ""}
            </div>
          )}
        </>
      )}

      {/* ── council group list ── */}
      {allGroups.length === 0 ? (
        <div className={styles.empty}>
          No councils yet. Click <strong>Add Council</strong> to create one,
          then add members to it.
        </div>
      ) : visibleGroups.length === 0 ? (
        <div className={styles.empty}>
          No official or council matches “{globalSearch.trim()}”.
        </div>
      ) : (
        <div className={styles.groupList}>
          {visibleGroups.map(({ key, councilId, councilNumber, termPeriod, entries }) => (
            <CouncilGroup
              key={key}
              termPeriod={termPeriod}
              councilNumber={councilNumber}
              councilId={councilId}
              entries={entries}
              isOpen={searching || !!openGroups[key]}
              globalSearch={globalSearch}
              onToggle={() => toggleGroup(key)}
              search={groupSearch[key] || ""}
              onSearch={(val) =>
                setGroupSearch((prev) => ({ ...prev, [key]: val }))
              }
              onAddMember={(tp) => onAddMember && onAddMember(tp)}
              onEdit={onEditMember}
              onDelete={handleDelete}
              onViewProfile={onViewProfile}
              onEditCouncil={(id, label, number) => setEditCouncilTarget({ id, label, number })}
              onDeleteCouncil={handleDeleteCouncilClick}
              onReorder={onReorderCouncil}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}

      {/* ── Add Council modal ── */}
      {showAddCouncil && (
        <CouncilFormModal
          mode="add"
          initialNumber={nextCouncilNumber}
          onClose={() => setShowAddCouncil(false)}
          onConfirm={handleAddCouncilConfirm}
        />
      )}

      {/* ── Edit Council modal ── */}
      {editCouncilTarget && (
        <CouncilFormModal
          mode="edit"
          initialLabel={editCouncilTarget.label}
          initialNumber={editCouncilTarget.number}
          onClose={() => setEditCouncilTarget(null)}
          onConfirm={handleEditCouncilConfirm}
        />
      )}
    </div>
  );
}
