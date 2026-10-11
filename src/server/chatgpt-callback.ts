import { ApiError } from "./types.js";

const DYNAMIC_CLIENT = "dynamic_agent_client";

export function callbackUri(port: number): string {
  return `http://127.0.0.1:${port}/auth/callback`;
}

export function manualCallbackParams(value: string, expectedCallback: string): URLSearchParams {
  if (!URL.canParse(value))
    throw new ApiError(401, "oauth_callback_invalid", "Authorization callback URL is invalid");
  const callback = new URL(value);
  if (
    callback.origin + callback.pathname !== expectedCallback ||
    callback.username !== "" ||
    callback.password !== "" ||
    callback.hash !== ""
  )
    throw new ApiError(
      401,
      "oauth_callback_invalid",
      "Authorization callback did not match the configured loopback URL",
    );
  return callback.searchParams;
}

export function issuedClientId(pendingClient: string, supplied: string | null): string {
  if (pendingClient === DYNAMIC_CLIENT) {
    if (supplied === null || supplied === DYNAMIC_CLIENT)
      throw new ApiError(401, "oauth_client_mismatch", "Authorization omitted the issued client");
    return supplied;
  }
  if (supplied !== null && supplied !== pendingClient)
    throw new ApiError(401, "oauth_client_mismatch", "Authorization client did not match");
  return pendingClient;
}
