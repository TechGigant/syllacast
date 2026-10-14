/*
 * Syllacast - Standalone Spotify Lyrics Kiosk
 * Copyright (C) 2026 TechGigant
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export interface UpdateNotification {
  current_version: string;
  latest_version: string;
  is_critical_security_update: boolean;
  release_notes_url: string;
  release_notes?: string;
  published_at: string;
}

export interface UpdateProgress {
  stage: string;
  percent: number;
  message: string;
}

export interface KioskUpdateBanner {
  element: HTMLElement;
  show: (info: UpdateNotification) => void;
  showProgress: (progress: UpdateProgress) => void;
  hide: () => void;
}

function isSafeHttpUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function createKioskUpdateBanner(): KioskUpdateBanner {
  const container = document.createElement("div");
  container.className = "kiosk-update-banner";
  container.style.cssText = `
    position: fixed;
    top: 72px;
    right: 28px;
    z-index: 99999;
    max-width: 440px;
    width: min(440px, calc(100vw - 56px));
    border-radius: 14px;
    padding: 14px 18px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #ffffff;
    display: none;
    flex-direction: column;
    gap: 10px;
    transition: opacity 0.3s ease, transform 0.3s ease;
  `;

  let currentInfo: UpdateNotification | null = null;
  let isUpdating = false;

  function renderStandard(info: UpdateNotification) {
    container.style.background = "rgba(18, 18, 24, 0.88)";
    container.style.border = "1px solid rgba(255, 255, 255, 0.15)";

    container.innerHTML = `
      <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.25rem;">✨</span>
          <div>
            <div id="banner-title" style="font-weight: 700; font-size: 0.95rem; letter-spacing: -0.01em;"></div>
            <div id="banner-current" style="font-size: 0.78rem; color: rgba(255, 255, 255, 0.65); margin-top: 2px;"></div>
          </div>
        </div>
        <button id="banner-btn-dismiss" style="background: none; border: none; color: rgba(255, 255, 255, 0.5); font-size: 1.1rem; cursor: pointer; padding: 2px 4px; line-height: 1;">✕</button>
      </div>

      <div id="banner-actions" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px;">
        <button id="banner-btn-update" style="
          background: #ff3366;
          color: #fff;
          border: none;
          padding: 6px 14px;
          border-radius: 8px;
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        ">Update Now</button>

        <button id="banner-btn-snooze" style="
          background: transparent;
          color: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.2);
          padding: 6px 12px;
          border-radius: 8px;
          font-size: 0.82rem;
          font-weight: 500;
          cursor: pointer;
        ">Remind Later</button>
      </div>
    `;

    const titleEl = container.querySelector("#banner-title");
    if (titleEl) titleEl.textContent = `Syllacast v${info.latest_version} Available`;

    const curEl = container.querySelector("#banner-current");
    if (curEl) curEl.textContent = `Currently running v${info.current_version}`;

    if (isSafeHttpUrl(info.release_notes_url)) {
      const link = document.createElement("a");
      link.href = info.release_notes_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Release Notes";
      link.style.cssText = `
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
        text-decoration: none;
        padding: 6px 12px;
        border-radius: 8px;
        font-size: 0.82rem;
        font-weight: 500;
        display: inline-flex;
        align-items: center;
      `;
      const actionsEl = container.querySelector("#banner-actions");
      const snoozeBtn = container.querySelector("#banner-btn-snooze");
      if (actionsEl && snoozeBtn) {
        actionsEl.insertBefore(link, snoozeBtn);
      }
    }

    container.querySelector("#banner-btn-update")?.addEventListener("click", () => {
      triggerApplyUpdate();
    });

    container.querySelector("#banner-btn-snooze")?.addEventListener("click", () => {
      void snoozeUpdate();
    });

    container.querySelector("#banner-btn-dismiss")?.addEventListener("click", () => {
      container.style.display = "none";
    });
  }

  function renderCritical(info: UpdateNotification) {
    container.style.background = "rgba(45, 12, 20, 0.94)";
    container.style.border = "1px solid #ff3366";
    container.style.boxShadow = "0 0 25px rgba(255, 51, 102, 0.35)";

    container.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 12px;">
        <span style="font-size: 1.4rem;">🛡️</span>
        <div style="flex: 1;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="
              font-size: 0.68rem;
              text-transform: uppercase;
              font-weight: 800;
              letter-spacing: 0.08em;
              background: #ff3366;
              color: #fff;
              padding: 2px 6px;
              border-radius: 4px;
            ">CRITICAL SECURITY UPDATE</span>
          </div>
          <div id="banner-critical-title" style="font-weight: 700; font-size: 0.95rem; margin-top: 4px;"></div>
          <div style="font-size: 0.78rem; color: rgba(255, 255, 255, 0.75); margin-top: 3px; line-height: 1.35;">
            This release contains essential security and stability fixes. Please install immediately.
          </div>
        </div>
      </div>

      <div id="banner-critical-actions" style="display: flex; gap: 8px; margin-top: 6px;">
        <button id="banner-btn-update-critical" style="
          flex: 1;
          background: #ff3366;
          color: #fff;
          border: none;
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 0.85rem;
          font-weight: 700;
          cursor: pointer;
        ">Update Immediately</button>
      </div>
    `;

    const critTitle = container.querySelector("#banner-critical-title");
    if (critTitle) critTitle.textContent = `Syllacast v${info.latest_version} is required`;

    if (isSafeHttpUrl(info.release_notes_url)) {
      const link = document.createElement("a");
      link.href = info.release_notes_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "View Advisory";
      link.style.cssText = `
        background: rgba(255, 255, 255, 0.12);
        color: #fff;
        text-decoration: none;
        padding: 8px 14px;
        border-radius: 8px;
        font-size: 0.82rem;
        font-weight: 600;
        display: inline-flex;
        align-items: center;
      `;
      container.querySelector("#banner-critical-actions")?.appendChild(link);
    }

    container.querySelector("#banner-btn-update-critical")?.addEventListener("click", () => {
      triggerApplyUpdate();
    });
  }

  function triggerApplyUpdate() {
    isUpdating = true;
    showProgress({
      stage: "downloading",
      percent: 5,
      message: "Starting update download...",
    });

    fetch("/api/updates/apply", { method: "POST" }).catch((e) => {
      console.error("Failed to start update:", e);
      showProgress({
        stage: "error",
        percent: 0,
        message: "Failed to trigger update: " + String(e),
      });
    });
  }

  async function snoozeUpdate() {
    try {
      await fetch("/api/updates/snooze", { method: "POST" });
    } catch (e) {
      console.error("Failed to snooze update:", e);
    }
    container.style.display = "none";
  }

  function show(info: UpdateNotification) {
    if (isUpdating) return;
    if (!info || !info.latest_version) return;
    currentInfo = info;
    if (info.is_critical_security_update) {
      renderCritical(info);
    } else {
      renderStandard(info);
    }
    container.style.display = "flex";
  }

  function showProgress(progress: UpdateProgress) {
    isUpdating = true;
    container.style.background = "rgba(18, 18, 24, 0.95)";
    container.style.border = "1px solid rgba(255, 255, 255, 0.2)";
    container.style.display = "flex";

    const isDone = progress.stage === "restarting";
    const isError = progress.stage === "error";

    container.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 1.25rem;">${isDone ? "🔄" : isError ? "⚠️" : "⏳"}</span>
        <div style="flex: 1;">
          <div style="font-weight: 700; font-size: 0.9rem;">
            ${isDone ? "Restarting Service..." : isError ? "Update Error" : "Updating Syllacast..."}
          </div>
          <div id="banner-progress-msg" style="font-size: 0.78rem; color: rgba(255, 255, 255, 0.7); margin-top: 2px;"></div>
        </div>
        <span id="banner-progress-pct" style="font-size: 0.82rem; font-weight: 700; color: #ff3366;"></span>
      </div>

      <div style="width: 100%; height: 6px; background: rgba(255, 255, 255, 0.1); border-radius: 9999px; overflow: hidden; margin-top: 4px;">
        <div id="banner-progress-bar" style="
          height: 100%;
          background: ${isError ? "#e74c3c" : "#ff3366"};
          transition: width 0.3s ease;
        "></div>
      </div>
    `;

    const cleanPct = Math.min(100, Math.max(0, Math.round(progress.percent || 0)));
    const msgEl = container.querySelector("#banner-progress-msg");
    if (msgEl) msgEl.textContent = progress.message;

    const pctEl = container.querySelector("#banner-progress-pct");
    if (pctEl) pctEl.textContent = `${cleanPct}%`;

    const barEl = container.querySelector<HTMLElement>("#banner-progress-bar");
    if (barEl) barEl.style.width = `${cleanPct}%`;

    if (isDone) {
      // Poll until reconnect, then reload window
      setTimeout(() => {
        const check = setInterval(async () => {
          try {
            const res = await fetch("/state", { cache: "no-store" });
            if (res.ok) {
              clearInterval(check);
              window.location.reload();
            }
          } catch {}
        }, 1500);
      }, 3000);
    }
  }

  function hide() {
    container.style.display = "none";
  }

  return {
    element: container,
    show,
    showProgress,
    hide,
  };
}
