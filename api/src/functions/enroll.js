const { app } = require("@azure/functions");
const { getKeyVaultClient } = require("../shared/keyvault");
const { generateSecretBase32, configureTotp } = require("../shared/totp");

function secretNameFor(employeeId) {
  return `totp-seed-${employeeId}`;
}

app.http("enroll", {
  methods: ["POST"],
  authLevel: "FUNCTION",
  route: "enroll",
  handler: async (request, context) => {
    const body = await request.json().catch(() => ({}));
    const employeeId = (body.employeeId || "").trim();
    const issuer = (body.issuer || "MyCompany").trim();

    if (!employeeId) {
      return { status: 400, jsonBody: { error: "employeeId is required" } };
    }

    const digits = Number(body.digits || 6);
    const period = Number(body.period || 30);
    const algorithm = body.algorithm || "SHA1";
    configureTotp({ digits, period, algorithm });

    const seed = generateSecretBase32(20);

    const kv = getKeyVaultClient();
    const secretName = secretNameFor(employeeId);
    await kv.setSecret(secretName, seed);

    const label = encodeURIComponent(`${issuer}:${employeeId}`);
    const params = new URLSearchParams({
      secret: seed,
      issuer,
      digits: String(digits),
      period: String(period)
    });

    const otpauth = `otpauth://totp/${label}?${params.toString()}`;

    return { status: 200, jsonBody: { employeeId, otpauth } };
  }
});