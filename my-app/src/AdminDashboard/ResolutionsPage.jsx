/**
 * ResolutionsPage.jsx — Review, Approval, and Manual Publishing Workflow
 * Preserves existing props: resolutions, setDeleteTarget, onEdit
 */

import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X,
  Check,
  Eye,
  Pencil,
  Archive,
  FileText,
  Image,
  CalendarDays,
  Filter,
  Download,
  Upload,
  CheckSquare,
  Send,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Presentation,
} from "lucide-react";
import lStyles from "./LegislativeModule.module.css";
import {
  pendingQueryKey,
  fetchPendingList,
  RESOLUTION_CATEGORIES,
  isDuplicateRecordNumber,
  recordDate,
  recordDateLabel,
  toIsoDate,
  OFFICIALS_QUERY_KEY,
  fetchOfficialsList,
  authFetch,
  API,
  downloadFile,
  openPdfInTab,
} from "./AdminContext";
import {
  pendingStatusesForRole,
  READY_TO_PUBLISH_STATUSES,
  READING_STATUSES,
  REVIEW_STATUSES,
  isLockedStatus,
  useReviewWorkflow,
  useCommentThread,
  useLegislativePublished,
  useResetOnChange,
  useDeepLinkedTab,
  usePublishNumberDetection,
  nextNumberMismatch,
  acceptSuccessMessage,
} from "./useLegislativeReview";

import {
  TabNavigation,
  SearchBar,
  FilterPanel,
  EmptyState,
  StatsRow,
  StatusBadge,
  RecordListSkeleton,
  PresentOverlay,
  PublishNumberModal,
  CouncilorRoleSection,
} from "./LegislativeComponents";
import { statusLabel, nextReadingActionLabel } from "./legislativeStatus";
import { ModalAlert } from "./AdminComponents";
import ConfirmModal from "./ConfirmModal";
import AuthorApprovalPanel from "./AuthorApprovalPanel";
import RecordHistory from "./RecordHistory";
import LoadingModal from "./LoadingModal";

const CATEGORIES = RESOLUTION_CATEGORIES;

