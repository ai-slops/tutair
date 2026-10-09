import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { ChatGptApi, type ChatGptEndpoints } from "./chatgpt-api.js";
import type { ProtectedTokenStore, StoredGrant } from "./chatgpt-token-store.js";
import { ApiError } from "./types.js";

const DIRECT_SCOPE = "chatgpt.tokens.use.direct";
const RESOURCE = "https://api.openai.com/v1";
const DYNAMIC_CLIENT = "dynamic_agent_client";

type PendingAuthorization = {
  readonly owner: string;
  readonly state: string;
  readonly nonce: string;
  readonly verifier: string;
  readonly clientId: string;
  readonly previous: StoredGrant | null;
  readonly createdAt: number;
};
export type ChatGptAuthConfig = ChatGptEndpoints & {
  readonly enabled: boolean;
  readonly callbackPort: number;
  readonly authorizationUrl: string;
  readonly tokenUrl: string;
  readonly jwksUrl: string;
  readonly issuer: string;
  readonly apiBaseUrl: string;
  readonly store: ProtectedTokenStore;
  readonly now?: () => number;
};

export class ChatGptAuth {
  readonly api: ChatGptApi;
  private readonly pending = new Map<string, PendingAuthorization>();
  private readonly refreshes = new Map<string, Promise<StoredGrant>>();

  constructor(readonly config: ChatGptAuthConfig) {
    this.api = new ChatGptApi(config);
  }

