/**
 * AccountLinking.jsx
 * Links a council member (who gets tagged as an Author) to the login
 * account that person signs in with — sb_council_members.user_id, see
 * my-backend/helpers/accountLinks.js and Author_Approval_Workflow_v2.docx:
 *   Option A (main)       CreateAccountFields — "Create login account" on
 *                         Add Council Member; the account is created linked.
 *   Option B (safety net) automatic on the server; accountLinkMessage below
 *                         reports what it did.
 *   Manual                LoginAccountField (Edit member) for rare edge
 *                         cases, and SuggestMatchesModal for the one-time
 *                         cleanup of records that existed before linking.
 */

import { useEffect, useState } from "react";
import { Link2, Link2Off, UserPlus, X, Check } from "lucide-react";
import { API, authFetch, extractErrorMsg } from "./AdminContext";
import { isCurrentTerm, wantsAccount } from "./authorWorkflow";

const LINKABLE_POSITIONS = ["councilor", "vice_mayor", "liga_ng_mga_barangay", "sk_federated"];
const POSITION_LABELS = {
  councilor: "Councilor",
  vice_mayor: "Vice-Mayor",
  liga_ng_mga_barangay: "Liga ng mga Barangay",
  sk_federated: "SK Federated",
};

const box = {
  marginTop: 14,
  padding: "14px 16px",
  background: "#f8fafc",
  borderRadius: 10,
  border: "1px solid #e2e8f0",
};
const boxTitle = {
  fontSize: 12,
  fontWeight: 700,
  color: "#1a365d",
  marginBottom: 10,
  display: "flex",
  alignItems: "center",
  gap: 6,
  textTransform: "uppercase",
  letterSpacing: "0.4px",
};
const hint = { fontSize: 12, color: "#64748b", margin: "6px 0 0" };

// ── Option A: Add Council Member → "Create login account" ─────────────────────
export function CreateAccountFields({ form, setForm, styles }) {
  const checked = wantsAccount(form);
  return (
    <div style={box}>
      <div style={boxTitle}>
        <UserPlus size={13} /> Login Account
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setForm({ ...form, create_account: e.target.checked })}
        />
        Create login account for this member
      </label>
      {checked ? (
        <>
          <label className={styles.fieldLabel} style={{ marginTop: 10 }}>
            Username <span style={{ color: "#e53e3e" }}>*</span>
          </label>
          <input
            className={styles.input}
            placeholder="Username (letters and numbers)"
            value={form.account_username || ""}
            onChange={(e) => setForm({ ...form, account_username: e.target.value.normalize("NFC").replace(/[^A-Za-z0-9ñÑ]/g, "") })}
          />
          <label className={styles.fieldLabel}>
            Email <span style={{ color: "#e53e3e" }}>*</span>
          </label>
          <input
            className={styles.input}
            type="email"
            placeholder="Email address"
            value={form.account_email || ""}
            onChange={(e) => setForm({ ...form, account_email: e.target.value })}
          />
          <p style={hint}>
            The account is linked to this member automatically, so they can approve the ordinances and resolutions
            they author. They'll get an email to set their own password.
          </p>
        </>
      ) : (
        <p style={hint}>
          {isCurrentTerm(form)
            ? "No account will be created. If one already exists with the same name and seat, it's linked automatically."
            : "Past officials don't need an account. Author approvals for them are recorded by the Secretary."}
        </p>
      )}
    </div>
  );
}

// ── Small badge for member cards ──────────────────────────────────────────────
export function AccountLinkBadge({ member }) {
  const linked = !!member?.user_id;
  return (
    <span
      title={linked ? "This member can sign in and approve their own records." : "No login account linked."}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 999,
        marginTop: 4,
        background: linked ? "#e6fffa" : "#f1f5f9",
        color: linked ? "#2c7a7b" : "#64748b",
      }}
    >
      {linked ? <Link2 size={11} /> : <Link2Off size={11} />}
      {linked ? "Account linked" : "No account"}
    </span>
  );
}

