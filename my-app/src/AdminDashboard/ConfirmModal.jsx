// ConfirmModal.jsx
// Usage: import ConfirmModal from "./ConfirmModal";
//
// <ConfirmModal
//   type="success" | "delete" | "warning" | "error"
//   title="Your title"
//   message="Your message"
//   confirmLabel="Done"        // optional, has defaults
//   cancelLabel="Cancel"       // optional, pass false to hide
//   onConfirm={() => {}}
//   onCancel={() => {}}
// />

import { useEffect } from "react";
import { createPortal } from "react-dom";

const CONFIGS = {
  success: {
    iconBg: "#d1fae5",
    iconColor: "#10b981",
    btnColor: "#22c55e",
    btnHover: "#16a34a",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
    confirmLabel: "Done",
  },
  delete: {
    iconBg: "#fee2e2",
    iconColor: "#ef4444",
    btnColor: "#ef4444",
    btnHover: "#dc2626",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6M14 11v6" />
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      </svg>
    ),
    confirmLabel: "Delete",
  },
  warning: {
    iconBg: "#fef9c3",
    iconColor: "#eab308",
    btnColor: "#f59e0b",
    btnHover: "#d97706",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
    confirmLabel: "Confirm",
  },
  error: {
    iconBg: "#fce7f3",
    iconColor: "#ec4899",
    btnColor: "#ec4899",
    btnHover: "#db2777",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
        <circle cx="12" cy="12" r="10" />
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
      </svg>
    ),
    confirmLabel: "Reconnect",
  },
  info: {
    iconBg: "#e0e7ff",
    iconColor: "#6366f1",
    btnColor: "#6366f1",
    btnHover: "#4f46e5",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
    confirmLabel: "Allow Now",
  },
};

export default function ConfirmModal({
  type = "info",
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  loading = false,
  children, // optional extra content (e.g. form fields) shown above the buttons
}) {
  const cfg = CONFIGS[type] || CONFIGS.info;
  const confirm = confirmLabel || cfg.confirmLabel;

  // Close on Escape (not while a confirm request is in flight)
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape" && onCancel && !loading) onCancel(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel, loading]);

  // Rendered into <body>, not where it's used: an ancestor with a transform
  // or backdrop-filter (e.g. the record View window) would otherwise trap
  // this fixed overlay inside it, clipped or hidden behind other content.
  return createPortal(
    <>
      <style>{`
        .cm-overlay {
          position: fixed; inset: 0;
          background: rgba(100, 100, 130, 0.25);
          backdrop-filter: blur(2px);
          display: flex; align-items: center; justify-content: center;
          z-index: 9999;
          animation: cmFadeIn 0.15s ease;
        }
        @keyframes cmFadeIn { from { opacity: 0 } to { opacity: 1 } }

        .cm-card {
          background: #fff;
          border-radius: 20px;
          padding: 36px 28px 28px;
          width: 100%;
          max-width: 360px;
          text-align: center;
          box-shadow: 0 8px 40px rgba(0,0,0,0.12);
          animation: cmSlideUp 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes cmSlideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.96) }
          to   { opacity: 1; transform: translateY(0)   scale(1)    }
        }

        .cm-icon-wrap {
          width: 68px; height: 68px;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 20px;
        }

        .cm-title {
          font-family: 'Segoe UI', system-ui, sans-serif;
          font-size: 18px;
          font-weight: 700;
          color: #1a1a2e;
          margin: 0 0 10px;
          line-height: 1.3;
        }

        .cm-message {
          font-family: 'Segoe UI', system-ui, sans-serif;
          font-size: 14px;
          color: #6b7280;
          margin: 0 0 24px;
          line-height: 1.6;
        }

        .cm-btn {
          width: 100%;
          padding: 14px;
          border: none;
          border-radius: 10px;
          font-family: 'Segoe UI', system-ui, sans-serif;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.1s;
          margin-bottom: 10px;
        }
        .cm-btn:last-child { margin-bottom: 0; }
        .cm-btn:hover { opacity: 0.9; }
        .cm-btn:active { transform: scale(0.98); }
        .cm-btn:disabled { cursor: not-allowed; opacity: 0.7; }
        .cm-btn:disabled:active { transform: none; }

        .cm-btn-confirm {
          color: #fff;
          display: flex; align-items: center; justify-content: center;
        }

        .cm-btn-cancel {
          background: #f3f4f6;
          color: #374151;
        }
        .cm-btn-cancel:hover { background: #e5e7eb; opacity: 1; }

        .cm-spinner {
          width: 18px; height: 18px;
          border: 2.5px solid rgba(255,255,255,0.4);
          border-top-color: #fff;
          border-radius: 50%;
          animation: cmSpin 0.6s linear infinite;
        }
        @keyframes cmSpin { to { transform: rotate(360deg) } }
      `}</style>

      <div className="cm-overlay" onClick={(e) => { if (e.target === e.currentTarget && onCancel && !loading) onCancel(); }}>
        <div className="cm-card">
          <div className="cm-icon-wrap" style={{ background: cfg.iconBg }}>
            <span style={{ color: cfg.iconColor, display: "flex" }}>{cfg.icon}</span>
          </div>

          {title && <p className="cm-title">{title}</p>}
          {message && <p className="cm-message">{message}</p>}
          {children}

          <button
            className="cm-btn cm-btn-confirm"
            style={{ background: cfg.btnColor }}
            onMouseEnter={(e) => { if (!loading) e.target.style.background = cfg.btnHover; }}
            onMouseLeave={(e) => { if (!loading) e.target.style.background = cfg.btnColor; }}
            onClick={loading ? undefined : onConfirm}
            disabled={loading}
          >
            {loading ? <span className="cm-spinner" aria-label="Loading" /> : confirm}
          </button>

          {cancelLabel !== false && (
            <button className="cm-btn cm-btn-cancel" onClick={loading ? undefined : onCancel} disabled={loading}>
              {cancelLabel}
            </button>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}