// productTour.js
// The dashboard's guided tour — one short walk through the layout: the
// sidebar's modules, My Profile, and the "?" help button that replays it.
// Starts automatically on an account's first visit (users.tour_completed,
// see migrations/036_add_tour_completed.sql) and from the "?" button any
// time after.
//
// Steps point at elements tagged with data-tour="..." in AdminDashboard.jsx.
// A step whose element isn't on the page is dropped, so each role's tour
// only covers what that account's sidebar actually shows (e.g. Archives is
// Secretary-only, User Management is Secretary/Clerk-only).

import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./productTour.css";

const LEGISLATIVE_HOW_TO = {
  staff:
    "Upload new records, review drafts, and move them through the readings until they're published.",
  vice_mayor:
    "Browse published records, upload drafts, and approve records sent to you before they're published.",
  councilor:
    "Browse published records, upload your own drafts for review, and approve records you authored when asked.",
};

function buildSteps({ name, position }) {
  const isStaff = position === "secretary" || position === "clerk";
  const firstName = (name || "").trim().split(/\s+/)[0];
  const legislativeHowTo = isStaff
    ? LEGISLATIVE_HOW_TO.staff
    : position === "vice_mayor"
    ? LEGISLATIVE_HOW_TO.vice_mayor
    : LEGISLATIVE_HOW_TO.councilor;

  return [
    {
      title: firstName ? `Welcome to eLEGIS, ${firstName}!` : "Welcome to eLEGIS!",
      description:
        "Here's a quick look around the system. It only takes a minute, and you can skip it anytime.",
    },
    {
      target: "nav-dashboard",
      title: "Dashboard",
      description:
        "Your home page: record counts, upcoming events, the latest announcements, and anything waiting for your review.",
    },
    {
      target: "nav-legislative",
      title: "Legislative Records",
      description: `Ordinances, Resolutions, Session Minutes, and the Order of Business. ${legislativeHowTo}`,
    },
    {
      target: "nav-calendar",
      title: "Calendar",
      description: "Sessions, meetings, events, and holidays at a glance.",
    },
    {
      target: "nav-announcements",
      title: "Announcements",
      description: "Office news and notices. The badge shows how many you haven't read yet.",
    },
    {
      target: "nav-officials",
      title: "Councilor Management",
      description:
        "The council's members, their terms and positions, and the records each one has authored.",
    },
    {
      target: "nav-content",
      title: "Content Management",
      description: "Posts, schedules, and trivia shown to the public.",
    },
    {
      target: "nav-archives",
      title: "Archives",
      description: "Archived records. Restore them, or delete them permanently.",
    },
    {
      target: "nav-users",
      title: "User Management",
      description:
        position === "secretary"
          ? "Create accounts for councilors and staff, reset passwords, and review the activity logs."
          : "Create accounts for councilors and staff, and reset their passwords.",
    },
    {
      target: "profile",
      title: "My Profile",
      description:
        "Click your name to update your details, change your password, and see records linked to you. Log out with the button below it.",
      side: "right",
      align: "end",
    },
    {
      target: "help",
      title: "Need a refresher?",
      description: "Click this ? on the Dashboard anytime to replay the tour.",
      side: "bottom",
      align: "end",
    },
  ];
}

// Skips elements that are in the DOM but not displayed.
function findVisible(target) {
  return [...document.querySelectorAll(`[data-tour="${target}"]`)].find(
    (el) => el.getClientRects().length > 0
  );
}

export function startProductTour({ name, position, onDone }) {
  const steps = buildSteps({ name, position })
    .map((step) => ({ ...step, element: step.target ? findVisible(step.target) : undefined }))
    .filter((step) => !step.target || step.element)
    .map(({ element, title, description, side = "right", align = "start" }) => ({
      element,
      popover: { title, description, side, align },
    }));

  const tour = driver({
    steps,
    showProgress: true,
    progressText: "{{current}} of {{total}}",
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Finish",
    popoverClass: "elegis-tour",
    stagePadding: 6,
    stageRadius: 10,
    // Look, don't click — a click on a highlighted nav item would switch
    // pages (and close the mobile sidebar) underneath the tour.
    disableActiveInteraction: true,
    onPopoverRender: (popover) => {
      if (tour.isLastStep()) return;
      const skip = document.createElement("button");
      skip.type = "button";
      skip.className = "elegis-tour-skip";
      skip.textContent = "Skip tour";
      skip.addEventListener("click", () => tour.destroy());
      popover.footer.insertBefore(skip, popover.footer.firstChild);
    },
    // Finish, Skip, the × button, Esc, and clicking the backdrop all end
    // here — every one of them counts as "seen".
    onDestroyed: () => onDone?.(),
  });

  tour.drive();
  return tour;
}
