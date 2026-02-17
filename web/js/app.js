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

  // --- Enrollment ---
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
        return;
      }

      const data = await res.json();
      if (!data?.otpauth) {
        msg.innerHTML = "<span class='err'>Enroll response missing otpauth.</span>";
        console.log("Enroll response:", data);
        return;
      }

      document.getElementById("issuerLine").textContent = data.issuer || "—";
      document.getElementById("otpauthPre").textContent = data.otpauth;
      document.getElementById("qrImg").src = qrUrl(data.otpauth);

      qrBlock.classList.remove("is-hidden");
      msg.innerHTML = `<span class='ok'>QR generated for ${email}.</span>`;
    } catch (e) {
      console.error(e);
      msg.innerHTML = "<span class='err'>Failed to start enrollment.</span>";
    }
  }

  // --- Verification ---
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
    } catch (e) {
      console.error(e);
      msg.innerHTML = "<span class='err'>Verification failed (network/error).</span>";
    }
  }

  // --- Wire up events safely (no relying on global IDs) ---
  document.getElementById("startEnrollBtn").addEventListener("click", startEnrollment);
  document.getElementById("verifyBtn").addEventListener("click", verifyCode);

  // --- Init ---
  (async () => {
    const user = await getUserInfo();
    setAuthUI(user);
  })();

  console.log("API BASE =", API);
})();