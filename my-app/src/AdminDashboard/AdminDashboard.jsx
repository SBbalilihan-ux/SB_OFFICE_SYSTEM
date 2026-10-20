import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import styles from "./AdminDashboard.module.css";
import logo from "../assets/image/balilihan-logo-Large-1.png";
import {
  Users,
  ShieldCheck,
  ScrollText,
  Landmark,
  X,
  LogOut,
  BookOpen,
  Gavel,
  Megaphone,
  ChevronDown,
  ChevronRight,
  Calendar,
  PlusCircle,
  Activity,
  RefreshCw,
  History,
  FileText,
  Image,
  Upload,
  CheckSquare,
  FileEdit,
  Camera,
  ClipboardList,
  Copy,
  Eye,
  Pencil,
  Trash2,
  CalendarDays,
  Archive,
  XCircle,
  Lock,
} from "lucide-react";
import ConfirmModal from "./ConfirmModal";
import LoadingModal from "./LoadingModal";
import ConnectionErrorModal from "./ConnectionErrorModal";
import RecordScanNotice from "./RecordScanNotice";
import { ToastContainer } from "./Toast";
import { useToasts } from "./useToasts";
import {
  API,
  authFetch,
  extractErrorMsg,
  missingFieldsMsg,
  toIsoDate,
  toLocalIso,
  formatDate,
  recordDate,
  tabTitles,
  getCurrentYear,
  suggestSessionNumber,
  SESSION_VENUE,
  isDuplicateRecordNumber,
  OFFICIALS_QUERY_KEY,
  fetchOfficialsList,
  COUNCILS_QUERY_KEY,
  fetchCouncilsList,
  ORDINANCE_CATEGORIES,
  RESOLUTION_CATEGORIES,
  setConnectionErrorHandler,
  useAutoRefresh,
  notifyDataChanged,
} from "./AdminContext";
import {
  TermStatusBadge,
  ModalAlert,
  TermFormFields,
  OfficialsCheckList,
  EventFormFields,
  UserAvatar,
} from "./AdminComponents";
import UsersPage from "./UsersPage";
import AdminsPage from "./AdminsPage";
import UserFormModal from "./UserFormModal";
import OrdinancesPage from "./OrdinancesPage";
import ResolutionsPage from "./ResolutionsPage";
import OfficialsPage from "./OfficialsPage";
import SessionsPage from "./SessionsPage";
import SessionAgendaPage from "./SessionAgendaPage";
import AnnouncementsPage from "./AnnouncementsPage";
import SectorSelect from "./SectorSelect";
import CalendarPage from "./CalendarPage";
import LogsPage from "./LogsPage";
import DashboardPage from "./DashboardPage";
import ContentManagementPage from "./ContentManagementPage";
import ArchivesPage from "./ArchivesPage";
import { TabNavigation, PresentOverlay } from "./LegislativeComponents";
import { CreateAccountFields, LoginAccountField, SuggestMatchesModal } from "./AccountLinking";
import MyProfilePage from "./MyProfilePage";
import { startProductTour } from "./productTour";
import {
  appendAccountFields,
  accountFieldsError,
  accountLinkMessage,
  MY_RECORDS_QUERY_KEY,
  fetchMyRecords,
} from "./authorWorkflow";

const ARCHIVABLE_TYPES = [
  "user",
  "ordinance",
  "resolution",
  "official",
  "session",
  "session_agenda",
];

// The confirm dialog names the record type; session_agenda's raw key isn't
// readable, so it gets its own wording.
const DELETE_TYPE_LABELS = { session_agenda: "order of business" };

// Every sidebar module key — the only values ?tab= may restore.
const MODULE_TABS = [
  "dashboard", "users", "admins", "ordinances", "resolutions", "officials", "sessions",
  "session_agendas", "announcements", "calendar", "logs", "content", "archives",
  "profile",
];

