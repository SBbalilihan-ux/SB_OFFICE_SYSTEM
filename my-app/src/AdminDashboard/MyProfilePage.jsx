/**
 * MyProfilePage.jsx
 * "My Profile" as a full page inside the dashboard (?tab=profile), opened by
 * clicking your own avatar in the sidebar — replaces the old pop-up modal.
 * Banner with photo, name, position and record stats; then the Account tab
 * (MyAccountTab.jsx) and, for accounts linked to a council member, the record
 * tabs (MyProfileRecords.jsx). Data and handlers stay in AdminDashboard.jsx.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AtSign, Mail, Pencil, Upload, Trash2 } from "lucide-react";
import ConfirmModal from "./ConfirmModal";
import s from "./MyProfilePage.module.css";
import { TabNavigation } from "./LegislativeComponents";
import MyAccountTab from "./MyAccountTab";
import MyProfileRecords, { NotLinkedNotice } from "./MyProfileRecords";
import { myRecordTabs, myRecordStats } from "./authorWorkflow";

export default function MyProfilePage({
  admin,
  positionLabel,
  tab,
  onTabChange,
  // Account tab
  name,
  onNameChange,
  onSaveName,
  onChangePhoto,
  onRemovePhoto,
  photoUploading,
  onSendResetLink,
  submitting,
  resetSentTo,
  // Record tabs
  records,
  recordsLoading,
  dashStyles,
  onPreview,
  onRecordsChanged,
}) {
  const stats = myRecordStats(records);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Edit-photo menu. Rendered into <body> at a fixed position under the
  // edit button, because the banner clips anything that overflows it.
  const [menuPos, setMenuPos] = useState(null); // { top, left } while open
  const editBtnRef = useRef(null);
  const menuRef = useRef(null);
  const fileInputRef = useRef(null);

  const toggleMenu = () => {
    if (menuPos) return setMenuPos(null);
    const r = editBtnRef.current.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 6, left: r.left });
  };

  // Close on outside click, Escape, scroll or resize (the fixed position
  // would otherwise drift away from the button).
  useEffect(() => {
    if (!menuPos) return;
    const close = () => setMenuPos(null);
    const onPointer = (e) => {
      if (!menuRef.current?.contains(e.target) && !editBtnRef.current?.contains(e.target)) close();
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menuPos]);

  return (
    <div className={s.page}>
      {/* ── Banner ── */}
      <section className={s.hero}>
        <div className={s.heroRow}>
          <div className={s.avatarWrap}>
            <div className={s.avatar}>
              {admin.photo ? <img src={admin.photo} alt={admin.name} /> : (admin.name || "?").charAt(0)}
              {photoUploading && <span className={s.avatarBusy} aria-label="Uploading photo" />}
            </div>
            <button
              ref={editBtnRef}
              type="button"
              className={s.avatarEdit}
              title="Edit photo"
              aria-label="Edit photo"
              aria-haspopup="menu"
              aria-expanded={!!menuPos}
              disabled={photoUploading}
              onClick={toggleMenu}
            >
              <Pencil size={15} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png"
              hidden
              onChange={(e) => {
                onChangePhoto(e.target.files?.[0]);
                e.target.value = ""; // so picking the same file again still fires
              }}
            />
          </div>
          {menuPos && createPortal(
            <div
              ref={menuRef}
              className={s.photoMenu}
              role="menu"
              style={{ top: menuPos.top, left: menuPos.left }}
            >
              <button
                type="button"
                role="menuitem"
                className={s.photoMenuItem}
                onClick={() => { setMenuPos(null); fileInputRef.current?.click(); }}
              >
                <Upload size={16} /> Upload photo
              </button>
              {admin.photo && (
                <button
                  type="button"
                  role="menuitem"
                  className={`${s.photoMenuItem} ${s.photoMenuDanger}`}
                  onClick={() => { setMenuPos(null); setConfirmRemove(true); }}
                >
                  <Trash2 size={16} /> Remove photo
                </button>
              )}
            </div>,
            document.body
          )}
          {confirmRemove && (
            <ConfirmModal
              type="delete"
              title="Remove your profile photo?"
              message="Your photo will be deleted and the default avatar will be shown instead. You can upload a new photo anytime."
              confirmLabel="Remove Photo"
              loading={photoUploading}
              onConfirm={async () => {
                await onRemovePhoto();
                setConfirmRemove(false);
              }}
              onCancel={() => setConfirmRemove(false)}
            />
          )}
          <div className={s.identity}>
            <h1 className={s.name}>{admin.name}</h1>
            <div className={s.metaRow}>
              <span className={s.badge}>{positionLabel}</span>
              {admin.username && (
                <span className={s.metaItem}>
                  <AtSign size={14} /> {admin.username}
                </span>
              )}
              {admin.email && (
                <span className={s.metaItem}>
                  <Mail size={14} /> {admin.email}
                </span>
              )}
            </div>
          </div>
          {stats.length > 0 && (
            <div className={s.stats}>
              {stats.map((stat) => (
                <div key={stat.label} className={s.stat}>
                  <div className={s.statValue}>{stat.value}</div>
                  <div className={s.statLabel}>{stat.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Tabs ── */}
      <div className={s.tabsCard}>
        <TabNavigation
          tabs={[{ id: "account", label: "Account" }, ...myRecordTabs(records)]}
          activeTab={tab}
          onTabChange={onTabChange}
        />
      </div>

      {/* ── Content ── */}
      {tab === "account" ? (
        <div className={s.contentPlain}>
          <MyAccountTab
            admin={admin}
            name={name}
            onNameChange={onNameChange}
            onSaveName={onSaveName}
            onSendResetLink={onSendResetLink}
            submitting={submitting}
            resetSentTo={resetSentTo}
            notice={<NotLinkedNotice data={records} />}
          />
        </div>
      ) : (
        <div className={s.content}>
          <MyProfileRecords
            tab={tab}
            data={records}
            loading={recordsLoading}
            styles={dashStyles}
            onPreview={onPreview}
            onChanged={onRecordsChanged}
          />
        </div>
      )}
    </div>
  );
}
