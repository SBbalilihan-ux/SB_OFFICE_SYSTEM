/**
 * authorWorkflow.js
 * Non-component helpers for the author-approval workflow UI (account linking,
 * the approval panel, My Profile's record tabs). Kept out of the .jsx files so
 * those only export components (react-refresh/only-export-components).
 * See Author_Approval_Workflow_v2.docx.
 */

import { API, authFetch, extractErrorMsg } from "./AdminContext";

// ── Account linking (AccountLinking.jsx) ──────────────────────────────────────

const todayIso = () => new Date().toISOString().slice(0, 10);

// A term with no end date, or one ending today or later, is current — the
// "Create login account" box starts checked for those and unchecked for past
// officials, who never get an account.
export const isCurrentTerm = (form) => !!form.term_start && (!form.term_end || form.term_end >= todayIso());

// Whether the Add Council Member form will create an account: the Admin's
// explicit choice if they touched the box, otherwise the default above.
export const wantsAccount = (form) =>
  form.create_account === undefined || form.create_account === null ? isCurrentTerm(form) : !!form.create_account;

// Adds the Option A fields to the Add Council Member FormData.
export function appendAccountFields(fd, form) {
  if (!wantsAccount(form)) return;
  fd.append("create_account", "true");
  fd.append("account_username", (form.account_username || "").trim());
  fd.append("account_email", (form.account_email || "").trim());
}

// Client-side check before submitting, so a missing username/email shows up
// in the form instead of as a server round trip.
export function accountFieldsError(form) {
  if (!wantsAccount(form)) return null;
  if (!/^[A-Za-z0-9ñÑ]+$/.test((form.account_username || "").normalize("NFC"))) return "Login account: username must be letters (including ñ) and numbers only.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.account_email || "")) return "Login account: a valid email is required.";
  return null;
}

// Success text for Add Council Member / Add User, saying what linking did.
export function accountLinkMessage(data, fallback) {
  if (data?.account) {
    return data.account.emailSent
      ? `${fallback} A login account (${data.account.username}) was created and linked. A "set your password" link was emailed to ${data.account.email}.`
      : `${fallback} A login account (${data.account.username}) was created and linked, but the email couldn't be sent — use Users → Reset Password to resend the link.`;
  }
  if (data?.linkedUser) return `${fallback} Linked automatically to the existing account "${data.linkedUser.username}".`;
  if (data?.linkedMember) return `${fallback} Linked automatically to council member ${data.linkedMember.full_name}.`;
  if (data?.linkedMember === null && data?.userId) {
    return `${fallback} It isn't linked to a council member yet — if this is an official, link it from Officials → Edit member → Login Account.`;
  }
  return fallback;
}

// ── Author approval (AuthorApprovalPanel.jsx) ────────────────────────────────

export const STAGE_LABELS = {
  accepted: "Acceptance (before First Reading)",
  first_reading: "First Reading",
  second_reading: "Second Reading",
  third_reading: "Third Reading",
  publish: "Final approval to publish",
};

// Success modal text after the author decides — shared by the approval panel
// and My Profile's "Needs My Approval" tab.
export function decisionSuccess(decision, stage, title) {
  const what = `the ${STAGE_LABELS[stage] || "request"}${title ? ` of "${title}"` : ""}`;
  return decision === "approved"
    ? { title: "Approved", message: `You approved ${what}. The Secretary has been notified and can now move it forward.` }
    : { title: "Decision Recorded", message: `You declined ${what}. The Secretary has been notified and will follow up with you.` };
}

// Shared with My Profile's "Needs My Approval" tab. Returns { ok, error? }.
export async function decideAuthorApproval(route, id, decision, comment) {
  try {
    const res = await authFetch(`${API}/api/${route}/${id}/author-approval/decide`, {
      method: "PUT",
      body: JSON.stringify({ decision, comment }),
    });
    const data = await res.json();
    if (res.ok && data.success) return { ok: true };
    return { ok: false, error: extractErrorMsg(data, "Couldn't save your decision.") };
  } catch {
    return { ok: false, error: "Server error." };
  }
}

// ── My Profile records (MyProfileRecords.jsx) ─────────────────────────────────

export const MY_RECORDS_QUERY_KEY = ["my-records"];
export const fetchMyRecords = async () => {
  const res = await authFetch(`${API}/api/users/me/records`);
  if (!res.ok) throw new Error("Failed to load your records.");
  return res.json();
};

// Tab definitions for the My Profile TabNavigation; empty when the account
// has no linked council member.
export function myRecordTabs(data) {
  if (!data?.member) return [];
  const rejected = data.authored.filter((r) => r.status === "rejected");
  return [
    { id: "approvals", label: "Needs My Approval", badge: data.awaiting_my_approval.length },
    { id: "authored", label: "Authored", badge: data.authored.length },
    { id: "involved", label: "Co-Authored / Sponsored", badge: data.co_authored.length + data.sponsored.length },
    { id: "rejected", label: "Rejected", badge: rejected.length },
  ];
}

// Hero stat chips.
export function myRecordStats(data) {
  if (!data?.member) return [];
  return [
    { label: "Authored", value: data.authored.length },
    { label: "Needs Approval", value: data.awaiting_my_approval.length },
    { label: "Rejected", value: data.authored.filter((r) => r.status === "rejected").length },
  ];
}

