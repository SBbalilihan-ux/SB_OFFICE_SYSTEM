import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import ConfirmModal from "./ConfirmModal";

// User Management → Reset Password. The Secretary types a new temporary
// password to hand to the account owner in person; the owner is emailed a
// notice (not the password) and must set their own on their next login.
const inputStyle = {
  width: "100%",
  padding: "11px 40px 11px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 10,
  fontSize: 14,
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  boxSizing: "border-box",
};

export default function ResetPasswordModal({ target, loading, onSubmit, onCancel }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const Toggle = show ? EyeOff : Eye;

  const handleConfirm = () => {
    if (!password || !confirm) return setError("Both fields are required.");
    if (password.length < 8 || !/[A-Z]/.test(password) || !/\d/.test(password))
      return setError("Password must be at least 8 characters, with 1 uppercase letter and 1 number.");
    if (password !== confirm) return setError("Passwords do not match.");
    setError("");
    onSubmit(password);
  };

  return (
    <ConfirmModal
      type="warning"
      title={`Reset password for ${target.name}?`}
      message={`Set a temporary password and give it to them in person. They'll be asked to choose their own password at their next login${target.email ? `, and ${target.email} will be emailed a notice that their password was reset` : ""}.`}
      confirmLabel="Reset Password"
      loading={loading}
      onConfirm={handleConfirm}
      onCancel={onCancel}
    >
      <div style={{ textAlign: "left", marginBottom: 20 }}>
        <div style={{ position: "relative", marginBottom: 10 }}>
          <input
            type={show ? "text" : "password"}
            placeholder="New temporary password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
            autoFocus
            autoComplete="new-password"
          />
          <Toggle
            size={18}
            onClick={() => setShow((v) => !v)}
            role="button"
            aria-label={show ? "Hide password" : "Show password"}
            style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", cursor: "pointer", color: "#6b7280" }}
          />
        </div>
        <input
          type={show ? "text" : "password"}
          placeholder="Confirm temporary password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !loading) handleConfirm(); }}
          style={inputStyle}
          autoComplete="new-password"
        />
        <p style={{ fontSize: 12, color: "#6b7280", margin: "8px 0 0" }}>
          At least 8 characters, with 1 uppercase letter and 1 number.
        </p>
        {error && <p style={{ fontSize: 13, color: "#dc2626", margin: "8px 0 0" }}>{error}</p>}
      </div>
    </ConfirmModal>
  );
}
