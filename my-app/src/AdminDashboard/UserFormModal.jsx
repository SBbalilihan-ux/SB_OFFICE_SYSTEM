// UserFormModal.jsx
// Shared Add/Edit form for both Users (councilor/vice_mayor) and Admins
// (secretary/clerk) — previously three near-identical ~170-line JSX blocks
// inlined in AdminDashboard.jsx (Add Admin, Add User, Edit User/Admin),
// differing only in title, which position options to show, whether a
// password field/required-asterisks show, and which handler gets called.
//
// Usage:
// <UserFormModal
//   mode="add" | "edit"
//   roleGroup="admin" | "user"   // which position options to offer
//   title="Add New Admin"
//   form={{ name, username, email, password?, position }}
//   onFieldChange={(field, value) => ...}
//   photo={file} onPhotoChange={(file) => ...}
//   currentPhotoUrl={editingUser?.photo}   // edit only, for the "current photo" hint
//   excludeUserId={editingUser?.id}        // edit only, so the availability check ignores the user's own current name/email
//   submitting={submitting} submitLabel="Add Admin" submittingLabel="Adding..."
//   onSubmit={handleAddAdmin} onClose={() => setShowAddAdminModal(false)}
// />

import { useEffect, useState } from "react";
import { X, Upload, CheckSquare, Eye, EyeOff, RefreshCw } from "lucide-react";
import styles from "./AdminDashboard.module.css";
import { API, authFetch } from "./AdminContext";

const POSITION_OPTIONS = {
  admin: [
    { value: "secretary", label: "Secretary" },
    { value: "clerk", label: "Clerk" },
  ],
  user: [
    { value: "councilor", label: "Councilor" },
    { value: "vice_mayor", label: "Vice Mayor" },
    { value: "liga_ng_mga_barangay", label: "Liga ng mga Barangay" },
    { value: "sk_federated", label: "SK Federated" },
  ],
};

const AVAILABILITY_DEBOUNCE_MS = 400;

// Temporary password the office hands to a new account — the account is
// forced to replace it on first login (must_change_password). Always
// satisfies the backend's rules (8+ chars, 1 uppercase, 1 number); skips
// look-alike characters (0/O, 1/l/I) since it's read out or written down.
function generateTempPassword(length = 10) {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const rand = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const chars = [upper[rand(upper.length)], digits[rand(digits.length)]];
  while (chars.length < length) chars.push(all[rand(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// Live "is this taken?" hint — a UX nicety only. The real enforcement is
// the case-insensitive unique index in the DB (migrations/011); this just
// saves a round trip of "submit, get a 400, fix it, resubmit."
function useAvailability(field, value, excludeUserId, minLength) {
  const [status, setStatus] = useState(null); // null | "checking" | "available" | "taken"

  useEffect(() => {
    if (!value || value.trim().length < minLength) {
      setStatus(null);
      return;
    }
    setStatus("checking");
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ field, value: value.trim() });
        if (excludeUserId) params.set("excludeId", excludeUserId);
        const res = await authFetch(`${API}/api/users/check-availability?${params.toString()}`);
        const data = await res.json();
        setStatus(res.ok ? (data.available ? "available" : "taken") : null);
      } catch {
        setStatus(null);
      }
    }, AVAILABILITY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, value, excludeUserId]);

  return status;
}

function AvailabilityHint({ status }) {
  if (status === "checking") return <span style={{ display: "block", fontSize: 12, color: "#94a3b8", margin: "-8px 0 10px" }}>Checking availability…</span>;
  if (status === "taken") return <span style={{ display: "block", fontSize: 12, color: "#dc2626", margin: "-8px 0 10px" }}>Already taken</span>;
  if (status === "available") return <span style={{ display: "block", fontSize: 12, color: "#16a34a", margin: "-8px 0 10px" }}>Available</span>;
  return null;
}

