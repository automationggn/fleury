(() => {
  const API = window.APP_CONFIG?.API_BASE;

  // --- Helpers ---
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

  function setAuthUI(user) {
    const isAuthed = !!user;
    const email = user?.userDetails || "";

    // Org name
    document.getElementById("orgNameText").textContent = isAuthed ? orgFromEmail(email) : "—";

    // Auth pill + dropdown email
    document.getElementById("authState").textContent = isAuthed ? "Authenticated" : "Anonymous";
    document.getElementById("ddEmail").textContent = isAuthed ? email : "Not signed in";

    // Avatar initials
    const ini = isAuthed ? initialsFromEmail(email) : "?";
    document.getElementById("avatarCircle").textContent = ini;
    document.getElementById("avatarCircleMini").textContent = ini;

    // Inline card fields
    document.getElementById("userLine").textContent = isAuthed ? email : "—";
    document.getElementById("rolesLine").textContent = isAuthed ? (user.userRoles || []).join(", ") : "—";

    // Links visibility (dropdown)
    document.getElementById("loginLink").style.display = isAuthed ? "none" : "flex";
    document.getElementById("logoutLink").style.display = isAuthed ? "flex" : "none";
    document.getElementById("msProfileLink").style.display = isAuthed ? "flex" : "none";

    // Links visibility (inline)
    document.getElementById("loginLinkInline").style.display = isAuthed ? "none" : "inline";
    document.getElementById("logoutLinkInline").style.display = isAuthed ? "inline" : "none";
  }

  // --- Dropdown behavior ---
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

  // ------------------------------------------------------------
  // ✅ STATUS UI (Step 6)
  // ------------------------------------------------------------

  function findStatusMessageElement() {
    // If you later add an ID in HTML, we support it automatically:
    const byId = document.getElementById("enrollmentStatusMsg");
    if (byId) return byId;

    // Current HTML has no ID. Find card by its h2 text and update its first ".muted".
    const headings = Array.from(document.querySelectorAll("h2"));
    const statusH2 = headings.find((h) =>
      (h.textContent || "").trim().toLowerCase() === "2) enrollment status"
    );
    if (!statusH2) return null;

    const card = statusH2.closest(".card");
    if (!card) return null;

    // the status card contains a single div.muted right now
    return card.querySelector(".muted");
  }

  function formatLocalTime(dt) {
    try {
      return new Date(dt).toLocaleString();
    } catch {
      return dt;
    }
  }

  function setStatusUI({ state, issuer, enrolledAt, detail, tone }) {
    const el = findStatusMessageElement();
    if (!el) return;

    // tone => ok | warn | err | muted
    const badgeClass = tone === "muted" ? "muted" : tone;

    const lines = [];

    if (state === "loading") {
      el.textContent = "Checking status…";
      return;
    }

    if (state === "anonymous") {
      el.innerHTML = "<span class='warn'>Login required</span> <span class='muted'>Sign in to view enrollment status.</span>";
      return;
    }

    if (state === "not_enrolled") {
      lines.push("<span class='warn'>Not enrolled</span>");
      lines.push("<span class='muted'>You haven’t completed TOTP enrollment yet.</span>");
    } else if (state === "pending") {
      lines.push("<span class='warn'>Pending verification</span>");
      lines.push("<span class='muted'>QR is generated. Please verify using a valid OTP.</span>");
    } else if (state === "enrolled") {
      lines.push("<span class='ok'>Enrolled</span>");
      if (enrolledAt) {
        lines.push(`<span class='muted'>Enrolled at: ${formatLocalTime(enrolledAt)}</span>`);
      }
    } else if (state === "error") {
      lines.push("<span class='err'>Status check failed</span>");
      if (detail) lines.push(`<span class='muted'>${detail}</span>`);
    } else {
      lines.push(`<span class='${badgeClass}'>${state}</span>`);
      if (detail) lines.push(`<span class='muted'>${detail}</span>`);
    }

    // issuer optional
    if (issuer && state !== "not_enrolled") {
      lines.push(`<span class='muted'>Issuer: ${issuer}</span>`);
    }

    el.innerHTML = lines.join(" ");
  }

  async function fetchEnrollmentStatus(employeeId) {
    const url = `${API}/api/status?employeeId=${encodeURIComponent(employeeId)}`;
    const res = await fetch(url, { method: "GET" });

    // status API should return 200 always for normal flow; handle unexpected responses
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${text}`.trim());
    }
    return await res.json().catch(() => ({}));
  }

  async function refreshStatus(user) {
    try {
      if (!API) {
        setStatusUI({ state: "error", detail: "API_BASE is not configured.", tone: "err" });
        return;
      }

      if (!user?.userDetails) {
        setStatusUI({ state: "anonymous", tone: "warn" });
        return;
      }

      const employeeId = emailToAlnumKey(user.userDetails);
      if (!employeeId) {
        setStatusUI({ state: "error", detail: "Unable to derive employeeId from email.", tone: "err" });
        return;
      }

      setStatusUI({ state: "loading" });

      const data = await fetchEnrollmentStatus(employeeId);

      const status = (data?.status || "").toLowerCase();
      const issuer = data?.issuer || null;
      const enrolledAt = data?.enrolledAt || null;

      if (status === "not_enrolled") {
        setStatusUI({ state: "not_enrolled", issuer: null, enrolledAt: null, tone: "warn" });
      } else if (status === "pending") {
        setStatusUI({ state: "pending", issuer, enrolledAt: null, tone: "warn" });
      } else if (status === "enrolled") {
        setStatusUI({ state: "enrolled", issuer, enrolledAt, tone: "ok" });
      } else {
        // Unknown status from backend
        setStatusUI({
          state: status || "unknown",
          issuer,
          enrolledAt,
          detail: "Unexpected status value returned by API.",
          tone: "warn"
        });
      }
    } catch (e) {
      console.error("refreshStatus error:", e);
      setStatusUI({ state: "error", detail: e?.message || "Unknown error", tone: "err" });
    }
  }

  // ------------------------------------------------------------
  // Enrollment + Verification (existing) + status refresh hooks
  // ------------------------------------------------------------

  async function startEnrollment() {
    const msg = document.getElementById("startEnrollMsg");
    const qrBlock = document.getElementById("qrBlock");

    qrBlock.classList.add("is-hidden");
    msg.textContent = "Starting…";

    try {
      const user = await getUserInfo();
      const email = user?.userDetails;

      if (!email) {
        msg.innerHTML = "<span class='err'>Not signed in. Please Login.</span>";
        setStatusUI({ state: "anonymous", tone: "warn" });
        return;
      }

      const employeeId = emailToAlnumKey(email);
      if (!employeeId) {
        msg.innerHTML = "<span class='err'>Unable to derive identifier from email.</span>";
        return;
      }

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
        // refresh status anyway (might remain not_enrolled)
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
      msg.innerHTML = `<span class='ok'>QR generated for ${email}.</span>`;

      // ✅ After successful enroll, status should become "pending"
      await refreshStatus(user);
    } catch (e) {
      console.error(e);
      msg.innerHTML = "<span class='err'>Failed to start enrollment.</span>";
    }
  }

  async function verifyCode() {
    const otpInput = document.getElementById("otpInput");
    const otp = otpInput.value.trim();
    const msg = document.getElementById("verifyMsg");

    if (!/^\d{6}$/.test(otp)) {
      msg.innerHTML = "<span class='warn'>Enter a 6-digit OTP.</span>";
      return;
    }

    const user = await getUserInfo();
    const email = user?.userDetails;

    if (!email) {
      msg.innerHTML = "<span class='err'>Not signed in. Please Login.</span>";
      setStatusUI({ state: "anonymous", tone: "warn" });
      return;
    }

    const employeeId = emailToAlnumKey(email);
    if (!employeeId) {
      msg.innerHTML = "<span class='err'>Unable to derive identifier from email.</span>";
      return;
    }

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
      } else {
        const reason = data?.error || data?.reason || "Verification failed.";
        msg.innerHTML = `<span class='err'>${reason}</span>`;
        console.log("Verify response:", data);
      }

      // ✅ Refresh status after verify (success should become "enrolled")
      await refreshStatus(user);
    } catch (e) {
      console.error(e);
      msg.innerHTML = "<span class='err'>Verification failed (network/error).</span>";
      await refreshStatus(user);
    }
  }

  // --- Wire up events safely ---
  document.getElementById("startEnrollBtn").addEventListener("click", startEnrollment);
  document.getElementById("verifyBtn").addEventListener("click", verifyCode);

  // --- Init ---
  (async () => {
    const user = await getUserInfo();
    setAuthUI(user);
    await refreshStatus(user);
  })();

  console.log("API BASE =", API);
})();