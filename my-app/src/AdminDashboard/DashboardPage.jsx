import { useState } from "react";
import {
  ScrollText,
  FileText,
  ClipboardList,
  ChevronRight,
  ExternalLink,
  Calendar,
  CalendarDays,
  Megaphone,
  BookOpen,
  ArrowUpRight,
  Clock,
  Hash,
  Plus,
  Gavel,
  User,
  Tag,
  MapPin,
  AlertCircle,
  Pin,
  X,
  Image,
  Download,
  Presentation,
  HelpCircle,
} from "lucide-react";
import styles from "./AdminDashboard.module.css";
import lStyles from "./LegislativeModule.module.css";
import PendingRecordsWidget from "./PendingRecordsWidget";
import RecordHistory from "./RecordHistory";
import { pendingStatusesForRole } from "./useLegislativeReview";
import { PresentOverlay } from "./LegislativeComponents";
import { ToastContainer } from "./Toast";
import { useToasts } from "./useToasts";
import { useIsMobile, toIsoDate, downloadFile, openPdfInTab } from "./AdminContext";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const getFileUrl = (filepath) =>
  `${SUPABASE_URL}/storage/v1/object/public/assets/${filepath}`;

// "14:30:00" -> "2:30 PM"
const formatEventTime = (t) => {
  const [h, m] = String(t).split(":");
  const hour = Number(h);
  if (Number.isNaN(hour)) return t;
  return `${((hour + 11) % 12) + 1}:${m || "00"} ${hour >= 12 ? "PM" : "AM"}`;
};

