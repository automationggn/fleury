(() => {
  const API = window.APP_CONFIG?.API_BASE;

  let lastKnownStatus = null; // "not_enrolled" | "pending" | "enrolled" | null
  let lastKnownUser = null;

  let isEnrollBusy = false;
  let isVerifyBusy = false;

  function emailToAlnumKey(email) {
    return (email || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function qrUrl(text) {
    return (
      "https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=" +
      encodeURIComponent(text)
    );
  }

  async function getUserInfo() {
    const res = await fetch("/.auth/me");
    const data = await res.json();
    return data.clientPrincipal || null;
  }

  function initialsFromEmail(email) {
    if (!email) return "?";
    const left = email.split("@")[0] || email;
    const parts = left.split(/[.\-_]+/).filter(Boolean);
    const a = (parts[0] || left)[0] || "?";
    const b = (parts[1] || "")[0] || (left.length > 1 ? left[1] : "");
    return (a + b).toUpperCase();
  }

  function orgFromEmail(email) {
    if (!email || !email.includes("@")) return "—";
    const domain = (email.split("@")[1] || "").trim();
    if (!domain) return "—";
    const firstLabel = domain.split(".")[0] || "";
    if (!firstLabel) return "—";
    const lower = firstLabel.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  function formatLocalTime(dt) {
    try {
      return new Date(dt).toLocaleString();
    } catch {
      return dt;
    }
  }

  // -----------------------------
  // Toasts
  // -----------------------------
  function ensureToastStyles() {
    if (document.getElementById("totpToastStyles")) return;

    const style = document.createElement("style");
    style.id = "totpToastStyles";
    style.textContent = `
      .toastHost {
        position: fixed;
        top: 16px;
        right: 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        z-index: 10000;
        pointer-events: none;
      }
      .toast {
        width: min(360px, calc(100vw - 32px));
        background: #fff;
        border: 1px solid var(--border, #e5e7eb);
        border-radius: 12px;
        box-shadow: 0 16px 40px rgba(0,0,0,0.14);
        padding: 12px;
        display: flex;
        gap: 10px;
        align-items: flex-start;
        pointer-events: auto;
        transform: translateY(-6px);
        opacity: 0;
        transition: opacity 140ms ease, transform 140ms ease;
      }
      .toast.show { opacity: 1; transform: translateY(0); }

      .toastIcon {
        width: 28px; height: 28px;
        border-radius: 10px;
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        font-size: 14px;
      }
      .toastBody { flex: 1 1 auto; min-width: 0; }
      .toastTitle {
        margin: 0;
        font-size: 13px;
        font-weight: 800;
        color: var(--text-main, #111827);
      }
      .toastMsg {
        margin: 2px 0 0 0;
        font-size: 12px;
        color: var(--text-muted, #6b7280);
        line-height: 1.35;
        word-break: break-word;
      }
      .toastClose {
        border: 0;
        background: transparent;
        cursor: pointer;
        color: #9ca3af;
        font-size: 16px;
        padding: 2px 6px;
        margin-left: 4px;
      }
      .toastClose:hover { color: #6b7280; }

      .toast.success .toastIcon { background: var(--success-bg, #ecfdf5); color: var(--success-text, #047857); }
      .toast.warn    .toastIcon { background: var(--warn-bg, #fffbeb); color: var(--warn-text, #b45309); }
      .toast.error   .toastIcon { background: var(--err-bg, #fef2f2); color: var(--err-text, #b91c1c); }
      .toast.info    .toastIcon { background: #eff6ff; color: #1d4ed8; }
    `;
    document.head.appendChild(style);
  }

  function ensureToastHost() {
    ensureToastStyles();
    let host = document.getElementById("toastHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "toastHost";
      host.className = "toastHost";
      document.body.appendChild(host);
    }
    return host;
  }

  function showToast(type, title, message, ttlMs = 4500) {
    const host = ensureToastHost();
    const iconByType = { success: "✅", warn: "⚠️", error: "⛔", info: "ℹ️" };

    const toast = document.createElement("div");
    toast.className = `toast ${type || "info"}`;
    toast.innerHTML = `
      <div class="toastIcon" aria-hidden="true">${iconByType[type] || "ℹ️"}</div>
      <div class="toastBody">
        <p class="toastTitle"></p>
        <p class="toastMsg"></p>
      </div>
      <button class="toastClose" type="button" aria-label="Close">×</button>
    `;

    toast.querySelector(".toastTitle").textContent = title || "Notice";
    toast.querySelector(".toastMsg").textContent = message || "";
    toast.querySelector(".toastClose").addEventListener("click", () => toast.remove());

    host.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));

    if (ttlMs > 0) {
      setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 160);
      }, ttlMs);
    }
  }

  // -----------------------------
  // Auth UI
  // -----------------------------
  function setAuthUI(user) {
    const isAuthed = !!user;
    const email = user?.userDetails || "";

    document.getElementById("orgNameText").textContent = isAuthed ? orgFromEmail(email) : "—";
    document.getElementById("authState").textContent = isAuthed ? "Authenticated" : "Anonymous";
    document.getElementById("ddEmail").textContent = isAuthed ? email : "Not signed in";

    const ini = isAuthed ? initialsFromEmail(email) : "?";
    document.getElementById("avatarCircle").textContent = ini;
    document.getElementById("avatarCircleMini").textContent = ini;

    document.getElementById("userLine").textContent = isAuthed ? email : "—";
    document.getElementById("rolesLine").textContent = isAuthed ? (user.userRoles || []).join(", ") : "—";

    document.getElementById("loginLink").style.display = isAuthed ? "none" : "flex";
    document.getElementById("logoutLink").style.display = isAuthed ? "flex" : "none";
    document.getElementById("msProfileLink").style.display = isAuthed ? "flex" : "none";

    document.getElementById("loginLinkInline").style.display = isAuthed ? "none" : "inline";
    document.getElementById("logoutLinkInline").style.display = isAuthed ? "inline" : "none";
  }

  // -----------------------------
  // Dropdown behavior
  // -----------------------------
  const avatarBtn = document.getElementById("avatarBtn");
  const userDropdown = document.getElementById("userDropdown");

  function closeDropdown() {
    userDropdown.classList.remove("open");
  }
  function toggleDropdown() {
    userDropdown.classList.toggle("open");
  }

  avatarBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDropdown();
  });

  document.addEventListener("click", () => closeDropdown());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDropdown();
  });

  // -----------------------------
  // Modal (Re-enroll confirm)
  // -----------------------------
  function ensureModalStyles() {
    if (document.getElementById("totpModalStyles")) return;

    const style = document.createElement("style");
    style.id = "totpModalStyles";
    style.textContent = `
      .modalOverlay { position: fixed; inset: 0; background: rgba(17,24,39,0.55); display: none;
        align-items: center; justify-content: center; padding: 16px; z-index: 9999; }
      .modalOverlay.open { display: flex; }
      .modalDialog { width: min(520px, 100%); background: var(--bg-card, #fff);
        border: 1px solid var(--border, #e5e7eb); border-radius: 14px;
        box-shadow: 0 24px 60px rgba(0,0,0,0.25); overflow: hidden; }
      .modalHeader { padding: 16px 16px 12px; display: flex; gap: 12px; align-items: flex-start;
        border-bottom: 1px solid var(--border, #e5e7eb); }
      .modalIcon { width: 36px; height: 36px; border-radius: 12px; display: grid; place-items: center;
        background: var(--warn-bg, #fffbeb); color: var(--warn-text, #b45309); font-size: 18px; flex: 0 0 auto; }
      .modalTitle { margin: 0; font-size: 16px; font-weight: 700; color: var(--text-main, #111827); }
      .modalBody { padding: 12px 16px 16px; color: var(--text-main, #111827); }
      .modalBody p { margin: 0; color: var(--text-muted, #6b7280); line-height: 1.45; white-space: pre-line; }
      .modalActions { display: flex; gap: 10px; justify-content: flex-end; padding: 14px 16px 16px;
        border-top: 1px solid var(--border, #e5e7eb); }
      .btnGhost { padding: 9px 14px; border-radius: 10px; border: 1px solid var(--border, #e5e7eb);
        background: #fff; cursor: pointer; font-weight: 600; }
      .btnDanger { padding: 9px 14px; border-radius: 10px; border: 1px solid var(--err-text, #b91c1c);
        background: var(--err-bg, #fef2f2); color: var(--err-text, #b91c1c); cursor: pointer; font-weight: 700; }
      .btnDanger:hover { filter: brightness(0.98); } .btnGhost:hover { background: #f9fafb; }
    `;
    document.head.appendChild(style);
  }

  function createConfirmModal() {
    ensureModalStyles();
    const overlay = document.createElement("div");
    overlay.className = "modalOverlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    overlay.innerHTML = `
      <div class="modalDialog" role="document">
        <div class="modalHeader">
          <div class="modalIcon" aria-hidden="true">⚠️</div>
          <div><h3 class="modalTitle" id="modalTitle">Confirm action</h3></div>
        </div>
        <div class="modalBody"><p id="modalMessage">Are you sure?</p></div>
        <div class="modalActions">
          <button type="button" class="btnGhost" id="modalCancelBtn">Cancel</button>
          <button type="button" class="btnDanger" id="modalConfirmBtn">Continue</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const titleEl = overlay.querySelector("#modalTitle");
    const msgEl = overlay.querySelector("#modalMessage");
    const cancelBtn = overlay.querySelector("#modalCancelBtn");
    const confirmBtn = overlay.querySelector("#modalConfirmBtn");

    function open({ title, message, confirmText, cancelText }) {
      titleEl.textContent = title || "Confirm action";
      msgEl.textContent = message || "Are you sure?";
      confirmBtn.textContent = confirmText || "Continue";
      cancelBtn.textContent = cancelText || "Cancel";

      overlay.classList.add("open");
      confirmBtn.focus();

      return new Promise((resolve) => {
        const cleanup = () => {
          overlay.classList.remove("open");
          confirmBtn.onclick = null;
          cancelBtn.onclick = null;
          overlay.onclick = null;
          document.removeEventListener("keydown", onKeyDown, true);
        };

        const onKeyDown = (e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cleanup();
            resolve(false);
          }
        };

        confirmBtn.onclick = () => {
          cleanup();
          resolve(true);
        };

        cancelBtn.onclick = () => {
          cleanup();
          resolve(false);
        };

        overlay.onclick = (e) => {
          if (e.target === overlay) {
            cleanup();
            resolve(false);
          }
        };

        document.addEventListener("keydown", onKeyDown, true);
      });
    }

    return { open };
  }

  const confirmModal = createConfirmModal();

  async function confirmReEnrollIfNeeded() {
    if (lastKnownStatus !== "enrolled") return true;

    return await confirmModal.open({
      title: "Re-enroll and generate new QR?",
      message:
        "You are already enrolled.\n\nGenerating a new QR code will RESET your existing enrollment. Your previous authenticator setup will stop working.\n\nDo you want to continue?",
      confirmText: "Yes, re-enroll",
      cancelText: "Cancel"
    });
  }

  // -----------------------------
  // Status UI + Refresh link + Last checked
  // -----------------------------
  function ensureStatusTools() {
    const headings = Array.from(document.querySelectorAll("h2"));
    const statusH2 = headings.find(
      (h) => (h.textContent || "").trim().toLowerCase() === "2) enrollment status"
    );
    if (!statusH2) return null;

    const card = statusH2.closest(".card");
    if (!card) return null;

    const msgEl = card.querySelector(".muted");
    if (!msgEl) return null;

    let tools = card.querySelector("#statusToolsBar");
    if (!tools) {
      const styleId = "statusToolsStyles";
      if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
          .statusToolsBar { margin-top: 10px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font-size: 12px; }
          .statusToolsBar a { color: var(--primary, #2563eb); text-decoration: none; font-weight: 600; }
          .statusToolsBar a:hover { text-decoration: underline; }
          .statusToolsMuted { color: var(--text-muted, #6b7280); }
        `;
        document.head.appendChild(style);
      }

      tools = document.createElement("div");
      tools.id = "statusToolsBar";
      tools.className = "statusToolsBar";
      tools.innerHTML = `
        <a href="#" id="refreshStatusLink">Refresh status</a>
        <span class="statusToolsMuted" id="lastCheckedText">Last checked: —</span>
      `;
      msgEl.insertAdjacentElement("afterend", tools);

      tools.querySelector("#refreshStatusLink").addEventListener("click", async (e) => {
        e.preventDefault();
        if (!lastKnownUser?.userDetails) {
          showToast("warn", "Login required", "Sign in to refresh enrollment status.");
          return;
        }
        showToast("info", "Refreshing", "Fetching latest enrollment status…", 2200);
        await refreshStatus(lastKnownUser, { showToastOnSuccess: true });
      });
    }

    return {
      card,
      msgEl,
      lastCheckedEl: card.querySelector("#lastCheckedText")
    };
  }

  function updateLastChecked(ts = new Date()) {
    const tools = ensureStatusTools();
    if (!tools?.lastCheckedEl) return;
    tools.lastCheckedEl.textContent = `Last checked: ${ts.toLocaleString()}`;
  }

  function setStatusUI({ state, issuer, enrolledAt, detail }) {
    const tools = ensureStatusTools();
    const el = tools?.msgEl;
    if (!el) return;

    if (state === "loading") {
      el.textContent = "Checking status…";
      return;
    }
    if (state === "anonymous") {
      el.innerHTML =
        "<span class='warn'>Login required</span> <span class='muted'>Sign in to view enrollment status.</span>";
      return;
    }

    const parts = [];
    if (state === "not_enrolled") {
      parts.push("<span class='warn'>Not enrolled</span>");
      parts.push("<span class='muted'>You haven’t completed TOTP enrollment yet.</span>");
    } else if (state === "pending") {
      parts.push("<span class='warn'>Pending verification</span>");
      parts.push("<span class='muted'>QR is generated. Please verify using a valid OTP.</span>");
    } else if (state === "enrolled") {
      parts.push("<span class='ok'>Enrolled</span>");
      if (enrolledAt) parts.push(`<span class='muted'>Enrolled at: ${formatLocalTime(enrolledAt)}</span>`);
    } else if (state === "error") {
      parts.push("<span class='err'>Status check failed</span>");
      if (detail) parts.push(`<span class='muted'>${detail}</span>`);
    } else {
      parts.push(`<span class='warn'>${state}</span>`);
      if (detail) parts.push(`<span class='muted'>${detail}</span>`);
    }

    if (issuer && state !== "not_enrolled") {
      parts.push(`<span class='muted'>Issuer: ${issuer}</span>`);
    }

    el.innerHTML = parts.join(" ");
  }

  async function fetchEnrollmentStatus(employeeId) {
    const url = `${API}/api/status?employeeId=${encodeURIComponent(employeeId)}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${text}`.trim());
    }
    return await res.json().catch(() => ({}));
  }

  // -----------------------------
  // ✅ CHANGE #1: Verify button enabled regardless of status
  // -----------------------------
  function setButtonsState({ user, status }) {
    const startBtn = document.getElementById("startEnrollBtn");
    const verifyBtn = document.getElementById("verifyBtn");

    const isAuthed = !!user?.userDetails;

    startBtn.disabled = !isAuthed || isEnrollBusy;

    // ✅ Verify should be enabled whenever user is authed (unless busy)
    verifyBtn.disabled = !isAuthed || isVerifyBusy;

    if (!isAuthed) {
      startBtn.textContent = "Login to Enroll";
    } else if (status === "not_enrolled") {
      startBtn.textContent = "Start Enrollment (Generate QR)";
    } else if (status === "pending") {
      startBtn.textContent = "Re-generate QR";
    } else if (status === "enrolled") {
      startBtn.textContent = "Re-enroll (Generate New QR)";
    } else {
      startBtn.textContent = "Start / Re-generate QR";
    }

    // Optional: keep verify label stable
    verifyBtn.textContent = isVerifyBusy ? "Verifying…" : "Verify";
  }

  async function refreshStatus(user, opts = {}) {
    try {
      ensureStatusTools();

      if (!API) {
        lastKnownStatus = null;
        setStatusUI({ state: "error", detail: "API_BASE is not configured." });
        setButtonsState({ user, status: lastKnownStatus });
        updateLastChecked();
        return;
      }

      if (!user?.userDetails) {
        lastKnownStatus = null;
        setStatusUI({ state: "anonymous" });
        setButtonsState({ user, status: lastKnownStatus });
        updateLastChecked();
        return;
      }

      const employeeId = emailToAlnumKey(user.userDetails);
      if (!employeeId) {
        lastKnownStatus = null;
        setStatusUI({ state: "error", detail: "Unable to derive employeeId from email." });
        setButtonsState({ user, status: lastKnownStatus });
        updateLastChecked();
        return;
      }

      setStatusUI({ state: "loading" });

      const data = await fetchEnrollmentStatus(employeeId);
      const status = (data?.status || "").toLowerCase();
      const issuer = data?.issuer || null;
      const enrolledAt = data?.enrolledAt || null;

      if (status === "not_enrolled" || status === "pending" || status === "enrolled") {
        lastKnownStatus = status;
      } else {
        lastKnownStatus = null;
      }

      if (status === "not_enrolled") {
        setStatusUI({ state: "not_enrolled", issuer: null, enrolledAt: null });
      } else if (status === "pending") {
        setStatusUI({ state: "pending", issuer, enrolledAt: null });
      } else if (status === "enrolled") {
        setStatusUI({ state: "enrolled", issuer, enrolledAt });
      } else {
        setStatusUI({
          state: status || "unknown",
          issuer,
          enrolledAt,
          detail: "Unexpected status value returned by API."
        });
      }

      setButtonsState({ user, status: lastKnownStatus });
      updateLastChecked();

      if (opts.showToastOnSuccess) {
        showToast("success", "Status refreshed", `Current status: ${lastKnownStatus || "unknown"}`, 2400);
      }
    } catch (e) {
      console.error("refreshStatus error:", e);
      lastKnownStatus = null;
      setStatusUI({ state: "error", detail: e?.message || "Unknown error" });
      setButtonsState({ user, status: lastKnownStatus });
      updateLastChecked();
      showToast("error", "Status error", e?.message || "Failed to refresh status.");
    }
  }

  function clearInlineMessages() {
    const startEnrollMsg = document.getElementById("startEnrollMsg");
    const verifyMsg = document.getElementById("verifyMsg");
    if (startEnrollMsg) startEnrollMsg.textContent = "";
    if (verifyMsg) verifyMsg.textContent = "";
  }

  async function startEnrollment() {
    if (isEnrollBusy) return;

    clearInlineMessages();

    const user = await getUserInfo();
    lastKnownUser = user;

    const email = user?.userDetails;
    if (!email) {
      showToast("warn", "Login required", "Please sign in before generating a QR code.");
      await refreshStatus(user);
      return;
    }

    const employeeId = emailToAlnumKey(email);
    if (!employeeId) {
      showToast("error", "Cannot enroll", "Unable to derive identifier from your email.");
      return;
    }

    const allowed = await confirmReEnrollIfNeeded();
    if (!allowed) {
      showToast("info", "Cancelled", "Re-enroll cancelled. Existing enrollment unchanged.", 2600);
      return;
    }

    isEnrollBusy = true;
    setButtonsState({ user: lastKnownUser, status: lastKnownStatus });

    const qrBlock = document.getElementById("qrBlock");
    qrBlock.classList.add("is-hidden");

    showToast("info", "Generating QR", "Requesting a new enrollment QR code…", 2200);

    try {
      const url = API + "/api/enroll";
      const payload = {
        employeeId,
        issuer: "FleuryTOTP",
        digits: 6,
        period: 30
      };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        showToast("error", "Enroll failed", `HTTP ${res.status} ${text}`.trim(), 6000);
        await refreshStatus(user);
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!data?.otpauth) {
        showToast("error", "Enroll failed", "Enroll response missing otpauth.", 6000);
        await refreshStatus(user);
        return;
      }

      document.getElementById("issuerLine").textContent = data.issuer || "—";
      document.getElementById("otpauthPre").textContent = data.otpauth;
      document.getElementById("qrImg").src = qrUrl(data.otpauth);
      qrBlock.classList.remove("is-hidden");

      showToast(
        "success",
        lastKnownStatus === "enrolled" ? "New QR generated" : "QR generated",
        "Scan the QR in Microsoft Authenticator, then verify with a 6-digit OTP.",
        5200
      );

      await refreshStatus(user);
    } catch (e) {
      console.error(e);
      showToast("error", "Enroll error", "Failed to start enrollment (network/error).", 6000);
    } finally {
      isEnrollBusy = false;
      setButtonsState({ user: lastKnownUser, status: lastKnownStatus });
    }
  }

  // -----------------------------
  // ✅ CHANGE #2: Allow Verify regardless of status (no pending guard)
  // -----------------------------
  async function verifyCode() {
    if (isVerifyBusy) return;

    clearInlineMessages();

    const otpInput = document.getElementById("otpInput");
    const otp = otpInput.value.trim();

    if (!/^\d{6}$/.test(otp)) {
      showToast("warn", "Invalid OTP", "Enter a valid 6-digit OTP.", 4200);
      return;
    }

    const user = await getUserInfo();
    lastKnownUser = user;

    const email = user?.userDetails;
    if (!email) {
      showToast("warn", "Login required", "Please sign in before verifying OTP.");
      await refreshStatus(user);
      return;
    }

    const employeeId = emailToAlnumKey(email);
    if (!employeeId) {
      showToast("error", "Verify failed", "Unable to derive identifier from your email.");
      return;
    }

    // Helpful context toast (optional)
    if (lastKnownStatus === "enrolled") {
      showToast("info", "Check enrollment", "Verifying OTP against your current enrollment…", 2200);
    } else if (lastKnownStatus === "not_enrolled") {
      showToast("info", "Not enrolled yet", "If this fails, generate a QR first.", 2600);
    } else if (lastKnownStatus === "pending") {
      showToast("info", "Verifying", "Completing enrollment verification…", 2200);
    } else {
      showToast("info", "Verifying", "Validating OTP…", 2000);
    }

    isVerifyBusy = true;
    setButtonsState({ user: lastKnownUser, status: lastKnownStatus });

    try {
      const url = API + "/api/verify";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, otp })
      });

      // If backend returns non-200 with JSON, still parse for error
      const data = await res.json().catch(() => ({}));
      const isSuccess = res.ok && (data.ok === true || data.valid === true);

      if (isSuccess) {
        otpInput.value = "";
        showToast("success", "OTP valid", "Your current enrollment is working.", 5200);
      } else {
        const reason = data?.error || data?.reason || "Verification failed.";
        showToast("error", "OTP invalid", reason, 6000);
      }

      // refresh status after check
      await refreshStatus(user);
    } catch (e) {
      console.error(e);
      showToast("error", "Verify error", "Verification failed (network/error).", 6000);
      await refreshStatus(user);
    } finally {
      isVerifyBusy = false;
      setButtonsState({ user: lastKnownUser, status: lastKnownStatus });
    }
  }

  // -----------------------------
  // Wire up + Init
  // -----------------------------
  document.getElementById("startEnrollBtn").addEventListener("click", startEnrollment);
  document.getElementById("verifyBtn").addEventListener("click", verifyCode);

  (async () => {
    ensureStatusTools();
    clearInlineMessages();
    const user = await getUserInfo();
    lastKnownUser = user;
    setAuthUI(user);
    await refreshStatus(user);
  })();

  console.log("API BASE =", API);
})();