// ── Manual: Edit member → Login Account ───────────────────────────────────────
// Only needed for the rare cases auto-linking can't settle (two members with
// the same name, a name typed differently). Lists Councilor/VM/Liga/SK
// accounts not linked to anyone else; unlinking warns when approvals are
// still waiting on this member.
export function LoginAccountField({ member, styles, onChanged }) {
  const [users, setUsers] = useState(null);
  const [selected, setSelected] = useState(member.user_id ? String(member.user_id) : "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let alive = true;
    authFetch(`${API}/api/users`)
      .then((r) => r.json())
      .then((data) => alive && setUsers(Array.isArray(data) ? data : []))
      .catch(() => alive && setUsers([]));
    return () => {
      alive = false;
    };
  }, []);

  const options = (users || []).filter(
    (u) => LINKABLE_POSITIONS.includes(u.position) && (!u.linked_member || u.linked_member.id === member.id)
  );
  const current = (users || []).find((u) => u.id === member.user_id);

  const save = async (userId) => {
    setMessage(null);
    if (userId === null) {
      try {
        const r = await authFetch(`${API}/api/sb-council-members/${member.id}/pending-approvals`);
        const { count } = await r.json();
        if (
          count > 0 &&
          !window.confirm(
            `${count} author approval${count > 1 ? "s are" : " is"} still waiting on ${member.full_name}. ` +
              "After unlinking, the Secretary will have to record them on their behalf. Unlink anyway?"
          )
        )
          return;
      } catch {
        /* the unlink itself still reports any real error */
      }
    }
    setSaving(true);
    try {
      const res = await authFetch(`${API}/api/sb-council-members/${member.id}/account`, {
        method: "PUT",
        body: JSON.stringify({ user_id: userId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({ type: "success", text: userId === null ? "Account unlinked." : "Account linked." });
        if (userId === null) setSelected("");
        onChanged?.(data.data);
      } else setMessage({ type: "error", text: extractErrorMsg(data, "Couldn't save the link.") });
    } catch {
      setMessage({ type: "error", text: "Server error." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={box}>
      <div style={boxTitle}>
        <Link2 size={13} /> Login Account
      </div>
      {users === null ? (
        <p style={hint}>Loading accounts…</p>
      ) : (
        <>
          <p style={{ ...hint, marginTop: 0, marginBottom: 8 }}>
            {current
              ? `Linked to ${current.name} (${current.username}).`
              : "Not linked. New councilors are linked automatically — use this only when that couldn't happen."}
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              className={styles.input}
              style={{ marginBottom: 0, flex: 1 }}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={saving}
            >
              <option value="">— Select an account —</option>
              {options.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.username}, {POSITION_LABELS[u.position]})
                </option>
              ))}
            </select>
            <button
              type="button"
              className={styles.confirmBtn}
              style={{ whiteSpace: "nowrap" }}
              disabled={saving || !selected || Number(selected) === member.user_id}
              onClick={() => save(Number(selected))}
            >
              Link
            </button>
            {member.user_id && (
              <button
                type="button"
                className={styles.cancelBtn || styles.confirmBtn}
                style={{ whiteSpace: "nowrap" }}
                disabled={saving}
                onClick={() => save(null)}
              >
                Unlink
              </button>
            )}
          </div>
        </>
      )}
      {message && (
        <p style={{ ...hint, color: message.type === "error" ? "#c53030" : "#2f855a", fontWeight: 600 }}>
          {message.text}
        </p>
      )}
    </div>
  );
}

// ── One-time cleanup: "Suggest matches" ───────────────────────────────────────
// Lists unlinked members next to similarly named unlinked accounts. Nothing is
// linked until the Admin clicks Link on a pair.
export function SuggestMatchesModal({ onClose, onLinked }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [done, setDone] = useState({});

  const load = async () => {
    setError("");
    try {
      const res = await authFetch(`${API}/api/sb-council-members/link-suggestions`);
      const data = await res.json();
      if (res.ok && Array.isArray(data)) setRows(data);
      else {
        setRows([]);
        setError(extractErrorMsg(data, "Couldn't load suggestions."));
      }
    } catch {
      setRows([]);
      setError("Server error.");
    }
  };
  useEffect(() => {
    load();
  }, []);

  const link = async (memberId, user) => {
    setBusyId(memberId);
    setError("");
    try {
      const res = await authFetch(`${API}/api/sb-council-members/${memberId}/account`, {
        method: "PUT",
        body: JSON.stringify({ user_id: user.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setDone((d) => ({ ...d, [memberId]: user.username }));
        onLinked?.();
      } else setError(extractErrorMsg(data, "Couldn't link."));
    } catch {
      setError("Server error.");
    } finally {
      setBusyId(null);
    }
  };

  // An account linked in this session is no longer offered for other members.
  const usedUsernames = new Set(Object.values(done));

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 14,
          width: "min(640px, 100%)",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "18px 22px 12px",
            borderBottom: "1px solid #f1f5f9",
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 18, color: "#1a365d" }}>Suggest Account Matches</h2>
            <p style={{ ...hint, marginTop: 4 }}>
              One-time cleanup for members and accounts made before linking existed. Check each pair and click Link
              only when it's the same person.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "#f1f5f9",
              border: "none",
              borderRadius: 8,
              width: 32,
              height: 32,
              cursor: "pointer",
              color: "#64748b",
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div style={{ overflowY: "auto", padding: "14px 22px 20px" }}>
          {error && <p style={{ ...hint, color: "#c53030", fontWeight: 600 }}>{error}</p>}
          {rows === null ? (
            <p style={hint}>Looking for matches…</p>
          ) : rows.length === 0 ? (
            !error && <p style={hint}>No suggestions — every member with a similarly named account is already linked.</p>
          ) : (
            rows.map((r) => (
              <div
                key={r.member_id}
                style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}
              >
                <div style={{ fontWeight: 700, color: "#1a202c" }}>{r.full_name}</div>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>{r.position || "No current term"}</div>
                {done[r.member_id] ? (
                  <div style={{ color: "#2f855a", fontSize: 13, fontWeight: 600, display: "flex", gap: 6, alignItems: "center" }}>
                    <Check size={14} /> Linked to {done[r.member_id]}
                  </div>
                ) : (
                  r.candidates
                    .filter((u) => !usedUsernames.has(u.username))
                    .map((u) => (
                      <div
                        key={u.id}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0", fontSize: 14 }}
                      >
                        <span style={{ flex: 1 }}>
                          {u.name} <span style={{ color: "#64748b" }}>({u.username}, {POSITION_LABELS[u.position]})</span>
                          {u.exact && (
                            <span style={{ marginLeft: 6, fontSize: 11, color: "#2c7a7b", fontWeight: 700 }}>
                              exact match
                            </span>
                          )}
                        </span>
                        <button
                          disabled={busyId === r.member_id}
                          onClick={() => link(r.member_id, u)}
                          style={{
                            border: "none",
                            background: "#090446",
                            color: "#fff",
                            borderRadius: 8,
                            padding: "6px 12px",
                            fontSize: 13,
                            cursor: "pointer",
                          }}
                        >
                          Link
                        </button>
                      </div>
                    ))
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