const formatDate = (dateStr) => {
  if (!dateStr) return "—";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

// For full ISO timestamps (e.g. announcements.created_at) — unlike formatDate
// above, these already carry a real time/timezone, so appending "T00:00:00"
// would corrupt the string instead of protecting against a timezone shift.
const formatTimestamp = (dateStr) => {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

// Same as formatTimestamp but includes the time — used where "when exactly
// was this posted" matters more than just the day (e.g. the announcements
// feed, where several posts can land on the same date).
const formatDateTime = (dateStr) => {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const date = d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
};

// ─── Empty State ──────────────────────────────────────────────────────────────
const EmptyState = ({ icon: Icon, label }) => (
  <div className={styles.dashEmptyState}>
    <Icon size={32} strokeWidth={1.2} className={styles.dashEmptyIcon} />
    <p>No {label} yet</p>
  </div>
);

// ─── Loading skeletons ────────────────────────────────────────────────────────
// `styles.skeleton` is the shared shimmer block (see AdminDashboard.module.css
// and its other use in LegislativeComponents.jsx's RecordListSkeleton) — a
// plain gray shimmer, sized per-use via inline style. The top stat-chip row
// sits on the dashboard's solid gradient header, where that gray shimmer
// would be nearly invisible, so those use `styles.skeletonSolid` instead
// (already built for exactly this — see its own comment in the CSS).
const DashStatChipSkeleton = () => (
  <div className={styles.dashStatChip}>
    <div className={styles.dashStatChipTop}>
      <div className={styles.skeletonSolid} style={{ width: 14, height: 14, borderRadius: 4 }} />
      <div className={styles.skeletonSolid} style={{ width: 22, height: 13, borderRadius: 4 }} />
    </div>
    <div className={styles.skeletonSolid} style={{ width: "80%", height: 10, borderRadius: 4 }} />
  </div>
);

const DashItemCardSkeleton = () => (
  <div className={styles.dashItemCard}>
    <div className={styles.dashCardTop}>
      <div className={styles.skeleton} style={{ width: 64, height: 18, borderRadius: 20 }} />
      <div className={styles.skeleton} style={{ width: 36, height: 11, borderRadius: 4 }} />
    </div>
    <div className={styles.skeleton} style={{ width: "85%", height: 15, borderRadius: 4 }} />
    <div className={styles.skeleton} style={{ width: "55%", height: 11, borderRadius: 4 }} />
    <div className={styles.dashCardFooter}>
      <div className={styles.skeleton} style={{ width: 68, height: 11, borderRadius: 4 }} />
      <div className={styles.skeleton} style={{ width: 58, height: 24, borderRadius: 8 }} />
    </div>
  </div>
);

const DashMiniAnnSkeleton = () => (
  <div className={styles.dashMiniAnn}>
    <div className={styles.skeleton} style={{ width: "65%", height: 13, borderRadius: 4 }} />
    <div className={styles.skeleton} style={{ width: "90%", height: 11, borderRadius: 4 }} />
    <div className={styles.dashMiniAnnMeta}>
      <div className={styles.skeleton} style={{ width: 60, height: 10, borderRadius: 4 }} />
      <div className={styles.skeleton} style={{ width: 88, height: 10, borderRadius: 4 }} />
    </div>
  </div>
);

const DashUpcomingItemSkeleton = () => (
  <div className={styles.dashUpcomingItem}>
    <div className={styles.skeleton} style={{ width: 80, height: 11, borderRadius: 4 }} />
    <div className={styles.skeleton} style={{ width: "70%", height: 13, borderRadius: 4 }} />
  </div>
);

// ─── Section Header ───────────────────────────────────────────────────────────
const SectionHeader = ({ icon: Icon, title, color, count, onViewAll }) => (
  <div className={styles.dashSectionHeader}>
    <div className={styles.dashSectionLeft}>
      <span
        className={styles.dashSectionIconWrap}
        style={{ background: color + "18", color }}
      >
        <Icon size={17} strokeWidth={2} />
      </span>
      <h3 className={styles.dashSectionTitle}>{title}</h3>
      {count > 0 && <span className={styles.dashSectionCount}>{count}</span>}
    </div>
    {onViewAll && (
      <button className={styles.dashViewAllBtn} onClick={onViewAll}>
        View all <ArrowUpRight size={13} />
      </button>
    )}
  </div>
);

// ─── Ordinance Card ───────────────────────────────────────────────────────────
const OrdinanceCard = ({ item, onView }) => (
  <div className={styles.dashItemCard}>
    <div className={styles.dashCardTop}>
      <span className={styles.dashApprovedBadge}>Published</span>
      {item.ordinance_number && (
        <span className={styles.dashCardMeta}>
          <Hash size={11} />
          {item.ordinance_number}
        </span>
      )}
    </div>
    <h4 className={styles.dashCardTitle}>{item.title}</h4>
    {item.category && (
      <span className={styles.dashCardCategory}>
        <Tag size={10} />
        {item.category}
      </span>
    )}
    {(item.officials?.length > 0) && (
      <span className={styles.dashCardAuthor}>
        <User size={11} />
        {item.officials.map((a) => a.full_name).join(", ")}
      </span>
    )}
    <div className={styles.dashCardFooter}>
      <span className={styles.dashCardDate}>
        <Calendar size={11} />
        {formatTimestamp(item.approved_on || item.uploaded_at)}
      </span>
      <button className={styles.dashCardBtn} onClick={onView}>
        View <ChevronRight size={12} />
      </button>
    </div>
  </div>
);

// ─── Resolution Card ──────────────────────────────────────────────────────────
const ResolutionCard = ({ item, onView }) => (
  <div className={styles.dashItemCard}>
    <div className={styles.dashCardTop}>
      <span className={styles.dashApprovedBadge}>Published</span>
      {item.resolution_number && (
        <span className={styles.dashCardMeta}>
          <Hash size={11} />
          {item.resolution_number}
        </span>
      )}
    </div>
    <h4 className={styles.dashCardTitle}>{item.title}</h4>
    {item.category && (
      <span className={styles.dashCardCategory}>
        <Tag size={10} />
        {item.category}
      </span>
    )}
    {(item.officials?.length > 0) && (
      <span className={styles.dashCardAuthor}>
        <User size={11} />
        {item.officials.map((a) => a.full_name).join(", ")}
      </span>
    )}
    <div className={styles.dashCardFooter}>
      <span className={styles.dashCardDate}>
        <Calendar size={11} />
        {formatTimestamp(item.approved_on || item.uploaded_at)}
      </span>
      <button className={styles.dashCardBtn} onClick={onView}>
        View <ChevronRight size={12} />
      </button>
    </div>
  </div>
);

// ─── Session Card ─────────────────────────────────────────────────────────────
const SessionCard = ({ item, onView }) => (
  <div className={styles.dashItemCard}>
    <div className={styles.dashCardTop}>
      <span className={styles.dashSessionBadge}>
        {item.session_type === "special" ? "Special Session" : "Regular Session"}
      </span>
      {item.session_number && (
        <span className={styles.dashCardMeta}>
          <Clock size={11} />
          {item.session_number}
        </span>
      )}
    </div>
    <h4 className={styles.dashCardTitle}>
      {item.session_number || formatDate(item.session_date)}
    </h4>
    {item.venue && (
      <span className={styles.dashCardCategory}>
        <MapPin size={10} />
        {item.venue}
      </span>
    )}
    <div className={styles.dashCardFooter}>
      <span className={styles.dashCardDate}>
        <Calendar size={11} />
        {formatDate(item.session_date)}
      </span>
      <button className={styles.dashCardBtn} onClick={onView}>
        View <ChevronRight size={12} />
      </button>
    </div>
  </div>
);

// ─── Order of Business Card ────────────────────────────────────────────────────
// "View" opens the uploaded file itself (there's no typed content to show).
const AgendaCard = ({ item, onView }) => (
  <div className={styles.dashItemCard}>
    <div className={styles.dashCardTop}>
      <span className={styles.dashSessionBadge}>
        {item.session_type === "special" ? "Special" : "Regular"}
      </span>
    </div>
    <h4 className={styles.dashCardTitle}>
      {item.session_number || formatDate(item.session_date)}
    </h4>
    {item.venue && (
      <span className={styles.dashCardCategory}>
        <MapPin size={10} />
        {item.venue}
      </span>
    )}
    <div className={styles.dashCardFooter}>
      <span className={styles.dashCardDate}>
        <Calendar size={11} />
        {formatDate(item.session_date)}
      </span>
      <button className={styles.dashCardBtn} onClick={onView}>
        View <ChevronRight size={12} />
      </button>
    </div>
  </div>
);

// ─── Announcement Card (full — used elsewhere if needed) ──────────────────────
const AnnouncementCard = ({ post }) => (
  <div className={styles.dashPostCard}>
    {post.image_url && (
      <img
        src={post.image_url}
        alt={post.title}
        className={styles.dashPostThumb}
      />
    )}
    <div className={styles.dashPostBody}>
      <div className={styles.dashPostMeta}>
        <span className={styles.dashPostTag}>
          <Megaphone size={10} /> Announcement
        </span>
        <span className={styles.dashCardDate}>
          <Calendar size={11} />
          {formatTimestamp(post.created_at)}
        </span>
      </div>
      <h4 className={styles.dashPostTitle}>{post.title}</h4>
      {post.content && (
        <p className={styles.dashPostPreview}>
          {post.content.length > 130
            ? post.content.substring(0, 130) + "…"
            : post.content}
        </p>
      )}
      <button className={styles.dashReadMoreBtn}>
        Read More <ArrowUpRight size={12} />
      </button>
    </div>
  </div>
);

// ─── Sidebar widget shell ──────────────────────────────────────────────────────
const DashWidget = ({ icon: Icon, title, badge, children }) => (
  <div className={styles.dashWidget}>
    <div className={styles.dashWidgetHeader}>
      <Icon size={14} strokeWidth={2} />
      <span className={styles.dashWidgetTitle}>{title}</span>
      {badge > 0 && (
        <span className={styles.dashWidgetBadge}>
          {badge} new
        </span>
      )}
    </div>
    {children}
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────
const DashboardPage = ({
  ordinances = [],
  resolutions = [],
  sessionMinutes = [],
  sessionAgendas = [],
  events = [],
  announcements = [],
  unreadAnnouncements = 0,
  loading = false,
  onNavigate,
  onReview,
  onStartTour,
  canQuickAdd = false,
  onAddOrdinance,
  onAddResolution,
  onAddSession,
  onAddAnnouncement,
  isViceMayor = false,
  isSecretary = false,
  isClerk = false,
  isCouncilor = false,
}) => {
  const [activityTab, setActivityTab] = useState("ordinances");
  const { toasts, dismissToast } = useToasts();
  const isMobile = useIsMobile();
  const [mobileSection, setMobileSection] = useState("legislative");
  const canSeePending = isViceMayor || isSecretary || isClerk || isCouncilor;
  // Dashboard's own read-only View modal — same look as the Legislative
  // Records pages' View modal (shares its CSS classes), but without their
  // review-workflow machinery (accept/reject/comments), since everything
  // shown here is already published. `type` picks which fields/actions
  // render below; `item` is the raw ordinance/resolution/session_minutes row.
  const [viewTarget, setViewTarget] = useState(null);
  const [presentTarget, setPresentTarget] = useState(null);

  // "Latest X" only shows finished, public-facing records — a pending draft
  // isn't official yet, so it has no business appearing here (or counting
  // toward the tab badge below) even though it's still part of the
  // all-status `ordinances`/`resolutions`/`sessionMinutes` props the rest
  // of the dashboard uses for its own (intentionally all-status) totals.
  const publishedOrdinances = ordinances.filter((o) => o.status === "published");
  const publishedResolutions = resolutions.filter((r) => r.status === "published");
  const publishedSessions = sessionMinutes.filter((s) => s.status === "published");
  const latestOrdinances = publishedOrdinances.slice(0, 6);
  const latestResolutions = publishedResolutions.slice(0, 6);
  const latestSessions = publishedSessions.slice(0, 6);
  const latestAnnouncements = announcements.slice(0, 2);

  // Upcoming events: scheduled calendar events that haven't finished yet
  // (holidays live in a separate source and are deliberately not included),
  // soonest first. A multi-day event stays listed until its last day.
  const todayIso = toIsoDate(new Date());
  const upcomingEvents = [...events]
    .filter((e) => e.start_date && (e.end_date || e.start_date) >= todayIso)
    .sort((a, b) =>
      `${a.start_date} ${a.all_day ? "" : a.start_time || ""}` <
      `${b.start_date} ${b.all_day ? "" : b.start_time || ""}`
        ? -1
        : 1
    )
    .slice(0, 3);
  // Latest order of business: the most recently dated ones first.
  const sortedAgendas = [...sessionAgendas]
    .filter((a) => a.session_date)
    .sort((a, b) => (a.session_date > b.session_date ? -1 : 1));
  const latestAgendas = sortedAgendas.slice(0, 6);

  // Same count as the Ordinances/Resolutions Pending tabs: drafts awaiting
  // review (or a fix) plus everything mid First/Second/Third Reading.
  const pendingStatuses = pendingStatusesForRole({ isSecretary }).split(",");
  const isPending = (r) => pendingStatuses.includes(r.status);
  const pendingCount =
    ordinances.filter(isPending).length + resolutions.filter(isPending).length;

  const stats = [
    {
      label: "Published Ordinances",
      value: publishedOrdinances.length,
      icon: ScrollText,
      iconBg: "#e3f2fd",
      iconColor: "#1976d2",
      trend: "+2 this month",
    },
    {
      label: "Published Resolutions",
      value: publishedResolutions.length,
      icon: FileText,
      iconBg: "#e8f5e9",
      iconColor: "#388e3c",
      trend: "+1 this month",
    },
    {
      label: "Published Sessions",
      value: publishedSessions.length,
      icon: ClipboardList,
      iconBg: "#fff3e0",
      iconColor: "#f57c00",
      trend: "Latest on record",
    },
    {
      label: "Order of Business",
      value: sessionAgendas.length,
      icon: BookOpen,
      iconBg: "#e0f2f1",
      iconColor: "#00897b",
      trend: "On record",
    },
    {
      label: "Pending",
      value: pendingCount,
      icon: AlertCircle,
      iconBg: "#fef3c7",
      iconColor: "#d97706",
      trend: "Awaiting review",
    },
  ];

  const ACTIVITY_TABS = [
    {
      id: "ordinances",
      label: "Ordinances",
      icon: ScrollText,
      color: "#1976d2",
      count: publishedOrdinances.length,
      items: latestOrdinances,
      emptyIcon: ScrollText,
      emptyLabel: "ordinances",
      renderItem: (item) => (
        <OrdinanceCard key={item.id} item={item} onView={() => setViewTarget({ type: "ordinance", item })} />
      ),
    },
    {
      id: "resolutions",
      label: "Resolutions",
      icon: FileText,
      color: "#388e3c",
      count: publishedResolutions.length,
      items: latestResolutions,
      emptyIcon: FileText,
      emptyLabel: "resolutions",
      renderItem: (item) => (
        <ResolutionCard key={item.id} item={item} onView={() => setViewTarget({ type: "resolution", item })} />
      ),
    },
    {
      id: "sessions",
      label: "Sessions",
      icon: BookOpen,
      color: "#f57c00",
      count: publishedSessions.length,
      items: latestSessions,
      emptyIcon: ClipboardList,
      emptyLabel: "session minutes",
      renderItem: (item) => (
        <SessionCard key={item.id} item={item} onView={() => setViewTarget({ type: "session", item })} />
      ),
    },
    {
      // id doubles as the tab "View all" navigates to.
      id: "session_agendas",
      label: "Order of Business",
      icon: ClipboardList,
      color: "#00897b",
      count: sortedAgendas.length,
      items: latestAgendas,
      emptyIcon: ClipboardList,
      emptyLabel: "order of business",
      renderItem: (item) => (
        <AgendaCard
          key={item.id}
          item={item}
          onView={() =>
            item.filetype === "application/pdf"
              ? openPdfInTab(getFileUrl(item.filepath), item.session_number || item.filename)
              : downloadFile(getFileUrl(item.filepath), item.filepath, item.session_number || item.filename)
          }
        />
      ),
    },
  ];

  const activeTabConfig =
    ACTIVITY_TABS.find((t) => t.id === activityTab) || ACTIVITY_TABS[0];

  // ── Mobile-only 4-tab switcher ──────────────────────────────────────────────
  // Desktop shows every section at once (activity feed + sidebar + bottom
  // row); on a phone that's a lot of scrolling just to reach e.g. Pending, so
  // below MOBILE_BREAKPOINT the same section markup (built once below, so
  // desktop and mobile never drift into two copies) is shown one at a time
  // behind these tabs instead. Quick Actions isn't one of the tabs — it's
  // short enough to just sit above the tab content on every tab instead of
  // needing its own (see the isMobile branch below). Pending is only a real
  // tab when that content would actually render for this role — matches the
  // same role checks the desktop sidebar already uses below.
  const MOBILE_SECTIONS = [
    { id: "legislative", label: "Legislative", icon: ScrollText },
    { id: "announcements", label: "Announcements", icon: Megaphone },
    ...(canSeePending ? [{ id: "pending", label: "Pending", icon: AlertCircle }] : []),
  ];
  const activeMobileSection = MOBILE_SECTIONS.some((s) => s.id === mobileSection)
    ? mobileSection
    : MOBILE_SECTIONS[0].id;

  const legislativeSection = (
    <div className={styles.dashMainPanel}>
      <div className={styles.dashTabRow}>
        {ACTIVITY_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`${styles.dashTabBtn} ${
              activityTab === tab.id ? styles.dashTabBtnActive : ""
            }`}
            onClick={() => setActivityTab(tab.id)}
          >
            <tab.icon size={14} strokeWidth={2} />
            <span className={styles.dashTabLabel}>{tab.label}</span>
            {tab.count > 0 && (
              <span className={styles.dashSectionCount}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      <SectionHeader
        icon={activeTabConfig.icon}
        title={`Latest ${activeTabConfig.label}`}
        color={activeTabConfig.color}
        count={0}
        onViewAll={onNavigate ? () => onNavigate(activeTabConfig.id) : null}
      />

      {loading ? (
        <div className={styles.dashCardGrid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <DashItemCardSkeleton key={i} />
          ))}
        </div>
      ) : activeTabConfig.items.length === 0 ? (
        <EmptyState
          icon={activeTabConfig.emptyIcon}
          label={activeTabConfig.emptyLabel}
        />
      ) : (
        <div className={styles.dashCardGrid}>
          {activeTabConfig.items.map(activeTabConfig.renderItem)}
        </div>
      )}
    </div>
  );

  const quickActionsSection = canQuickAdd ? (
    <DashWidget icon={Plus} title="Quick actions">
      <div className={styles.dashQuickActionsGrid}>
        <button className={styles.quickActionIconBtn} onClick={onAddOrdinance}>
          <ScrollText size={16} /> Ordinance
        </button>
        <button className={styles.quickActionIconBtn} onClick={onAddResolution}>
          <Gavel size={16} /> Resolution
        </button>
        <button className={styles.quickActionIconBtn} onClick={onAddSession}>
          <BookOpen size={16} /> Session
        </button>
        <button className={styles.quickActionIconBtn} onClick={onAddAnnouncement}>
          <Megaphone size={16} /> Announce
        </button>
      </div>
    </DashWidget>
  ) : null;

  const pendingSection = canSeePending ? (
    <PendingRecordsWidget
      isViceMayor={isViceMayor}
      isSecretary={isSecretary}
      isClerk={isClerk}
      isCouncilor={isCouncilor}
      onReview={onReview}
      style={{ flex: 1, minHeight: 0 }}
    />
  ) : null;

  const announcementsSection = (
    <>
      <DashWidget icon={Megaphone} title="Latest announcements" badge={unreadAnnouncements}>
        {loading ? (
          <div className={styles.dashMiniAnnList}>
            {Array.from({ length: 2 }).map((_, i) => (
              <DashMiniAnnSkeleton key={i} />
            ))}
          </div>
        ) : latestAnnouncements.length === 0 ? (
          <p className={styles.dashWidgetEmpty}>No announcements yet.</p>
        ) : (
          <div className={styles.dashMiniAnnList}>
            {latestAnnouncements.map((post) => (
              <div key={post.id} className={styles.dashMiniAnn}>
                <div className={styles.dashMiniAnnHeader}>
                  <div className={styles.dashMiniAnnTitle}>{post.title}</div>
                  {(post.pinned || post.priority === "urgent") && (
                    <div className={styles.dashMiniAnnBadges}>
                      {post.pinned && (
                        <span className={styles.dashMiniAnnPinned} title="Pinned">
                          <Pin size={9} />
                        </span>
                      )}
                      {post.priority === "urgent" && (
                        <span className={styles.dashMiniAnnUrgent}>Urgent</span>
                      )}
                    </div>
                  )}
                </div>
                {post.body && (
                  <p className={styles.dashMiniAnnSnippet}>
                    {post.body.length > 90
                      ? post.body.slice(0, 90) + "…"
                      : post.body}
                  </p>
                )}
                <div className={styles.dashMiniAnnMeta}>
                  <span className={styles.dashMiniAnnAuthor}>
                    <User size={10} />
                    {/* Legacy rows posted before author tracking was added
                        have no `author` relation — see AnnouncementsPage.jsx's
                        same fallback for why "Admin" and not "Unknown". */}
                    {post.author?.name || "Admin"}
                  </span>
                  <span className={styles.dashMiniAnnDate}>
                    <Calendar size={10} />
                    {formatDateTime(post.created_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        {onNavigate && (
          <button
            className={styles.dashWidgetViewAll}
            onClick={() => onNavigate("announcements")}
          >
            View all announcements <ArrowUpRight size={12} />
          </button>
        )}
      </DashWidget>

      <DashWidget icon={Clock} title="Upcoming events">
        {loading ? (
          <div className={styles.dashUpcomingList}>
            {Array.from({ length: 2 }).map((_, i) => (
              <DashUpcomingItemSkeleton key={i} />
            ))}
          </div>
        ) : upcomingEvents.length === 0 ? (
          <p className={styles.dashWidgetEmpty}>No upcoming events.</p>
        ) : (
          <div className={styles.dashUpcomingList}>
            {upcomingEvents.map((e) => (
              <div key={e.id} className={styles.dashUpcomingItem}>
                <div className={styles.dashUpcomingDate}>
                  {formatDate(e.start_date)}
                  {e.end_date && e.end_date !== e.start_date
                    ? ` – ${formatDate(e.end_date)}`
                    : ""}
                </div>
                <div className={styles.dashUpcomingTitle}>{e.title}</div>
                {(!e.all_day && e.start_time) || e.location ? (
                  <div style={{ fontSize: 12, color: "#718096", marginTop: 2 }}>
                    {!e.all_day && e.start_time ? formatEventTime(e.start_time) : ""}
                    {!e.all_day && e.start_time && e.location ? " · " : ""}
                    {e.location || ""}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {onNavigate && (
          <button
            className={styles.dashWidgetViewAll}
            onClick={() => onNavigate("calendar")}
          >
            View calendar <ArrowUpRight size={12} />
          </button>
        )}
      </DashWidget>
    </>
  );

  return (
    <div className={styles.dashboardContainer}>
      {/* ── Top bar: greeting + inline stat chips combined ── */}
      <div className={styles.dashTopBar}>
        {/* Replays the guided tour (productTour.js). */}
        <button
          type="button"
          data-tour="help"
          className={styles.dashHelpBtn}
          onClick={onStartTour}
          aria-label="Show the guided tour"
          title="Show the guided tour"
        >
          <HelpCircle size={16} strokeWidth={1.8} />
        </button>
        <div className={styles.dashWelcomeText}>
          <h2 className={styles.dashWelcomeTitle}>Welcome back</h2>
          <p className={styles.dashWelcomeSub}>
            Here's what's happening in the Sangguniang Bayan Office today.
          </p>
        </div>
        <div className={styles.dashTopBarStats}>
          {loading
            ? Array.from({ length: 5 }).map((_, i) => <DashStatChipSkeleton key={i} />)
            : stats.map((s) => (
                <div key={s.label} className={styles.dashStatChip}>
                  <div className={styles.dashStatChipTop}>
                    <s.icon size={14} strokeWidth={2} />
                    <span className={styles.dashStatChipValue}>{s.value}</span>
                  </div>
                  <span className={styles.dashStatChipLabel}>{s.label}</span>
                </div>
              ))}
        </div>
      </div>

      {isMobile ? (
        <>
          {/* ── Mobile: one section at a time behind a tab switcher ── */}
          <div
            className={styles.dashMobileTabs}
            style={{ gridTemplateColumns: `repeat(${MOBILE_SECTIONS.length}, 1fr)` }}
          >
            {MOBILE_SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`${styles.dashMobileTabBtn} ${
                  activeMobileSection === s.id ? styles.dashMobileTabBtnActive : ""
                }`}
                onClick={() => setMobileSection(s.id)}
              >
                <s.icon size={16} strokeWidth={2} />
                {s.label}
              </button>
            ))}
          </div>
          {/* Short enough to just sit above every tab's content instead of
              needing a tab of its own. */}
          {quickActionsSection && (
            <div className={styles.dashMobileQuickActions}>{quickActionsSection}</div>
          )}
          <div className={styles.dashMobileSectionBody}>
            {activeMobileSection === "legislative" && legislativeSection}
            {activeMobileSection === "announcements" && announcementsSection}
            {activeMobileSection === "pending" && pendingSection}
          </div>
        </>
      ) : (
        <>
          {/* ── Body: main activity feed + sidebar ── */}
          <div className={styles.dashBody}>
            {legislativeSection}
            {/* Sidebar: Quick actions on top, Pending Review fills the rest */}
            <div className={styles.dashSidebar}>
              {quickActionsSection}
              {pendingSection}
            </div>
          </div>

          {/* ── Bottom row: Announcements + Upcoming session, side by side ── */}
          <div className={styles.dashBottomRow}>{announcementsSection}</div>
        </>
      )}
      {viewTarget && (
        <div className={lStyles.viewModalOverlay} onClick={() => setViewTarget(null)}>
          <div className={lStyles.viewModal} onClick={(e) => e.stopPropagation()}>
            <div className={lStyles.viewModalHeader}>
              <div className={lStyles.viewModalHeaderTop}>
                <div className={lStyles.viewModalHeaderInfo}>
                  {(viewTarget.item.ordinance_number ||
                    viewTarget.item.resolution_number ||
                    viewTarget.item.session_number) && (
                    <div className={lStyles.viewModalOrdNumber}>
                      <Hash size={12} />
                      {viewTarget.item.ordinance_number ||
                        viewTarget.item.resolution_number ||
                        viewTarget.item.session_number}
                    </div>
                  )}
                  <h2 className={lStyles.viewModalTitle}>
                    {viewTarget.type === "session"
                      ? viewTarget.item.session_type === "special"
                        ? "Special Session"
                        : "Regular Session"
                      : viewTarget.item.title}
                  </h2>
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

            <div className={lStyles.viewModalBody}>
              <div className={lStyles.viewModalMeta}>
                {viewTarget.type === "session" ? (
                  <div className={lStyles.viewModalMetaItem}>
                    <div className={`${lStyles.viewModalMetaIcon} ${lStyles.viewModalMetaIconBlue}`}>
                      <CalendarDays size={16} />
                    </div>
                    <div>
                      <div className={lStyles.viewModalMetaLabel}>Date</div>
                      <div className={lStyles.viewModalMetaValue}>
                        {viewTarget.item.session_date
                          ? new Date(viewTarget.item.session_date + "T00:00:00").toLocaleDateString("en-PH", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })
                          : "—"}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {viewTarget.item.year && (
                      <div className={lStyles.viewModalMetaItem}>
                        <div className={`${lStyles.viewModalMetaIcon} ${lStyles.viewModalMetaIconBlue}`}>
                          <CalendarDays size={16} />
                        </div>
                        <div>
                          <div className={lStyles.viewModalMetaLabel}>Year</div>
                          <div className={lStyles.viewModalMetaValue}>{viewTarget.item.year}</div>
                        </div>
                      </div>
                    )}
                    <div className={lStyles.viewModalMetaItem}>
                      <div className={`${lStyles.viewModalMetaIcon} ${lStyles.viewModalMetaIconGreen}`}>
                        <CalendarDays size={16} />
                      </div>
                      <div>
                        <div className={lStyles.viewModalMetaLabel}>
                          {viewTarget.item.approved_on ? "Approved" : "Uploaded"}
                        </div>
                        <div className={lStyles.viewModalMetaValue}>
                          {formatTimestamp(viewTarget.item.approved_on || viewTarget.item.uploaded_at)}
                        </div>
                      </div>
                    </div>
                  </>
                )}
                {viewTarget.type !== "session" && viewTarget.item.category && (
                  <div className={lStyles.viewModalMetaItem}>
                    <div className={`${lStyles.viewModalMetaIcon} ${lStyles.viewModalMetaIconPurple}`}>
                      <Tag size={16} />
                    </div>
                    <div>
                      <div className={lStyles.viewModalMetaLabel}>Sector</div>
                      <div className={lStyles.viewModalMetaValue}>{viewTarget.item.category}</div>
                    </div>
                  </div>
                )}
                {viewTarget.type === "session" && viewTarget.item.venue && (
                  <div className={lStyles.viewModalMetaItem}>
                    <div className={`${lStyles.viewModalMetaIcon} ${lStyles.viewModalMetaIconGreen}`}>
                      <MapPin size={16} />
                    </div>
                    <div>
                      <div className={lStyles.viewModalMetaLabel}>Venue</div>
                      <div className={lStyles.viewModalMetaValue}>{viewTarget.item.venue}</div>
                    </div>
                  </div>
                )}
              </div>

              <div className={lStyles.viewModalDivider} />

              {viewTarget.type === "session" ? (
                <>
                  <div className={lStyles.viewModalCouncilTitle} style={{ marginBottom: 8 }}>
                    Minutes
                  </div>
                  <div style={{ fontSize: 13, whiteSpace: "pre-wrap", color: "var(--color-text-secondary)" }}>
                    {viewTarget.item.minutes_text || "No minutes recorded."}
                  </div>
                </>
              ) : (
                <>
                  {viewTarget.item.filetype === "application/pdf" && (
                    <div className={lStyles.viewModalFileActions}>
                      <button
                        className={`${lStyles.viewModalFileBtn} ${lStyles.viewModalFileBtnPrimary}`}
                        onClick={() => openPdfInTab(getFileUrl(viewTarget.item.filepath), viewTarget.item.title || viewTarget.item.ordinance_number || viewTarget.item.resolution_number || viewTarget.item.session_number)}
                      >
                        <FileText size={16} />
                        Open PDF Document
                      </button>
                      <button
                        className={`${lStyles.viewModalFileBtn} ${lStyles.viewModalFileBtnSecondary}`}
                        onClick={() => downloadFile(getFileUrl(viewTarget.item.filepath), viewTarget.item.filepath, viewTarget.item.title || viewTarget.item.ordinance_number || viewTarget.item.resolution_number || viewTarget.item.session_number)}
                      >
                        <Download size={16} />
                        Download PDF
                      </button>
                      <button
                        className={`${lStyles.viewModalFileBtn} ${lStyles.viewModalFileBtnSecondary}`}
                        onClick={() => setPresentTarget(viewTarget.item)}
                      >
                        <Presentation size={16} />
                        Present
                      </button>
                    </div>
                  )}
                  {(viewTarget.item.filetype === "application/msword" ||
                    viewTarget.item.filetype ===
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document") && (
                    <div className={lStyles.viewModalFileActions}>
                      <button
                        className={`${lStyles.viewModalFileBtn} ${lStyles.viewModalFileBtnPrimary}`}
                        onClick={() => downloadFile(getFileUrl(viewTarget.item.filepath), viewTarget.item.filepath, viewTarget.item.title || viewTarget.item.ordinance_number || viewTarget.item.resolution_number || viewTarget.item.session_number)}
                      >
                        <Download size={16} />
                        Download Word Document
                      </button>
                      <button
                        className={`${lStyles.viewModalFileBtn} ${lStyles.viewModalFileBtnSecondary}`}
                        onClick={() => setPresentTarget(viewTarget.item)}
                      >
                        <Presentation size={16} />
                        Present
                      </button>
                    </div>
                  )}
                  {viewTarget.item.filetype?.startsWith("image/") && (
                    <div className={lStyles.viewModalOcrSection}>
                      <img
                        src={getFileUrl(viewTarget.item.filepath)}
                        alt={viewTarget.item.title}
                        className={lStyles.viewModalImagePreview}
                      />
                      <div className={lStyles.viewModalFileActions}>
                        <button
                          className={`${lStyles.viewModalFileBtn} ${lStyles.viewModalFileBtnSecondary}`}
                          onClick={() => setPresentTarget(viewTarget.item)}
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
                        value={viewTarget.item.extracted_text || "No text could be extracted from this image."}
                      />
                    </div>
                  )}

                  {viewTarget.item.officials?.length > 0 && (
                    <>
                      <div className={lStyles.viewModalDivider} />
                      <div className={lStyles.viewModalCouncilSection}>
                        <div className={lStyles.viewModalCouncilHeader}>
                          <div className={lStyles.viewModalCouncilTitle}>Author</div>
                          <div className={lStyles.viewModalCouncilCount}>
                            {viewTarget.item.officials.length} member
                            {viewTarget.item.officials.length !== 1 ? "s" : ""}
                          </div>
                        </div>
                        <div className={lStyles.viewModalCouncilGrid}>
                          {viewTarget.item.officials.map((m) => (
                            <div key={m.id} className={lStyles.viewModalCouncilCard}>
                              {m.photo ? (
                                <img src={m.photo} alt={m.full_name} className={lStyles.viewModalCouncilPhoto} />
                              ) : (
                                <div className={lStyles.viewModalCouncilAvatar}>{m.full_name?.charAt(0)}</div>
                              )}
                              <div>
                                <div className={lStyles.viewModalCouncilName}>{m.full_name}</div>
                                <div className={lStyles.viewModalCouncilPosition}>{m.position}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Record history: upload → publish/reject (staff only — see RecordHistory.jsx). */}
                  {["published", "rejected"].includes(viewTarget.item.status) && (
                    <>
                      <div className={lStyles.viewModalDivider} />
                      <RecordHistory
                        key={`history-${viewTarget.type}-${viewTarget.item.id}`}
                        route={viewTarget.type === "ordinance" ? "ordinances" : "resolutions"}
                        recordId={viewTarget.item.id}
                        status={viewTarget.item.status}
                      />
                    </>
                  )}
                </>
              )}
            </div>

            <div className={lStyles.viewModalFooter}>
              {onNavigate && (
                <button
                  className={`${lStyles.viewModalFooterBtn} ${lStyles.viewModalFooterBtnPrimary}`}
                  onClick={() => {
                    setViewTarget(null);
                    onNavigate(
                      viewTarget.type === "ordinance"
                        ? "ordinances"
                        : viewTarget.type === "resolution"
                        ? "resolutions"
                        : "sessions"
                    );
                  }}
                >
                  Open full record <ArrowUpRight size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {presentTarget && (
        <PresentOverlay record={presentTarget} onClose={() => setPresentTarget(null)} />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

export default DashboardPage;
