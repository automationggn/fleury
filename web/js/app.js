(() => {
  const API = window.APP_CONFIG?.API_BASE;

  let lastKnownStatus = null; // "not_enrolled" | "pending" | "enrolled" | null
  let lastKnownUser = null;

  let isEnrollBusy = false;
  let isVerifyBusy = false;

  // Flow step elements
  const flow = {
    signin: null,
    status: null,
    enroll: null,
    verify: null
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

  // -----------------------------
  // Fix broken stray cards in HTML
  // -----------------------------
  function cleanupBrokenTopCards() {
    // Remove any .card.step-* that are direct children of body and not inside .app
    const app = document.querySelector(".app");
    document.querySelectorAll("body > .card.step-complete, body > .card.step-current, body > .card.step-pending")
      .forEach(el => {
        if (!app || !app.contains(el)) el.remove();
      });
  }

  // -----------------------------
  // Flow init + update
  // -----------------------------
  function initFlow() {
    const app = document.querySelector(".app");
    if (!app) return;

    // Ensure flow-enabled is applied (even if HTML forgot)
    app.classList.add("flow-enabled");

    // Locate the four cards by their h2 text (robust against markup changes)
    const cards = Array.from(app.querySelectorAll(".card"));
    const findByH2 = (label) =>
      cards.find(c => (c.querySelector("h2")?.textContent || "").trim().toLowerCase() === label);

    flow.signin = findByH2("sign in");
    flow.status = findByH2("enrollment status");
    flow.enroll = findByH2("start enrollment");
    flow.verify = findByH2("verify");

    // Tag step cards only (title card stays untouched)
    [flow.signin, flow.status, flow.enroll, flow.verify].forEach(el => {
      if (!el) return;
      el.classList.add("flow-step");
      el.classList.remove("step-complete", "step-current", "step-pending");
    });

    if (flow.verify) flow.verify.classList.add("flow-last");

    // Initial state
    updateFlowSteps(false, null);
  }

  function setStep(el, state) {
    if (!el) return;
    el.classList.remove("step-complete", "step-current", "step-pending");
    el.classList.add(state);
  }

  function updateFlowSteps(isAuthed, status) {
    // When not signed in: sign-in current, others pending
    if (!isAuthed) {
      setStep(flow.signin, "step-current");
      setStep(flow.status, "step-pending");
      setStep(flow.enroll, "step-pending");
      setStep(flow.verify, "step-pending");
      return;
    }

    // Signed in: sign-in complete
    setStep(flow.signin, "step-complete");

    if (status === "not_enrolled" || !status) {
      setStep(flow.status, "step-current");
      setStep(flow.enroll, "step-pending");
      setStep(flow.verify, "step-pending");
    } else if (status === "pending") {
      setStep(flow.status, "step-complete");
      setStep(flow.enroll, "step-current");
      setStep(flow.verify, "step-pending");
    } else if (status === "enrolled") {
      setStep(flow.status, "step-complete");
      setStep(flow.enroll, "step-complete");
      setStep(flow.verify, "step-current");
    } else {
      // Unknown: treat as status current
      setStep(flow.status, "step-current");
      setStep(flow.enroll, "step-pending");
      setStep(flow.verify, "step-pending");
    }
  }

  // -----------------------------
  // Toasts
  // -----------------------------
  function showToast(type, title, message, ttlMs = 4500) {
    const host = document.getElementById("toastHost");
    if (!host) return;

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
  // Modal confirm
  // -----------------------------
  function openConfirmModal({ title, message, confirmText, cancelText }) {
    const overlay = document.getElementById("confirmModal");
    const titleEl = document.getElementById("modalTitle");
    const msgEl = document.getElementById("modalMessage");
    const cancelBtn = document.getElementById("modalCancelBtn");
    const confirmBtn = document.getElementById("modalConfirmBtn");

    if (!overlay || !titleEl || !msgEl || !cancelBtn || !confirmBtn) {
      return Promise.resolve(window.confirm(message || "Are you sure?"));
    }

    titleEl.textContent = title || "Confirm action";
    msgEl.textContent = message || "Are you sure?";
    confirmBtn.textContent = confirmText || "Continue";
    cancelBtn.textContent = cancelText || "Cancel";

    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    confirmBtn.focus();

    return new Promise((resolve) => {
      const cleanup = () => {
        overlay.classList.remove("open");
        overlay.setAttribute("aria-hidden", "true");
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

      confirmBtn.onclick = () => { cleanup(); resolve(true); };
      cancelBtn.onclick = () => { cleanup(); resolve(false); };
      overlay.onclick = (e) => { if (e.target === overlay) { cleanup(); resolve(false); } };

      document.addEventListener("keydown", onKeyDown, true);
    });
  }

  async function confirmReEnrollIfNeeded() {
    if (lastKnownStatus !== "enrolled") return true;

    return await openConfirmModal({
      title: "Re-enroll and generate new QR?",
      message:
        "You are already enrolled.\n\nGenerating a new QR code will RESET your existing enrollment. Your previous authenticator setup will stop working.\n\nDo you want to continue?",
      confirmText: "Yes, re-enroll",
      cancelText: "Cancel"
    });
  }

  // -----------------------------
  // Auth UI
  // -----------------------------
  function setAuthUI(user) {
    const isAuthed = !!user;
    const email = user?.userDetails || "";

    document.getElementById("orgNameText").textContent = isAuthed ? orgFromEmail(email) : "—";
    document.getElementById("authState").textContent = isAuthed ? "Authenticated" : "Anonymous";
    
const ddEmailEl = document.getElementById("ddEmail");
if (ddEmailEl) {
  const value = isAuthed ? email : "Not signed in";
  ddEmailEl.textContent = value;
  ddEmailEl.title = value;   // ✅ native tooltip with full email
}



    const ini = isAuthed ? initialsFromEmail(email) : "?";
    document.getElementById("avatarCircle").textContent = ini;
    document.getElementById("avatarCircleMini").textContent = ini;

    document.getElementById("userLine").textContent = isAuthed ? email : "—";

    // Dropdown visibility
    document.getElementById("loginLink").style.display = isAuthed ? "none" : "flex";
    document.getElementById("logoutLink").style.display = isAuthed ? "flex" : "none";
    document.getElementById("msProfileLink").style.display = isAuthed ? "flex" : "none";

    // Inline visibility
    document.getElementById("loginLinkInline").style.display = isAuthed ? "none" : "inline-block";
    document.getElementById("logoutLinkInline").style.display = isAuthed ? "inline-block" : "none";

    // Update flow based on auth (status may not yet be known)
    updateFlowSteps(isAuthed, lastKnownStatus);
  }

  // Dropdown behavior
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
  // Status UI
  // -----------------------------
  function updateLastChecked(ts = new Date()) {
    const el = document.getElementById("lastCheckedText");
    if (!el) return;
    el.textContent = `Last checked: ${ts.toLocaleString()}`;
  }

  function setStatusUI({ state, issuer, enrolledAt, detail }) {
    const el = document.getElementById("enrollmentStatusText");
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

  // Buttons state
  function setButtonsState({ user, status }) {
    const startBtn = document.getElementById("startEnrollBtn");
    const verifyBtn = document.getElementById("verifyBtn");

    const isAuthed = !!user?.userDetails;

    startBtn.disabled = !isAuthed || isEnrollBusy;
    verifyBtn.disabled = !isAuthed || isVerifyBusy;

    if (!isAuthed) startBtn.textContent = "Login to Enroll";
    else if (status === "not_enrolled") startBtn.textContent = "Start Enrollment (Generate QR)";
    else if (status === "pending") startBtn.textContent = "Re-generate QR";
    else if (status === "enrolled") startBtn.textContent = "Re-enroll (Generate New QR)";
    else startBtn.textContent = "Start / Re-generate QR";

    if (!isAuthed) verifyBtn.textContent = "Login to Verify";
    else if (isVerifyBusy) verifyBtn.textContent = "Verifying…";
    else if (status === "pending") verifyBtn.textContent = "Complete Verification";
    else verifyBtn.textContent = "Check OTP";
  }

  async function refreshStatus(user, opts = {}) {
    try {
      if (!API) {
        lastKnownStatus = null;
        setStatusUI({ state: "error", detail: "API_BASE is not configured." });
        setButtonsState({ user, status: lastKnownStatus });
        updateLastChecked();
        updateFlowSteps(!!user?.userDetails, lastKnownStatus);
        return;
      }

      if (!user?.userDetails) {
        lastKnownStatus = null;
        setStatusUI({ state: "anonymous" });
        setButtonsState({ user, status: lastKnownStatus });
        updateLastChecked();
        updateFlowSteps(false, lastKnownStatus);
        return;
      }

      const employeeId = emailToAlnumKey(user.userDetails);
      if (!employeeId) {
        lastKnownStatus = null;
        setStatusUI({ state: "error", detail: "Unable to derive employeeId from email." });
        setButtonsState({ user, status: lastKnownStatus });
        updateLastChecked();
        updateFlowSteps(true, lastKnownStatus);
        return;
      }

      setStatusUI({ state: "loading" });

      const data = await fetchEnrollmentStatus(employeeId);
      const status = (data?.status || "").toLowerCase();
      const issuer = data?.issuer || null;
      const enrolledAt = data?.enrolledAt || null;

      lastKnownStatus =
        status === "not_enrolled" || status === "pending" || status === "enrolled" ? status : null;

      if (status === "not_enrolled") setStatusUI({ state: "not_enrolled", issuer: null, enrolledAt: null });
      else if (status === "pending") setStatusUI({ state: "pending", issuer, enrolledAt: null });
      else if (status === "enrolled") setStatusUI({ state: "enrolled", issuer, enrolledAt });
      else setStatusUI({ state: status || "unknown", issuer, enrolledAt, detail: "Unexpected status value." });

      setButtonsState({ user, status: lastKnownStatus });
      updateLastChecked();
      updateFlowSteps(true, lastKnownStatus);

      if (opts.showToastOnSuccess) {
        showToast("success", "Status refreshed", `Current status: ${lastKnownStatus || "unknown"}`, 2400);
      }
    } catch (e) {
      console.error("refreshStatus error:", e);
      lastKnownStatus = null;
      setStatusUI({ state: "error", detail: e?.message || "Unknown error" });
      setButtonsState({ user, status: lastKnownStatus });
      updateLastChecked();
      updateFlowSteps(!!user?.userDetails, lastKnownStatus);
      showToast("error", "Status error", e?.message || "Failed to refresh status.");
    }
  }

  // Enroll & Verify
  async function startEnrollment() {
    if (isEnrollBusy) return;

    const user = await getUserInfo();
    lastKnownUser = user;

    const email = user?.userDetails;
    if (!email) {
      showToast("warn", "Login required", "Please sign in before generating a QR code.");
      await refreshStatus(user);
      return;
    }

    const employeeId = emailToAlnumKey(email);

    const allowed = await confirmReEnrollIfNeeded();
    if (!allowed) {
      showToast("info", "Cancelled", "Re-enroll cancelled. Existing enrollment unchanged.", 2600);
      return;
    }

    isEnrollBusy = true;
    setButtonsState({ user: lastKnownUser, status: lastKnownStatus });

    const qrBlock = document.getElementById("qrBlock");
    const qrImg = document.getElementById("qrImg");
    qrBlock.classList.add("is-hidden");
    qrImg.removeAttribute("src");

    showToast("info", "Generating QR", "Requesting a new enrollment QR code…", 2200);

    try {
      const url = API + "/api/enroll";
      const payload = { employeeId, issuer: "FleuryTOTP", digits: 6, period: 30 };

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

      qrImg.src = qrUrl(data.otpauth);
      qrBlock.classList.remove("is-hidden");

      // ✅ Front-end: treat re-enroll as "pending" immediately
      lastKnownStatus = "pending";
      setStatusUI({
        state: "pending",
        issuer: data.issuer || "FleuryTOTP",
        enrolledAt: null
      });
      updateFlowSteps(true, lastKnownStatus);
      setButtonsState({ user: lastKnownUser, status: lastKnownStatus });

      showToast("success", "QR generated", "Scan in Authenticator, then verify with OTP.", 5200);

      // ❌ Remove this line so backend "enrolled" does not override our pending state
      // await refreshStatus(user);

    } catch (e) {
      console.error(e);
      showToast("error", "Enroll error", "Failed to start enrollment (network/error).", 6000);
    } finally {
      isEnrollBusy = false;
      setButtonsState({ user: lastKnownUser, status: lastKnownStatus });
    }
  }

  async function verifyCode() {
    if (isVerifyBusy) return;

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

    if (lastKnownStatus === "not_enrolled") {
      showToast(
        "warn",
        "Not enrolled yet",
        "Status indicates you are not enrolled. You can still try OTP, but if it fails generate a QR first.",
        5200
      );
    }

    const employeeId = emailToAlnumKey(email);

    showToast("info", "Verifying", "Validating OTP…", 2000);

    isVerifyBusy = true;
    setButtonsState({ user: lastKnownUser, status: lastKnownStatus });

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
        otpInput.value = "";
        showToast("success", "OTP valid", "Your current enrollment is working.", 5200);
      } else {
        const reason = data?.error || data?.reason || "Verification failed.";
        showToast("error", "OTP invalid", reason, 6000);
      }

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

  // Init + Events
  function wireUp() {
    cleanupBrokenTopCards();
    initFlow();

    const startBtn = document.getElementById("startEnrollBtn");
    const verifyBtn = document.getElementById("verifyBtn");
    const otpInput = document.getElementById("otpInput");

    if (startBtn) {
      startBtn.addEventListener("click", startEnrollment);
    }

    if (verifyBtn) {
      verifyBtn.addEventListener("click", verifyCode);

      // ✅ Tooltip on hover when OTP is incomplete
      const updateVerifyTooltip = () => {
        if (!otpInput) return;

        const value = (otpInput.value || "").trim();
        const hasSixDigits = /^\d{6}$/.test(value);

        if (!hasSixDigits) {
          verifyBtn.title = "Enter a valid 6-digit OTP.";
          // Optional: also expose to screen readers
          verifyBtn.setAttribute("aria-label", "Verify OTP – enter a valid 6-digit OTP first.");
        } else {
          verifyBtn.title = "";
          verifyBtn.removeAttribute("aria-label");
        }
      };

      // Update tooltip on hover
      verifyBtn.addEventListener("mouseenter", updateVerifyTooltip);

      // Keep tooltip in sync as user types
      if (otpInput) {
        otpInput.addEventListener("input", updateVerifyTooltip);
      }
    }


    const refreshBtn = document.getElementById("refreshStatusBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        if (!lastKnownUser?.userDetails) {
          showToast("warn", "Login required", "Sign in to refresh enrollment status.");
          return;
        }
        showToast("info", "Refreshing", "Fetching latest enrollment status…", 2200);
        await refreshStatus(lastKnownUser, { showToastOnSuccess: true });
      });
    }

    (async () => {
      const user = await getUserInfo();
      lastKnownUser = user;

      setAuthUI(user);
      await refreshStatus(user);

      setButtonsState({ user: lastKnownUser, status: lastKnownStatus });
    })();
  }

  // Run after DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireUp);
  } else {
    wireUp();
  }

  console.log("API BASE =", API);
})();