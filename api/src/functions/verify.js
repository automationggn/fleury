const { app } = require("@azure/functions");
const { getKeyVaultClient } = require("../shared/keyvault");
const { configureTotp, verifyOtp, getTimeStep } = require("../shared/totp");

function secretNameFor(employeeId) {
  return `totp-seed-${employeeId}`;
}

app.http("verify", {
  methods: ["POST"],
  authLevel: "FUNCTION",
  route: "verify",
  handler: async (request, context) => {
    const body = await request.json().catch(() => ({}));
    const employeeId = (body.employeeId || "").trim();
    const token = (body.otp || "").trim();

    if (!employeeId || !token) {
      return { status: 400, jsonBody: { error: "employeeId and otp are required" } };
    }

    const digits = Number(body.digits || 6);
    const period = Number(body.period || 30);
    const algorithm = body.algorithm || "SHA1";
    const window = Number.isFinite(body.window) ? Number(body.window) : 1;

    configureTotp({ digits, period, algorithm });

    const kv = getKeyVaultClient();
    const secretName = secretNameFor(employeeId);

    let seed;
    try {
      const secret = await kv.getSecret(secretName);
      seed = secret.value;
    } catch {
      return { status: 404, jsonBody: { ok: false, error: "User not enrolled (seed not found)" } };
    }

    const ok = verifyOtp({ secret: seed, token, window });
    const step = getTimeStep({ period });

    return { status: 200, jsonBody: { ok, employeeId, step } };
  }
});
