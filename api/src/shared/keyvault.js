const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");

function getKeyVaultClient() {
  const vaultName = process.env.KEY_VAULT_NAME;
  if (!vaultName) throw new Error("Missing env var KEY_VAULT_NAME");

  const vaultUrl = `https://${vaultName}.vault.azure.net`;
  const credential = new DefaultAzureCredential();
  return new SecretClient(vaultUrl, credential);
}

module.exports = { getKeyVaultClient };