export default function AdminDashboard() {
  // ── core ──
  const [users, setUsers] = useState([]);
  const [admin, setAdmin] = useState(null);
  // The open module lives in the address (/dashboard?tab=ordinances), so a
  // page refresh reopens the same module instead of falling back to the
  // Dashboard. Unknown values fall back to "dashboard"; tabs the account
  // isn't allowed to see are sent back there once the account is known
  // (see the ADMIN_ONLY_TABS effect below).
  const [activeTab, setActiveTab] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    return MODULE_TABS.includes(fromUrl) ? fromUrl : "dashboard";
  });
  useEffect(() => {
    const url = new URL(window.location.href);
    if (activeTab === "dashboard") url.searchParams.delete("tab");
    else url.searchParams.set("tab", activeTab);
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [activeTab]);
  // Floating success/error toasts for routine action confirmations (save,
  // delete, publish, etc.) — non-blocking, unlike modalMessage below which
  // stays anchored inside an open modal for validation feedback.
  const { toasts, showMsg, dismissToast } = useToasts();
  const [modalMessage, setModalMessage] = useState("");
  const [modalMessageType, setModalMessageType] = useState("success");
  // Blocking success modal (upload/archive/save/update confirmations) —
  // unlike the toasts above, these need a deliberate dismissal so the user
  // has clear confirmation the action actually went through.
  const [successModalMsg, setSuccessModalMsg] = useState("");
  const showSuccessModal = (msg) => setSuccessModalMsg(msg);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  // authFetch (AdminContext.jsx) has no component of its own to render
  // from, so it reports connectivity trouble (offline, or a 503 from the
  // backend's own Supabase check failing) through this one registered
  // handler instead — see ConnectionErrorModal.jsx.
  const [connectionError, setConnectionError] = useState("");
  useEffect(() => {
    setConnectionErrorHandler(setConnectionError);
    return () => setConnectionErrorHandler(null);
  }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  // `sidebarCollapsed` only ever changes via desktop hover (see
  // handleSidebarMouseEnter/Leave below) — hover never fires on a touch
  // device, so it stays stuck at its default `true` forever on mobile. The
  // mobile sidebar is a slide-in overlay (see .sidebar.mobileOpen in
  // AdminDashboard.module.css), not the desktop hover rail, so it should
  // always render fully expanded — labelled nav items, expandable Legislative
  // Records/User Management sections — the same as the desktop sidebar looks
  // once hovered open. This is what the sidebar's JSX actually keys off of
  // instead of the raw `sidebarCollapsed` state.
  // The guided tour (productTour.js) points at sidebar items, so the sidebar
  // stays expanded for its whole run — otherwise moving the mouse over to a
  // tour popover would collapse the rail out from under it.
  const [touring, setTouring] = useState(false);
  const sidebarShowsCollapsed = sidebarCollapsed && !mobileOpen && !touring;
  const [legislativeOpen, setLegislativeOpen] = useState(false);
  const [userMgmtOpen, setUserMgmtOpen] = useState(false);
  // Set when navigating from the dashboard's "Needs your review" widget so
  // the destination module (Ordinances / Resolutions / Sessions) can open
  // directly on its Pending tab instead of the default Published tab.
  const [subTabRequest, setSubTabRequest] = useState(null);
  // Record opened from the dashboard's "Needs your review" widget — shown in
  // its module's own View modal (see the view-only OrdinancesPage /
  // ResolutionsPage below DashboardPage).
  const [dashboardReview, setDashboardReview] = useState(null);
  // The widget keeps its own pending list (a different status set than the
  // module's tabs), so refresh every pending list once the modal closes.
  const closeDashboardReview = () => {
    setDashboardReview(null);
    queryClient.invalidateQueries({ queryKey: ["pending"] });
  };

  // PH Holidays now live entirely in CalendarPage.jsx — it owns the viewed
  // month/year (calendarViewDate) and fetches holidays for whichever year is
  // actually on screen, not just the real "today" year. Only the show/hide
  // toggle preference stays here.
  const [showHolidays, setShowHolidays] = useState(true);

  // ── loading flags ──
  const [fetchingUsers, setFetchingUsers] = useState(false);
  const [fetchingOrdinances, setFetchingOrdinances] = useState(false);
  const [fetchingMinutes, setFetchingMinutes] = useState(false);
  const [fetchingAgendas, setFetchingAgendas] = useState(false);
  const [fetchingResolutions, setFetchingResolutions] = useState(false);
  const [fetchingAnnouncements, setFetchingAnnouncements] = useState(false);

  // ── activity logs ──
  const [logs, setLogs] = useState([]);
  const [logStats, setLogStats] = useState(null);
  const [fetchingLogs, setFetchingLogs] = useState(false);
  const [logModuleFilter, setLogModuleFilter] = useState("all");
  const [logActionFilter, setLogActionFilter] = useState("all");

  // ── modals ──
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showAddAdminModal, setShowAddAdminModal] = useState(false);
  const [showEditUserModal, setShowEditUserModal] = useState(false);
  const [resetPasswordTarget, setResetPasswordTarget] = useState(null); // { id, name, email }
  const [showOrdinanceModal, setShowOrdinanceModal] = useState(false);
  const [showEditOrdinanceModal, setShowEditOrdinanceModal] = useState(false);
  const [showResolutionModal, setShowResolutionModal] = useState(false);
  const [showEditResolutionModal, setShowEditResolutionModal] = useState(false);
  const [showOfficialModal, setShowOfficialModal] = useState(false);
  const [showEditOfficialModal, setShowEditOfficialModal] = useState(false);
  const [showOfficialProfile, setShowOfficialProfile] = useState(false);
  // Which section of the official-profile modal is open — reset to "terms"
  // each time a different official's profile is opened (see onViewProfile).
  const [officialProfileTab, setOfficialProfileTab] = useState("terms");
  // The ordinance/resolution currently shown in-app via PresentOverlay from
  // that modal's "View" button — was a plain `<a href={o.filepath}>`, but
  // filepath is just the storage object's path, not a real URL, so it just
  // opened a broken/blank tab instead of the actual document.
  const [officialRecordPreview, setOfficialRecordPreview] = useState(null);
  const [showTextModal, setShowTextModal] = useState(false);
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [showEditSessionModal, setShowEditSessionModal] = useState(false);
  const [showAgendaModal, setShowAgendaModal] = useState(false);
  const [showEditAgendaModal, setShowEditAgendaModal] = useState(false);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [showEditAnnouncementModal, setShowEditAnnouncementModal] =
    useState(false);
  const [showLocalEventModal, setShowLocalEventModal] = useState(false);
  const [showEditEventModal, setShowEditEventModal] = useState(false);
  const [showAddTermModal, setShowAddTermModal] = useState(false);
  const [showEditTermModal, setShowEditTermModal] = useState(false);
  const [termTarget, setTermTarget] = useState(null);

  // ── data ──
  const [newUser, setNewUser] = useState({
    name: "",
    username: "",
    email: "",
    password: "",
    position: "councilor",
  });
  const [newAdmin, setNewAdmin] = useState({
    name: "",
    username: "",
    email: "",
    password: "",
    position: "secretary",
  });
  const [newUserPhoto, setNewUserPhoto] = useState(null);
  const [newAdminPhoto, setNewAdminPhoto] = useState(null);

  // ── edit user/admin states ──
  const [editingUser, setEditingUser] = useState(null);
  const [editUserForm, setEditUserForm] = useState({
    name: "",
    username: "",
    email: "",
    position: "",
  });
  const [editUserPhoto, setEditUserPhoto] = useState(null);

  // ── Legislative Record Numbering: tracks the last system-suggested
  // session number so we know whether the user has since edited it manually
  // (in which case we stop overwriting their input). Ordinances/resolutions
  // no longer suggest/collect a number at upload time — see PublishNumberModal,
  // which now collects it when the Secretary actually publishes.
  const lastSessionSuggestion = useRef("");

  // ordinances
  const [ordinances, setOrdinances] = useState([]);
  const [ordinanceTitle, setOrdinanceTitle] = useState("");
  const [ordinanceDate, setOrdinanceDate] = useState("");
  const [ordinanceFile, setOrdinanceFile] = useState(null);
  const [ordinanceCategory, setOrdinanceCategory] = useState("");
  const [uploadType, setUploadType] = useState("");
  const [selectedOfficials, setSelectedOfficials] = useState([]);
  const [extractedText, setExtractedText] = useState("");
  const [editingOrdinance, setEditingOrdinance] = useState(null);
  const [editOrdinanceNumber, setEditOrdinanceNumber] = useState("");
  const [editOrdinanceTitle, setEditOrdinanceTitle] = useState("");
  const [editOrdinanceDate, setEditOrdinanceDate] = useState("");
  const [editOrdinanceCategory, setEditOrdinanceCategory] = useState("");
  const [editSelectedOfficials, setEditSelectedOfficials] = useState([]);
  const [editCoAuthors, setEditCoAuthors] = useState([]);
  const [editSponsors, setEditSponsors] = useState([]);
  const [editOrdinanceFile, setEditOrdinanceFile] = useState(null);

  // resolutions
  const [resolutions, setResolutions] = useState([]);
  const [resolutionTitle, setResolutionTitle] = useState("");
  const [resolutionDate, setResolutionDate] = useState("");
  const [resolutionFile, setResolutionFile] = useState(null);
  // Result of "detect the date from the chosen file" per upload form — see
  // detectRecordMeta below. (The official number isn't collected at upload;
  // the Secretary sets it when publishing.)
  // minutes / agenda: the session-minutes and order-of-business upload forms.
  const [recordScan, setRecordScan] = useState({
    ordinance: null, resolution: null, minutes: null, agenda: null,
  });
  const recordScanSeq = useRef({ ordinance: 0, resolution: 0, minutes: 0, agenda: 0 });
  const recordScanAuto = useRef({
    ordinance: { date: "" },
    resolution: { date: "" },
    minutes: {},
    agenda: {},
  });
  const latestRecordForm = useRef({});
  const [resolutionCategory, setResolutionCategory] = useState("");
  const [selectedResolutionOfficials, setSelectedResolutionOfficials] =
    useState([]);
  const [editingResolution, setEditingResolution] = useState(null);
  const [editResolutionNumber, setEditResolutionNumber] = useState("");
  const [editResolutionTitle, setEditResolutionTitle] = useState("");
  const [editResolutionDate, setEditResolutionDate] = useState("");
  const [editResolutionCategory, setEditResolutionCategory] = useState("");
  const [editResolutionSelectedOfficials, setEditResolutionSelectedOfficials] =
    useState([]);
  const [editResCoAuthors, setEditResCoAuthors] = useState([]);
  const [editResolutionFile, setEditResolutionFile] = useState(null);

  // officials — cached via React Query instead of useState/fetchX so
  // reopening the tab (or invalidating after a mutation) doesn't unmount
  // OfficialsPage the way the old fetchingX-gated pattern did (see the
  // announcements flicker fix for the same class of bug).
  const queryClient = useQueryClient();
  const { data: officials = [], isLoading: fetchingOfficials } = useQuery({
    queryKey: OFFICIALS_QUERY_KEY,
    queryFn: fetchOfficialsList,
  });
  // Old call sites just call fetchOfficials() to refresh after a mutation —
  // keeping the name means none of them need to change.
  const fetchOfficials = () =>
    queryClient.invalidateQueries({ queryKey: OFFICIALS_QUERY_KEY });

  // councils — the canonical list (see migrations/001), independent of
  // which members currently have terms in one. Needed so "Add Council" can
  // create a real, persisted row instead of a client-only placeholder that
  // vanished on refresh.
  const { data: councils = [] } = useQuery({
    queryKey: COUNCILS_QUERY_KEY,
    queryFn: fetchCouncilsList,
  });
  const handleAddCouncil = async (termLabel) => {
    try {
      const res = await authFetch(`${API}/api/councils`, {
        method: "POST",
        body: JSON.stringify({ term_label: termLabel }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        queryClient.invalidateQueries({ queryKey: COUNCILS_QUERY_KEY });
        return { success: true, data: data.data };
      }
      return { success: false, error: data.error || "Failed to add council." };
    } catch {
      return { success: false, error: "Server error." };
    }
  };
  const handleEditCouncil = async (id, termLabel) => {
    try {
      const res = await authFetch(`${API}/api/councils/${id}`, {
        method: "PUT",
        body: JSON.stringify({ term_label: termLabel }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        queryClient.invalidateQueries({ queryKey: COUNCILS_QUERY_KEY });
        return { success: true, data: data.data };
      }
      return {
        success: false,
        error: data.error || "Failed to update council.",
      };
    } catch {
      return { success: false, error: "Server error." };
    }
  };
  // Card drag in OfficialsPage (migrations/032). The new order is written
  // into the cached officials list right away so the cards move instantly,
  // then saved in the background once the user pauses — several quick drags
  // become one request, and nothing waits on the network.
  const reorderSaves = useRef({}); // councilId -> { timer, resolve }
  const handleReorderCouncil = (councilId, termIds) => {
    const rank = new Map(termIds.map((id, i) => [id, i + 1]));
    const place = (t) => (t && rank.has(t.id) ? { ...t, display_order: rank.get(t.id) } : t);
    queryClient.cancelQueries({ queryKey: OFFICIALS_QUERY_KEY });
    queryClient.setQueryData(OFFICIALS_QUERY_KEY, (old = []) =>
      old.map((m) => ({ ...m, terms: (m.terms || []).map(place), active_term: place(m.active_term) }))
    );

    // A newer drag in the same council replaces the pending save.
    const prev = reorderSaves.current[councilId];
    if (prev) {
      clearTimeout(prev.timer);
      prev.resolve({ success: true });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(async () => {
        let result;
        try {
          const res = await authFetch(`${API}/api/sb-council-members/reorder`, {
            method: "PUT",
            body: JSON.stringify({ council_id: councilId, term_ids: termIds }),
          });
          const data = await res.json();
          result = res.ok && data.success
            ? { success: true }
            : { success: false, error: data.error || "Failed to save the new order." };
        } catch {
          result = { success: false, error: "Server error. The new order was not saved." };
        }
        if (reorderSaves.current[councilId]?.timer === timer) {
          delete reorderSaves.current[councilId];
          // Re-sorts the author/sponsor pickers — or, on failure, puts the
          // cards back to the order that's actually saved.
          fetchOfficials();
        }
        resolve(result);
      }, 800);
      reorderSaves.current[councilId] = { timer, resolve };
    });
  };
  // Council deletion is blocked server-side (400, with an explanatory
  // message) while any member term still references it — surfaced as a
  // toast rather than silently failing, since the blocking ConfirmModal
  // below has already closed by the time this runs.
  const handleDeleteCouncil = async (id) => {
    try {
      const res = await authFetch(`${API}/api/councils/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        showSuccessModal("Council deleted!");
        queryClient.invalidateQueries({ queryKey: COUNCILS_QUERY_KEY });
      } else showMsg(data.error || "Error!", "error");
    } catch {
      showMsg("Error!", "error");
    }
  };
  const [newOfficial, setNewOfficial] = useState({
    full_name: "",
    position: "",
    term_period: "",
    term_start: "",
    term_end: "",
    is_reelected: false,
    notes: "",
  });
  const [officialPhoto, setOfficialPhoto] = useState(null);
  const [showSuggestMatches, setShowSuggestMatches] = useState(false);
  const [selectedOfficialProfile, setSelectedOfficialProfile] = useState(null);

  // ── "My Profile" — the logged-in user's own profile, opened by clicking
  // their own avatar in the sidebar. Separate from selectedOfficialProfile
  // above (which is Officials Management viewing/editing SOMEONE ELSE) so
  // self-service editing can never leak into that admin-only flow.
  // My Profile is a page (activeTab "profile"), not a modal any more.
  const showMyProfile = activeTab === "profile";
  const [myProfileTab, setMyProfileTab] = useState("account");
  const [myProfileName, setMyProfileName] = useState("");
  // Email address the last "Email Me a Reset Link" went to, shown under the
  // button so the user knows where to look.
  const [myResetLinkSentTo, setMyResetLinkSentTo] = useState("");
  const [myProfileSubmitting, setMyProfileSubmitting] = useState(false);

  // ── edit official states ──
  const [editingOfficial, setEditingOfficial] = useState(null);
  const [editOfficialName, setEditOfficialName] = useState("");
  const [editOfficialPhoto, setEditOfficialPhoto] = useState(null);

  const emptyTermForm = {
    position: "",
    term_period: "",
    term_start: "",
    term_end: "",
    status: "active",
    is_reelected: false,
    notes: "",
  };
  const [termForm, setTermForm] = useState(emptyTermForm);

  // sessions
  const [sessionMinutes, setSessionMinutes] = useState([]);
  const [sessionForm, setSessionForm] = useState({
    session_number: "",
    session_date: "",
    session_type: "regular",
    venue: SESSION_VENUE,
    agenda: "",
    minutes_text: "",
  });
  const [sessionFile, setSessionFile] = useState(null);
  const [editingSession, setEditingSession] = useState(null);
  // A file picked in the Edit Session form — attaches the original document to
  // the record (or replaces its current one).
  const [editSessionFile, setEditSessionFile] = useState(null);
  const [editSessionForm, setEditSessionForm] = useState({
    session_number: "",
    session_date: "",
    session_type: "regular",
    venue: "",
    agenda: "",
    minutes_text: "",
  });

  // session agendas — no draft/review workflow (see routes/sessionAgendas.js):
  // Secretary/Clerk upload a PDF/Word file and it's immediately live.
  const [sessionAgendas, setSessionAgendas] = useState([]);
  const [agendaForm, setAgendaForm] = useState({
    session_number: "",
    session_date: "",
    session_type: "regular",
    venue: SESSION_VENUE,
  });
  const [agendaFile, setAgendaFile] = useState(null);
  const [editingAgenda, setEditingAgenda] = useState(null);
  const [editAgendaForm, setEditAgendaForm] = useState({
    session_number: "",
    session_date: "",
    session_type: "regular",
    venue: "",
  });
  const [editAgendaFile, setEditAgendaFile] = useState(null);

  // announcements
  const [announcements, setAnnouncements] = useState([]);
  const [unreadAnnouncements, setUnreadAnnouncements] = useState(0);
  const [totalActiveUsers, setTotalActiveUsers] = useState(0);
  const [editingAnnouncement, setEditingAnnouncement] = useState(null);
  const [announcementForm, setAnnouncementForm] = useState({
    title: "",
    body: "",
    priority: "normal",
    pinned: false,
  });
  const [editAnnouncementForm, setEditAnnouncementForm] = useState({
    title: "",
    body: "",
    priority: "normal",
    pinned: false,
  });

  // calendar
  const [localEvents, setLocalEvents] = useState([]);
  const [editingEvent, setEditingEvent] = useState(null);
  const [savingLocalEvent, setSavingLocalEvent] = useState(false);

  const emptyEventForm = {
    title: "",
    description: "",
    location: "",
    start_date: "",
    start_time: "08:00",
    end_date: "",
    end_time: "09:00",
    all_day: false,
    color: "#090446",
  };
  const [localEventForm, setLocalEventForm] = useState(emptyEventForm);
  const [editEventForm, setEditEventForm] = useState(emptyEventForm);

  // ─── Init ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    const token = localStorage.getItem("token");
    // Every redirect below must clear localStorage first — GuestRoute (App.jsx)
    // sends a logged-in user straight back to /dashboard, so replacing "/"
    // while a stale "user" is still stored bounces right back here and loops
    // forever (ping-ponging the address bar between / and /dashboard).
    if (!storedUser || !token) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.replace("/");
      return;
    }
    let u;
    try {
      u = JSON.parse(storedUser);
    } catch {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.replace("/");
      return;
    }
    if (u.role !== "admin" && u.role !== "user") {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.replace("/");
      return;
    }
    setAdmin(u);

    if (u.role === "admin") fetchUsers();
    fetchOrdinances();
    // officials load via the useQuery above — no manual kickoff needed here
    fetchSessionMinutes();
    fetchSessionAgendas();
    fetchResolutions();
    fetchAnnouncements();
    fetchUnreadAnnouncements();
    fetchActiveStaffCount();
    // The dashboard's "Upcoming events" widget needs these before the
    // Calendar tab is ever opened.
    fetchLocalEvents();
  }, []);

  useEffect(() => {
    if (activeTab === "calendar") {
      fetchLocalEvents();
      // PH holidays now load inside CalendarPage.jsx itself — no manual
      // kickoff needed here.
    }
    if (activeTab === "logs") {
      fetchLogs();
      fetchLogStats();
    }
    // Keyed on the tab only — the fetchers are redefined every render, so
    // listing them would re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "logs") fetchLogs();
    // Only the filters should trigger a refetch; switching to the tab is
    // already handled by the effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logModuleFilter, logActionFilter]);

  // ─── Helpers ──────────────────────────────────────────────────────────────────
  const showModalMsg = (msg, type = "success") => {
    setModalMessage(msg);
    setModalMessageType(type);
    setTimeout(() => setModalMessage(""), 5000);
  };
  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.replace("/");
  };
  const handleTabChange = (key, subTab = null) => {
    if (!isAdmin && ADMIN_ONLY_TABS.includes(key)) return;
    setActiveTab(key);
    setSubTabRequest(subTab);
    setMobileOpen(false);
    if (key === "announcements") markAnnouncementsSeen();
  };

  // ─── Guided tour ──────────────────────────────────────────────────────────────
  // Opens everything the tour points at (the Dashboard page, whose banner
  // holds the "?" button; both sidebar dropdowns; and the slide-in sidebar
  // on mobile) first; the effect below starts the tour once that has
  // rendered.
  const startTour = () => {
    if (touring) return;
    handleTabChange("dashboard");
    setTouring(true);
    setLegislativeOpen(true);
    setUserMgmtOpen(true);
    if (window.matchMedia("(max-width: 768px)").matches) setMobileOpen(true);
  };
  const markTourCompleted = async () => {
    try {
      const stored = JSON.parse(localStorage.getItem("user") || "null");
      if (stored) localStorage.setItem("user", JSON.stringify({ ...stored, tourCompleted: true }));
    } catch {
      // A corrupt stored user is handled by the init effect on next load.
    }
    setAdmin((prev) => (prev ? { ...prev, tourCompleted: true } : prev));
    try {
      await authFetch(`${API}/api/users/me/tour-completed`, { method: "PUT" });
    } catch {
      // Not worth interrupting anyone over — worst case the tour just
      // starts again on their next login.
    }
  };
  const endTour = () => {
    setTouring(false);
    setLegislativeOpen(false);
    setUserMgmtOpen(false);
    setMobileOpen(false);
    markTourCompleted();
  };
  useEffect(() => {
    if (!touring) return;
    // Waits out the sidebar's expand transition (0.3s) so every step
    // measures its element at its final position.
    const timer = setTimeout(() => {
      startProductTour({
        name: admin?.name,
        position: admin?.position,
        onDone: endTour,
      });
    }, 400);
    return () => clearTimeout(timer);
    // Only the tour starting should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touring]);
  // First visit: start the tour automatically. Strictly `false` — a session
  // stored before tourCompleted existed has no value at all, and shouldn't
  // have the tour spring up mid-session.
  useEffect(() => {
    if (admin?.tourCompleted === false) startTour();
    // Once per account load, not on every profile edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin?.id]);

  // Only laptops/PCs with a real mouse get hover-to-expand; touch devices keep manual toggle.
  const canHoverSidebar = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const handleSidebarMouseEnter = () => {
    if (canHoverSidebar()) setSidebarCollapsed(false);
  };
  const handleSidebarMouseLeave = () => {
    if (canHoverSidebar()) setSidebarCollapsed(true);
  };

  // ─── Fetches ──────────────────────────────────────────────────────────────────
  const fetchUsers = async ({ silent = false } = {}) => {
    if (!silent) setFetchingUsers(true);
    try {
      const res = await authFetch(`${API}/api/users`);
      // 401 (expired/invalid session) is now handled globally by authFetch
      // itself — this only needs to guard against a genuine 403 (a real,
      // still-logged-in non-admin account somehow calling an admin-only
      // route), which authFetch correctly leaves alone.
      if (res.status === 403) return;
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      // A failed background refresh keeps the list already on screen.
      if (!silent) setUsers([]);
    } finally {
      if (!silent) setFetchingUsers(false);
    }
  };
  const fetchOrdinances = async ({ silent = false } = {}) => {
    if (!silent) setFetchingOrdinances(true);
    try {
      const d = await (await authFetch(`${API}/api/ordinances?status=all`)).json();
      setOrdinances(Array.isArray(d) ? d : []);
    } catch {
      // A failed background refresh keeps the list already on screen.
      if (!silent) setOrdinances([]);
    } finally {
      if (!silent) setFetchingOrdinances(false);
    }
  };
  const fetchResolutions = async ({ silent = false } = {}) => {
    if (!silent) setFetchingResolutions(true);
    try {
      const d = await (await authFetch(`${API}/api/resolutions?status=all`)).json();
      setResolutions(Array.isArray(d) ? d : []);
    } catch {
      // A failed background refresh keeps the list already on screen.
      if (!silent) setResolutions([]);
    } finally {
      if (!silent) setFetchingResolutions(false);
    }
  };
  const fetchSessionMinutes = async ({ silent = false } = {}) => {
    if (!silent) setFetchingMinutes(true);
    try {
      const d = await (await authFetch(`${API}/api/session-minutes?status=all`)).json();
      setSessionMinutes(Array.isArray(d) ? d : []);
    } catch {
      // A failed background refresh keeps the list already on screen.
      if (!silent) setSessionMinutes([]);
    } finally {
      if (!silent) setFetchingMinutes(false);
    }
  };
  const fetchSessionAgendas = async ({ silent = false } = {}) => {
    if (!silent) setFetchingAgendas(true);
    try {
      const d = await (await authFetch(`${API}/api/session-agendas`)).json();
      setSessionAgendas(Array.isArray(d) ? d : []);
    } catch {
      // A failed background refresh keeps the list already on screen.
      if (!silent) setSessionAgendas([]);
    } finally {
      if (!silent) setFetchingAgendas(false);
    }
  };
  // `silent` skips the fetchingAnnouncements toggle — used for background
  // refreshes (after marking read, after posting/editing) so the tab doesn't
  // unmount/remount and flash every time it's reopened. Only the true first
  // load on mount shows the loading state.
  const fetchAnnouncements = async ({ silent = false } = {}) => {
    if (!silent) setFetchingAnnouncements(true);
    try {
      // GET /api/announcements now embeds per-reader names — it's
      // auth-gated, so this must be authFetch, not a plain fetch.
      const d = await (await authFetch(`${API}/api/announcements`)).json();
      setAnnouncements(Array.isArray(d) ? d : []);
    } catch {
      // A failed background refresh keeps the list already on screen.
      if (!silent) setAnnouncements([]);
    } finally {
      if (!silent) setFetchingAnnouncements(false);
    }
  };
  const fetchUnreadAnnouncements = async () => {
    try {
      const d = await (await authFetch(`${API}/api/announcements/unread-count`)).json();
      setUnreadAnnouncements(typeof d.count === "number" ? d.count : 0);
    } catch {
      // Non-critical — leave whatever count was already showing.
    }
  };
  const fetchActiveStaffCount = async () => {
    try {
      const d = await (await authFetch(`${API}/api/announcements/active-staff-count`)).json();
      setTotalActiveUsers(typeof d.count === "number" ? d.count : 0);
    } catch {
      // Non-critical — "seen by" denominators just won't render.
    }
  };
  // Called when the Announcements tab is opened, and after posting/editing
  // an announcement (so your own new/updated post doesn't inflate your own
  // badge — you obviously just saw it). Also records a real per-post read
  // receipt (announcement_reads), not just a personal last-seen timestamp.
  const markAnnouncementsSeen = async () => {
    try {
      await authFetch(`${API}/api/announcements/mark-all-read`, { method: "POST" });
      setUnreadAnnouncements(0);
    } catch {
      // Non-critical — badge just won't clear until the next successful call.
    } finally {
      // Refetch regardless of whether marking-read succeeded — callers rely
      // on this to pick up a just-posted/edited announcement, so a flaky
      // mark-all-read call must not also skip refreshing the list.
      fetchAnnouncements({ silent: true });
    }
  };
  // Silent re-pull of everything the dashboard shows, so records added by
  // this user or anyone else appear without a page reload. Runs on a timer,
  // on tab focus, and after every save (see useAutoRefresh).
  const refreshAllData = () => {
    const jobs = [
      fetchOrdinances({ silent: true }),
      fetchResolutions({ silent: true }),
      fetchSessionMinutes({ silent: true }),
      fetchSessionAgendas({ silent: true }),
      fetchAnnouncements({ silent: true }),
      fetchUnreadAnnouncements(),
      fetchActiveStaffCount(),
      fetchLocalEvents({ silent: true }),
      // Re-fetches every React Query list currently on screen (officials,
      // councils, pending / ready-to-publish / published records, …). The
      // holidays list is fixed for the year, so it's left alone.
      queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] !== "holidays",
      }),
    ];
    if (admin?.role === "admin") jobs.push(fetchUsers({ silent: true }));
    if (activeTab === "logs") jobs.push(fetchLogs({ silent: true }), fetchLogStats());
    return Promise.allSettled(jobs);
  };
  useAutoRefresh(refreshAllData, !!admin);
  const fetchLocalEvents = async ({ silent = false } = {}) => {
    try {
      const d = await (await authFetch(`${API}/api/calendar-events`)).json();
      setLocalEvents(Array.isArray(d) ? d : []);
    } catch {
      // A failed background refresh keeps the list already on screen.
      if (!silent) setLocalEvents([]);
    }
  };
  const fetchLogs = async ({ silent = false } = {}) => {
    if (!silent) setFetchingLogs(true);
    try {
      let url = `${API}/api/activity-logs?limit=100`;
      if (logModuleFilter !== "all") url += `&module=${logModuleFilter}`;
      if (logActionFilter !== "all") url += `&action=${logActionFilter}`;
      const d = await (await authFetch(url)).json();
      setLogs(Array.isArray(d) ? d : []);
    } catch {
      // A failed background refresh keeps the list already on screen.
      if (!silent) setLogs([]);
    } finally {
      if (!silent) setFetchingLogs(false);
    }
  };
  const fetchLogStats = async () => {
    try {
      const d = await (
        await authFetch(`${API}/api/activity-logs/stats`)
      ).json();
      setLogStats(d);
    } catch {
      // Non-critical — the stats cards just keep showing whatever they last had.
    }
  };
  // ─── Users / Admins ───────────────────────────────────────────────────────────
  const handleAddAdmin = async () => {
    const missing = missingFieldsMsg([
      [newAdmin.name, "Name"],
      [newAdmin.username, "Username"],
      [newAdmin.email, "Email"],
      [newAdmin.password, "Password"],
    ]);
    if (missing) {
      showModalMsg(missing, "error");
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    fd.append("name", newAdmin.name);
    fd.append("username", newAdmin.username);
    fd.append("email", newAdmin.email);
    fd.append("password", newAdmin.password);
    fd.append("position", newAdmin.position || "secretary");
    if (newAdminPhoto) fd.append("photo", newAdminPhoto);
    try {
      const res = await authFetch(`${API}/api/admin/add`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccessModal("Admin added!");
        setNewAdmin({ name: "", username: "", email: "", password: "", position: "secretary" });
        setNewAdminPhoto(null);
        setShowAddAdminModal(false);
        notifyDataChanged();
      } else showModalMsg(extractErrorMsg(data, "Failed!"), "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setSubmitting(false);
    }
  };
  const handleAddUser = async () => {
    const missing = missingFieldsMsg([
      [newUser.name, "Name"],
      [newUser.username, "Username"],
      [newUser.email, "Email"],
      [newUser.password, "Password"],
    ]);
    if (missing) {
      showModalMsg(missing, "error");
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    fd.append("name", newUser.name);
    fd.append("username", newUser.username);
    fd.append("email", newUser.email);
    fd.append("password", newUser.password);
    fd.append("position", newUser.position || "councilor");
    if (newUserPhoto) fd.append("photo", newUserPhoto);
    try {
      // Admin-gated creation goes through POST /api/users (verifyToken +
      // adminOnly) now, not the public self-registration endpoint
      // (/api/register) — that endpoint has no auth at all, so this button
      // used to have no real server-side protection beyond the UI hiding it.
      const res = await authFetch(`${API}/api/users`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccessModal(
          ["councilor", "vice_mayor", "liga_ng_mga_barangay", "sk_federated"].includes(newUser.position || "councilor")
            ? accountLinkMessage(data, "User added!")
            : "User added!"
        );
        setNewUser({ name: "", username: "", email: "", password: "", position: "councilor" });
        setNewUserPhoto(null);
        setShowAddUserModal(false);
        notifyDataChanged();
      } else showModalMsg(extractErrorMsg(data, "Failed!"), "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setSubmitting(false);
    }
  };
  const handleOpenEditUser = (u) => {
    setEditingUser(u);
    setEditUserForm({
      name: u.name || "",
      username: u.username || "",
      email: u.email || "",
      position: u.position || (u.role === "admin" ? "secretary" : "councilor"),
    });
    setEditUserPhoto(null);
    setModalMessage("");
    setShowEditUserModal(true);
  };
  const handleUpdateUser = async () => {
    if (!editUserForm.name || !editUserForm.username || !editUserForm.email) {
      showModalMsg("Name, username, and email are required!", "error");
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    fd.append("name", editUserForm.name);
    fd.append("username", editUserForm.username);
    fd.append("email", editUserForm.email);
    fd.append("role", editingUser.role);
    fd.append("position", editUserForm.position);
    if (editUserPhoto) fd.append("photo", editUserPhoto);
    try {
      const res = await authFetch(`${API}/api/users/${editingUser.id}`, {
        method: "PUT",
        body: fd,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccessModal(`${editingUser.role === "admin" ? "Admin" : "User"} updated!`);
        setShowEditUserModal(false);
        setEditingUser(null);
        notifyDataChanged();
      } else showModalMsg(extractErrorMsg(data, "Update failed!"), "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setSubmitting(false);
    }
  };
  const handleDeleteUser = async (id) => {
    try {
      const res = await authFetch(`${API}/api/users/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        showSuccessModal("User archived!");
        notifyDataChanged();
      } else showMsg(data.error || "Error!", "error");
    } catch {
      showMsg("Error!", "error");
    }
  };

  const handleResetPassword = async (user) => {
    setSubmitting(true);
    try {
      const res = await authFetch(`${API}/api/users/${user.id}/reset-password`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) showSuccessModal(`Password reset link sent to ${user.email}.`);
      else showMsg(data.error || "Failed to reset password.", "error");
    } catch {
      showMsg("Server error.", "error");
    } finally {
      setSubmitting(false);
      setResetPasswordTarget(null);
    }
  };

  // ─── Detect the date from the chosen file ────────────────────────────────────
  // Asks the backend to read the file (text layer, Word, or OCR for scans) and
  // suggest the record's date, then prefills that form field. Suggestion only:
  // it fills the date just when it's still the default of today (or the last
  // thing this detection filled in itself) — so it never overwrites something
  // the user typed, and nothing is saved until they submit the form.
  useEffect(() => {
    latestRecordForm.current = { ordinanceDate, resolutionDate, sessionForm, agendaForm };
  });
  const RECORD_SCAN = {
    ordinance: { route: "ordinances", setDate: setOrdinanceDate },
    resolution: { route: "resolutions", setDate: setResolutionDate },
  };
  const clearRecordScan = (kind) => {
    recordScanSeq.current[kind]++;
    recordScanAuto.current[kind] = kind === "minutes" || kind === "agenda" ? {} : { date: "" };
    setRecordScan((s) => ({ ...s, [kind]: null }));
  };
  // Session minutes / order of business: reads the chosen file for the
  // session's title (number, e.g. "2nd Regular Session, 2026"), date, type and
  // venue, and prefills the form. Same rule as above — a field is only filled
  // while it's still untouched (empty, the auto-suggested number, or what an
  // earlier detection put there), and nothing is saved until the form is.
  const detectSessionMeta = async (target, file) => {
    const route = target === "minutes" ? "session-minutes" : "session-agendas";
    const setForm = target === "minutes" ? setSessionForm : setAgendaForm;
    const seq = ++recordScanSeq.current[target];
    const isCurrent = () => recordScanSeq.current[target] === seq;
    const show = (value) => {
      if (isCurrent()) setRecordScan((s) => ({ ...s, [target]: value }));
    };

    if (!file) {
      show(null);
      return;
    }
    show({ status: "reading" });
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await authFetch(`${API}/api/${route}/extract-meta`, { method: "POST", body: fd });
      const data = await res.json();
      if (!isCurrent()) return;
      if (!res.ok || !data.success) {
        show({ status: "error", message: data.error });
        return;
      }

      const found = data.data;
      const form = (target === "minutes" ? latestRecordForm.current.sessionForm : latestRecordForm.current.agendaForm) || {};
      const auto = recordScanAuto.current[target];
      const suggestion = target === "minutes" ? lastSessionSuggestion.current : "";
      const applied = {
        number:
          Boolean(found.number) &&
          (!(form.session_number || "").trim() || form.session_number === suggestion || form.session_number === auto.number),
        date: Boolean(found.date) && (!form.session_date || form.session_date === auto.date),
        type: Boolean(found.sessionType) && (form.session_type === "regular" || form.session_type === auto.type),
      };
      setForm((prev) => {
        const next = { ...prev };
        if (applied.date) next.session_date = found.date;
        if (applied.type) next.session_type = found.sessionType;
        if (applied.number) {
          next.session_number = found.number;
        } else if (applied.type && target === "minutes" && prev.session_number === lastSessionSuggestion.current) {
          // Still the auto-suggested number, but the type just changed —
          // re-suggest for the new type, like picking the type by hand does.
          const year = next.session_date ? new Date(next.session_date).getFullYear() : getCurrentYear();
          const suggested = suggestSessionNumber(sessionMinutes, year, next.session_type);
          lastSessionSuggestion.current = suggested;
          next.session_number = suggested;
        }
        return next;
      });
      recordScanAuto.current[target] = {
        number: applied.number ? found.number : auto.number,
        date: applied.date ? found.date : auto.date,
        type: applied.type ? found.sessionType : auto.type,
      };
      show({ status: "done", data: found, applied });
    } catch {
      show({ status: "error", message: "Couldn't read this file automatically." });
    }
  };
  const detectRecordMeta = async (kind, file) => {
    const { route, setDate } = RECORD_SCAN[kind];
    // A newer file choice (or closing the form) invalidates this request.
    const seq = ++recordScanSeq.current[kind];
    const isCurrent = () => recordScanSeq.current[kind] === seq;
    const show = (value) => {
      if (isCurrent()) setRecordScan((s) => ({ ...s, [kind]: value }));
    };

    if (!file) {
      show(null);
      return;
    }
    show({ status: "reading" });
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await authFetch(`${API}/api/${route}/extract-meta`, { method: "POST", body: fd });
      const data = await res.json();
      if (!isCurrent()) return;
      if (!res.ok || !data.success) {
        show({ status: "error", message: data.error });
        return;
      }

      const found = data.data;
      const form = latestRecordForm.current;
      const currentDate = (kind === "ordinance" ? form.ordinanceDate : form.resolutionDate) || "";
      const auto = recordScanAuto.current[kind];
      const applied = {
        date:
          Boolean(found.date) &&
          (!currentDate || currentDate === toIsoDate(new Date()) || currentDate === auto.date),
      };
      if (applied.date) setDate(found.date);
      recordScanAuto.current[kind] = { date: applied.date ? found.date : auto.date };
      show({ status: "done", data: found, applied });
    } catch {
      show({ status: "error", message: "Couldn't read this file automatically." });
    }
  };

  // ─── Ordinances ──────────────────────────────────────────────────────────────
  const handleUploadOrdinance = async () => {
    const missing = missingFieldsMsg([
      [ordinanceTitle, "Title"],
      [ordinanceDate, "Date"],
      [ordinanceFile, "File"],
      [ordinanceCategory, "Sector"],
      [selectedOfficials.length > 0, "Author"],
    ]);
    if (missing) {
      showModalMsg(missing, "error");
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    fd.append("title", ordinanceTitle);
    fd.append("date", ordinanceDate);
    fd.append("year", ordinanceDate.split("-")[0]);
    fd.append("category", ordinanceCategory);
    fd.append("file", ordinanceFile);
    fd.append("officials", JSON.stringify(selectedOfficials));
    try {
      const res = await authFetch(`${API}/api/ordinances/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccessModal("Ordinance uploaded!");
        if (uploadType === "image-to-text" && data.text) {
          setExtractedText(data.text);
          setShowTextModal(true);
        }
        setOrdinanceTitle("");
        setOrdinanceDate("");
        clearRecordScan("ordinance");
        setOrdinanceFile(null);
        setOrdinanceCategory("");
        setSelectedOfficials([]);
        setUploadType("");
        setShowOrdinanceModal(false);
        notifyDataChanged();
      } else showModalMsg(data.error || "Upload failed!", "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setSubmitting(false);
    }
  };
  const handleOpenEditOrdinance = (o) => {
    setEditingOrdinance(o);
    setEditOrdinanceNumber(o.ordinance_number || "");
    setEditOrdinanceTitle(o.title);
    // The date is the record's APPROVED date once it has one (not the upload
    // date); a record not yet approved falls back to its year.
    setEditOrdinanceDate(
      o.approved_on ? toIsoDate(new Date(o.approved_on)) : o.date || (o.year ? `${o.year}-01-01` : "")
    );
    setEditOrdinanceCategory(o.category || "");
    setEditSelectedOfficials(o.officials ? o.officials.map((x) => x.id) : []);
    setEditCoAuthors((o.co_authors || []).map((x) => x.id));
    setEditSponsors((o.sponsors || []).map((x) => x.id));
    setEditOrdinanceFile(null);
    setModalMessage("");
    setShowEditOrdinanceModal(true);
  };
  // Only one author per ordinance — selecting a different member replaces
  // the current pick instead of adding to it.
  const toggleEditOfficial = (id) =>
    setEditSelectedOfficials((p) => (p.includes(id) ? [] : [id]));
  // Co-Authors and Sponsors, unlike the Author, can be several people.
  const toggleEditCoAuthor = (id) =>
    setEditCoAuthors((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const toggleEditSponsor = (id) =>
    setEditSponsors((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const handleUpdateOrdinance = async () => {
    const missing = missingFieldsMsg([
      [editOrdinanceTitle, "Title"],
      [editOrdinanceDate, "Date"],
      [editOrdinanceCategory, "Sector"],
      [editSelectedOfficials.length > 0, "Author"],
    ]);
    if (missing) {
      showModalMsg(missing, "error");
      return;
    }
    if (
      isDuplicateRecordNumber(
        ordinances,
        "ordinance_number",
        editOrdinanceNumber,
        editingOrdinance.id
      )
    ) {
      showModalMsg(
        `"${editOrdinanceNumber}" is already in use by another ordinance. Please choose a different number.`,
        "error"
      );
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    fd.append("ordinance_number", editOrdinanceNumber);
    fd.append("title", editOrdinanceTitle);
    fd.append("date", editOrdinanceDate);
    fd.append("year", editOrdinanceDate.split("-")[0]);
    fd.append("category", editOrdinanceCategory);
    fd.append("officials", JSON.stringify(editSelectedOfficials));
    fd.append("co_authors", JSON.stringify(editCoAuthors));
    fd.append("sponsors", JSON.stringify(editSponsors));
    if (editingOrdinance.approved_on) fd.append("approved_on", editOrdinanceDate);
    if (editOrdinanceFile) fd.append("file", editOrdinanceFile);
    try {
      const res = await authFetch(
        `${API}/api/ordinances/${editingOrdinance.id}`,
        { method: "PUT", body: fd }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccessModal("Ordinance updated!");
        setShowEditOrdinanceModal(false);
        setEditingOrdinance(null);
        notifyDataChanged();
      } else showModalMsg(data.error || "Update failed!", "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setSubmitting(false);
    }
  };
  const handleDeleteOrdinance = async (id) => {
    try {
      const res = await authFetch(`${API}/api/ordinances/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        showSuccessModal("Archived!");
        notifyDataChanged();
      } else showMsg(data.error || "Error!", "error");
    } catch {
      showMsg("Error!", "error");
    }
  };
  // Only one author per ordinance — selecting a different member replaces
  // the current pick instead of adding to it.
  const toggleOfficial = (id) =>
    setSelectedOfficials((p) => (p.includes(id) ? [] : [id]));

  // ─── Resolutions ─────────────────────────────────────────────────────────────
  const handleUploadResolution = async () => {
    const missing = missingFieldsMsg([
      [resolutionTitle, "Title"],
      [resolutionDate, "Date"],
      [resolutionFile, "File"],
      [resolutionCategory, "Sector"],
      [selectedResolutionOfficials.length > 0, "Sponsor"],
    ]);
    if (missing) {
      showModalMsg(missing, "error");
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    fd.append("title", resolutionTitle);
    fd.append("date", resolutionDate);
    fd.append("year", resolutionDate.split("-")[0]);
    fd.append("category", resolutionCategory);
    fd.append("file", resolutionFile);
    fd.append("officials", JSON.stringify(selectedResolutionOfficials));
    try {
      const res = await authFetch(`${API}/api/resolutions/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccessModal("Resolution uploaded!");
        setResolutionTitle("");
        setResolutionDate("");
        clearRecordScan("resolution");
        setResolutionFile(null);
        setResolutionCategory("");
        setSelectedResolutionOfficials([]);
        setShowResolutionModal(false);
        notifyDataChanged();
      } else showModalMsg(data.error || "Upload failed!", "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setSubmitting(false);
    }
  };
  const handleOpenEditResolution = (r) => {
    setEditingResolution(r);
    setEditResolutionNumber(r.resolution_number || "");
    setEditResolutionTitle(r.title);
    // The date is the record's APPROVED date once it has one (not the upload
    // date); a record not yet approved falls back to its year.
    setEditResolutionDate(
      r.approved_on ? toIsoDate(new Date(r.approved_on)) : r.date || (r.year ? `${r.year}-01-01` : "")
    );
    setEditResolutionCategory(r.category || "");
    setEditResolutionSelectedOfficials(
      r.officials ? r.officials.map((x) => x.id) : []
    );
    setEditResCoAuthors((r.co_authors || []).map((x) => x.id));
    setEditResolutionFile(null);
    setModalMessage("");
    setShowEditResolutionModal(true);
  };
  // Only one author per resolution — selecting a different member replaces
  // the current pick instead of adding to it.
  const toggleEditResolutionOfficial = (id) =>
    setEditResolutionSelectedOfficials((p) => (p.includes(id) ? [] : [id]));
  // Co-Sponsors, unlike the Sponsor, can be several people.
  const toggleEditResCoAuthor = (id) =>
    setEditResCoAuthors((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const handleUpdateResolution = async () => {
    const missing = missingFieldsMsg([
      [editResolutionTitle, "Title"],
      [editResolutionDate, "Date"],
      [editResolutionCategory, "Sector"],
      [editResolutionSelectedOfficials.length > 0, "Sponsor"],
    ]);
    if (missing) {
      showModalMsg(missing, "error");
      return;
    }
    if (
      isDuplicateRecordNumber(
        resolutions,
        "resolution_number",
        editResolutionNumber,
        editingResolution.id
      )
    ) {
      showModalMsg(
        `"${editResolutionNumber}" is already in use by another resolution. Please choose a different number.`,
        "error"
      );
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    fd.append("resolution_number", editResolutionNumber);
    fd.append("title", editResolutionTitle);
    fd.append("date", editResolutionDate);
    fd.append("year", editResolutionDate.split("-")[0]);
    fd.append("category", editResolutionCategory);
    fd.append("officials", JSON.stringify(editResolutionSelectedOfficials));
    fd.append("co_authors", JSON.stringify(editResCoAuthors));
    if (editingResolution.approved_on) fd.append("approved_on", editResolutionDate);
    if (editResolutionFile) fd.append("file", editResolutionFile);
    try {
      const res = await authFetch(
        `${API}/api/resolutions/${editingResolution.id}`,
        { method: "PUT", body: fd }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccessModal("Resolution updated!");
        setShowEditResolutionModal(false);
        setEditingResolution(null);
        notifyDataChanged();
      } else showModalMsg(data.error || "Update failed!", "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setSubmitting(false);
    }
  };
  const handleDeleteResolution = async (id) => {
    try {
      const res = await authFetch(`${API}/api/resolutions/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        showSuccessModal("Resolution archived!");
        notifyDataChanged();
      } else showMsg(data.error || "Error!", "error");
    } catch {
      showMsg("Error!", "error");
    }
  };
  // Only one author per resolution — selecting a different member replaces
  // the current pick instead of adding to it.
  const toggleResolutionOfficial = (id) =>
    setSelectedResolutionOfficials((p) => (p.includes(id) ? [] : [id]));

  // ─── Officials ────────────────────────────────────────────────────────────────
  const handleAddOfficial = async () => {
    // Every field is required except Photo, End Date (blank means still
    // serving), and Notes (free supplementary text).
    const missing = missingFieldsMsg([
      [newOfficial.full_name, "Full name"],
      [newOfficial.position, "Position"],
      [newOfficial.term_period, "Term period"],
      [newOfficial.term_start, "Start date"],
    ]);
    if (missing) {
      showModalMsg(missing, "error");
      return;
    }
    const accountError = accountFieldsError(newOfficial);
    if (accountError) {
      showModalMsg(accountError, "error");
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    fd.append("full_name", newOfficial.full_name);
    appendAccountFields(fd, newOfficial);
    if (newOfficial.term_period)
      fd.append("term_period", newOfficial.term_period);
    if (newOfficial.term_start) fd.append("term_start", newOfficial.term_start);
    if (newOfficial.term_end) fd.append("term_end", newOfficial.term_end);
    if (newOfficial.position) fd.append("position", newOfficial.position);
    fd.append("is_reelected", newOfficial.is_reelected);
    if (newOfficial.notes) fd.append("notes", newOfficial.notes);
    if (officialPhoto) fd.append("photo", officialPhoto);
    try {
      const res = await authFetch(`${API}/api/sb-council-members/add`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccessModal(accountLinkMessage(data, "Council member added!"));
        setNewOfficial({
          full_name: "",
          position: "",
          term_period: "",
          term_start: "",
          term_end: "",
          is_reelected: false,
          notes: "",
        });
        setOfficialPhoto(null);
        setShowOfficialModal(false);
        fetchOfficials();
      } else showModalMsg(data.error || "Failed!", "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Edit Official ──
  const handleOpenEditOfficial = (o) => {
    setEditingOfficial(o);
    setEditOfficialName(o.full_name || "");
    setEditOfficialPhoto(null);
    setModalMessage("");
    setShowEditOfficialModal(true);
  };

  const handleUpdateOfficial = async () => {
    if (!editOfficialName) {
      showModalMsg("Full name is required!", "error");
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    fd.append("full_name", editOfficialName);
    if (editOfficialPhoto) fd.append("photo", editOfficialPhoto);
    try {
      const res = await authFetch(
        `${API}/api/sb-council-members/${editingOfficial.id}`,
        { method: "PUT", body: fd }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccessModal("Council member updated!");
        setShowEditOfficialModal(false);
        setEditingOfficial(null);
        fetchOfficials();
      } else showModalMsg(data.error || "Update failed!", "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteOfficial = async (id) => {
    try {
      const res = await authFetch(`${API}/api/sb-council-members/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        showSuccessModal("Council member archived!");
        fetchOfficials();
      } else showMsg(data.error || "Error!", "error");
    } catch {
      showMsg("Error!", "error");
    }
  };
  const getOfficialOrdinances = (id) =>
    ordinances.filter(
      (o) => o.officials && o.officials.some((x) => x.id === id)
    );
  const getOfficialResolutions = (id) =>
    resolutions.filter(
      (r) => r.officials && r.officials.some((x) => x.id === id)
    );
  // Rejected records, scoped to the tagged author (an actual council
  // member, via ordinance_officials/resolution_officials) rather than
  // created_by (whichever staff account did the data entry) — Secretary-
  // only in the UI below, since a rejected record's existence shouldn't be
  // visible to every Councilor Management viewer, only whoever also has
  // full rejected-records visibility elsewhere in the app.
  // ─── Terms ────────────────────────────────────────────────────────────────────
  const handleOpenAddTerm = (memberId) => {
    setTermTarget({ memberId });
    setTermForm(emptyTermForm);
    setModalMessage("");
    setShowAddTermModal(true);
  };
  const handleSaveTerm = async () => {
    if (!termForm.term_period || !termForm.term_start) {
      showModalMsg("Term period and start date are required!", "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch(
        `${API}/api/sb-council-members/${termTarget.memberId}/terms`,
        { method: "POST", body: JSON.stringify(termForm) }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccessModal("Term added!");
        setShowAddTermModal(false);
        fetchOfficials();
        if (selectedOfficialProfile?.id === termTarget.memberId) {
          const updated = await (
            await fetch(`${API}/api/sb-council-members/${termTarget.memberId}`)
          ).json();
          setSelectedOfficialProfile(updated);
        }
      } else showModalMsg(data.error || "Failed!", "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setSubmitting(false);
    }
  };
  const handleOpenEditTerm = (memberId, term) => {
    setTermTarget({ memberId, term });
    setTermForm({
      position: term.position || "",
      term_period: term.term_period || "",
      term_start: term.term_start ? term.term_start.split("T")[0] : "",
      term_end: term.term_end ? term.term_end.split("T")[0] : "",
      status: term.status || "active",
      is_reelected: !!term.is_reelected,
      notes: term.notes || "",
    });
    setModalMessage("");
    setShowEditTermModal(true);
  };
  const handleUpdateTerm = async () => {
    if (!termForm.term_period || !termForm.term_start) {
      showModalMsg("Term period and start date are required!", "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch(
        `${API}/api/sb-council-members/${termTarget.memberId}/terms/${termTarget.term.id}`,
        { method: "PUT", body: JSON.stringify(termForm) }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccessModal("Term updated!");
        setShowEditTermModal(false);
        fetchOfficials();
        if (selectedOfficialProfile?.id === termTarget.memberId) {
          const updated = await (
            await fetch(`${API}/api/sb-council-members/${termTarget.memberId}`)
          ).json();
          setSelectedOfficialProfile(updated);
        }
      } else showModalMsg(data.error || "Failed!", "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setSubmitting(false);
    }
  };
  const handleDeleteTerm = async (memberId, termId) => {
    try {
      const res = await authFetch(
        `${API}/api/sb-council-members/${memberId}/terms/${termId}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (data.success) {
        showSuccessModal("Term deleted!");
        fetchOfficials();
        if (selectedOfficialProfile?.id === memberId) {
          const updated = await (
            await fetch(`${API}/api/sb-council-members/${memberId}`)
          ).json();
          setSelectedOfficialProfile(updated);
        }
      } else showMsg(data.error || "Error!", "error");
    } catch {
      showMsg("Error!", "error");
    }
  };

  // ─── Sessions ─────────────────────────────────────────────────────────────────
  const resetSessionForm = () => {
    const suggested = suggestSessionNumber(
      sessionMinutes,
      getCurrentYear(),
      "regular"
    );
    lastSessionSuggestion.current = suggested;
    setSessionForm({
      session_number: suggested,
      session_date: "",
      session_type: "regular",
      venue: SESSION_VENUE,
      agenda: "",
      minutes_text: "",
    });
    setSessionFile(null);
    clearRecordScan("minutes");
  };
  const handleAddSession = async () => {
    if (!sessionForm.session_date) {
      showModalMsg("Session date is required!", "error");
      return;
    }
    if (
      isDuplicateRecordNumber(
        sessionMinutes,
        "session_number",
        sessionForm.session_number
      )
    ) {
      showModalMsg(
        `"${sessionForm.session_number}" is already in use by another session. Please choose a different number.`,
        "error"
      );
      return;
    }
    setSubmitting(true);
    try {
      // Session minutes are added by uploading the file (PDF, Word or image).
      if (!sessionFile) {
        showModalMsg("Please upload a file!", "error");
        setSubmitting(false);
        return;
      }
      const fd = new FormData();
      Object.entries(sessionForm).forEach(([k, v]) => fd.append(k, v));
      fd.append("file", sessionFile);
      const res = await authFetch(`${API}/api/session-minutes/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccessModal("Session added!");
        resetSessionForm();
        setShowSessionModal(false);
        notifyDataChanged();
      } else showModalMsg(data.error || "Upload failed!", "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setSubmitting(false);
    }
  };
  const handleOpenEditSession = (s) => {
    setEditingSession(s);
    setEditSessionForm({
      session_number: s.session_number || "",
      session_date: s.session_date ? s.session_date.split("T")[0] : "",
      session_type: s.session_type || "regular",
      venue: s.venue || "",
      agenda: s.agenda || "",
      minutes_text: s.minutes_text || "",
    });
    setEditSessionFile(null);
    setModalMessage("");
    setShowEditSessionModal(true);
  };
  const handleUpdateSession = async () => {
    if (!editSessionForm.session_date) {
      showModalMsg("Session date is required!", "error");
      return;
    }
    if (
      isDuplicateRecordNumber(
        sessionMinutes,
        "session_number",
        editSessionForm.session_number,
        editingSession.id
      )
    ) {
      showModalMsg(
        `"${editSessionForm.session_number}" is already in use by another session. Please choose a different number.`,
        "error"
      );
      return;
    }
    setSubmitting(true);
    try {
      // With a file picked the request is multipart (fields + file); without
      // one it stays plain JSON, exactly as before.
      let body = JSON.stringify(editSessionForm);
      if (editSessionFile) {
        body = new FormData();
        Object.entries(editSessionForm).forEach(([k, v]) => body.append(k, v ?? ""));
        body.append("file", editSessionFile);
      }
      const res = await authFetch(
        `${API}/api/session-minutes/${editingSession.id}`,
        { method: "PUT", body }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccessModal("Session minutes updated!");
        setShowEditSessionModal(false);
        setEditingSession(null);
        notifyDataChanged();
      } else showModalMsg(data.error || "Update failed!", "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setSubmitting(false);
    }
  };
  const handleDeleteSession = async (id) => {
    try {
      const res = await authFetch(`${API}/api/session-minutes/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        showSuccessModal("Session archived!");
        notifyDataChanged();
      } else showMsg(data.error || "Error!", "error");
    } catch {
      showMsg("Error!", "error");
    }
  };

  // ─── Session Agendas ─────────────────────────────────────────────────────────
  // No draft/review workflow (see routes/sessionAgendas.js) — a Secretary/
  // Clerk upload is immediately live, so this is just plain create/edit/
  // delete, no accept/vm-approve/publish steps like Ordinances/Resolutions/
  // Session Minutes above.
  const resetAgendaForm = () => {
    setAgendaForm({
      session_number: "",
      session_date: "",
      session_type: "regular",
      venue: SESSION_VENUE,
    });
    setAgendaFile(null);
    clearRecordScan("agenda");
  };
  const handleAddAgenda = async () => {
    if (!agendaForm.session_date) {
      showModalMsg("Date is required!", "error");
      return;
    }
    if (!agendaFile) {
      showModalMsg("Please upload a PDF or Word file!", "error");
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      Object.entries(agendaForm).forEach(([k, v]) => fd.append(k, v));
      fd.append("file", agendaFile);
      const res = await authFetch(`${API}/api/session-agendas/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccessModal("Order of business posted!");
        resetAgendaForm();
        setShowAgendaModal(false);
        notifyDataChanged();
      } else showModalMsg(data.error || "Upload failed!", "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setSubmitting(false);
    }
  };
  const handleOpenEditAgenda = (a) => {
    setEditingAgenda(a);
    setEditAgendaForm({
      session_number: a.session_number || "",
      session_date: a.session_date ? a.session_date.split("T")[0] : "",
      session_type: a.session_type || "regular",
      venue: a.venue || "",
    });
    setEditAgendaFile(null);
    setModalMessage("");
    setShowEditAgendaModal(true);
  };
  const handleUpdateAgenda = async () => {
    if (!editAgendaForm.session_date) {
      showModalMsg("Date is required!", "error");
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      Object.entries(editAgendaForm).forEach(([k, v]) => fd.append(k, v));
      if (editAgendaFile) fd.append("file", editAgendaFile);
      const res = await authFetch(`${API}/api/session-agendas/${editingAgenda.id}`, {
        method: "PUT",
        body: fd,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccessModal("Order of business updated!");
        setShowEditAgendaModal(false);
        setEditingAgenda(null);
        notifyDataChanged();
      } else showModalMsg(data.error || "Update failed!", "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setSubmitting(false);
    }
  };
  const handleDeleteAgenda = async (id) => {
    try {
      const res = await authFetch(`${API}/api/session-agendas/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        showSuccessModal("Order of business archived!");
        notifyDataChanged();
      } else showMsg(data.error || "Error!", "error");
    } catch {
      showMsg("Error!", "error");
    }
  };

  // ─── Announcements ────────────────────────────────────────────────────────────
  const resetAnnouncementForm = () =>
    setAnnouncementForm({
      title: "",
      body: "",
      priority: "normal",
      pinned: false,
    });
  const handleAddAnnouncement = async () => {
    if (!announcementForm.title || !announcementForm.body) {
      showModalMsg("Title and body are required!", "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch(`${API}/api/announcements`, {
        method: "POST",
        body: JSON.stringify(announcementForm),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccessModal("Announcement posted!");
        resetAnnouncementForm();
        setShowAnnouncementModal(false);
        markAnnouncementsSeen(); // refetches announcements + clears own unread badge
      } else showModalMsg(data.error || "Failed!", "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setSubmitting(false);
    }
  };
  const handleOpenEditAnnouncement = (a) => {
    setEditingAnnouncement(a);
    setEditAnnouncementForm({
      title: a.title || "",
      body: a.body || "",
      priority: a.priority || "normal",
      pinned: a.pinned || false,
    });
    setModalMessage("");
    setShowEditAnnouncementModal(true);
  };
  const handleUpdateAnnouncement = async () => {
    if (!editAnnouncementForm.title || !editAnnouncementForm.body) {
      showModalMsg("Title and body are required!", "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch(
        `${API}/api/announcements/${editingAnnouncement.id}`,
        { method: "PUT", body: JSON.stringify(editAnnouncementForm) }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccessModal("Announcement updated!");
        setShowEditAnnouncementModal(false);
        setEditingAnnouncement(null);
        markAnnouncementsSeen(); // refetches announcements + clears own unread badge
      } else showModalMsg(data.error || "Update failed!", "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setSubmitting(false);
    }
  };
  const handleDeleteAnnouncement = async (id) => {
    try {
      const res = await authFetch(`${API}/api/announcements/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        showSuccessModal("Announcement deleted!");
        fetchAnnouncements({ silent: true });
      } else showMsg(data.error || "Error!", "error");
    } catch {
      showMsg("Error!", "error");
    }
  };

  // ─── Calendar ─────────────────────────────────────────────────────────────────
  const handleSaveLocalEvent = async () => {
    if (!localEventForm.title || !localEventForm.start_date) {
      showModalMsg("Title and start date are required!", "error");
      return;
    }
    const localEnd = localEventForm.end_date || localEventForm.start_date;
    if (localEnd < localEventForm.start_date) {
      showModalMsg("End date cannot be before the start date!", "error");
      return;
    }
    if (
      localEnd === localEventForm.start_date &&
      !localEventForm.all_day &&
      localEventForm.start_time &&
      localEventForm.end_time &&
      localEventForm.end_time < localEventForm.start_time
    ) {
      showModalMsg("End time cannot be before the start time!", "error");
      return;
    }
    setSavingLocalEvent(true);
    try {
      const res = await authFetch(`${API}/api/calendar-events`, {
        method: "POST",
        body: JSON.stringify(localEventForm),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccessModal("Event saved!");
        setShowLocalEventModal(false);
        setLocalEventForm(emptyEventForm);
        notifyDataChanged();
      } else showModalMsg(data.error || "Failed to save event!", "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setSavingLocalEvent(false);
    }
  };
  const handleOpenEditEvent = (ev) => {
    const r = ev.raw;
    setEditingEvent(ev);
    setEditEventForm({
      title: r.title || "",
      description: r.description || "",
      location: r.location || "",
      start_date: toLocalIso(r.start_date) || "",
      start_time: r.start_time || "08:00",
      end_date: toLocalIso(r.end_date) || "",
      end_time: r.end_time || "09:00",
      all_day: !!r.all_day,
      color: r.color || "#090446",
    });
    setShowEditEventModal(true);
  };
  const handleUpdateEvent = async () => {
    if (!editEventForm.title || !editEventForm.start_date) {
      showModalMsg("Title and start date are required!", "error");
      return;
    }
    const editEnd = editEventForm.end_date || editEventForm.start_date;
    if (editEnd < editEventForm.start_date) {
      showModalMsg("End date cannot be before the start date!", "error");
      return;
    }
    if (
      editEnd === editEventForm.start_date &&
      !editEventForm.all_day &&
      editEventForm.start_time &&
      editEventForm.end_time &&
      editEventForm.end_time < editEventForm.start_time
    ) {
      showModalMsg("End time cannot be before the start time!", "error");
      return;
    }
    setSavingLocalEvent(true);
    try {
      const res = await authFetch(
        `${API}/api/calendar-events/${editingEvent.dbId}`,
        { method: "PUT", body: JSON.stringify(editEventForm) }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccessModal("Event updated!");
        setShowEditEventModal(false);
        setEditingEvent(null);
        notifyDataChanged();
      } else showModalMsg(data.error || "Update failed!", "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setSavingLocalEvent(false);
    }
  };
  const handleDeleteEvent = async (dbId) => {
    try {
      const res = await authFetch(`${API}/api/calendar-events/${dbId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        showSuccessModal("Event deleted!");
        notifyDataChanged();
      } else showMsg(data.error || "Error!", "error");
    } catch {
      showMsg("Error!", "error");
    }
  };
  const isAdmin = admin?.role === "admin";
  // Computed once here instead of UsersPage/AdminsPage each independently
  // re-deriving it from the same `users` array.
  const totalUsersCount = users.filter((u) => u.role === "user").length;
  const totalAdminsCount = users.filter((u) => u.role === "admin").length;
  const PIN_LIMIT = 3;
  const pinnedCount = announcements.filter((a) => a.pinned).length;
  // Editing an already-pinned post shouldn't count against its own slot.
  const editPinnedCount = editingAnnouncement
    ? announcements.filter((a) => a.pinned && a.id !== editingAnnouncement.id).length
    : pinnedCount;
  const position = admin?.position;
  const isSecretary = position === "secretary";
  const isClerk = position === "clerk";
  const isViceMayor = position === "vice_mayor";
  // Liga ng mga Barangay and SK Federated are ex-officio Sangguniang Bayan
  // members — same permissions as an elected Councilor throughout the app,
  // just a distinct position value so the sidebar/Users list can still show
  // which seat they actually hold.
  const isCouncilor =
    position === "councilor" ||
    position === "liga_ng_mga_barangay" ||
    position === "sk_federated";

  const canManageUsers = isSecretary || isClerk;
  const canViewLogs = isSecretary;
  const canViewArchives = isSecretary;
  // Gates whether the Pending tab is visible at all (Secretary reviews it,
  // Vice-Mayor approves from it, Clerk/Councilor draft in it).
  const canPublishLegislative = isSecretary || isClerk || isViceMayor || isCouncilor;
  // Gates edit/upload/delete content — Secretary/Clerk only, in every
  // bucket (matches the backend's canEditLegislativeRecord). Councilor and
  // Vice-Mayor stay read-only for content, published or not.
  const canEditLegislative = isSecretary || isClerk;
  // Gates the Pending-tab Archive button for Secretary/Clerk, who may
  // archive any record. Councilor/Vice-Mayor may still archive a pending
  // record, but only one they created themselves — that's checked
  // per-record inside each page (ordinance.created_by === currentUserId),
  // not here (matches the backend's canArchiveLegislativeRecord).
  const canManagePendingLegislative = isSecretary || isClerk;
  // All four positions can originate a new draft — Secretary and Vice-Mayor
  // sometimes make the ordinance/resolution/session minutes directly rather
  // than only reviewing/approving what Clerk/Councilor submit. Gates the
  // "+Upload" button specifically, not the per-draft edit/archive actions
  // above.
  const canCreateLegislative = isSecretary || isClerk || isCouncilor || isViceMayor;
  // Session Agenda has no draft/review workflow (see routes/sessionAgendas.js).
  // Uploading is open to all four positions — any of them may need to post
  // the agenda ahead of a session — but editing/deleting an already-posted
  // agenda stays Secretary/Clerk only, same as canEditLegislative.
  const canUploadSessionAgenda = isSecretary || isClerk || isViceMayor || isCouncilor;
  const canManageSessionAgenda = isSecretary || isClerk;
  const canManageOfficials = isSecretary || isClerk;

  // ── "My Profile" ──────────────────────────────────────────────────────────────
  // The logged-in account's own council member and records come from
  // GET /api/users/me/records, which follows the account link
  // (sb_council_members.user_id) — the old name match broke whenever either
  // name was edited. Secretary/Clerk have no member record, so they only see
  // the Account tab. Loaded only while the modal is open.
  const {
    data: myRecords,
    isLoading: fetchingMyRecords,
  } = useQuery({
    queryKey: MY_RECORDS_QUERY_KEY,
    queryFn: fetchMyRecords,
    enabled: showMyProfile,
    staleTime: 15000,
  });

  const openMyProfile = () => {
    setMyResetLinkSentTo("");
    setModalMessage("");
    setMyProfileTab("account");
    handleTabChange("profile");
  };
  // Fill the name field whenever the page opens — including straight from a
  // refresh on ?tab=profile, where openMyProfile never ran.
  useEffect(() => {
    if (showMyProfile && admin) setMyProfileName(admin.name || "");
  }, [showMyProfile, admin]);

  // Updates the account's own name — the one piece of their account a
  // non-admin user may edit themselves (see PUT /:id/name in routes/users.js).
  const handleUpdateMyName = async () => {
    const name = myProfileName.trim();
    if (!name) {
      showModalMsg("Name is required.", "error");
      return;
    }
    setMyProfileSubmitting(true);
    try {
      const res = await authFetch(`${API}/api/users/${admin.id}/name`, {
        method: "PUT",
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const updated = { ...admin, name: data.name };
        setAdmin(updated);
        localStorage.setItem("user", JSON.stringify(updated));
        showSuccessModal("Name updated!");
      } else showModalMsg(data.error || data.errors?.[0]?.msg || "Update failed!", "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setMyProfileSubmitting(false);
    }
  };

  // Emails the signed-in account a reset link to its own address (POST
  // /api/users/me/reset-password) — the same single-use, 1-hour link the
  // Secretary's Reset Password sends. The password itself is then set on the
  // Reset Password page the link opens, not in this modal.
  const handleSendMyResetLink = async () => {
    setMyProfileSubmitting(true);
    try {
      const res = await authFetch(`${API}/api/users/me/reset-password`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        setMyResetLinkSentTo(data.email);
        showSuccessModal(`A password reset link was sent to ${data.email}. It expires in 1 hour.`);
      } else showModalMsg(data.error || "Couldn't send the reset link.", "error");
    } catch {
      showModalMsg("Server error!", "error");
    } finally {
      setMyProfileSubmitting(false);
    }
  };

  // "users"/"admins"/"archives" are gated for every position; "logs" is the
  // only one that ever varies — excluded solely for clerks (canManageUsers
  // but not canViewLogs), included for everyone else (secretaries via
  // canViewLogs, and vice-mayors/councilors/no-position accounts by default).
  const ADMIN_ONLY_TABS = isClerk
    ? ["users", "admins", "archives"]
    : ["users", "admins", "logs", "archives"];
  // A refresh (or a pasted link) can land on a module this account may not
  // open — handleTabChange's check never ran for it, so apply it here once
  // the account is loaded.
  useEffect(() => {
    if (admin && !isAdmin && ADMIN_ONLY_TABS.includes(activeTab)) setActiveTab("dashboard");
    if (admin && activeTab === "logs" && !canViewLogs && isAdmin) setActiveTab("dashboard");
    if (admin && activeTab === "archives" && !canViewArchives) setActiveTab("dashboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, activeTab]);
  const pageLoading =
    fetchingUsers ||
    fetchingOrdinances ||
    fetchingOfficials ||
    fetchingMinutes ||
    fetchingAgendas ||
    fetchingResolutions ||
    fetchingAnnouncements;
  // Only pop the loading modal up if a fetch is still running 5s later —
  // most refetches (e.g. the ones that follow an upload/save success) finish
  // almost instantly, and popping this in for that brief window used to sit
  // on top of and hide the success modal fired by the same action.
  const LOADING_MODAL_DELAY_MS = 5000;
  const [showLoadingModal, setShowLoadingModal] = useState(false);
  useEffect(() => {
    if (!pageLoading) {
      setShowLoadingModal(false);
      return;
    }
    const timer = setTimeout(() => setShowLoadingModal(true), LOADING_MODAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pageLoading]);
  // Narrower than pageLoading — only the fetches DashboardPage's own content
  // actually depends on (fetchingUsers/fetchingOfficials feed Users/Admins/
  // Officials, none of which this page renders), so its skeleton clears as
  // soon as its own data is in, not whenever any unrelated tab is still loading.
  const dashboardLoading =
    fetchingOrdinances || fetchingResolutions || fetchingMinutes || fetchingAnnouncements || fetchingAgendas;

  // ── Quick-action openers ── shared by the sidebar "+ Add" buttons and the
  // Dashboard's Quick Actions panel.
  const openOrdinanceModal = () => {
    setModalMessage("");
    setOrdinanceDate(toIsoDate(new Date()));
    clearRecordScan("ordinance");
    setShowOrdinanceModal(true);
  };
  const openResolutionModal = () => {
    setModalMessage("");
    setResolutionTitle("");
    setResolutionDate(toIsoDate(new Date()));
    setResolutionFile(null);
    clearRecordScan("resolution");
    setSelectedResolutionOfficials([]);
    setShowResolutionModal(true);
  };
  const openSessionModal = () => {
    setModalMessage("");
    resetSessionForm();
    setShowSessionModal(true);
  };
  const openAgendaModal = () => {
    setModalMessage("");
    resetAgendaForm();
    setShowAgendaModal(true);
  };
  const openAnnouncementModal = () => {
    setModalMessage("");
    resetAnnouncementForm();
    setShowAnnouncementModal(true);
  };

  // ══════════════════════════════════════════════════════════════════════════════
  return (
    <div className={styles.container}>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <ModalAlert message={modalMessage} type={modalMessageType} />
      {successModalMsg && (
        <ConfirmModal
          type="success"
          title="Success"
          message={successModalMsg}
          confirmLabel="OK"
          cancelLabel={false}
          onConfirm={() => setSuccessModalMsg("")}
          onCancel={() => setSuccessModalMsg("")}
        />
      )}

      <div
        className={`${styles.mobileBackdrop} ${
          mobileOpen ? styles.visible : ""
        }`}
        onClick={() => setMobileOpen(false)}
      />

      {/* Mobile topbar */}
      <div className={styles.mobileTopbar}>
        <button
          className={`${styles.hamburgerBtn} ${mobileOpen ? styles.open : ""}`}
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          <span className={styles.hamburgerLine} />
          <span className={styles.hamburgerLine} />
          <span className={styles.hamburgerLine} />
        </button>
        <span className={styles.mobileTopTitle}>{tabTitles[activeTab]}</span>
        <div style={{ width: 34 }} />
      </div>

      {/* ── SIDEBAR ── */}
      <div
        className={`${styles.sidebar} ${
          sidebarShowsCollapsed ? styles.collapsed : ""
        } ${mobileOpen ? styles.mobileOpen : ""}`}
        onMouseEnter={handleSidebarMouseEnter}
        onMouseLeave={handleSidebarMouseLeave}
      >
        <div className={styles.sidebarHeader}>
          <img src={logo} alt="Balilihan Seal" className={styles.logoCircle} />
          <div className={styles.logoTextWrap}>
            <div className={styles.logoText}>eLEGIS-BALILIHAN</div>
            <div className={styles.logoSub}>Office of Sangguniang Bayan</div>
          </div>
        </div>
        <nav className={styles.nav}>
          {/* Dashboard */}
          <button
            data-tour="nav-dashboard"
            className={`${styles.navBtn} ${
              activeTab === "dashboard" ? styles.navBtnActive : ""
            }`}
            onClick={() => handleTabChange("dashboard")}
          >
            <span className={styles.navIcon}>
              <Activity size={18} strokeWidth={1.5} />
            </span>
            <span className={styles.navLabel}>Dashboard</span>
          </button>

          <div className={styles.navDivider} />

          {/* Legislative Records dropdown */}
          <div className={styles.navSection} data-tour="nav-legislative">
            <button
              className={styles.navSectionHeader}
              onClick={() => !sidebarShowsCollapsed && setLegislativeOpen((v) => !v)}
            >
              <span className={styles.navSectionIcon}>
                <ScrollText size={14} strokeWidth={1.8} />
              </span>
              <span className={styles.navSectionLabel}>
                Legislative Records
              </span>
              {!sidebarShowsCollapsed && (
                <span className={styles.navSectionChevron}>
                  {legislativeOpen ? (
                    <ChevronDown size={13} />
                  ) : (
                    <ChevronRight size={13} />
                  )}
                </span>
              )}
            </button>
            <div
              className={`${styles.navSectionItems} ${
                legislativeOpen && !sidebarShowsCollapsed
                  ? styles.navSectionItemsOpen
                  : ""
              }`}
            >
              {[
                {
                  key: "ordinances",
                  icon: <ScrollText size={17} strokeWidth={1.5} />,
                  label: "Ordinances",
                },
                {
                  key: "resolutions",
                  icon: <Gavel size={17} strokeWidth={1.5} />,
                  label: "Resolutions",
                },
                {
                  key: "sessions",
                  icon: <BookOpen size={17} strokeWidth={1.5} />,
                  label: "Session Minutes",
                },
                {
                  key: "session_agendas",
                  icon: <ClipboardList size={17} strokeWidth={1.5} />,
                  label: "Order of Business",
                },
              ].map((t) => (
                <button
                  key={t.key}
                  className={`${styles.navBtn} ${styles.navBtnIndented} ${
                    activeTab === t.key ? styles.navBtnActive : ""
                  }`}
                  onClick={() => handleTabChange(t.key)}
                >
                  <span className={styles.navIcon}>{t.icon}</span>
                  <span className={styles.navLabel}>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Calendar */}
          <button
            data-tour="nav-calendar"
            className={`${styles.navBtn} ${
              activeTab === "calendar" ? styles.navBtnActive : ""
            }`}
            onClick={() => handleTabChange("calendar")}
          >
            <span className={styles.navIcon}>
              <Calendar size={18} strokeWidth={1.5} />
            </span>
            <span className={styles.navLabel}>Calendar</span>
          </button>

          {/* Announcements */}
          <button
            data-tour="nav-announcements"
            className={`${styles.navBtn} ${
              activeTab === "announcements" ? styles.navBtnActive : ""
            }`}
            onClick={() => handleTabChange("announcements")}
          >
            <span className={styles.navIcon}>
              <Megaphone size={18} strokeWidth={1.5} />
            </span>
            <span className={styles.navLabel}>Announcements</span>
            {unreadAnnouncements > 0 && (
              <span className={styles.navBadge}>
                {unreadAnnouncements > 9 ? "9+" : unreadAnnouncements}
              </span>
            )}
          </button>

          {/* Councilor Management */}
          <button
            data-tour="nav-officials"
            className={`${styles.navBtn} ${
              activeTab === "officials" ? styles.navBtnActive : ""
            }`}
            onClick={() => handleTabChange("officials")}
          >
            <span className={styles.navIcon}>
              <Landmark size={18} strokeWidth={1.5} />
            </span>
            <span className={styles.navLabel}>Councilor Management</span>
          </button>

          {/* Content Management */}
          <button
            data-tour="nav-content"
            className={`${styles.navBtn} ${
              activeTab === "content" ? styles.navBtnActive : ""
            }`}
            onClick={() => handleTabChange("content")}
          >
            <span className={styles.navIcon}>
              <FileText size={18} strokeWidth={1.5} />
            </span>
            <span className={styles.navLabel}>Content Management</span>
          </button>

          {/* Archives */}
          {canViewArchives && (
            <button
              data-tour="nav-archives"
              className={`${styles.navBtn} ${
                activeTab === "archives" ? styles.navBtnActive : ""
              }`}
              onClick={() => handleTabChange("archives")}
            >
              <span className={styles.navIcon}>
                <Archive size={18} strokeWidth={1.5} />
              </span>
              <span className={styles.navLabel}>Archives</span>
            </button>
          )}

          {canManageUsers && (
            <>
              <div className={styles.navDivider} />

              {/* User Management dropdown */}
              <div className={styles.navSection} data-tour="nav-users">
                <button
                  className={styles.navSectionHeader}
                  onClick={() =>
                    !sidebarShowsCollapsed && setUserMgmtOpen((v) => !v)
                  }
                >
                  <span className={styles.navSectionIcon}>
                    <Users size={14} strokeWidth={1.8} />
                  </span>
                  <span className={styles.navSectionLabel}>
                    User Management
                  </span>
                  {!sidebarShowsCollapsed && (
                    <span className={styles.navSectionChevron}>
                      {userMgmtOpen ? (
                        <ChevronDown size={13} />
                      ) : (
                        <ChevronRight size={13} />
                      )}
                    </span>
                  )}
                </button>
                <div
                  className={`${styles.navSectionItems} ${
                    userMgmtOpen && !sidebarShowsCollapsed
                      ? styles.navSectionItemsOpen
                      : ""
                  }`}
                >
                  {[
                    {
                      key: "users",
                      icon: <Users size={17} strokeWidth={1.5} />,
                      label: "Manage Users",
                    },
                    {
                      key: "admins",
                      icon: <ShieldCheck size={17} strokeWidth={1.5} />,
                      label: "Manage Admins",
                    },
                    ...(canViewLogs
                      ? [
                          {
                            key: "logs",
                            icon: <Activity size={17} strokeWidth={1.5} />,
                            label: "Activity Logs",
                          },
                        ]
                      : []),
                  ].map((t) => (
                    <button
                      key={t.key}
                      className={`${styles.navBtn} ${styles.navBtnIndented} ${
                        activeTab === t.key ? styles.navBtnActive : ""
                      }`}
                      onClick={() => handleTabChange(t.key)}
                    >
                      <span className={styles.navIcon}>{t.icon}</span>
                      <span className={styles.navLabel}>{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </nav>
        <div className={styles.sidebarFooter} data-tour="profile">
          <button
            type="button"
            className={styles.adminInfo}
            onClick={openMyProfile}
            title="My Profile"
            aria-label="Open my profile"
          >
            <span className={styles.adminAvatarRing}>
              <UserAvatar name={admin?.name} photo={admin?.photo} size={34} fallbackBg="#c09a3c" />
            </span>
            <div className={styles.adminTextWrap}>
              <div className={styles.adminName}>{admin?.name}</div>
              <div className={styles.adminRole}>
                {position === "secretary"
                  ? "Secretary"
                  : position === "clerk"
                  ? "Clerk"
                  : position === "vice_mayor"
                  ? "Vice Mayor"
                  : position === "councilor"
                  ? "Councilor"
                  : position === "liga_ng_mga_barangay"
                  ? "Liga ng mga Barangay"
                  : position === "sk_federated"
                  ? "SK Federated"
                  : isAdmin
                  ? "Administrator"
                  : "User"}
              </div>
            </div>
            <ChevronRight size={16} className={styles.adminChevron} aria-hidden="true" />
          </button>
          <button className={styles.logoutBtn} onClick={handleLogout}>
            <LogOut size={15} strokeWidth={1.5} />
            <span className={styles.logoutLabel}>Logout</span>
          </button>
        </div>
      </div>

      {/* ── MAIN ── */}
      <div className={styles.main}>
        <div
          className={styles.header}
          style={activeTab === "dashboard" || activeTab === "profile" ? { display: "none" } : {}}
        >
          <div>
            <h1 className={styles.headerTitle}>{tabTitles[activeTab]}</h1>
            <p className={styles.headerSub}>LGU Administration Dashboard</p>
          </div>
          <div className={styles.headerActions}>
            {activeTab === "users" && isAdmin && (
              <button
                className={styles.addBtn}
                onClick={() => {
                  setModalMessage("");
                  setNewUserPhoto(null);
                  setShowAddUserModal(true);
                }}
              >
                + Add User
              </button>
            )}
            {activeTab === "admins" && isAdmin && (
              <button
                className={styles.addBtn}
                onClick={() => {
                  setModalMessage("");
                  setNewAdminPhoto(null);
                  setShowAddAdminModal(true);
                }}
              >
                + Add Admin
              </button>
            )}
            {activeTab === "ordinances" && canCreateLegislative && (
              <button className={styles.addBtn} onClick={openOrdinanceModal}>
                + Upload Ordinance
              </button>
            )}
            {activeTab === "resolutions" && canCreateLegislative && (
              <button className={styles.addBtn} onClick={openResolutionModal}>
                + Upload Resolution
              </button>
            )}
            {activeTab === "sessions" && canCreateLegislative && (
              <button className={styles.addBtn} onClick={openSessionModal}>
                + Add Session
              </button>
            )}
            {activeTab === "session_agendas" && canUploadSessionAgenda && (
              <button className={styles.addBtn} onClick={openAgendaModal}>
                + Upload Order of Business
              </button>
            )}
            {activeTab === "logs" && isAdmin && (
              <button
                className={styles.addBtn}
                onClick={() => {
                  fetchLogs();
                  fetchLogStats();
                }}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <RefreshCw size={14} /> Refresh
              </button>
            )}
          </div>
        </div>

        {showLoadingModal && <LoadingModal message="Loading data..." />}
        {/* Covers every Add/Upload/Save/Reset-password/Delete action across
            the dashboard — they all toggle this one shared `submitting`
            flag, so this single overlay stands in for a spinner on every
            individual button. Shown immediately (no delay, unlike
            showLoadingModal above): the user just clicked something and is
            actively waiting, so a moment of silence on a slow connection
            should never be mistaken for the click not having registered. */}
        {submitting && <LoadingModal message="Processing..." />}
        {connectionError && (
          <ConnectionErrorModal
            message={connectionError}
            onClose={() => setConnectionError("")}
          />
        )}

        {/* ── PAGE COMPONENTS ── */}
        {activeTab === "dashboard" && (
          <DashboardPage
            ordinances={ordinances}
            resolutions={resolutions}
            sessionMinutes={sessionMinutes}
            sessionAgendas={sessionAgendas}
            events={localEvents}
            announcements={announcements}
            unreadAnnouncements={unreadAnnouncements}
            loading={dashboardLoading}
            onNavigate={handleTabChange}
            canQuickAdd={isAdmin}
            onAddOrdinance={openOrdinanceModal}
            onAddResolution={openResolutionModal}
            onAddSession={openSessionModal}
            onAddAnnouncement={openAnnouncementModal}
            isViceMayor={isViceMayor}
            isSecretary={isSecretary}
            isClerk={isClerk}
            isCouncilor={isCouncilor}
            onReview={setDashboardReview}
            onStartTour={startTour}
          />
        )}
        {/* Dashboard "Review": the record's own module page, in view-only
            mode — the same View modal as in Ordinances / Resolutions. */}
        {activeTab === "dashboard" && dashboardReview?.record_type === "ordinance" && (
          <OrdinancesPage
            ordinances={ordinances}
            loading={fetchingOrdinances}
            setDeleteTarget={setDeleteTarget}
            onEdit={handleOpenEditOrdinance}
            readOnly={!canEditLegislative}
            canPublish={canPublishLegislative}
            canManagePending={canManagePendingLegislative}
            currentUserId={admin?.id}
            isViceMayor={isViceMayor}
            isSecretary={isSecretary}
            isClerk={isClerk}
            isCouncilor={isCouncilor}
            onRefresh={notifyDataChanged}
            viewOnlyRecord={dashboardReview}
            onViewOnlyClose={closeDashboardReview}
          />
        )}
        {activeTab === "dashboard" && dashboardReview?.record_type === "resolution" && (
          <ResolutionsPage
            resolutions={resolutions}
            loading={fetchingResolutions}
            setDeleteTarget={setDeleteTarget}
            onEdit={handleOpenEditResolution}
            readOnly={!canEditLegislative}
            canPublish={canPublishLegislative}
            canManagePending={canManagePendingLegislative}
            currentUserId={admin?.id}
            isViceMayor={isViceMayor}
            isSecretary={isSecretary}
            isClerk={isClerk}
            isCouncilor={isCouncilor}
            onRefresh={notifyDataChanged}
            viewOnlyRecord={dashboardReview}
            onViewOnlyClose={closeDashboardReview}
          />
        )}
        {activeTab === "users" && (
          <UsersPage
            users={users}
            totalUsers={totalUsersCount}
            loading={fetchingUsers}
            setDeleteTarget={setDeleteTarget}
            onEdit={handleOpenEditUser}
            onResetPassword={setResetPasswordTarget}
          />
        )}
        {activeTab === "admins" && (
          <AdminsPage
            users={users}
            totalAdmins={totalAdminsCount}
            loading={fetchingUsers}
            setDeleteTarget={setDeleteTarget}
            onEdit={handleOpenEditUser}
            onResetPassword={setResetPasswordTarget}
          />
        )}
        {activeTab === "ordinances" && (
          <OrdinancesPage
            ordinances={ordinances}
            loading={fetchingOrdinances}
            setDeleteTarget={setDeleteTarget}
            onEdit={handleOpenEditOrdinance}
            readOnly={!canEditLegislative}
            canPublish={canPublishLegislative}
            canManagePending={canManagePendingLegislative}
            currentUserId={admin?.id}
            isViceMayor={isViceMayor}
            isSecretary={isSecretary}
            isClerk={isClerk}
            isCouncilor={isCouncilor}
            onRefresh={notifyDataChanged}
            initialSubTab={activeTab === "ordinances" ? subTabRequest : null}
          />
        )}
        {activeTab === "resolutions" && (
          <ResolutionsPage
            resolutions={resolutions}
            loading={fetchingResolutions}
            setDeleteTarget={setDeleteTarget}
            onEdit={handleOpenEditResolution}
            readOnly={!canEditLegislative}
            canPublish={canPublishLegislative}
            canManagePending={canManagePendingLegislative}
            currentUserId={admin?.id}
            isViceMayor={isViceMayor}
            isSecretary={isSecretary}
            isClerk={isClerk}
            isCouncilor={isCouncilor}
            onRefresh={notifyDataChanged}
            initialSubTab={activeTab === "resolutions" ? subTabRequest : null}
          />
        )}

        {/* ── OFFICIALS PAGE — group-by-council wiring ── */}
        {activeTab === "officials" && !fetchingOfficials && (
          <OfficialsPage
            officials={officials}
            ordinances={ordinances}
            councils={councils}
            onAddCouncil={handleAddCouncil}
            onEditCouncil={handleEditCouncil}
            onReorderCouncil={handleReorderCouncil}
            showSuccessModal={showSuccessModal}
            setDeleteTarget={setDeleteTarget}
            onViewProfile={(o) => {
              setSelectedOfficialProfile(o);
              setOfficialProfileTab("terms");
              setShowOfficialProfile(true);
            }}
            onEditMember={handleOpenEditOfficial}
            onAddMember={(termPeriod) => {
              setNewOfficial({
                full_name: "",
                position: "",
                term_period: termPeriod || "",
                term_start: "",
                term_end: "",
                is_reelected: false,
                notes: "",
              });
              setOfficialPhoto(null);
              setModalMessage("");
              setShowOfficialModal(true);
            }}
            onSuggestMatches={() => setShowSuggestMatches(true)}
            readOnly={!canManageOfficials}
          />
        )}
        {showSuggestMatches && (
          <SuggestMatchesModal
            onClose={() => setShowSuggestMatches(false)}
            onLinked={fetchOfficials}
          />
        )}

        {activeTab === "sessions" && (
          <SessionsPage
            sessionMinutes={sessionMinutes}
            loading={fetchingMinutes}
            setDeleteTarget={setDeleteTarget}
            onEdit={handleOpenEditSession}
            readOnly={!canEditLegislative}
          />
        )}
        {activeTab === "session_agendas" && (
          <SessionAgendaPage
            agendas={sessionAgendas}
            loading={fetchingAgendas}
            setDeleteTarget={setDeleteTarget}
            onEdit={handleOpenEditAgenda}
            readOnly={!canManageSessionAgenda}
          />
        )}
        {activeTab === "announcements" && !fetchingAnnouncements && (
          <AnnouncementsPage
            announcements={announcements}
            totalActiveUsers={totalActiveUsers}
            setDeleteTarget={setDeleteTarget}
            onEdit={handleOpenEditAnnouncement}
            onOpenComposer={openAnnouncementModal}
            onRefresh={() => fetchAnnouncements({ silent: true })}
            onAnnouncementsChange={setAnnouncements}
            readOnly={false}
            currentUser={{
              id: admin?.id,
              name: admin?.name,
              photo: admin?.photo,
              initials: (admin?.name || "?").trim().charAt(0).toUpperCase(),
              role: isViceMayor || isCouncilor ? "Councilor" : isAdmin ? "Admin" : "Staff",
            }}
          />
        )}
        {activeTab === "calendar" && (
          <CalendarPage
            localEvents={localEvents}
            showHolidays={showHolidays}
            setShowHolidays={setShowHolidays}
            onAddEvent={(dateStr) => {
              setLocalEventForm({
                ...emptyEventForm,
                start_date: dateStr,
                end_date: dateStr,
              });
              setModalMessage("");
              setShowLocalEventModal(true);
            }}
            onEditEvent={handleOpenEditEvent}
            onDeleteEvent={handleDeleteEvent}
            isAdmin={isAdmin}
            currentUser={admin}
          />
        )}
        {activeTab === "logs" && canViewLogs && (
          <LogsPage
            logs={logs}
            logStats={logStats}
            fetchingLogs={fetchingLogs}
            logModuleFilter={logModuleFilter}
            setLogModuleFilter={setLogModuleFilter}
            logActionFilter={logActionFilter}
            setLogActionFilter={setLogActionFilter}
          />
        )}
        {activeTab === "content" && (
          <ContentManagementPage isAdmin={isAdmin} currentUser={admin} />
        )}
        {activeTab === "archives" && canViewArchives && <ArchivesPage />}

        {/* My Profile — opened by clicking your own avatar in the sidebar.
            Account tab is always shown; the record tabs only appear when
            this account is linked to a council member (MyProfileRecords.jsx). */}
        {activeTab === "profile" && admin && (
          <MyProfilePage
            admin={admin}
            positionLabel={
              {
                secretary: "Secretary",
                clerk: "Clerk",
                vice_mayor: "Vice Mayor",
                councilor: "Councilor",
                liga_ng_mga_barangay: "Liga ng mga Barangay",
                sk_federated: "SK Federated",
              }[position] || (isAdmin ? "Administrator" : "User")
            }
            tab={myProfileTab}
            onTabChange={setMyProfileTab}
            name={myProfileName}
            onNameChange={setMyProfileName}
            onSaveName={handleUpdateMyName}
            onSendResetLink={handleSendMyResetLink}
            submitting={myProfileSubmitting}
            resetSentTo={myResetLinkSentTo}
            records={myRecords}
            recordsLoading={fetchingMyRecords}
            dashStyles={styles}
            onPreview={setOfficialRecordPreview}
            onRecordsChanged={notifyDataChanged}
          />
        )}
      </div>

      {/* ══════════════════ MODALS ══════════════════ */}

      {/* Add Admin / Add User / Edit User+Admin — one shared parameterized
          modal (UserFormModal.jsx) instead of three near-duplicate ~170-line
          JSX blocks. */}
      {showAddAdminModal && (
        <UserFormModal
          mode="add"
          roleGroup="admin"
          title="Add New Admin"
          form={newAdmin}
          onFieldChange={(field, value) => setNewAdmin({ ...newAdmin, [field]: value })}
          photo={newAdminPhoto}
          onPhotoChange={setNewAdminPhoto}
          submitting={submitting}
          submitLabel="Add Admin"
          submittingLabel="Adding..."
          onSubmit={handleAddAdmin}
          onClose={() => {
            setShowAddAdminModal(false);
            setModalMessage("");
          }}
        />
      )}

      {showAddUserModal && (
        <UserFormModal
          mode="add"
          roleGroup="user"
          title="Add New User"
          form={newUser}
          onFieldChange={(field, value) => setNewUser({ ...newUser, [field]: value })}
          photo={newUserPhoto}
          onPhotoChange={setNewUserPhoto}
          submitting={submitting}
          submitLabel="Add User"
          submittingLabel="Adding..."
          onSubmit={handleAddUser}
          onClose={() => {
            setShowAddUserModal(false);
            setModalMessage("");
          }}
        />
      )}

      {showEditUserModal && editingUser && (
        <UserFormModal
          mode="edit"
          roleGroup={editingUser.role === "admin" ? "admin" : "user"}
          title={`Edit ${editingUser.role === "admin" ? "Admin" : "User"}`}
          form={editUserForm}
          onFieldChange={(field, value) => setEditUserForm({ ...editUserForm, [field]: value })}
          photo={editUserPhoto}
          onPhotoChange={setEditUserPhoto}
          currentPhotoUrl={editingUser.photo}
          excludeUserId={editingUser.id}
          submitting={submitting}
          submitLabel="Save Changes"
          submittingLabel="Saving..."
          onSubmit={handleUpdateUser}
          onClose={() => {
            setShowEditUserModal(false);
            setEditingUser(null);
            setModalMessage("");
          }}
        />
      )}

      {/* ── Add Council Member modal ── */}
      {showOfficialModal && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            setShowOfficialModal(false);
            setModalMessage("");
          }}
        >
          <div
            className={`${styles.modal} ${styles.sessionModal}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: "90vh",
              overflow: "hidden",
            }}
          >
            {/* ── Sticky header ── */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 16px",
                borderBottom: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
                position: "sticky",
                top: 0,
                zIndex: 2,
              }}
            >
              <h2
                className={styles.modalTitle}
                style={{ margin: 0, fontSize: 18 }}
              >
                Add Council Member
              </h2>
              <button
                onClick={() => {
                  setShowOfficialModal(false);
                  setModalMessage("");
                }}
                aria-label="Close modal"
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  cursor: "pointer",
                  color: "#64748b",
                  width: 32,
                  height: 32,
                  minWidth: 32,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  transition: "background 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#fee2e2";
                  e.currentTarget.style.color = "#dc2626";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#f1f5f9";
                  e.currentTarget.style.color = "#64748b";
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* ── Scrollable body ── */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                overscrollBehavior: "contain",
              }}
            >
              {/* Council banner */}
              {newOfficial.term_period && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    background: "#ebf4ff",
                    border: "1px solid #bee3f8",
                    borderRadius: 8,
                    marginBottom: 14,
                    fontSize: 13,
                    color: "#1a365d",
                    fontWeight: 600,
                  }}
                >
                  <CalendarDays size={14} strokeWidth={1.5} />
                  Adding to council: {newOfficial.term_period}
                </div>
              )}

              <label className={styles.fieldLabel}>
                Full Name <span style={{ color: "#e53e3e" }}>*</span>
              </label>
              <input
                className={styles.input}
                placeholder="Full Name"
                value={newOfficial.full_name}
                onChange={(e) =>
                  setNewOfficial({
                    ...newOfficial,
                    full_name: e.target.value.replace(/[0-9]/g, ""),
                  })
                }
              />

              <div className={styles.fileUploadBox}>
                <input
                  type="file"
                  accept="image/*"
                  id="photoInput"
                  style={{ display: "none" }}
                  onChange={(e) => setOfficialPhoto(e.target.files[0])}
                />
                <label htmlFor="photoInput" className={styles.fileLabel}>
                  {officialPhoto ? (
                    <>
                      <CheckSquare size={14} strokeWidth={1.5} />{" "}
                      {officialPhoto.name}
                    </>
                  ) : (
                    <>
                      <Upload size={14} strokeWidth={1.5} /> Click to upload
                      photo (optional)
                    </>
                  )}
                </label>
              </div>

              <div
                style={{
                  marginTop: 14,
                  padding: "14px 16px",
                  background: "#f8fafc",
                  borderRadius: 10,
                  border: "1px solid #e2e8f0",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#1a365d",
                    marginBottom: 10,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    textTransform: "uppercase",
                    letterSpacing: "0.4px",
                  }}
                >
                  <History size={13} /> Term &amp; Position
                </div>
                <TermFormFields
                  form={newOfficial}
                  setForm={setNewOfficial}
                  styles={styles}
                />
              </div>

              <CreateAccountFields
                form={newOfficial}
                setForm={setNewOfficial}
                styles={styles}
              />
            </div>

            {/* ── Sticky footer ── */}
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                padding: "16px 24px 20px",
                borderTop: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
                position: "sticky",
                bottom: 0,
                zIndex: 2,
              }}
            >
              <button
                className={styles.confirmBtn}
                onClick={handleAddOfficial}
                disabled={submitting}
              >
                {submitting ? "Adding..." : "Add Member"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Council Member */}
      {showEditOfficialModal && editingOfficial && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            setShowEditOfficialModal(false);
            setEditingOfficial(null);
            setModalMessage("");
          }}
        >
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: "90vh",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 16px",
                borderBottom: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <h2
                className={styles.modalTitle}
                style={{ margin: 0, fontSize: 18 }}
              >
                Edit Council Member
              </h2>
              <button
                onClick={() => {
                  setShowEditOfficialModal(false);
                  setEditingOfficial(null);
                  setModalMessage("");
                }}
                aria-label="Close modal"
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  cursor: "pointer",
                  color: "#64748b",
                  width: 32,
                  height: 32,
                  minWidth: 32,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                overscrollBehavior: "contain",
              }}
            >
              <label className={styles.fieldLabel}>
                Full Name <span style={{ color: "#e53e3e" }}>*</span>
              </label>
              <input
                className={styles.input}
                placeholder="Full Name"
                value={editOfficialName}
                onChange={(e) => setEditOfficialName(e.target.value.replace(/[0-9]/g, ""))}
              />
              <p className={styles.fieldHint} style={{ marginTop: 4 }}>
                Position is set per term now — edit it from this member's
                Term History instead (open their profile, then Edit on the
                relevant term).
              </p>
              <div className={styles.fileUploadBox}>
                <input
                  type="file"
                  accept="image/*"
                  id="editPhotoInput"
                  style={{ display: "none" }}
                  onChange={(e) => setEditOfficialPhoto(e.target.files[0])}
                />
                <label htmlFor="editPhotoInput" className={styles.fileLabel}>
                  {editOfficialPhoto ? (
                    <>
                      <CheckSquare size={14} strokeWidth={1.5} />{" "}
                      {editOfficialPhoto.name}
                    </>
                  ) : (
                    <>
                      <Upload size={14} strokeWidth={1.5} /> Click to replace
                      photo (optional)
                    </>
                  )}
                </label>
                {editingOfficial.photo && !editOfficialPhoto && (
                  <p className={styles.fileHint}>Current photo on file</p>
                )}
              </div>
              <LoginAccountField
                member={editingOfficial}
                styles={styles}
                onChanged={(updated) => {
                  setEditingOfficial((prev) => (prev ? { ...prev, user_id: updated.user_id } : prev));
                  fetchOfficials();
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                padding: "16px 24px 20px",
                borderTop: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <button
                className={styles.confirmBtn}
                onClick={handleUpdateOfficial}
                disabled={submitting}
              >
                {submitting ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Official Profile */}
      {showOfficialProfile && selectedOfficialProfile && (
        <div
          className={styles.modalOverlay}
          onClick={() => setShowOfficialProfile(false)}
        >
          <div
            className={styles.officialModal}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── Hero header ── */}
            <div className={styles.officialHero}>
              <button
                className={styles.officialModalCloseBtn}
                onClick={() => setShowOfficialProfile(false)}
                aria-label="Close modal"
              >
                <X size={16} />
              </button>
              <div className={styles.officialHeroTop}>
                <div className={styles.officialAvatarWrap}>
                  {selectedOfficialProfile.photo ? (
                    <img
                      src={selectedOfficialProfile.photo}
                      alt={selectedOfficialProfile.full_name}
                      className={styles.officialAvatarPhoto}
                    />
                  ) : (
                    <div className={styles.officialAvatarFallback}>
                      {selectedOfficialProfile.full_name.charAt(0)}
                    </div>
                  )}
                  {selectedOfficialProfile.active_term && (
                    <span
                      className={`${styles.officialStatusDot} ${
                        selectedOfficialProfile.active_term.status === "active"
                          ? styles.officialStatusDotActive
                          : styles.officialStatusDotEnded
                      }`}
                    />
                  )}
                </div>
                <div>
                  <div className={styles.officialHeroName}>
                    {selectedOfficialProfile.full_name}
                  </div>
                  {selectedOfficialProfile.position && (
                    <div>
                      <span className={styles.officialHeroPosition}>
                        {selectedOfficialProfile.position}
                      </span>
                    </div>
                  )}
                  {selectedOfficialProfile.active_term && (
                    <div className={styles.officialHeroMeta}>
                      <TermStatusBadge
                        status={selectedOfficialProfile.active_term.status}
                      />
                      <span className={styles.officialHeroTermLabel}>
                        {selectedOfficialProfile.active_term.term_period}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div
                className={`${styles.officialStatsRow} ${
                  isSecretary ? styles.officialStatsRowWide : ""
                }`}
              >
                <div className={styles.officialStatChip}>
                  <div className={styles.officialStatValue}>
                    {(selectedOfficialProfile.terms || []).length}
                  </div>
                  <div className={styles.officialStatLabel}>Terms</div>
                </div>
                <div className={styles.officialStatChip}>
                  <div className={styles.officialStatValue}>
                    {getOfficialOrdinances(selectedOfficialProfile.id).length}
                  </div>
                  <div className={styles.officialStatLabel}>Ordinances</div>
                </div>
                <div className={styles.officialStatChip}>
                  <div className={styles.officialStatValue}>
                    {getOfficialResolutions(selectedOfficialProfile.id).length}
                  </div>
                  <div className={styles.officialStatLabel}>Resolutions</div>
                </div>
              </div>
            </div>

            {/* ── Tabs ── */}
            <div className={styles.officialTabsWrap}>
              <TabNavigation
                tabs={[
                  {
                    id: "terms",
                    label: "Term History",
                    badge: (selectedOfficialProfile.terms || []).length,
                  },
                  {
                    id: "ordinances",
                    label: "Ordinances",
                    badge: getOfficialOrdinances(selectedOfficialProfile.id)
                      .length,
                  },
                  {
                    id: "resolutions",
                    label: "Resolutions",
                    badge: getOfficialResolutions(selectedOfficialProfile.id)
                      .length,
                  },
                  // No Rejected tab here: a rejected record is private to its
                  // author and shows only in their own My Profile.
                ]}
                activeTab={officialProfileTab}
                onTabChange={setOfficialProfileTab}
              />
            </div>

            {/* ── Tab content ── */}
            <div className={styles.officialModalBody}>
              {officialProfileTab === "terms" && (
                <>
                  {canManageOfficials && (
                    <div style={{ textAlign: "right", marginBottom: 12 }}>
                      <button
                        className={styles.addBtn}
                        style={{ fontSize: 11, padding: "4px 10px" }}
                        onClick={() =>
                          handleOpenAddTerm(selectedOfficialProfile.id)
                        }
                      >
                        + Add Term
                      </button>
                    </div>
                  )}
                  {(selectedOfficialProfile.terms || []).length === 0 ? (
                    <p className={styles.officialEmptyState}>
                      No term records yet.
                    </p>
                  ) : (
                    (selectedOfficialProfile.terms || []).map((term) => (
                      <div
                        key={term.id}
                        className={`${styles.officialTermCard} ${
                          term.status === "active"
                            ? styles.officialTermCardActive
                            : ""
                        }`}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className={styles.officialTermTop}>
                            <span className={styles.officialTermPeriod}>
                              {term.term_period}
                            </span>
                            <TermStatusBadge status={term.status} />
                            {term.is_reelected && (
                              <span className={styles.officialReelectedTag}>
                                Re-elected
                              </span>
                            )}
                          </div>
                          <div className={styles.officialTermRange}>
                            {formatDate(term.term_start)} →{" "}
                            {term.term_end ? (
                              formatDate(term.term_end)
                            ) : (
                              <em>Present</em>
                            )}
                          </div>
                          {term.notes && (
                            <div className={styles.officialTermNote}>
                              {term.notes}
                            </div>
                          )}
                        </div>
                        {canManageOfficials && (
                          <div className={styles.officialTermActions}>
                            <button
                              className={styles.officialIconBtn}
                              title="Edit term"
                              onClick={() =>
                                handleOpenEditTerm(
                                  selectedOfficialProfile.id,
                                  term
                                )
                              }
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              className={`${styles.officialIconBtn} ${styles.officialIconBtnDanger}`}
                              title="Delete term"
                              onClick={() =>
                                setDeleteTarget({
                                  id: term.id,
                                  type: "term",
                                  name: term.term_period,
                                  memberId: selectedOfficialProfile.id,
                                })
                              }
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </>
              )}

              {officialProfileTab === "ordinances" &&
                (getOfficialOrdinances(selectedOfficialProfile.id).length ===
                0 ? (
                  <p className={styles.officialEmptyState}>
                    No ordinances passed yet.
                  </p>
                ) : (
                  getOfficialOrdinances(selectedOfficialProfile.id).map(
                    (o) => (
                      <div key={o.id} className={styles.officialRecordItem}>
                        <div className={styles.officialRecordIcon}>
                          <ClipboardList size={16} strokeWidth={1.5} />
                        </div>
                        <div className={styles.officialRecordBody}>
                          <div className={styles.officialRecordTitle}>
                            {o.title}
                          </div>
                          <div className={styles.officialRecordMeta}>
                            {o.filetype === "application/pdf" ? "PDF" : "OCR"}
                            {" · "}
                            {new Date(recordDate(o)).toLocaleDateString(
                              "en-PH",
                              { year: "numeric", month: "long", day: "numeric" }
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => setOfficialRecordPreview(o)}
                          className={styles.officialViewLink}
                          title="View"
                        >
                          <Eye size={14} />
                        </button>
                      </div>
                    )
                  )
                ))}

              {officialProfileTab === "resolutions" &&
                (getOfficialResolutions(selectedOfficialProfile.id).length ===
                0 ? (
                  <p className={styles.officialEmptyState}>
                    No resolutions passed yet.
                  </p>
                ) : (
                  getOfficialResolutions(selectedOfficialProfile.id).map(
                    (r) => (
                      <div key={r.id} className={styles.officialRecordItem}>
                        <div className={styles.officialRecordIcon}>
                          <FileText size={16} strokeWidth={1.5} />
                        </div>
                        <div className={styles.officialRecordBody}>
                          <div className={styles.officialRecordTitle}>
                            {r.title}
                          </div>
                          <div className={styles.officialRecordMeta}>
                            {r.filetype === "application/pdf" ? "PDF" : "OCR"}
                            {" · "}
                            {new Date(recordDate(r)).toLocaleDateString(
                              "en-PH",
                              { year: "numeric", month: "long", day: "numeric" }
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => setOfficialRecordPreview(r)}
                          className={styles.officialViewLink}
                          title="View"
                        >
                          <Eye size={14} />
                        </button>
                      </div>
                    )
                  )
                ))}

            </div>
          </div>
        </div>
      )}

      {officialRecordPreview && (
        <PresentOverlay
          record={officialRecordPreview}
          onClose={() => setOfficialRecordPreview(null)}
        />
      )}

      {/* Add Term */}
      {showAddTermModal && termTarget && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            setShowAddTermModal(false);
            setModalMessage("");
          }}
        >
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: "90vh",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 16px",
                borderBottom: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <h2
                className={styles.modalTitle}
                style={{ margin: 0, fontSize: 18 }}
              >
                <History size={16} /> Add Term Record
              </h2>
              <button
                onClick={() => {
                  setShowAddTermModal(false);
                  setModalMessage("");
                }}
                aria-label="Close modal"
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  cursor: "pointer",
                  color: "#64748b",
                  width: 32,
                  height: 32,
                  minWidth: 32,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                overscrollBehavior: "contain",
              }}
            >
              <TermFormFields
                form={termForm}
                setForm={setTermForm}
                styles={styles}
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                padding: "16px 24px 20px",
                borderTop: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <button
                className={styles.confirmBtn}
                onClick={handleSaveTerm}
                disabled={submitting}
              >
                {submitting ? "Saving..." : "Save Term"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Term */}
      {showEditTermModal && termTarget && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            setShowEditTermModal(false);
            setModalMessage("");
          }}
        >
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: "90vh",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 16px",
                borderBottom: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <h2
                className={styles.modalTitle}
                style={{ margin: 0, fontSize: 18 }}
              >
                <Pencil size={16} /> Edit Term Record
              </h2>
              <button
                onClick={() => {
                  setShowEditTermModal(false);
                  setModalMessage("");
                }}
                aria-label="Close modal"
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  cursor: "pointer",
                  color: "#64748b",
                  width: 32,
                  height: 32,
                  minWidth: 32,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                overscrollBehavior: "contain",
              }}
            >
              <TermFormFields
                form={termForm}
                setForm={setTermForm}
                styles={styles}
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                padding: "16px 24px 20px",
                borderTop: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <button
                className={styles.confirmBtn}
                onClick={handleUpdateTerm}
                disabled={submitting}
              >
                {submitting ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Ordinance */}
      {showOrdinanceModal && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            setShowOrdinanceModal(false);
            setOrdinanceFile(null);
            clearRecordScan("ordinance");
            setOrdinanceTitle("");
            setOrdinanceDate("");
            setSelectedOfficials([]);
            setUploadType("");
            setModalMessage("");
          }}
        >
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: "90vh",
              overflow: "hidden",
            }}
          >
            {/* ── Sticky header ── */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 16px",
                borderBottom: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <h2
                className={styles.modalTitle}
                style={{ margin: 0, fontSize: 18 }}
              >
                Upload Ordinance
              </h2>
              <button
                onClick={() => {
                  setShowOrdinanceModal(false);
                  setOrdinanceFile(null);
                  clearRecordScan("ordinance");
                  setOrdinanceTitle("");
                  setOrdinanceDate("");
                  setSelectedOfficials([]);
                  setUploadType("");
                  setModalMessage("");
                }}
                aria-label="Close modal"
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  cursor: "pointer",
                  color: "#64748b",
                  width: 32,
                  height: 32,
                  minWidth: 32,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* ── Scrollable body ── */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                overscrollBehavior: "contain",
              }}
            >
              <input
                className={styles.input}
                placeholder="Ordinance Title"
                value={ordinanceTitle}
                onChange={(e) => setOrdinanceTitle(e.target.value.toUpperCase())}
              />
              <label className={styles.fieldLabel}>Date</label>
              <input
                className={styles.input}
                type="date"
                value={ordinanceDate}
                onChange={(e) => setOrdinanceDate(e.target.value)}
              />
              <label className={styles.fieldLabel}>Sector</label>
              <SectorSelect
                value={ordinanceCategory}
                onChange={setOrdinanceCategory}
                options={ORDINANCE_CATEGORIES.filter((c) => c !== "All")}
                placeholder="— Select sector —"
                searchable
              />
              <div className={styles.fileUploadBox}>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,image/*"
                  id="fileInput"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files[0];
                    setOrdinanceFile(file);
                    detectRecordMeta("ordinance", file);
                  }}
                />
                <label htmlFor="fileInput" className={styles.fileLabel}>
                  {ordinanceFile ? (
                    <>
                      <CheckSquare size={14} strokeWidth={1.5} />{" "}
                      {ordinanceFile.name}
                    </>
                  ) : (
                    <>
                      <Upload size={14} strokeWidth={1.5} /> Click to choose
                      file
                    </>
                  )}
                </label>
                <p className={styles.fileHint}>
                  Accepted: PDF, Word (.doc/.docx), or Image (JPG, PNG)
                </p>
              </div>
              <RecordScanNotice scan={recordScan.ordinance} />

              <div className={styles.officialsSelectSection}>
                <p className={styles.officialsSelectLabel}>
                  Tag the Council Member who authored this ordinance:
                </p>
                <OfficialsCheckList
                  officials={officials}
                  selected={selectedOfficials}
                  onToggle={toggleOfficial}
                  styles={styles}
                />
              </div>
            </div>

            {/* ── Sticky footer ── */}
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                padding: "16px 24px 20px",
                borderTop: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <button
                className={styles.confirmBtn}
                onClick={handleUploadOrdinance}
                disabled={submitting}
              >
                {submitting ? "Uploading..." : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Ordinance */}
      {showEditOrdinanceModal && editingOrdinance && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            setShowEditOrdinanceModal(false);
            setEditingOrdinance(null);
            setModalMessage("");
          }}
        >
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: "90vh",
              overflow: "hidden",
            }}
          >
            {/* ── Sticky header ── */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 16px",
                borderBottom: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <h2
                className={styles.modalTitle}
                style={{ margin: 0, fontSize: 18 }}
              >
                Edit Ordinance
              </h2>
              <button
                onClick={() => {
                  setShowEditOrdinanceModal(false);
                  setEditingOrdinance(null);
                  setModalMessage("");
                }}
                aria-label="Close modal"
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  cursor: "pointer",
                  color: "#64748b",
                  width: 32,
                  height: 32,
                  minWidth: 32,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* ── Scrollable body ── */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                overscrollBehavior: "contain",
              }}
            >
              <input
                className={styles.input}
                placeholder="Ordinance Number (optional — assigned at publish time if left blank)"
                value={editOrdinanceNumber}
                onChange={(e) => setEditOrdinanceNumber(e.target.value)}
              />
              <input
                className={styles.input}
                placeholder="Ordinance Title"
                value={editOrdinanceTitle}
                onChange={(e) => setEditOrdinanceTitle(e.target.value.toUpperCase())}
              />
              <label className={styles.fieldLabel}>
                {editingOrdinance.approved_on ? "Approved Date" : "Date"}
              </label>
              <input
                className={styles.input}
                type="date"
                value={editOrdinanceDate}
                onChange={(e) => setEditOrdinanceDate(e.target.value)}
              />
              <label className={styles.fieldLabel}>Sector</label>
              <SectorSelect
                value={editOrdinanceCategory}
                onChange={setEditOrdinanceCategory}
                options={ORDINANCE_CATEGORIES.filter((c) => c !== "All")}
                placeholder="— Select sector —"
                searchable
              />
              <p className={styles.officialsSelectLabel}>
                Replace file (optional):
              </p>
              <div className={styles.fileUploadBox}>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,image/*"
                  id="editFileInput"
                  style={{ display: "none" }}
                  onChange={(e) => setEditOrdinanceFile(e.target.files[0])}
                />
                <label htmlFor="editFileInput" className={styles.fileLabel}>
                  {editOrdinanceFile ? (
                    <>
                      <CheckSquare size={14} strokeWidth={1.5} />{" "}
                      {editOrdinanceFile.name}
                    </>
                  ) : (
                    <>
                      <Upload size={14} strokeWidth={1.5} />{" "}
                      Click to replace file
                    </>
                  )}
                </label>
                <p className={styles.fileHint}>
                  Current file: {editingOrdinance.filename}
                </p>
              </div>
              <div className={styles.officialsSelectSection}>
                <p className={styles.officialsSelectLabel}>
                  Tag the Council Member who authored this ordinance:
                </p>
                <OfficialsCheckList
                  officials={officials}
                  selected={editSelectedOfficials}
                  onToggle={toggleEditOfficial}
                  styles={styles}
                />
              </div>
              <div className={styles.officialsSelectSection}>
                <p className={styles.officialsSelectLabel}>
                  Tag the Co-Authors <span className={styles.fieldHint}>(optional)</span>:
                </p>
                <OfficialsCheckList
                  officials={officials}
                  selected={editCoAuthors}
                  onToggle={toggleEditCoAuthor}
                  styles={styles}
                />
              </div>
              <div className={styles.officialsSelectSection}>
                <p className={styles.officialsSelectLabel}>
                  Tag the Sponsors <span className={styles.fieldHint}>(optional)</span>:
                </p>
                <OfficialsCheckList
                  officials={officials}
                  selected={editSponsors}
                  onToggle={toggleEditSponsor}
                  styles={styles}
                />
              </div>
            </div>

            {/* ── Sticky footer ── */}
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                padding: "16px 24px 20px",
                borderTop: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <button
                className={styles.confirmBtn}
                onClick={handleUpdateOrdinance}
                disabled={submitting}
              >
                {submitting ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Resolution */}
      {showResolutionModal && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            setShowResolutionModal(false);
            setResolutionFile(null);
            clearRecordScan("resolution");
            setResolutionTitle("");
            setResolutionDate("");
            setResolutionCategory("");
            setSelectedResolutionOfficials([]);
            setModalMessage("");
          }}
        >
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: "90vh",
              overflow: "hidden",
            }}
          >
            {/* ── Sticky header ── */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 16px",
                borderBottom: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <h2
                className={styles.modalTitle}
                style={{ margin: 0, fontSize: 18 }}
              >
                <Gavel size={18} strokeWidth={1.5} /> Upload Resolution
              </h2>
              <button
                onClick={() => {
                  setShowResolutionModal(false);
                  setResolutionFile(null);
                  clearRecordScan("resolution");
                  setResolutionTitle("");
                  setResolutionDate("");
                  setResolutionCategory("");
                  setSelectedResolutionOfficials([]);
                  setModalMessage("");
                }}
                aria-label="Close modal"
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  cursor: "pointer",
                  color: "#64748b",
                  width: 32,
                  height: 32,
                  minWidth: 32,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* ── Scrollable body ── */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                overscrollBehavior: "contain",
              }}
            >
              <input
                className={styles.input}
                placeholder="Resolution Title"
                value={resolutionTitle}
                onChange={(e) => setResolutionTitle(e.target.value.toUpperCase())}
              />
              <label className={styles.fieldLabel}>Date</label>
              <input
                className={styles.input}
                type="date"
                value={resolutionDate}
                onChange={(e) => setResolutionDate(e.target.value)}
              />
              <label className={styles.fieldLabel}>Sector</label>
              <SectorSelect
                value={resolutionCategory}
                onChange={setResolutionCategory}
                options={RESOLUTION_CATEGORIES.filter((c) => c !== "All")}
                placeholder="— Select sector —"
                searchable
              />
              <div className={styles.fileUploadBox}>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,image/*"
                  id="resFileInput"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files[0];
                    setResolutionFile(file);
                    detectRecordMeta("resolution", file);
                  }}
                />
                <label htmlFor="resFileInput" className={styles.fileLabel}>
                  {resolutionFile ? (
                    <>
                      <CheckSquare size={14} strokeWidth={1.5} />{" "}
                      {resolutionFile.name}
                    </>
                  ) : (
                    <>
                      <Upload size={14} strokeWidth={1.5} /> Click to choose
                      file
                    </>
                  )}
                </label>
                <p className={styles.fileHint}>
                  Accepted: PDF, Word (.doc/.docx), or Image (JPG, PNG)
                </p>
              </div>
              <RecordScanNotice scan={recordScan.resolution} />

              <div className={styles.officialsSelectSection}>
                <p className={styles.officialsSelectLabel}>
                  Tag the Council Member who sponsored this resolution:
                </p>
                <OfficialsCheckList
                  officials={officials}
                  selected={selectedResolutionOfficials}
                  onToggle={toggleResolutionOfficial}
                  styles={styles}
                />
              </div>
            </div>

            {/* ── Sticky footer ── */}
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                padding: "16px 24px 20px",
                borderTop: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <button
                className={styles.confirmBtn}
                onClick={handleUploadResolution}
                disabled={submitting}
              >
                {submitting ? "Uploading..." : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Resolution */}
      {showEditResolutionModal && editingResolution && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            setShowEditResolutionModal(false);
            setEditingResolution(null);
            setModalMessage("");
          }}
        >
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: "90vh",
              overflow: "hidden",
            }}
          >
            {/* ── Sticky header ── */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 16px",
                borderBottom: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <h2
                className={styles.modalTitle}
                style={{ margin: 0, fontSize: 18 }}
              >
                <Pencil size={16} strokeWidth={1.5} /> Edit Resolution
              </h2>
              <button
                onClick={() => {
                  setShowEditResolutionModal(false);
                  setEditingResolution(null);
                  setModalMessage("");
                }}
                aria-label="Close modal"
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  cursor: "pointer",
                  color: "#64748b",
                  width: 32,
                  height: 32,
                  minWidth: 32,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* ── Scrollable body ── */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                overscrollBehavior: "contain",
              }}
            >
              <input
                className={styles.input}
                placeholder="Resolution Number (optional — assigned at publish time if left blank)"
                value={editResolutionNumber}
                onChange={(e) => setEditResolutionNumber(e.target.value.toUpperCase())}
              />
              <input
                className={styles.input}
                placeholder="Resolution Title"
                value={editResolutionTitle}
                onChange={(e) => setEditResolutionTitle(e.target.value.toUpperCase())}
              />
              <label className={styles.fieldLabel}>
                {editingResolution.approved_on ? "Approved Date" : "Date"}
              </label>
              <input
                className={styles.input}
                type="date"
                value={editResolutionDate}
                onChange={(e) => setEditResolutionDate(e.target.value)}
              />
              <label className={styles.fieldLabel}>Sector</label>
              <SectorSelect
                value={editResolutionCategory}
                onChange={setEditResolutionCategory}
                options={RESOLUTION_CATEGORIES.filter((c) => c !== "All")}
                placeholder="— Select sector —"
                searchable
              />
              <p className={styles.officialsSelectLabel}>
                Replace file (optional):
              </p>
              <div className={styles.fileUploadBox}>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,image/*"
                  id="editResFileInput"
                  style={{ display: "none" }}
                  onChange={(e) => setEditResolutionFile(e.target.files[0])}
                />
                <label htmlFor="editResFileInput" className={styles.fileLabel}>
                  {editResolutionFile ? (
                    <>
                      <CheckSquare size={14} strokeWidth={1.5} />{" "}
                      {editResolutionFile.name}
                    </>
                  ) : (
                    <>
                      <Upload size={14} strokeWidth={1.5} />{" "}
                      Click to replace file
                    </>
                  )}
                </label>
                <p className={styles.fileHint}>
                  Current file: {editingResolution.filename}
                </p>
              </div>
              <div className={styles.officialsSelectSection}>
                <p className={styles.officialsSelectLabel}>
                  Tag the Council Member who sponsored this resolution:
                </p>
                <OfficialsCheckList
                  officials={officials}
                  selected={editResolutionSelectedOfficials}
                  onToggle={toggleEditResolutionOfficial}
                  styles={styles}
                />
              </div>
              <div className={styles.officialsSelectSection}>
                <p className={styles.officialsSelectLabel}>
                  Tag the Co-Sponsors <span className={styles.fieldHint}>(optional)</span>:
                </p>
                <OfficialsCheckList
                  officials={officials}
                  selected={editResCoAuthors}
                  onToggle={toggleEditResCoAuthor}
                  styles={styles}
                />
              </div>
            </div>

            {/* ── Sticky footer ── */}
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                padding: "16px 24px 20px",
                borderTop: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <button
                className={styles.confirmBtn}
                onClick={handleUpdateResolution}
                disabled={submitting}
              >
                {submitting ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Extracted Text */}
      {showTextModal && (
        <div
          className={styles.modalOverlay}
          onClick={() => setShowTextModal(false)}
        >
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: "90vh",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 16px",
                borderBottom: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <h2
                className={styles.modalTitle}
                style={{ margin: 0, fontSize: 18 }}
              >
                Extracted Text (OCR)
              </h2>
              <button
                onClick={() => setShowTextModal(false)}
                aria-label="Close modal"
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  cursor: "pointer",
                  color: "#64748b",
                  width: 32,
                  height: 32,
                  minWidth: 32,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                overscrollBehavior: "contain",
              }}
            >
              <textarea
                className={styles.textArea}
                value={extractedText}
                readOnly
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                padding: "16px 24px 20px",
                borderTop: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <button
                className={styles.cancelBtn}
                onClick={() => {
                  navigator.clipboard.writeText(extractedText);
                  showMsg("Copied to clipboard!");
                }}
              >
                <Copy size={13} /> Copy Text
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Session */}
      {showSessionModal && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            setShowSessionModal(false);
            resetSessionForm();
            setModalMessage("");
          }}
        >
          <div
            className={`${styles.modal} ${styles.sessionModal}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: "90vh",
              overflow: "hidden",
            }}
          >
            {/* ── Sticky header ── */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 16px",
                borderBottom: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <h2
                className={styles.modalTitle}
                style={{ margin: 0, fontSize: 18 }}
              >
                <BookOpen size={18} strokeWidth={1.5} /> Add Session Minutes
              </h2>
              <button
                onClick={() => {
                  setShowSessionModal(false);
                  resetSessionForm();
                  setModalMessage("");
                }}
                aria-label="Close modal"
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  cursor: "pointer",
                  color: "#64748b",
                  width: 32,
                  height: 32,
                  minWidth: 32,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* ── Scrollable body ── */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                overscrollBehavior: "contain",
              }}
            >
              <div className={styles.sessionFormGrid}>
                <div className={styles.sessionFormCol}>
                  <label className={styles.fieldLabel}>Session Number</label>
                  <input
                    className={styles.input}
                    placeholder="e.g. MINUTES NO. 01 - 2025"
                    value={sessionForm.session_number}
                    onChange={(e) =>
                      setSessionForm({
                        ...sessionForm,
                        session_number: e.target.value.toUpperCase(),
                      })
                    }
                  />
                  <p className={styles.fieldHint}>
                    Suggested automatically — feel free to edit it.
                  </p>
                </div>
                <div className={styles.sessionFormCol}>
                  <label className={styles.fieldLabel}>
                    Session Date <span style={{ color: "#e53e3e" }}>*</span>
                  </label>
                  <input
                    className={styles.input}
                    type="date"
                    value={sessionForm.session_date}
                    onChange={(e) => {
                      const newDate = e.target.value;
                      setSessionForm((prev) => {
                        const year = newDate
                          ? new Date(newDate).getFullYear()
                          : getCurrentYear();
                        const shouldUpdate =
                          prev.session_number === lastSessionSuggestion.current;
                        if (!shouldUpdate)
                          return { ...prev, session_date: newDate };
                        const suggested = suggestSessionNumber(
                          sessionMinutes,
                          year,
                          prev.session_type
                        );
                        lastSessionSuggestion.current = suggested;
                        return {
                          ...prev,
                          session_date: newDate,
                          session_number: suggested,
                        };
                      });
                    }}
                  />
                </div>
                <div className={styles.sessionFormCol}>
                  <label className={styles.fieldLabel}>Session Type</label>
                  <select
                    className={styles.input}
                    value={sessionForm.session_type}
                    onChange={(e) => {
                      const newType = e.target.value;
                      setSessionForm((prev) => {
                        const year = prev.session_date
                          ? new Date(prev.session_date).getFullYear()
                          : getCurrentYear();
                        const shouldUpdate =
                          prev.session_number === lastSessionSuggestion.current;
                        if (!shouldUpdate)
                          return { ...prev, session_type: newType };
                        const suggested = suggestSessionNumber(
                          sessionMinutes,
                          year,
                          newType
                        );
                        lastSessionSuggestion.current = suggested;
                        return {
                          ...prev,
                          session_type: newType,
                          session_number: suggested,
                        };
                      });
                    }}
                  >
                    <option value="regular">Regular Session</option>
                    <option value="special">Special Session</option>
                  </select>
                </div>
                <div className={styles.sessionFormCol}>
                  <label className={styles.fieldLabel}>Venue</label>
                  <input
                    className={styles.input}
                    placeholder="e.g. Session Hall"
                    value={sessionForm.venue}
                    onChange={(e) =>
                      setSessionForm({ ...sessionForm, venue: e.target.value })
                    }
                  />
                </div>
              </div>
              <>
                  <div className={styles.fileUploadBox}>
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,image/*"
                      id="sessionFileInput"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files[0];
                        e.target.value = "";
                        setSessionFile(file);
                        detectSessionMeta("minutes", file);
                      }}
                    />
                    <label
                      htmlFor="sessionFileInput"
                      className={styles.fileLabel}
                    >
                      {sessionFile ? (
                        <>
                          <CheckSquare size={14} strokeWidth={1.5} />{" "}
                          {sessionFile.name}
                        </>
                      ) : (
                        <>
                          <Upload size={14} strokeWidth={1.5} /> Click to choose
                          file
                        </>
                      )}
                    </label>
                    <p className={styles.fileHint}>
                      Accepted: PDF, Word (.doc/.docx), or Image (JPG, PNG)
                    </p>
                  </div>
                  <RecordScanNotice scan={recordScan.minutes} variant="session" />
                </>
            </div>

            {/* ── Sticky footer ── */}
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                padding: "16px 24px 20px",
                borderTop: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <button
                className={styles.confirmBtn}
                onClick={handleAddSession}
                disabled={submitting}
              >
                {submitting ? "Saving..." : "Save Session"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Session */}
      {showEditSessionModal && editingSession && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            setShowEditSessionModal(false);
            setEditingSession(null);
            setModalMessage("");
          }}
        >
          <div
            className={`${styles.modal} ${styles.sessionModal}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: "90vh",
              overflow: "hidden",
            }}
          >
            {/* ── Sticky header ── */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 16px",
                borderBottom: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <h2
                className={styles.modalTitle}
                style={{ margin: 0, fontSize: 18 }}
              >
                <Pencil size={16} strokeWidth={1.5} /> Edit Session Minutes
              </h2>
              <button
                onClick={() => {
                  setShowEditSessionModal(false);
                  setEditingSession(null);
                  setModalMessage("");
                }}
                aria-label="Close modal"
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  cursor: "pointer",
                  color: "#64748b",
                  width: 32,
                  height: 32,
                  minWidth: 32,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* ── Scrollable body ── */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                overscrollBehavior: "contain",
              }}
            >
              <div className={styles.sessionFormGrid}>
                <div className={styles.sessionFormCol}>
                  <label className={styles.fieldLabel}>Session Number</label>
                  <input
                    className={styles.input}
                    placeholder="e.g. MINUTES NO. 01 - 2025"
                    value={editSessionForm.session_number}
                    onChange={(e) =>
                      setEditSessionForm({
                        ...editSessionForm,
                        session_number: e.target.value.toUpperCase(),
                      })
                    }
                  />
                </div>
                <div className={styles.sessionFormCol}>
                  <label className={styles.fieldLabel}>
                    Session Date <span style={{ color: "#e53e3e" }}>*</span>
                  </label>
                  <input
                    className={styles.input}
                    type="date"
                    value={editSessionForm.session_date}
                    onChange={(e) =>
                      setEditSessionForm({
                        ...editSessionForm,
                        session_date: e.target.value,
                      })
                    }
                  />
                </div>
                <div className={styles.sessionFormCol}>
                  <label className={styles.fieldLabel}>Session Type</label>
                  <select
                    className={styles.input}
                    value={editSessionForm.session_type}
                    onChange={(e) =>
                      setEditSessionForm({
                        ...editSessionForm,
                        session_type: e.target.value,
                      })
                    }
                  >
                    <option value="regular">Regular Session</option>
                    <option value="special">Special Session</option>
                  </select>
                </div>
                <div className={styles.sessionFormCol}>
                  <label className={styles.fieldLabel}>Venue</label>
                  <input
                    className={styles.input}
                    placeholder="Venue"
                    value={editSessionForm.venue}
                    onChange={(e) =>
                      setEditSessionForm({
                        ...editSessionForm,
                        venue: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <label className={styles.fieldLabel}>
                Minutes of the Session
              </label>
              <textarea
                className={styles.textArea}
                value={editSessionForm.minutes_text}
                onChange={(e) =>
                  setEditSessionForm({
                    ...editSessionForm,
                    minutes_text: e.target.value,
                  })
                }
                rows={8}
              />

              <label className={styles.fieldLabel} style={{ marginTop: 10 }}>
                Document{" "}
                <span className={styles.fieldHint}>
                  (attach or replace the original PDF, Word or image)
                </span>
              </label>
              <div className={styles.fileUploadBox}>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,image/*"
                  id="editSessionFileInput"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files[0] || null;
                    e.target.value = "";
                    setEditSessionFile(file);
                  }}
                />
                <label htmlFor="editSessionFileInput" className={styles.fileLabel}>
                  {editSessionFile ? (
                    <>
                      <CheckSquare size={14} strokeWidth={1.5} />{" "}
                      {editSessionFile.name}
                    </>
                  ) : (
                    <>
                      <Upload size={14} strokeWidth={1.5} />{" "}
                      {editingSession.filepath
                        ? "Click to replace file"
                        : "Click to choose file"}
                    </>
                  )}
                </label>
                <p className={styles.fileHint}>
                  {editingSession.filepath
                    ? `Current file: ${editingSession.filename}`
                    : editingSession.filename
                      ? `Recorded from ${editingSession.filename} — its file wasn't kept. Attach it again to open or download it from the View window.`
                      : "No file attached."}
                </p>
              </div>
            </div>

            {/* ── Sticky footer ── */}
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                padding: "16px 24px 20px",
                borderTop: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <button
                className={styles.confirmBtn}
                onClick={handleUpdateSession}
                disabled={submitting}
              >
                {submitting ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Session Agenda */}
      {showAgendaModal && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            setShowAgendaModal(false);
            resetAgendaForm();
            setModalMessage("");
          }}
        >
          <div
            className={`${styles.modal} ${styles.sessionModal}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: "90vh",
              overflow: "hidden",
            }}
          >
            {/* ── Sticky header ── */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 16px",
                borderBottom: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <h2
                className={styles.modalTitle}
                style={{ margin: 0, fontSize: 18 }}
              >
                <ClipboardList size={18} strokeWidth={1.5} /> Upload Order of
                Business
              </h2>
              <button
                onClick={() => {
                  setShowAgendaModal(false);
                  resetAgendaForm();
                  setModalMessage("");
                }}
                aria-label="Close modal"
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  cursor: "pointer",
                  color: "#64748b",
                  width: 32,
                  height: 32,
                  minWidth: 32,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* ── Scrollable body ── */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                overscrollBehavior: "contain",
              }}
            >
              <div className={styles.sessionFormGrid}>
                <div className={styles.sessionFormCol}>
                  <label className={styles.fieldLabel}>Number</label>
                  <input
                    className={styles.input}
                    placeholder="e.g. AGENDA NO. 01 - 2025"
                    value={agendaForm.session_number}
                    onChange={(e) =>
                      setAgendaForm({
                        ...agendaForm,
                        session_number: e.target.value.toUpperCase(),
                      })
                    }
                  />
                </div>
                <div className={styles.sessionFormCol}>
                  <label className={styles.fieldLabel}>
                    Date <span style={{ color: "#e53e3e" }}>*</span>
                  </label>
                  <input
                    className={styles.input}
                    type="date"
                    value={agendaForm.session_date}
                    onChange={(e) =>
                      setAgendaForm({
                        ...agendaForm,
                        session_date: e.target.value,
                      })
                    }
                  />
                </div>
                <div className={styles.sessionFormCol}>
                  <label className={styles.fieldLabel}>Type</label>
                  <select
                    className={styles.input}
                    value={agendaForm.session_type}
                    onChange={(e) =>
                      setAgendaForm({
                        ...agendaForm,
                        session_type: e.target.value,
                      })
                    }
                  >
                    <option value="regular">Regular</option>
                    <option value="special">Special</option>
                  </select>
                </div>
                <div className={styles.sessionFormCol}>
                  <label className={styles.fieldLabel}>Venue</label>
                  <input
                    className={styles.input}
                    placeholder="Venue"
                    value={agendaForm.venue}
                    onChange={(e) =>
                      setAgendaForm({ ...agendaForm, venue: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className={styles.fileUploadBox}>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx"
                  id="agendaFileInput"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files[0];
                    e.target.value = "";
                    setAgendaFile(file);
                    detectSessionMeta("agenda", file);
                  }}
                />
                <label htmlFor="agendaFileInput" className={styles.fileLabel}>
                  {agendaFile ? (
                    <>
                      <CheckSquare size={14} strokeWidth={1.5} />{" "}
                      {agendaFile.name}
                    </>
                  ) : (
                    <>
                      <Upload size={14} strokeWidth={1.5} /> Click to choose
                      file
                    </>
                  )}
                </label>
                <p className={styles.fileHint}>
                  Accepted: PDF or Word (.doc/.docx) only — the system
                  auto-detects which.
                </p>
              </div>
              <RecordScanNotice scan={recordScan.agenda} variant="session" />
            </div>

            {/* ── Sticky footer ── */}
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                padding: "16px 24px 20px",
                borderTop: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <button
                className={styles.confirmBtn}
                onClick={handleAddAgenda}
                disabled={submitting}
              >
                {submitting ? "Uploading..." : "Upload Order of Business"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Session Agenda */}
      {showEditAgendaModal && editingAgenda && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            setShowEditAgendaModal(false);
            setEditingAgenda(null);
            setModalMessage("");
          }}
        >
          <div
            className={`${styles.modal} ${styles.sessionModal}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: "90vh",
              overflow: "hidden",
            }}
          >
            {/* ── Sticky header ── */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 16px",
                borderBottom: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <h2
                className={styles.modalTitle}
                style={{ margin: 0, fontSize: 18 }}
              >
                <Pencil size={16} strokeWidth={1.5} /> Edit Order of Business
              </h2>
              <button
                onClick={() => {
                  setShowEditAgendaModal(false);
                  setEditingAgenda(null);
                  setModalMessage("");
                }}
                aria-label="Close modal"
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  cursor: "pointer",
                  color: "#64748b",
                  width: 32,
                  height: 32,
                  minWidth: 32,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* ── Scrollable body ── */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                overscrollBehavior: "contain",
              }}
            >
              <div className={styles.sessionFormGrid}>
                <div className={styles.sessionFormCol}>
                  <label className={styles.fieldLabel}>Session Number</label>
                  <input
                    className={styles.input}
                    placeholder="e.g. AGENDA NO. 01 - 2025"
                    value={editAgendaForm.session_number}
                    onChange={(e) =>
                      setEditAgendaForm({
                        ...editAgendaForm,
                        session_number: e.target.value.toUpperCase(),
                      })
                    }
                  />
                </div>
                <div className={styles.sessionFormCol}>
                  <label className={styles.fieldLabel}>
                    Session Date <span style={{ color: "#e53e3e" }}>*</span>
                  </label>
                  <input
                    className={styles.input}
                    type="date"
                    value={editAgendaForm.session_date}
                    onChange={(e) =>
                      setEditAgendaForm({
                        ...editAgendaForm,
                        session_date: e.target.value,
                      })
                    }
                  />
                </div>
                <div className={styles.sessionFormCol}>
                  <label className={styles.fieldLabel}>Session Type</label>
                  <select
                    className={styles.input}
                    value={editAgendaForm.session_type}
                    onChange={(e) =>
                      setEditAgendaForm({
                        ...editAgendaForm,
                        session_type: e.target.value,
                      })
                    }
                  >
                    <option value="regular">Regular Session</option>
                    <option value="special">Special Session</option>
                  </select>
                </div>
                <div className={styles.sessionFormCol}>
                  <label className={styles.fieldLabel}>Venue</label>
                  <input
                    className={styles.input}
                    placeholder="Venue"
                    value={editAgendaForm.venue}
                    onChange={(e) =>
                      setEditAgendaForm({
                        ...editAgendaForm,
                        venue: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <div className={styles.fileUploadBox}>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx"
                  id="editAgendaFileInput"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files[0];
                    e.target.value = "";
                    setEditAgendaFile(file);
                  }}
                />
                <label
                  htmlFor="editAgendaFileInput"
                  className={styles.fileLabel}
                >
                  {editAgendaFile ? (
                    <>
                      <CheckSquare size={14} strokeWidth={1.5} />{" "}
                      {editAgendaFile.name}
                    </>
                  ) : (
                    <>
                      <Upload size={14} strokeWidth={1.5} /> Click to replace file
                    </>
                  )}
                </label>
                <p className={styles.fileHint}>
                  Current file: {editingAgenda.filename}. Leave unchanged to
                  keep it, or choose a new PDF/Word file to replace it.
                </p>
              </div>
            </div>

            {/* ── Sticky footer ── */}
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                padding: "16px 24px 20px",
                borderTop: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <button
                className={styles.confirmBtn}
                onClick={handleUpdateAgenda}
                disabled={submitting}
              >
                {submitting ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Announcement */}
      {showAnnouncementModal && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            setShowAnnouncementModal(false);
            resetAnnouncementForm();
            setModalMessage("");
          }}
        >
          <div
            className={`${styles.modal} ${styles.sessionModal}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: "90vh",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 16px",
                borderBottom: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <h2
                className={styles.modalTitle}
                style={{ margin: 0, fontSize: 18 }}
              >
                <Megaphone size={18} strokeWidth={1.5} /> New Announcement
              </h2>
              <button
                onClick={() => {
                  setShowAnnouncementModal(false);
                  resetAnnouncementForm();
                  setModalMessage("");
                }}
                aria-label="Close modal"
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  cursor: "pointer",
                  color: "#64748b",
                  width: 32,
                  height: 32,
                  minWidth: 32,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                overscrollBehavior: "contain",
              }}
            >
              <label className={styles.fieldLabel}>
                Title <span style={{ color: "#e53e3e" }}>*</span>
              </label>
              <input
                className={styles.input}
                placeholder="Announcement title..."
                value={announcementForm.title}
                onChange={(e) =>
                  setAnnouncementForm({
                    ...announcementForm,
                    title: e.target.value,
                  })
                }
              />
              <label
                className={styles.fieldLabel}
                style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={announcementForm.priority === "urgent"}
                  onChange={(e) =>
                    setAnnouncementForm({
                      ...announcementForm,
                      priority: e.target.checked ? "urgent" : "normal",
                    })
                  }
                />
                Mark as urgent
              </label>
              {announcementForm.priority === "urgent" && (
                <p className={styles.fieldHint} style={{ marginTop: -6, marginBottom: 12 }}>
                  Every announcement is emailed to all active users. Urgent ones are flagged "URGENT" in the email and the feed.
                </p>
              )}
              <label
                className={styles.fieldLabel}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  cursor: pinnedCount >= PIN_LIMIT && !announcementForm.pinned ? "default" : "pointer",
                  marginTop: 4,
                  opacity: pinnedCount >= PIN_LIMIT && !announcementForm.pinned ? 0.55 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={announcementForm.pinned}
                  disabled={pinnedCount >= PIN_LIMIT && !announcementForm.pinned}
                  onChange={(e) =>
                    setAnnouncementForm({
                      ...announcementForm,
                      pinned: e.target.checked,
                    })
                  }
                />{" "}
                Pin to top of feed ({pinnedCount}/{PIN_LIMIT} pinned)
              </label>
              {pinnedCount >= PIN_LIMIT && !announcementForm.pinned && (
                <p className={styles.fieldHint} style={{ marginTop: 2, marginBottom: 12 }}>
                  Pin limit reached — unpin something first to free up a slot.
                </p>
              )}
              <label className={styles.fieldLabel}>
                Announcement Body <span style={{ color: "#e53e3e" }}>*</span>
              </label>
              <textarea
                className={styles.textArea}
                placeholder="Write your announcement here..."
                value={announcementForm.body}
                onChange={(e) =>
                  setAnnouncementForm({
                    ...announcementForm,
                    body: e.target.value,
                  })
                }
                rows={7}
                style={{ height: "auto" }}
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                padding: "16px 24px 20px",
                borderTop: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <button
                className={styles.confirmBtn}
                onClick={handleAddAnnouncement}
                disabled={submitting}
              >
                {submitting ? "Posting..." : "Post Announcement"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Announcement */}
      {showEditAnnouncementModal && editingAnnouncement && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            setShowEditAnnouncementModal(false);
            setEditingAnnouncement(null);
            setModalMessage("");
          }}
        >
          <div
            className={`${styles.modal} ${styles.sessionModal}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: "90vh",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 16px",
                borderBottom: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <h2
                className={styles.modalTitle}
                style={{ margin: 0, fontSize: 18 }}
              >
                <Pencil size={16} strokeWidth={1.5} /> Edit Announcement
              </h2>
              <button
                onClick={() => {
                  setShowEditAnnouncementModal(false);
                  setEditingAnnouncement(null);
                  setModalMessage("");
                }}
                aria-label="Close modal"
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  cursor: "pointer",
                  color: "#64748b",
                  width: 32,
                  height: 32,
                  minWidth: 32,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                overscrollBehavior: "contain",
              }}
            >
              <label className={styles.fieldLabel}>
                Title <span style={{ color: "#e53e3e" }}>*</span>
              </label>
              <input
                className={styles.input}
                placeholder="Announcement title..."
                value={editAnnouncementForm.title}
                onChange={(e) =>
                  setEditAnnouncementForm({
                    ...editAnnouncementForm,
                    title: e.target.value,
                  })
                }
              />
              <label
                className={styles.fieldLabel}
                style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={editAnnouncementForm.priority === "urgent"}
                  onChange={(e) =>
                    setEditAnnouncementForm({
                      ...editAnnouncementForm,
                      priority: e.target.checked ? "urgent" : "normal",
                    })
                  }
                />
                Mark as urgent
              </label>
              {editAnnouncementForm.priority === "urgent" &&
                editingAnnouncement.priority !== "urgent" && (
                  <p className={styles.fieldHint} style={{ marginTop: -6, marginBottom: 12 }}>
                    Sends a new "URGENT" email to every other active user when you save.
                  </p>
                )}
              <label
                className={styles.fieldLabel}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  cursor: editPinnedCount >= PIN_LIMIT && !editAnnouncementForm.pinned ? "default" : "pointer",
                  marginTop: 4,
                  opacity: editPinnedCount >= PIN_LIMIT && !editAnnouncementForm.pinned ? 0.55 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={editAnnouncementForm.pinned}
                  disabled={editPinnedCount >= PIN_LIMIT && !editAnnouncementForm.pinned}
                  onChange={(e) =>
                    setEditAnnouncementForm({
                      ...editAnnouncementForm,
                      pinned: e.target.checked,
                    })
                  }
                />{" "}
                Pin to top of feed ({editPinnedCount}/{PIN_LIMIT} pinned)
              </label>
              {editPinnedCount >= PIN_LIMIT && !editAnnouncementForm.pinned && (
                <p className={styles.fieldHint} style={{ marginTop: 2, marginBottom: 12 }}>
                  Pin limit reached — unpin something first to free up a slot.
                </p>
              )}
              <label className={styles.fieldLabel}>
                Announcement Body <span style={{ color: "#e53e3e" }}>*</span>
              </label>
              <textarea
                className={styles.textArea}
                value={editAnnouncementForm.body}
                onChange={(e) =>
                  setEditAnnouncementForm({
                    ...editAnnouncementForm,
                    body: e.target.value,
                  })
                }
                rows={7}
                style={{ height: "auto" }}
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                padding: "16px 24px 20px",
                borderTop: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <button
                className={styles.confirmBtn}
                onClick={handleUpdateAnnouncement}
                disabled={submitting}
              >
                {submitting ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Local Event */}
      {showLocalEventModal && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            setShowLocalEventModal(false);
            setModalMessage("");
          }}
        >
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: "90vh",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 16px",
                borderBottom: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <h2
                className={styles.modalTitle}
                style={{ margin: 0, fontSize: 18 }}
              >
                <PlusCircle size={16} /> Add Event
              </h2>
              <button
                onClick={() => {
                  setShowLocalEventModal(false);
                  setModalMessage("");
                }}
                aria-label="Close modal"
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  cursor: "pointer",
                  color: "#64748b",
                  width: 32,
                  height: 32,
                  minWidth: 32,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                overscrollBehavior: "contain",
              }}
            >
              <EventFormFields
                form={localEventForm}
                setForm={setLocalEventForm}
                styles={styles}
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                padding: "16px 24px 20px",
                borderTop: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <button
                className={styles.confirmBtn}
                onClick={handleSaveLocalEvent}
                disabled={savingLocalEvent}
              >
                {savingLocalEvent ? "Saving..." : "Save Event"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Local Event */}
      {showEditEventModal && editingEvent && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            setShowEditEventModal(false);
            setEditingEvent(null);
            setModalMessage("");
          }}
        >
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: "90vh",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 16px",
                borderBottom: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <h2
                className={styles.modalTitle}
                style={{ margin: 0, fontSize: 18 }}
              >
                <Pencil size={16} /> Edit Event
              </h2>
              <button
                onClick={() => {
                  setShowEditEventModal(false);
                  setEditingEvent(null);
                  setModalMessage("");
                }}
                aria-label="Close modal"
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  cursor: "pointer",
                  color: "#64748b",
                  width: 32,
                  height: 32,
                  minWidth: 32,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                overscrollBehavior: "contain",
              }}
            >
              <EventFormFields
                form={editEventForm}
                setForm={setEditEventForm}
                styles={styles}
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                padding: "16px 24px 20px",
                borderTop: "1px solid #f1f5f9",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <button
                className={styles.confirmBtn}
                onClick={handleUpdateEvent}
                disabled={savingLocalEvent}
              >
                {savingLocalEvent ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <ConfirmModal
          type={
            ARCHIVABLE_TYPES.includes(deleteTarget.type) ? "warning" : "delete"
          }
          title={
            ARCHIVABLE_TYPES.includes(deleteTarget.type)
              ? `Archive this ${DELETE_TYPE_LABELS[deleteTarget.type] || deleteTarget.type}?`
              : `Delete this ${deleteTarget.type}?`
          }
          message={
            ARCHIVABLE_TYPES.includes(deleteTarget.type)
              ? `"${deleteTarget.name}" will be moved to Archives. You can restore it later.`
              : `"${deleteTarget.name}" will be permanently removed. This cannot be undone.`
          }
          confirmLabel={
            ARCHIVABLE_TYPES.includes(deleteTarget.type) ? "Archive" : "Delete"
          }
          loading={submitting}
          onConfirm={async () => {
            // Awaited (unlike the old fire-and-forget version) so the modal
            // stays open with a spinner — via `loading` above — for as long
            // as the request actually takes, instead of closing instantly
            // and leaving the user staring at nothing on a slow connection
            // until the success modal eventually appears on its own.
            setSubmitting(true);
            try {
              if (deleteTarget.type === "user") await handleDeleteUser(deleteTarget.id);
              else if (deleteTarget.type === "ordinance")
                await handleDeleteOrdinance(deleteTarget.id);
              else if (deleteTarget.type === "resolution")
                await handleDeleteResolution(deleteTarget.id);
              else if (deleteTarget.type === "official")
                await handleDeleteOfficial(deleteTarget.id);
              else if (deleteTarget.type === "session")
                await handleDeleteSession(deleteTarget.id);
              else if (deleteTarget.type === "session_agenda")
                await handleDeleteAgenda(deleteTarget.id);
              else if (deleteTarget.type === "announcement")
                await handleDeleteAnnouncement(deleteTarget.id);
              else if (deleteTarget.type === "term")
                await handleDeleteTerm(deleteTarget.memberId, deleteTarget.id);
              else if (deleteTarget.type === "council")
                await handleDeleteCouncil(deleteTarget.id);
            } finally {
              setSubmitting(false);
              setDeleteTarget(null);
            }
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {resetPasswordTarget && (
        <ConfirmModal
          type="warning"
          title="Reset this account's password?"
          message={`A password reset link will be emailed to "${resetPasswordTarget.email}". It lets them set a new password directly and expires in 1 hour.`}
          confirmLabel="Send Reset"
          loading={submitting}
          onConfirm={() => handleResetPassword(resetPasswordTarget)}
          onCancel={() => setResetPasswordTarget(null)}
        />
      )}
    </div>
  );
}
