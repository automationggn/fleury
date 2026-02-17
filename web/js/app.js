(() => {
  const API = window.APP_CONFIG?.API_BASE;

  // Track last known backend status for UI decisions
  let lastKnownStatus = null; // "not_enrolled" | "pending" | "enrolled" | null
  let lastKnownUser = null;

  // Busy flags
  let isEnrollBusy = false;
  let isVerifyBusy = false;

  // ✅ Local override: when user re-enrolls (new seed), force pending until verified
  let pendingOverride = {
    employeeId: null,
    untilMs: 0
  };

  // -----------------------------
  // Helpers
  // -----------------------------
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

  function now() {
    return Date.now();
  }

  function isPendingOverrideActive(employeeId) {
    return (
      employeeId &&
      pendingOverride.employeeId === employeeId &&
      pendingOverride.untilMs > now()
    );
  }

  function setPendingOverride(employeeId, minutes = 10) {
    pendingOverride.employeeId = employeeId;
    pendingOverride.untilMs = now() + minutes * 60 * 1000;
  }

  function clearPendingOverride() {
    pendingOverride.employeeId = null;
    pendingOverride.untilMs = 0;
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
  // Modal (Step 8)
  // -----------------------------
  function ensureModalStyles() {
    if (document.getElementById("totpModalStyles")) return;

    const style = document.createElement("style");
    style.id = "totpModalStyles";
    style.textContent = `
      .modalOverlay {
        position: fixed;
        inset: 0;
        background: rgba(17,24,39,0.55);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 16px;
        z-index: 9999;
      }
      .modalOverlay.open { display: flex; }

      .modalDialog {
        width: min(520px, 100%);
        background: var(--bg-card, #fff);
        border: 1px solid var(--border, #e5e7eb);
        border-radius: 14px;
        box-shadow: 0 24px 60px rgba(0,0,0,0.25);
        overflow: hidden;
      }

      .modalHeader {
        padding: 16px 16px 12px;
        display: flex;
        gap: 12px;
        align-items: flex-start;
        border-bottom: 1px solid var(--border, #e5e7eb);
      }

      .modalIcon {
        width: 36px;
        height: 36px;
        border-radius: 12px;
        display: grid;
        place-items: center;
        background: var(--warn-bg, #fffbeb);
        color: var(--warn-text, #b45309);
        font-size: 18px;
        flex: 0 0 auto;
      }

      .modalTitle {
        margin: 0;
        font-size: 16px;
        font-weight: 700;
        color: var(--text-main, #111827);
      }

      .modalBody {
        padding: 12px 16px 16px;
        color: var(--text-main, #111827);
      }

      .modalBody p {
        margin: 0;
        color: var(--text-muted, #6b7280);
        line-height: 1.45;
        white-space: pre-line;
      }

      .modalActions {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        padding: 14px 16px 16px;
        border-top: 1px solid var(--border, #e5e7eb);
      }

      .btnGhost {
        padding: 9px 14px;
        border-radius: 10px;
        border: 1px solid var(--border, #e5e7eb);
        background: #fff;
        cursor: pointer;
        font-weight: 600;
      }

      .btnDanger {
        padding: 9px 14px;
        border-radius: 10px;
        border: 1px solid var(--err-text, #b91c1c);
        background: var(--err-bg, #fef2f2);
        color: var(--err-text, #b91c1c);
        cursor: pointer;
        font-weight: 700;
      }
      .btnDanger:hover { filter: brightness(0.98); }
      .btnGhost:hover { background: #f9fafb; }
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
          <div>
            <h3 class="modalTitle" id="modalTitle">Confirm action</h3>
          </div>
        </div>
        <div class="modalBody">
          <p id="modalMessage">Are you sure?</p>
        </div>
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
  // Status UI + Button state (Step 9)
  // -----------------------------
  function findStatusMessageElement() {
    const headings = Array.from(document.querySelectorAll("h2"));
    const statusH2 = headings.find(
      (h) => (h.textContent || "").trim().toLowerCase() === "2) enrollment status"
    );
    if (!statusH2) return null;
    const card = statusH2.closest(".card");
    return card ? card.querySelector(".muted") : null;
  }

  function setStatusUI({ state, issuer, enrolledAt, detail, overrideNote }) {
    const el = findStatusMessageElement();
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

    // ✅ show note when we override server-enrolled -> pending after re-enroll
    if (overrideNote) {
      parts.push(`<span class='muted'>(${overrideNote})</span>`);
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

  function setButtonsState({ user, status }) {
    const startBtn = document.getElementById("startEnrollBtn");
    const verifyBtn = document.getElementById("verifyBtn");

    const isAuthed = !!user?.userDetails;

    startBtn.disabled = !isAuthed || isEnrollBusy;
    verifyBtn.disabled = !isAuthed || isVerifyBusy || status !== "pending";

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
  }

  async function refreshStatus(user) {
    try {
      if (!API) {
        lastKnownStatus = null;
        setStatusUI({ state: "error", detail: "API_BASE is not configured." });
        setButtonsState({ user, status: lastKnownStatus });
        return;
      }

      if (!user?.userDetails) {
        lastKnownStatus = null;
        setStatusUI({ state: "anonymous" });
        setButtonsState({ user, status: lastKnownStatus });
        return;
      }

      const employeeId = emailToAlnumKey(user.userDetails);
      if (!employeeId) {
        lastKnownStatus = null;
        setStatusUI({ state: "error", detail: "Unable to derive employeeId from email." });
        setButtonsState({ user, status: lastKnownStatus });
        return;
      }

      setStatusUI({ state: "loading" });

      const data = await fetchEnrollmentStatus(employeeId);
      let status = (data?.status || "").toLowerCase();
      const issuer = data?.issuer || null;
      const enrolledAt = data?.enrolledAt || null;

      // ✅ If we just re-enrolled, force pending even if server still says enrolled
      const overrideActive = isPendingOverrideActive(employeeId);
      if (overrideActive && status === "enrolled") {
        status = "pending";
        lastKnownStatus = "pending";
        setStatusUI({
          state: "pending",
          issuer,
          enrolledAt: null,
          overrideNote: "awaiting verification of newly generated QR"
        });
        setButtonsState({ user, status: lastKnownStatus });
        return;
      }

      // If server starts returning pending, clear override
      if (overrideActive && status === "pending") {
        clearPendingOverride();
      }

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
    } catch (e) {
      console.error("refreshStatus error:", e);
      lastKnownStatus = null;
      setStatusUI({ state: "error", detail: e?.message || "Unknown error" });
      setButtonsState({ user, status: lastKnownStatus });
    }
  }

  // -----------------------------
  // Enrollment + Verification
  // -----------------------------
  async function startEnrollment() {
    const msg = document.getElementById("startEnrollMsg");
    const qrBlock = document.getElementById("qrBlock");
    if (isEnrollBusy) return;

    const user = await getUserInfo();
    lastKnownUser = user;

    const email = user?.userDetails;
    if (!email) {
      msg.innerHTML = "<span class='err'>Not signed in. Please Login.</span>";
      await refreshStatus(user);
      return;
    }

    const employeeId = emailToAlnumKey(email);

    // Modal confirm if enrolled
    const allowed = await confirmReEnrollIfNeeded();
    if (!allowed) {
      msg.innerHTML = "<span class='warn'>Re-enroll cancelled. Existing enrollment is unchanged.</span>";
      return;
    }

    isEnrollBusy = true;
    setButtonsState({ user: lastKnownUser, status: lastKnownStatus });

    qrBlock.classList.add("is-hidden");
    msg.textContent = "Starting…";

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
        const text = await res.text();
        msg.innerHTML = `<span class='err'>Enroll failed: ${res.status} ${text}</span>`;
        await refreshStatus(user);
        return;
      }

      const data = await res.json();
      if (!data?.otpauth) {
        msg.innerHTML = "<span class='err'>Enroll response missing otpauth.</span>";
        console.log("Enroll response:", data);
        await refreshStatus(user);
        return;
      }

      document.getElementById("issuerLine").textContent = data.issuer || "—";
      document.getElementById("otpauthPre").textContent = data.otpauth;
      document.getElementById("qrImg").src = qrUrl(data.otpauth);

      qrBlock.classList.remove("is-hidden");

      // ✅ Immediately force pending UX after enroll (reseed requires verification)
      setPendingOverride(employeeId, 10);
      lastKnownStatus = "pending";
      setStatusUI({
        state: "pending",
        issuer: "FleuryTOTP",
        enrolledAt: null,
        overrideNote: "awaiting verification of newly generated QR"
      });
      setButtonsState({ user, status: lastKnownStatus });

      msg.innerHTML = `<span class='ok'>QR generated for ${email}. Please verify to complete enrollment.</span>`;

      // Refresh (will keep pending if server incorrectly reports enrolled)
      await refreshStatus(user);
    } catch (e) {
      console.error(e);
      msg.innerHTML = "<span class='err'>Failed to start enrollment.</span>";
    } finally {
      isEnrollBusy = false;
      setButtonsState({ user: lastKnownUser, status: lastKnownStatus });
    }
  }

  async function verifyCode() {
    const otpInput = document.getElementById("otpInput");
    const otp = otpInput.value.trim();
    const msg = document.getElementById("verifyMsg");
    if (isVerifyBusy) return;

    // Guard
    if (lastKnownStatus !== "pending") {
      msg.innerHTML = "<span class='warn'>No pending enrollment to verify. Generate a QR first.</span>";
      return;
    }

    if (!/^\d{6}$/.test(otp)) {
      msg.innerHTML = "<span class='warn'>Enter a 6-digit OTP.</span>";
      return;
    }

    isVerifyBusy = true;
    setButtonsState({ user: lastKnownUser, status: lastKnownStatus });

    const user = await getUserInfo();
    lastKnownUser = user;

    const email = user?.userDetails;
    if (!email) {
      msg.innerHTML = "<span class='err'>Not signed in. Please Login.</span>";
      await refreshStatus(user);
      isVerifyBusy = false;
      setButtonsState({ user: lastKnownUser, status: lastKnownStatus });
      return;
    }

    const employeeId = emailToAlnumKey(email);

    msg.textContent = "Verifying…";

    try {
      const url = API + "/api/verify";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, otp })
      });

      const data = await res.json().catch(() => ({}));
      const isSuccess = res.ok && (data.ok === true || data.valid === true);

      if (isSuccess) {
        msg.innerHTML = `<span class='ok'>Enrollment verified for ${email}.</span>`;
        otpInput.value = "";

        // ✅ verification completes re-enroll: clear override
        clearPendingOverride();
      } else {
        const reason = data?.error || data?.reason || "Verification failed.";
        msg.innerHTML = `<span class='err'>${reason}</span>`;
      }

      await refreshStatus(user);
    } catch (e) {
      console.error(e);
      msg.innerHTML = "<span class='err'>Verification failed (network/error).</span>";
      await refreshStatus(user);
    } finally {
      isVerifyBusy = false;
      setButtonsState({ user: lastKnownUser, status: lastKnownStatus });
    }
  }

  // -----------------------------
  // Wire up events + Init
  // -----------------------------
  document.getElementById("startEnrollBtn").addEventListener("click", startEnrollment);
  document.getElementById("verifyBtn").addEventListener("click", verifyCode);

  (async () => {
    const user = await getUserInfo();
    lastKnownUser = user;
    setAuthUI(user);
    await refreshStatus(user);
  })();

  console.log("API BASE =", API);
})();