// Published records are paginated server-side (see GET /api/resolutions'
// opt-in page/limit) instead of fetching every resolution ever created —
// this stays independent of the `resolutions` prop, which the dashboard
// still fetches in full for its own stats.
const PAGE_SIZE = 20;

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function ResolutionsPage({
  resolutions,
  loading = false,
  setDeleteTarget,
  onEdit,
  readOnly = false,
  canPublish = false,
  canManagePending = false,
  currentUserId = null,
  isViceMayor = false,
  isSecretary = false,
  isClerk = false,
  isCouncilor = false,
  onRefresh,
  initialSubTab = null,
  // Dashboard "Review" button (PendingRecordsWidget): open just this record's
  // View modal — the exact same one this module uses — without the list
  // behind it. onViewOnlyClose runs once the modal (and anything it opened,
  // like the Publish dialog or a success message) has closed.
  viewOnlyRecord = null,
  onViewOnlyClose,
}) {
  // Lets the dashboard's "Needs your review" widget deep-link straight into
  // the Pending tab instead of landing on the default Published tab.
  const [activeTab, setActiveTab] = useDeepLinkedTab(
    "published",
    initialSubTab,
    canPublish ? ["published", "pending", "ready_to_publish"] : ["published"]
  );
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("All");
  const [dateFilter, setDateFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [presentTarget, setPresentTarget] = useState(null);
  // False while the open record still needs its author's approval for the
  // current stage (see AuthorApprovalPanel) — locks Advance / Publish.
  const [authorGateOpen, setAuthorGateOpen] = useState(true);
  const queryClient = useQueryClient();
  // Co-Author / Sponsor tagging (see helpers/officialRoleRoutes.js) draws its
  // picker from the same full council-member list Councilor Management uses,
  // not from `resolutions`/the officials this one record already has.
  const [selectedCoAuthorId, setSelectedCoAuthorId] = useState("");
  const [addingAllCoAuthors, setAddingAllCoAuthors] = useState(false);
  const { data: allOfficials = [] } = useQuery({
    queryKey: OFFICIALS_QUERY_KEY,
    queryFn: fetchOfficialsList,
    staleTime: 60000,
  });
  const pendingStatusQ = pendingStatusesForRole({ isSecretary });
  const { data: pendingResolutions = [], isLoading: fetchingPending } = useQuery({
    queryKey: pendingQueryKey("resolutions", pendingStatusQ),
    queryFn: () => fetchPendingList("resolutions", pendingStatusQ),
    enabled: canPublish,
    staleTime: 15000,
  });
  // Ready to Publish: its own tab (see READY_TO_PUBLISH_STATUSES) — Vice-Mayor
  // approves from here, everyone else can still track what's awaiting them.
  const { data: readyToPublishResolutions = [], isLoading: fetchingReadyToPublish } = useQuery({
    queryKey: pendingQueryKey("resolutions", READY_TO_PUBLISH_STATUSES),
    queryFn: () => fetchPendingList("resolutions", READY_TO_PUBLISH_STATUSES),
    enabled: canPublish,
    staleTime: 15000,
  });
  // Rejected records don't get a tab in this module — a rejected record is
  // private to its author and shows only in their own My Profile (see
  // MyProfileRecords.jsx); the list API never returns them. This page still
  // fires the /reject action (below), it just doesn't list them itself.

  // ── Published tab: server-paginated ─────────────────────────────────────────
  const [publishedPage, setPublishedPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);
  useResetOnChange(
    [debouncedSearch, yearFilter, catFilter, dateFilter],
    setPublishedPage,
    1
  );

  const publishedParams = {
    page: String(publishedPage),
    limit: String(PAGE_SIZE),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(yearFilter !== "all" ? { year: yearFilter } : {}),
    ...(catFilter !== "All" ? { category: catFilter } : {}),
    ...(dateFilter ? { date: dateFilter } : {}),
  };
  const {
    publishedList,
    publishedTotal,
    publishedTotalPages,
    fetchingPublished,
    refreshPublished: fetchPublishedResolutions,
  } = useLegislativePublished("resolutions", publishedParams, resolutions);

  // ── Review workflow (comment thread + actions inside the View Draft modal) ──
  // reviewCommentText/reviewFile stay local — they're page-specific glue
  // (one textarea doubles as both the comment box and the reject-reason
  // input; the file picker feeds handleReplaceFile below).
  const [reviewCommentText, setReviewCommentText] = useState("");
  const [reviewFile, setReviewFile] = useState(null);
  const {
    viewTarget, setViewTarget,
    submitting: reviewSubmitting, error: reviewError, setError: setReviewError,
    successMsg: reviewSuccessMsg, clearSuccessMsg: clearReviewSuccessMsg,
    runAction: runReviewAction,
  } = useReviewWorkflow({ onRefresh: () => refreshAll() });

  // ── Publish: collects the resolution number at the moment it's actually
  // published (see PublishNumberModal) instead of at draft-upload time.
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishNumberValue, setPublishNumberValue] = useState("");
  const [publishNumberError, setPublishNumberError] = useState("");
  const [publishDateValue, setPublishDateValue] = useState("");
  const publishDetect = usePublishNumberDetection("resolutions");
  const {
    comments: reviewComments, loadingComments, commentSubmitting,
    fetchComments: fetchCommentsForId, sendComment,
  } = useCommentThread();
  const fetchComments = (id) => fetchCommentsForId("resolution", id);

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const getFileUrl = (filepath) =>
    `${SUPABASE_URL}/storage/v1/object/public/assets/${filepath}`;

  // ── Derive available years from the full resolutions list (the dashboard
  // already fetches this in full for its own stats, so reusing it here is
  // free — the Published tab's own list below is the one that's paginated).
  // Deliberately NOT scoped to status === "published": this Year dropdown
  // is shared by all three tabs (Published/Pending/Ready to Publish) via
  // the one FilterPanel above, so scoping it to published-only years
  // silently dropped any year that only exists on a pending/ready_to_publish
  // draft — that year just had no option to select it by on those tabs.
  const availableYears = [
    ...new Set(
      resolutions
        .map((r) => r.year?.toString())
        .filter(Boolean)
    ),
  ].sort((a, b) => b - a);

  const resetFilters = () => {
    setSearch("");
    setCatFilter("All");
    setDateFilter("");
    setYearFilter("all");
    setStatusFilter("all");
  };

  // Old call sites just call fetchPendingResolutions() to refresh — keeping
  // the name means refreshAll() below doesn't need to change.
  const fetchPendingResolutions = () => {
    queryClient.invalidateQueries({ queryKey: pendingQueryKey("resolutions", pendingStatusQ) });
    queryClient.invalidateQueries({ queryKey: pendingQueryKey("resolutions", READY_TO_PUBLISH_STATUSES) });
  };

  const refreshAll = () => {
    fetchPendingResolutions();
    fetchPublishedResolutions();
    onRefresh?.();
  };

  const handleOpenView = (item) => {
    setReviewError("");
    setReviewCommentText("");
    setReviewFile(null);
    setSelectedCoAuthorId("");
    setAddingAllCoAuthors(false);
    setViewTarget(item);
    if (item.status !== "published") fetchComments(item.id);
  };

  const viewOnly = !!viewOnlyRecord;
  // Set once the record's modal has actually been on screen — the close
  // check below must not fire before that (on the first render viewTarget is
  // still null, which would otherwise close the modal the instant it opens).
  const viewOnlyShown = useRef(false);
  useEffect(() => {
    if (!viewOnlyRecord) return;
    handleOpenView(viewOnlyRecord);
    // Opens once per record; handleOpenView is recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewOnlyRecord?.id]);

  const handleSendComment = async () => {
    if (!viewTarget) return;
    const result = await sendComment("resolution", viewTarget.id, reviewCommentText);
    if (result.ok) setReviewCommentText("");
    else if (result.error) setReviewError(result.error);
  };

  const handleAccept = (id) =>
    runReviewAction(
      `/api/resolutions/${id}/accept`,
      { method: "PUT" },
      (d) => ({ status: d.status }),
      acceptSuccessMessage
    );

  const handleAdvanceReading = (id) => {
    const label = nextReadingActionLabel(viewTarget?.status);
    const successMsg =
      label === "Send for VM Approval"
        ? "Third reading complete — sent to the Vice-Mayor!"
        : label === "Proceed to First Reading"
        ? "Now in First Reading!"
        : label
        ? `${label.replace("Mark ", "")}!`
        : undefined;
    return runReviewAction(
      `/api/resolutions/${id}/advance-reading`,
      { method: "PUT" },
      (d) => ({ status: d.status }),
      successMsg
    );
  };

  const handleRequestChanges = async () => {
    if (!viewTarget) return;
    if (!reviewCommentText.trim() && reviewComments.length === 0) return;
    const ok = await runReviewAction(
      `/api/resolutions/${viewTarget.id}/request-changes`,
      {
        method: "PUT",
        body: JSON.stringify({ comment: reviewCommentText.trim() }),
      },
      (d) => ({ status: d.status }),
      "Changes requested!"
    );
    if (ok) {
      setReviewCommentText("");
      fetchComments(viewTarget.id);
    }
  };

  // Terminal, unlike Request Changes — there's no resubmission path back to
  // pending. The record stays visible on its creator's own Profile page
  // (and the Secretary's, across every creator) as a record of the
  // rejection. A reason is required at every stage so the Author knows why
  // — see the matching check in helpers/legislativeReviewRoutes.js.
  const handleReject = async () => {
    if (!viewTarget || !reviewCommentText.trim()) return;
    const ok = await runReviewAction(
      `/api/resolutions/${viewTarget.id}/reject`,
      {
        method: "PUT",
        body: JSON.stringify({ comment: reviewCommentText.trim() }),
      },
      (d) => ({ status: d.status }),
      "Resolution rejected."
    );
    if (ok) {
      setReviewCommentText("");
      fetchComments(viewTarget.id);
    }
  };

  // Co-Author / Sponsor: addable once the draft has reached a reading stage
  // (see READING_STATUSES gate in helpers/officialRoleRoutes.js), alongside
  // the existing Author tagged at upload time — not a replacement for it.
  const handleAddCoAuthor = async () => {
    if (!viewTarget || !selectedCoAuthorId) return;
    const ok = await runReviewAction(
      `/api/resolutions/${viewTarget.id}/officials`,
      {
        method: "POST",
        body: JSON.stringify({ official_id: selectedCoAuthorId, role: "co_author" }),
      },
      (d) => ({ co_authors: [...(viewTarget.co_authors || []), d] }),
      "Co-sponsor added!"
    );
    if (ok) setSelectedCoAuthorId("");
  };

  const handleRemoveCoAuthor = (officialId) =>
    runReviewAction(
      `/api/resolutions/${viewTarget.id}/officials/${officialId}?role=co_author`,
      { method: "DELETE" },
      () => ({
        co_authors: (viewTarget.co_authors || []).filter((m) => m.id !== officialId),
      }),
      "Co-sponsor removed."
    );

  // Bypasses runReviewAction (fired one at a time here, in parallel) because
  // that hook's applyUpdate closes over the `viewTarget` from the render
  // that triggered it — firing it N times in a row would have each call
  // overwrite the others' additions instead of accumulating them. Collecting
  // every result first and merging into state once avoids that.
  const handleAddAllCoAuthors = async () => {
    if (!viewTarget) return;
    const candidates = allOfficials.filter(
      (o) => !(viewTarget.co_authors || []).some((m) => m.id === o.id)
    );
    if (candidates.length === 0) return;
    setAddingAllCoAuthors(true);
    setReviewError("");
    try {
      const results = await Promise.all(
        candidates.map(async (o) => {
          try {
            const res = await authFetch(`${API}/api/resolutions/${viewTarget.id}/officials`, {
              method: "POST",
              body: JSON.stringify({ official_id: o.id, role: "co_author" }),
            });
            const data = await res.json();
            return res.ok && data.success ? data.data : null;
          } catch {
            return null;
          }
        })
      );
      const added = results.filter(Boolean);
      if (added.length > 0) {
        setViewTarget((prev) =>
          prev
            ? { ...prev, co_authors: [...(prev.co_authors || []), ...added] }
            : prev
        );
        refreshAll();
      }
      if (added.length < candidates.length) {
        setReviewError("Some councilors couldn't be added as co-sponsor.");
      }
    } finally {
      setAddingAllCoAuthors(false);
    }
  };


  const handleVMApprove = (id) =>
    runReviewAction(
      `/api/resolutions/${id}/vm-approve`,
      { method: "PUT" },
      (d) => ({ status: d.status }),
      "Resolution approved!"
    );

  const handlePublish = (id, resolutionNumber, approvedOn) =>
    runReviewAction(
      `/api/resolutions/${id}/publish`,
      {
        method: "PUT",
        body: JSON.stringify({
          resolution_number: resolutionNumber,
          ...(approvedOn && { approved_on: approvedOn }),
        }),
      },
      (d) => ({
        status: d.status,
        resolution_number: d.resolution_number,
        approved_on: d.approved_on,
      })
    );

  const openPublishModal = () => {
    const initial = viewTarget.resolution_number || "";
    // The approved date starts as the day the Vice-Mayor approved it.
    const initialDate = viewTarget.approved_on ? toIsoDate(new Date(viewTarget.approved_on)) : "";
    setPublishNumberValue(initial);
    setPublishDateValue(initialDate);
    setPublishNumberError("");
    setShowPublishModal(true);
    // The document is read for a number and an approved date, and whatever it
    // finds goes straight into the fields — but only into a field still
    // holding its untouched starting value, and never over a number the
    // record already carries.
    publishDetect.detect(viewTarget.id, (d) => {
      if (d.number && !viewTarget.resolution_number) {
        setPublishNumberValue((cur) => (cur === initial ? d.number : cur));
      }
      if (d.date) setPublishDateValue((cur) => (cur === initialDate ? d.date : cur));
    });
  };

  const confirmPublish = async () => {
    const number = publishNumberValue.trim();
    if (!number) {
      setPublishNumberError("Resolution number is required.");
      return;
    }
    // Latest published + 1 only — see nextNumberMismatch / helpers/recordNumbers.js.
    const sequenceError = nextNumberMismatch(number, publishDetect.next, "resolution");
    if (sequenceError) {
      setPublishNumberError(sequenceError);
      return;
    }
    if (isDuplicateRecordNumber(resolutions, "resolution_number", number, viewTarget.id)) {
      setPublishNumberError(
        `"${number}" is already in use by another resolution. Please choose a different number.`
      );
      return;
    }
    const ok = await handlePublish(viewTarget.id, number, publishDateValue);
    if (ok) setShowPublishModal(false);
  };

  const handleReplaceFile = async (id) => {
    if (!reviewFile) return;
    const fd = new FormData();
    fd.append("file", reviewFile);
    const ok = await runReviewAction(
      `/api/resolutions/${id}/replace-file`,
      { method: "PUT", body: fd },
      (d) => ({
        filename: d.filename,
        filetype: d.filetype,
        filepath: d.filepath,
        extracted_text: d.extracted_text,
        revision_count: d.revision_count,
      })
    );
    if (ok) setReviewFile(null);
    return ok;
  };

  const matchesPendingFilters = (r) => {
    // Mirrors GET /api/resolutions' widened search (title/number/category/
    // author all OR'd together) — this box's own placeholder already
    // promised all four, it just wasn't actually checking category/author.
    const q = search.toLowerCase();
    const matchesSearch =
      !search ||
      (r.title || "").toLowerCase().includes(q) ||
      (r.resolution_number || "").toLowerCase().includes(q) ||
      (r.category || "").toLowerCase().includes(q) ||
      (r.officials || []).some((off) =>
        (off.full_name || "").toLowerCase().includes(q)
      );
    const matchesCategory = catFilter === "All" || r.category === catFilter;
    const matchesYear = yearFilter === "all" || String(r.year) === yearFilter;
    const matchesDate =
      !dateFilter || (r.uploaded_at || "").slice(0, 10) === dateFilter;
    const matchesStatus = statusFilter === "all" || r.status === statusFilter;
    return matchesSearch && matchesCategory && matchesYear && matchesDate && matchesStatus;
  };
  const pendingFiltered = pendingResolutions.filter(matchesPendingFilters);
  const pendingCount = pendingResolutions.length;
  const readyToPublishFiltered = readyToPublishResolutions.filter(matchesPendingFilters);
  const readyToPublishCount = readyToPublishResolutions.length;

  // Status filter options, scoped to whichever tab is actually open — Pending
  // (pending, plus the three reading statuses for Secretary) vs Ready to
  // Publish (ready_to_publish, approved). Published has only one status, so
  // no filter is offered there.
  const statusFilterOptions =
    activeTab === "pending"
      ? pendingStatusQ.split(",").map((s) => ({ value: s, label: statusLabel(s) }))
      : activeTab === "ready_to_publish"
      ? READY_TO_PUBLISH_STATUSES.split(",").map((s) => ({ value: s, label: statusLabel(s) }))
      : null;

  // View-only mode: once nothing is open any more, hand control back.
  useEffect(() => {
    if (!viewOnly) return;
    if (viewTarget) {
      viewOnlyShown.current = true;
      return;
    }
    if (viewOnlyShown.current && !reviewSuccessMsg && !showPublishModal && !presentTarget) {
      viewOnlyShown.current = false;
      onViewOnlyClose?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewOnly, viewTarget, reviewSuccessMsg, showPublishModal, presentTarget]);

  return (
    <>
      {!viewOnly && (
      <>
      {/* STATS */}
      <StatsRow
        loading={loading || (fetchingPublished && publishedTotal === 0)}
        stats={[
          { value: publishedTotal, label: "Total Published" },
          {
            value: pendingCount,
            label: "Pending Review",
            colorClass: lStyles.statCardAmber,
          },
        ]}
      />

      {/* TABS */}
      <TabNavigation
        tabs={[
          { id: "published", label: "Published" },
          ...(canPublish
            ? [
                { id: "pending", label: "Pending", badge: pendingCount },
                {
                  id: "ready_to_publish",
                  label: "Ready to Publish",
                  badge: readyToPublishCount,
                },
              ]
            : []),
        ]}
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          resetFilters();
        }}
      />

      {/* SEARCH & FILTER */}
      <div className={lStyles.searchFilterBar}>
        <div className={lStyles.searchRow}>
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search by title, number, category, or sponsor..."
          />
        </div>
        <FilterPanel
          categories={CATEGORIES}
          categoryValue={catFilter}
          onCategoryChange={setCatFilter}
          dateValue={dateFilter}
          onDateChange={setDateFilter}
          yearValue={yearFilter}
          onYearChange={setYearFilter}
          years={availableYears}
          statuses={statusFilterOptions}
          statusValue={statusFilter}
          onStatusChange={setStatusFilter}
          onReset={resetFilters}
        />
      </div>

      {/* ── PUBLISHED TAB ────────────────────────────────────────────────────── */}
      {activeTab === "published" && (
        <>
          <div className={lStyles.resultCount}>
            Showing {publishedList.length === 0 ? 0 : (publishedPage - 1) * PAGE_SIZE + 1}
            {publishedList.length > 0 ? `-${(publishedPage - 1) * PAGE_SIZE + publishedList.length}` : ""} of {publishedTotal} resolutions
          </div>
          {loading || fetchingPublished ? (
            <RecordListSkeleton count={4} />
          ) : (
          <div className={lStyles.recordList}>
            {publishedList.length === 0 ? (
              <EmptyState
                title="No published resolutions yet"
                text={
                  search || yearFilter !== "all"
                    ? "No records match your filters."
                    : "Approved drafts will appear here after final signed upload."
                }
              />
            ) : (
              publishedList.map((r) => (
                <div key={r.id} className={lStyles.recordCard}>
                  <div
                    className={lStyles.recordIcon}
                    style={{ background: "var(--blue-50)" }}
                  >
                    {r.filetype === "application/pdf" ? (
                      <FileText size={20} strokeWidth={1.2} />
                    ) : (
                      <Image size={20} strokeWidth={1.2} />
                    )}
                  </div>
                  <div className={lStyles.recordBody}>
                    <div className={lStyles.recordCode}>
                      {r.resolution_number || "—"}
                    </div>
                    <div className={lStyles.recordTitle}>{r.title}</div>
                    <div className={lStyles.recordMeta}>
                      {r.category && (
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <Filter size={12} /> {r.category}
                        </span>
                      )}
                      {r.year && (
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <CalendarDays size={12} /> {r.year}
                        </span>
                      )}
                      <StatusBadge status={r.status} />
                      {r.officials?.length > 0 && (
                        <span
                          title="Sponsor"
                          style={{
                            fontSize: 11,
                            color: "var(--color-text-secondary)",
                          }}
                        >
                          {r.officials.map((a) => a.full_name).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className={lStyles.recordActions}>
                    <button
                      className={`${lStyles.btn} ${lStyles.btnSm} ${lStyles.btnInfo}`}
                      onClick={() => handleOpenView(r)}
                    >
                      <Eye size={13} /> View
                    </button>
                    {!readOnly && (
                      <>
                        <button
                          className={`${lStyles.btn} ${lStyles.btnSm}`}
                          onClick={() => onEdit(r)}
                        >
                          <Pencil size={13} /> Edit
                        </button>
                        <button
                          className={`${lStyles.btn} ${lStyles.btnSm} ${lStyles.btnDanger}`}
                          onClick={() =>
                            setDeleteTarget({
                              id: r.id,
                              type: "resolution",
                              name: r.title,
                            })
                          }
                        >
                          <Archive size={13} /> Archive
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          )}
          {!fetchingPublished && publishedTotalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, padding: "14px 0" }}>
              <button
                className={`${lStyles.btn} ${lStyles.btnSm}`}
                disabled={publishedPage <= 1}
                onClick={() => setPublishedPage((p) => Math.max(p - 1, 1))}
              >
                <ChevronLeft size={13} /> Prev
              </button>
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                Page {publishedPage} of {publishedTotalPages}
              </span>
              <button
                className={`${lStyles.btn} ${lStyles.btnSm}`}
                disabled={publishedPage >= publishedTotalPages}
                onClick={() => setPublishedPage((p) => Math.min(p + 1, publishedTotalPages))}
              >
                Next <ChevronRight size={13} />
              </button>
            </div>
          )}
        </>
      )}

      {/* ── PENDING TAB ──────────────────────────────────────────────────────── */}
      {activeTab === "pending" && (
        <>
          <div className={lStyles.resultCount}>
            Showing {pendingFiltered.length} drafts
          </div>
          {fetchingPending ? (
            <RecordListSkeleton count={3} />
          ) : (
          <div className={lStyles.recordList}>
            {pendingFiltered.length === 0 ? (
              <EmptyState
                title="No pending drafts"
                text="All submitted drafts have been reviewed."
              />
            ) : (
              pendingFiltered.map((item) => (
                <div key={item.id} className={lStyles.recordCard}>
                  <div
                    className={lStyles.recordIcon}
                    style={{ background: "var(--blue-50)" }}
                  >
                    {item.filetype === "application/pdf" ? (
                      <FileText size={20} strokeWidth={1.2} />
                    ) : (
                      <Image size={20} strokeWidth={1.2} />
                    )}
                  </div>
                  <div className={lStyles.recordBody}>
                    <div className={lStyles.recordCode}>
                      {item.resolution_number || "—"}
                    </div>
                    <div className={lStyles.recordTitle}>{item.title}</div>
                    <div className={lStyles.recordMeta}>
                      <span>
                        Submitted:{" "}
                        {new Date(item.uploaded_at).toLocaleDateString("en-PH")}
                      </span>
                      {item.revision_count > 0 && (
                        <span>Revision #{item.revision_count}</span>
                      )}
                      <StatusBadge status={item.status} />
                    </div>
                  </div>
                  <div className={lStyles.recordActions}>
                    <button
                      className={`${lStyles.btn} ${lStyles.btnSm} ${lStyles.btnInfo}`}
                      onClick={() => handleOpenView(item)}
                    >
                      <Eye size={13} /> View Draft
                    </button>
                    {/* Secretary/Clerk may archive any draft; Councilor/
                        Vice-Mayor may only withdraw one they created. Once a
                        record enters its first reading, it's read-only for
                        everyone — including here in Pending, before it ever
                        reaches the Ready to Publish tab. */}
                    {!isLockedStatus(item.status) &&
                      (canManagePending ||
                        ((isCouncilor || isViceMayor) &&
                          item.created_by === currentUserId)) && (
                        <button
                          className={`${lStyles.btn} ${lStyles.btnSm} ${lStyles.btnDanger}`}
                          onClick={() =>
                            setDeleteTarget({
                              id: item.id,
                              type: "resolution",
                              name: item.title,
                            })
                          }
                        >
                          <Archive size={13} /> Archive
                        </button>
                      )}
                  </div>
                </div>
              ))
            )}
          </div>
          )}
        </>
      )}

      {/* ── READY TO PUBLISH TAB ─────────────────────────────────────────────── */}
      {activeTab === "ready_to_publish" && (
        <>
          <div className={lStyles.resultCount}>
            Showing {readyToPublishFiltered.length} records
          </div>
          {fetchingReadyToPublish ? (
            <RecordListSkeleton count={3} />
          ) : (
          <div className={lStyles.recordList}>
            {readyToPublishFiltered.length === 0 ? (
              <EmptyState
                title="Nothing ready to publish"
                text="Records approved by the Vice-Mayor and awaiting final publish will show up here."
              />
            ) : (
              readyToPublishFiltered.map((item) => (
                <div key={item.id} className={lStyles.recordCard}>
                  <div
                    className={lStyles.recordIcon}
                    style={{ background: "var(--blue-50)" }}
                  >
                    {item.filetype === "application/pdf" ? (
                      <FileText size={20} strokeWidth={1.2} />
                    ) : (
                      <Image size={20} strokeWidth={1.2} />
                    )}
                  </div>
                  <div className={lStyles.recordBody}>
                    <div className={lStyles.recordCode}>
                      {item.resolution_number || "—"}
                    </div>
                    <div className={lStyles.recordTitle}>{item.title}</div>
                    <div className={lStyles.recordMeta}>
                      <span>
                        Submitted:{" "}
                        {new Date(item.uploaded_at).toLocaleDateString("en-PH")}
                      </span>
                      {item.revision_count > 0 && (
                        <span>Revision #{item.revision_count}</span>
                      )}
                      <StatusBadge status={item.status} />
                    </div>
                  </div>
                  <div className={lStyles.recordActions}>
                    {/* Read-only tab — no edit/comment/archive for anyone
                        here, just View (which still carries the Approve/
                        Publish actions once applicable). */}
                    <button
                      className={`${lStyles.btn} ${lStyles.btnSm} ${lStyles.btnInfo}`}
                      onClick={() => handleOpenView(item)}
                    >
                      <Eye size={13} /> View
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          )}
        </>
      )}

      {/* ── VIEW RESOLUTION MODAL ────────────────────────────────────────────── */}
      </>
      )}

      {viewTarget && (
        <div
          className={lStyles.viewModalOverlay}
          onClick={() => setViewTarget(null)}
        >
          <ModalAlert message={reviewError} type="error" />
          <div
            className={lStyles.viewModal}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── Header ── */}
            <div className={lStyles.viewModalHeader}>
              <div className={lStyles.viewModalHeaderTop}>
                <div className={lStyles.viewModalHeaderInfo}>
                  {viewTarget.resolution_number && (
                    <div className={lStyles.viewModalOrdNumber}>
                      <FileText size={12} />
                      {viewTarget.resolution_number}
                    </div>
                  )}
                  <h2 className={lStyles.viewModalTitle}>{viewTarget.title}</h2>
                </div>
                <button
                  className={lStyles.viewModalCloseBtn}
                  onClick={() => setViewTarget(null)}
                  aria-label="Close modal"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* ── Scrollable body ── */}
            <div className={lStyles.viewModalBody}>
              {/* ── Metadata cards ── */}
              <div className={lStyles.viewModalMeta}>
                {viewTarget.year && (
                  <div className={lStyles.viewModalMetaItem}>
                    <div
                      className={`${lStyles.viewModalMetaIcon} ${lStyles.viewModalMetaIconBlue}`}
                    >
                      <CalendarDays size={16} />
                    </div>
                    <div>
                      <div className={lStyles.viewModalMetaLabel}>Year</div>
                      <div className={lStyles.viewModalMetaValue}>
                        {viewTarget.year}
                      </div>
                    </div>
                  </div>
                )}
                <div className={lStyles.viewModalMetaItem}>
                  <div
                    className={`${lStyles.viewModalMetaIcon} ${lStyles.viewModalMetaIconGreen}`}
                  >
                    <CalendarDays size={16} />
                  </div>
                  <div>
                    <div className={lStyles.viewModalMetaLabel}>
                      {recordDateLabel(viewTarget)}
                    </div>
                    <div className={lStyles.viewModalMetaValue}>
                      {new Date(recordDate(viewTarget)).toLocaleDateString(
                        "en-PH",
                        {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        }
                      )}
                    </div>
                  </div>
                </div>
                {viewTarget.status && (
                  <div className={lStyles.viewModalMetaItem}>
                    <div
                      className={`${lStyles.viewModalMetaIcon} ${lStyles.viewModalMetaIconAmber}`}
                    >
                      <Eye size={16} />
                    </div>
                    <div>
                      <div className={lStyles.viewModalMetaLabel}>Status</div>
                      <div className={lStyles.viewModalMetaValue}>
                        {statusLabel(viewTarget.status)}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className={lStyles.viewModalDivider} />

              {/* ── File actions ── */}
              {viewTarget.filetype === "application/pdf" && (
                <div className={lStyles.viewModalFileActions}>
                  <button
                    className={`${lStyles.viewModalFileBtn} ${lStyles.viewModalFileBtnPrimary}`}
                    onClick={() => openPdfInTab(getFileUrl(viewTarget.filepath), viewTarget.title || viewTarget.resolution_number)}
                  >
                    <FileText size={16} />
                    Open PDF Document
                  </button>
                  <button
                    className={`${lStyles.viewModalFileBtn} ${lStyles.viewModalFileBtnSecondary}`}
                    onClick={() => downloadFile(getFileUrl(viewTarget.filepath), viewTarget.filepath, viewTarget.title || viewTarget.resolution_number)}
                  >
                    <Download size={16} />
                    Download PDF
                  </button>
                  <button
                    className={`${lStyles.viewModalFileBtn} ${lStyles.viewModalFileBtnSecondary}`}
                    onClick={() => setPresentTarget(viewTarget)}
                  >
                    <Presentation size={16} />
                    Present
                  </button>
                </div>
              )}

              {(viewTarget.filetype === "application/msword" ||
                viewTarget.filetype ===
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document") && (
                <div className={lStyles.viewModalFileActions}>
                  <button
                    className={`${lStyles.viewModalFileBtn} ${lStyles.viewModalFileBtnPrimary}`}
                    onClick={() =>
                      downloadFile(getFileUrl(viewTarget.filepath), viewTarget.filepath, viewTarget.title || viewTarget.resolution_number)
                    }
                  >
                    <Download size={16} />
                    Download Word Document
                  </button>
                  <button
                    className={`${lStyles.viewModalFileBtn} ${lStyles.viewModalFileBtnSecondary}`}
                    onClick={() => setPresentTarget(viewTarget)}
                  >
                    <Presentation size={16} />
                    Present
                  </button>
                </div>
              )}

              {viewTarget.filetype?.startsWith("image/") && (
                <div className={lStyles.viewModalOcrSection}>
                  <img
                    src={getFileUrl(viewTarget.filepath)}
                    alt={viewTarget.title}
                    className={lStyles.viewModalImagePreview}
                  />
                  <div className={lStyles.viewModalFileActions}>
                    <button
                      className={`${lStyles.viewModalFileBtn} ${lStyles.viewModalFileBtnSecondary}`}
                      onClick={() => setPresentTarget(viewTarget)}
                    >
                      <Presentation size={16} />
                      Present
                    </button>
                  </div>
                  <div className={lStyles.viewModalOcrLabel}>
                    <Image size={14} />
                    Extracted Text (OCR)
                  </div>
                  <textarea
                    className={lStyles.viewModalOcrText}
                    readOnly
                    rows={6}
                    value={
                      viewTarget.extracted_text ||
                      "No text could be extracted from this image."
                    }
                  />
                </div>
              )}

              {/* ── Council members ── */}
              {viewTarget.officials?.length > 0 && (
                <>
                  <div className={lStyles.viewModalDivider} />
                  <div className={lStyles.viewModalCouncilSection}>
                    <div className={lStyles.viewModalCouncilHeader}>
                      <div className={lStyles.viewModalCouncilTitle}>
                        Sponsor
                      </div>
                      <div className={lStyles.viewModalCouncilCount}>
                        {viewTarget.officials.length} member
                        {viewTarget.officials.length !== 1 ? "s" : ""}
                      </div>
                    </div>
                    <div className={lStyles.viewModalCouncilGrid}>
                      {viewTarget.officials.map((m) => (
                        <div
                          key={m.id}
                          className={lStyles.viewModalCouncilCard}
                        >
                          {m.photo ? (
                            <img
                              src={m.photo}
                              alt={m.full_name}
                              className={lStyles.viewModalCouncilPhoto}
                            />
                          ) : (
                            <div className={lStyles.viewModalCouncilAvatar}>
                              {m.full_name?.charAt(0)}
                            </div>
                          )}
                          <div>
                            <div className={lStyles.viewModalCouncilName}>
                              {m.full_name}
                            </div>
                            <div className={lStyles.viewModalCouncilPosition}>
                              {m.position}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* ── Co-Sponsor ── (a resolution's main Sponsor is the tagged
                  member above; there's no separate Sponsor role for it) */}
              {(() => {
                const canEditRoles =
                  isSecretary && READING_STATUSES.includes(viewTarget.status);
                if (
                  !canEditRoles &&
                  !viewTarget.co_authors?.length
                )
                  return null;
                return (
                  <>
                    <div className={lStyles.viewModalDivider} />
                    <CouncilorRoleSection
                      title="Co-Sponsor"
                      members={viewTarget.co_authors || []}
                      canEdit={canEditRoles}
                      availableOfficials={allOfficials.filter(
                        (o) =>
                          !(viewTarget.co_authors || []).some(
                            (m) => m.id === o.id
                          )
                      )}
                      selectedId={selectedCoAuthorId}
                      onSelectedIdChange={setSelectedCoAuthorId}
                      onAdd={handleAddCoAuthor}
                      onRemove={handleRemoveCoAuthor}
                      submitting={reviewSubmitting}
                      onAddAll={handleAddAllCoAuthors}
                      addingAll={addingAllCoAuthors}
                    />
                  </>
                );
              })()}

              {/* ── Record history: upload → publish/reject (staff only — see RecordHistory.jsx) ── */}
              {["published", "rejected"].includes(viewTarget.status) && (
                <>
                  <div className={lStyles.viewModalDivider} />
                  <RecordHistory
                    key={`history-${viewTarget.id}`}
                    route="resolutions"
                    recordId={viewTarget.id}
                    status={viewTarget.status}
                  />
                </>
              )}

              {/* ── Review workflow (hidden once published) ── */}
              {viewTarget.status !== "published" && (
                <>
                  <div className={lStyles.viewModalDivider} />

                  {/* Replace file — Secretary/Clerk only. Still allowed
                      through the three readings (the Secretary may need to
                      swap in a corrected file while walking a draft through
                      them), locked out only once it's ready_to_publish/
                      approved/rejected — see isLockedStatus. */}
                  {(isSecretary || isClerk) &&
                    (!isLockedStatus(viewTarget.status) ||
                      REVIEW_STATUSES.includes(viewTarget.status) ||
                      ["ready_to_publish", "approved"].includes(viewTarget.status)) && (
                    <div style={{ marginBottom: 16 }}>
                      <div
                        className={lStyles.viewModalCouncilTitle}
                        style={{ marginBottom: 8 }}
                      >
                        Replace Draft File
                      </div>
                      <div
                        className={lStyles.replaceFileBox}
                        onClick={() =>
                          document.getElementById("reviewFileInputRes")?.click()
                        }
                      >
                        <div className={lStyles.replaceFileLabel}>
                          {reviewFile ? (
                            <>
                              <CheckSquare size={14} strokeWidth={1.5} />{" "}
                              {reviewFile.name}
                            </>
                          ) : (
                            <>
                              <Upload size={14} strokeWidth={1.5} />{" "}
                              Click to replace file
                            </>
                          )}
                        </div>
                        {viewTarget.filename && (
                          <p className={lStyles.fileHint}>
                            Current file: {viewTarget.filename}
                          </p>
                        )}
                        <input
                          id="reviewFileInputRes"
                          type="file"
                          accept=".pdf,.doc,.docx,image/*"
                          style={{ display: "none" }}
                          onChange={(e) =>
                            setReviewFile(e.target.files?.[0] || null)
                          }
                        />
                      </div>
                      {reviewFile && (
                        <button
                          className={`${lStyles.pillActionBtn} ${lStyles.pillAccept}`}
                          style={{ marginTop: 10, width: "100%" }}
                          disabled={reviewSubmitting}
                          onClick={() => handleReplaceFile(viewTarget.id)}
                        >
                          <Upload size={16} />{" "}
                          {viewTarget.status === "needs_revision"
                            ? "Replace File & Resubmit"
                            : "Upload Replacement"}
                        </button>
                      )}
                    </div>
                  )}

                  <div className={lStyles.commentsLabel}>Comments</div>
                  <div className={lStyles.commentsThread}>
                    {loadingComments ? (
                      <div
                        style={{
                          fontSize: 13,
                          textAlign: "center",
                          padding: "1rem",
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        Loading comments...
                      </div>
                    ) : reviewComments.length === 0 ? (
                      <div
                        style={{
                          fontSize: 13,
                          textAlign: "center",
                          padding: "1rem",
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        No comments yet
                      </div>
                    ) : (
                      reviewComments.map((c) => (
                        <div key={c.id} className={lStyles.comment}>
                          <div className={lStyles.commentMeta}>
                            <span className={lStyles.commentAuthor}>
                              {c.author?.name || c.author_role}
                            </span>
                            <span>
                              {new Date(c.created_at).toLocaleString("en-PH", {
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <div className={lStyles.commentText}>{c.text}</div>
                        </div>
                      ))
                    )}
                  </div>

                  {(isSecretary || isClerk || isCouncilor || isViceMayor) &&
                    // Otherwise-locked statuses stay closed to new comments
                    // — except mid-reading, where the Secretary needs this
                    // same box to type a required reason before Reject.
                    (!isLockedStatus(viewTarget.status) ||
                      REVIEW_STATUSES.includes(viewTarget.status) ||
                      ["ready_to_publish", "approved"].includes(viewTarget.status)) && (
                    <div className={lStyles.commentInputRow}>
                      <textarea
                        className={lStyles.commentInput}
                        rows={2}
                        placeholder={
                          isSecretary &&
                          (REVIEW_STATUSES.includes(viewTarget.status) ||
                            ["ready_to_publish", "approved"].includes(viewTarget.status))
                            ? "Add a comment, or the reason for rejection (required to reject)..."
                            : "Add a comment..."
                        }
                        value={reviewCommentText}
                        onChange={(e) => setReviewCommentText(e.target.value)}
                      />
                      <button
                        className={`${lStyles.btn} ${lStyles.btnSm}`}
                        disabled={commentSubmitting || !reviewCommentText.trim()}
                        onClick={handleSendComment}
                      >
                        <Send size={13} />
                      </button>
                    </div>
                  )}
                  {(REVIEW_STATUSES.includes(viewTarget.status) || viewTarget.status === "approved") && (
                    <AuthorApprovalPanel
                      key={viewTarget.id}
                      route="resolutions"
                      record={viewTarget}
                      isSecretary={isSecretary}
                      onGateChange={setAuthorGateOpen}
                      onDecided={onRefresh}
                    />
                  )}


                  <div
                    className={lStyles.viewModalFileActions}
                    style={{ marginTop: 16 }}
                  >
                    {isSecretary && viewTarget.status === "pending" && (
                      <div className={lStyles.pendingActionsRow}>
                        <button
                          className={`${lStyles.pillActionBtn} ${lStyles.pillReject}`}
                          disabled={
                            reviewSubmitting ||
                            (!reviewCommentText.trim() &&
                              reviewComments.length === 0)
                          }
                          title={
                            !reviewCommentText.trim() &&
                            reviewComments.length === 0
                              ? "Enter a comment above explaining the requested changes"
                              : ""
                          }
                          onClick={handleRequestChanges}
                        >
                          <X size={16} /> Request Changes
                        </button>
                        <button
                          className={`${lStyles.pillActionBtn} ${lStyles.pillAccept}`}
                          disabled={reviewSubmitting}
                          onClick={() => handleAccept(viewTarget.id)}
                        >
                          <Check size={16} /> Accept
                        </button>
                      </div>
                    )}

                    {isSecretary && REVIEW_STATUSES.includes(viewTarget.status) && (
                      <div className={lStyles.pendingActionsRow}>
                        <button
                          className={`${lStyles.pillActionBtn} ${lStyles.pillReject}`}
                          disabled={reviewSubmitting || !reviewCommentText.trim()}
                          title={!reviewCommentText.trim() ? "Enter a note above explaining the reason for rejection" : ""}
                          onClick={handleReject}
                        >
                          <X size={16} /> Reject
                        </button>
                        <button
                          className={`${lStyles.pillActionBtn} ${lStyles.pillAccept}`}
                          disabled={reviewSubmitting || !authorGateOpen}
                          title={!authorGateOpen ? "Waiting for the author's approval of this reading" : ""}
                          onClick={() => handleAdvanceReading(viewTarget.id)}
                        >
                          <CheckCircle2 size={16} /> {nextReadingActionLabel(viewTarget.status)}
                        </button>
                      </div>
                    )}

                    {/* Waiting on the Vice-Mayor — the Secretary can still reject. */}
                    {isSecretary && viewTarget.status === "ready_to_publish" && (
                      <div className={lStyles.pendingActionsRow}>
                        <button
                          className={`${lStyles.pillActionBtn} ${lStyles.pillReject}`}
                          disabled={reviewSubmitting || !reviewCommentText.trim()}
                          title={!reviewCommentText.trim() ? "Enter a note above explaining the reason for rejection" : ""}
                          onClick={handleReject}
                        >
                          <X size={16} /> Reject
                        </button>
                      </div>
                    )}

                    {isViceMayor &&
                      viewTarget.status === "ready_to_publish" && (
                        <button
                          className={lStyles.pillApprove}
                          disabled={reviewSubmitting}
                          onClick={() => handleVMApprove(viewTarget.id)}
                        >
                          <CheckCircle2 size={16} /> Approve
                        </button>
                      )}

                    {/* Same side-by-side row as Reject / Mark Reading above. */}
                    {isSecretary && viewTarget.status === "approved" && (
                      <div className={lStyles.pendingActionsRow}>
                        <button
                          className={`${lStyles.pillActionBtn} ${lStyles.pillReject}`}
                          disabled={reviewSubmitting || !reviewCommentText.trim()}
                          title={!reviewCommentText.trim() ? "Enter a note above explaining the reason for rejection" : ""}
                          onClick={handleReject}
                        >
                          <X size={16} /> Reject
                        </button>
                        <button
                          className={`${lStyles.pillActionBtn} ${lStyles.pillAccept}`}
                          disabled={reviewSubmitting || !authorGateOpen}
                          title={!authorGateOpen ? "Waiting for the author's final approval" : ""}
                          onClick={openPublishModal}
                        >
                          <CheckCircle2 size={16} /> Publish
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {presentTarget && (
        <PresentOverlay record={presentTarget} onClose={() => setPresentTarget(null)} />
      )}

      {reviewSuccessMsg && (
        <ConfirmModal
          type="success"
          title="Success"
          message={reviewSuccessMsg}
          confirmLabel="OK"
          cancelLabel={false}
          onConfirm={clearReviewSuccessMsg}
          onCancel={clearReviewSuccessMsg}
        />
      )}

      {showPublishModal && (
        <PublishNumberModal
          label="Resolution Number"
          value={publishNumberValue}
          onChange={(v) => {
            setPublishNumberValue(v);
            setPublishNumberError("");
          }}
          onConfirm={confirmPublish}
          onCancel={() => {
            setShowPublishModal(false);
            publishDetect.reset();
          }}
          nextNumber={publishDetect.next}
          onYearChange={(year) => publishDetect.refreshNext(viewTarget.id, null, year)}
          detection={publishDetect.detected}
          onSkipDetection={publishDetect.reset}
          uppercase
          dateValue={publishDateValue}
          onDateChange={(date) => {
            setPublishDateValue(date);
            publishDetect.refreshNext(viewTarget.id, date);
          }}
          submitting={reviewSubmitting}
          error={publishNumberError}
        />
      )}

      {/* Covers every review action on this page (Accept/Reject/Advance
          Reading/VM Approve/Publish/Replace File/Add-Remove Co-Author or
          Sponsor/comments) — they all funnel through one of these three
          submitting flags, so one overlay is enough instead of wiring a
          spinner into each individual button. On a slow connection this is
          what tells the user their click registered instead of leaving them
          wondering if a "hang" is really still processing. */}
      {(reviewSubmitting || addingAllCoAuthors || commentSubmitting) && (
        <LoadingModal message="Processing..." />
      )}
    </>
  );
}