  async begin(owner: string): Promise<{ readonly url: string; readonly state: string }> {
    this.requireEnabled();
    const previous = await this.config.store.read(owner);
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const clientId = previous?.clientId ?? DYNAMIC_CLIENT;
    this.pending.set(state, {
      owner,
      state,
      nonce,
      verifier,
      clientId,
      previous,
      createdAt: this.now(),
    });
    const url = new URL(this.config.authorizationUrl);
    const params = url.searchParams;
    params.set("client_id", clientId);
    if (clientId === DYNAMIC_CLIENT) params.set("agent_name_hint", "Tutair");
    params.set("ext_agent_host_id", await this.config.store.hostId());
    if (previous !== null) params.set("id_token_hint", previous.idToken);
    params.set("response_type", "code");
    params.set("redirect_uri", this.redirectUri());
    params.set(
      "scope",
      "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    );
    params.set("resource", RESOURCE);
    params.set("state", state);
    params.set("nonce", nonce);
    params.set("code_challenge_method", "S256");
    params.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
    return { url: url.toString(), state };
  }

  async complete(params: URLSearchParams): Promise<string> {
    const state = params.get("state") ?? "";
    const pending = this.pending.get(state);
    if (pending === undefined || this.now() - pending.createdAt > 600_000)
      throw new ApiError(401, "oauth_state_invalid", "Authorization state is invalid or expired");
    this.pending.delete(state);
    if (params.get("error") === "access_denied")
      throw new ApiError(401, "oauth_access_denied", "ChatGPT authorization was denied");
    const code = params.get("code");
    if (code === null)
      throw new ApiError(400, "oauth_code_missing", "Authorization code is missing");
    const suppliedClient = params.get("client_id");
    const clientId = this.resolveClient(pending, suppliedClient);
    const token = await this.api.exchangeCode({
      code,
      clientId,
      verifier: pending.verifier,
      redirectUri: this.redirectUri(),
    });
    if (token.id_token === undefined)
      throw new ApiError(502, "oauth_id_token_missing", "Authorization did not return identity");
    const scopes = (token.scope ?? params.get("scope") ?? "").split(" ").filter(Boolean);
    if (!scopes.includes(DIRECT_SCOPE))
      throw new ApiError(
        403,
        "oauth_scope_missing",
        "ChatGPT direct-token permission was not granted",
      );
    const verified = await this.api.verifyIdentity(token.id_token, clientId);
    if (verified.payload["nonce"] !== pending.nonce)
      throw new ApiError(401, "oauth_nonce_mismatch", "Authorization nonce did not match");
    const subject = z.string().min(1).parse(verified.payload.sub);
    if (
      pending.previous !== null &&
      (pending.previous.subject !== subject || pending.previous.clientId !== clientId)
    )
      throw new ApiError(409, "oauth_account_mismatch", "Authorization returned another account");
    await this.config.store.write(pending.owner, {
      clientId,
      issuer: this.config.issuer,
      subject,
      scopes,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      idToken: token.id_token,
      expiresAt: this.now() + token.expires_in * 1_000,
      selectedModel: pending.previous?.selectedModel ?? null,
    });
    return pending.owner;
  }

  async status(owner: string): Promise<Readonly<Record<string, unknown>>> {
    const grant = await this.config.store.read(owner);
    return grant === null
      ? { enabled: this.config.enabled, connected: false }
      : {
          enabled: this.config.enabled,
          connected: true,
          subject: grant.subject,
          clientId: grant.clientId,
          selectedModel: grant.selectedModel,
        };
  }

  async credential(owner: string): Promise<StoredGrant> {
    const grant = await this.config.store.read(owner);
    if (grant === null)
      throw new ApiError(401, "chatgpt_not_connected", "Connect ChatGPT for this learner first");
    if (grant.expiresAt > this.now() + 60_000) return grant;
    const active = this.refreshes.get(owner);
    if (active !== undefined) return active;
    const refresh = this.refresh(owner, grant).finally(() => this.refreshes.delete(owner));
    this.refreshes.set(owner, refresh);
    return refresh;
  }

  async disconnect(owner: string): Promise<void> {
    await this.config.store.delete(owner);
  }

  async models(
    owner: string,
  ): Promise<readonly { readonly slug: string; readonly displayName: string }[]> {
    const grant = await this.credential(owner);
    return this.api.models(grant.accessToken);
  }

  async selectModel(owner: string, slug: string): Promise<void> {
    const available = await this.models(owner);
    if (!available.some((model) => model.slug === slug))
      throw new ApiError(422, "chatgpt_model_unavailable", "Selected model is not available");
    await this.config.store.selectModel(owner, slug);
  }

  async responseCredential(owner: string): Promise<{
    readonly accessToken: string;
    readonly model: string;
    readonly apiBaseUrl: string;
  }> {
    const grant = await this.credential(owner);
    if (grant.selectedModel === null)
      throw new ApiError(409, "chatgpt_model_required", "Choose a ChatGPT model first");
    return {
      accessToken: grant.accessToken,
      model: grant.selectedModel,
      apiBaseUrl: this.config.apiBaseUrl,
    };
  }

  private async refresh(owner: string, grant: StoredGrant): Promise<StoredGrant> {
    const updated = await this.api.refresh(grant, this.now());
    if (!updated.scopes.includes(DIRECT_SCOPE))
      throw new ApiError(403, "oauth_scope_missing", "ChatGPT direct-token permission was revoked");
    await this.config.store.write(owner, updated);
    return updated;
  }

  private resolveClient(pending: PendingAuthorization, supplied: string | null): string {
    if (pending.clientId === DYNAMIC_CLIENT) {
      if (supplied === null || supplied === DYNAMIC_CLIENT)
        throw new ApiError(401, "oauth_client_mismatch", "Authorization omitted the issued client");
      return supplied;
    }
    if (supplied !== null && supplied !== pending.clientId)
      throw new ApiError(401, "oauth_client_mismatch", "Authorization client did not match");
    return pending.clientId;
  }

  private requireEnabled(): void {
    if (!this.config.enabled)
      throw new ApiError(404, "chatgpt_personal_disabled", "Personal ChatGPT mode is disabled");
  }

  private redirectUri(): string {
    return `http://127.0.0.1:${this.config.callbackPort}/auth/callback`;
  }

  private now(): number {
    return this.config.now?.() ?? Date.now();
  }
}