export default function UserFormModal({
  mode,
  roleGroup,
  title,
  form,
  onFieldChange,
  photo,
  onPhotoChange,
  currentPhotoUrl,
  excludeUserId,
  submitting,
  submitLabel,
  submittingLabel,
  onSubmit,
  onClose,
}) {
  const isEdit = mode === "edit";
  const positionOptions = POSITION_OPTIONS[roleGroup] || [];
  const usernameStatus = useAvailability("username", form.username, excludeUserId, 3);
  const emailStatus = useAvailability("email", form.email, excludeUserId, 5);
  const photoInputId = `userFormPhotoInput-${mode}-${roleGroup}`;
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        style={{ display: "flex", flexDirection: "column", maxHeight: "90vh", overflow: "hidden" }}
      >
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "20px 24px 16px", borderBottom: "1px solid #f1f5f9", background: "#fff", flexShrink: 0,
          }}
        >
          <h2 className={styles.modalTitle} style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: "#f1f5f9", border: "none", cursor: "pointer", color: "#64748b",
              width: 32, height: 32, minWidth: 32, borderRadius: 8,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", overscrollBehavior: "contain" }}>
          {isEdit && <label className={styles.fieldLabel}>Full Name <span style={{ color: "#e53e3e" }}>*</span></label>}
          <input
            className={styles.input}
            placeholder="Full Name"
            value={form.name}
            // Letters, spaces, a period (initials, "Ma.", "Jr.") and ñ/Ñ only.
            onChange={(e) =>
              onFieldChange("name", e.target.value.replace(/[^A-Za-zñÑ\s.]/g, ""))
            }
          />

          {isEdit && <label className={styles.fieldLabel}>Username <span style={{ color: "#e53e3e" }}>*</span></label>}
          <input
            className={styles.input}
            placeholder="Username"
            value={form.username}
            onChange={(e) => onFieldChange("username", e.target.value)}
          />
          <AvailabilityHint status={usernameStatus} />

          {isEdit && <label className={styles.fieldLabel}>Email Address <span style={{ color: "#e53e3e" }}>*</span></label>}
          <input
            className={styles.input}
            type="email"
            placeholder="Email Address"
            value={form.email}
            onChange={(e) => onFieldChange("email", e.target.value)}
          />
          <AvailabilityHint status={emailStatus} />

          {!isEdit && (
            <>
              <label className={styles.fieldLabel}>Temporary Password</label>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <input
                    className={styles.input}
                    type={showPassword ? "text" : "password"}
                    placeholder="Temporary Password"
                    value={form.password}
                    onChange={(e) => onFieldChange("password", e.target.value)}
                    style={{ paddingRight: 40 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    style={{
                      position: "absolute", right: 10, top: 12, background: "none",
                      border: "none", cursor: "pointer", color: "#94a3b8", padding: 0, display: "flex",
                    }}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onFieldChange("password", generateTempPassword());
                    setShowPassword(true);
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, height: 40, padding: "0 12px",
                    background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8,
                    cursor: "pointer", color: "#334155", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
                  }}
                >
                  <RefreshCw size={14} /> Generate
                </button>
              </div>
              <p className={styles.fieldHint}>
                At least 8 characters, with 1 uppercase letter and 1 number. Give this to the account owner — they'll be asked to set their own password on first login.
              </p>
            </>
          )}

          <label className={styles.fieldLabel}>Position</label>
          <select
            className={styles.input}
            value={form.position}
            onChange={(e) => onFieldChange("position", e.target.value)}
          >
            {positionOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <div className={styles.fileUploadBox}>
            <input
              type="file"
              accept="image/*"
              id={photoInputId}
              style={{ display: "none" }}
              onChange={(e) => onPhotoChange(e.target.files[0])}
            />
            <label htmlFor={photoInputId} className={styles.fileLabel}>
              {photo ? (
                <><CheckSquare size={14} strokeWidth={1.5} /> {photo.name}</>
              ) : (
                <><Upload size={14} strokeWidth={1.5} /> Click to {isEdit ? "replace" : "upload"} {isEdit ? "photo" : "profile photo"} (optional)</>
              )}
            </label>
            {isEdit && currentPhotoUrl && !photo && (
              <p className={styles.fileHint}>Current photo on file</p>
            )}
          </div>
        </div>

        <div
          style={{
            display: "flex", gap: 10, justifyContent: "flex-end",
            padding: "16px 24px 20px", borderTop: "1px solid #f1f5f9", background: "#fff", flexShrink: 0,
          }}
        >
          <button className={styles.confirmBtn} onClick={onSubmit} disabled={submitting}>
            {submitting ? submittingLabel : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
