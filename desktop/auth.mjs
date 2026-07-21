import { validateCodexLoginUrl } from "./runtime.mjs";

export async function beginChatGPTLogin({ sidecar, openExternal }) {
  const result = await sidecar.startLogin();
  try {
    const loginUrl = validateCodexLoginUrl(result.auth_url);
    await openExternal(loginUrl);
    return { state: result.state };
  } catch (error) {
    try { await sidecar.cancelLogin(); } catch { /* Preserve the browser-open error. */ }
    throw error;
  }
}
