// auth.js
// redeploy trigger
// ==============================
// MSAL configuration
// ==============================
const msalConfig = {
  auth: {
    clientId: "e65522c7-e835-455e-868e-84374e2f455c",
    authority: "https://login.microsoftonline.com/6ff58ea8-3962-43e0-a6d8-1ae07fe72650",
    redirectUri: window.location.origin
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false
  }
};

// Create MSAL instance
const msalInstance = new msal.PublicClientApplication(msalConfig);

// ==============================
// API scope (EXACT as required)
// ==============================
const tokenRequest = {
  scopes: [
    "api://e95f22f4-b5a9-4711-b2eb-1067df45215a/access_as_user"
  ]
};

// ==============================
// Sign-in + get access token
// ==============================
async function signInAndGetToken() {
  // Required for MSAL v2+
  await msalInstance.initialize();

  let account = msalInstance.getAllAccounts()[0];

  // Login if no account exists
  if (!account) {
    const loginResponse = await msalInstance.loginPopup(tokenRequest);
    account = loginResponse.account;
  }

  // Try silent token acquisition first
  try {
    const tokenResponse = await msalInstance.acquireTokenSilent({
      ...tokenRequest,
      account
    });
    return tokenResponse.accessToken;
  } catch (silentError) {
    // Fallback to popup
    const tokenResponse = await msalInstance.acquireTokenPopup({
      ...tokenRequest,
      account
    });
    return tokenResponse.accessToken;
  }
}

// ==============================
// Expose globally for testing
// ==============================
window.signInAndGetToken = signInAndGetToken;