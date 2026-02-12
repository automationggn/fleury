const { app } = require("@azure/functions");
const { getKeyVaultClient } = require("../shared/keyvault");
const { generateSecretBase32, configureTotp } = require("../shared/totp");

function secretNameFor(employeeId) {
  return `totp-seed-${employeeId}`;
}
//Trigger redeployment by simply commenting
// IMPORTANT: set this to your SWA origin exactly
const ALLOWED_ORIGIN = "https://icy-river-03e7fe80f.2.azurestaticapps.net";

function corsHeaders(origin) {
  // If you want to allow multiple origins later, add logic here.
  const allowed = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;

  return {
    "Access-Control-Allow-Origin": allowed,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    // If you ever use cookies, then also add:
    // "Access-Control-Allow-Credentials": "true",
  };
}

app.http("enroll", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "enroll",
  handler: async (request, context) => {
    const origin = request.headers.get("origin") || "";
    const headers = corsHeaders(origin);

    // 1) Handle browser preflight cleanly
    if (request.method === "OPTIONS") {
      return {
        status: 204,
        headers
      };
    }

    // 2) Debug marker to prove the function is being hit
    // Remove later if you want, but keep for now while debugging.
    context.log("✅ enroll function HIT");

    // 3) Parse body safely
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      body = {};
    }

    const employeeId = String(body.employeeId || "").trim();
    const issuer = String(body.issuer || "MyCompany").trim();

    if (!employeeId) {
      return {
        status: 400,
        headers,
        jsonBody: { error: "employeeId is required" }
      };
    }

    // 4) TOTP config
    const digits = Number(body.digits || 6);
    const period = Number(body.period || 30);
    const algorithm = String(body.algorithm || "SHA1").toUpperCase();

    configureTotp({ digits, period, algorithm });

    // 5) Generate and store seed
    const seed = generateSecretBase32(20);

    const kv = getKeyVaultClient();
    const secretName = secretNameFor(employeeId);
    await kv.setSecret(secretName, seed);

    // 6) Build otpauth URI
    const label = encodeURIComponent(`${issuer}:${employeeId}`);
    const params = new URLSearchParams({
      secret: seed,
      issuer,
      digits: String(digits),
      period: String(period),
      algorithm
    });

    const otpauth = `otpauth://totp/${label}?${params.toString()}`;

    return {
      status: 200,
      headers,
      jsonBody: { employeeId, otpauth }
    };
  }
});
``