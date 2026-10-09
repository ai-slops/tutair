import { createRemoteJWKSet, jwtVerify } from "jose";
import ky from "ky";
import { z } from "zod";
import type { StoredGrant } from "./chatgpt-token-store.js";
import { ApiError } from "./types.js";

const RESOURCE = "https://api.openai.com/v1";
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  id_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
  token_type: z.literal("Bearer"),
});
const modelsSchema = z.object({
  models: z.array(
    z.object({ slug: z.string().min(1), display_name: z.string().min(1), visibility: z.string() }),
  ),
});

export type ChatGptEndpoints = {
  readonly tokenUrl: string;
  readonly jwksUrl: string;
  readonly issuer: string;
  readonly apiBaseUrl: string;
};

export class ChatGptApi {
  constructor(readonly endpoints: ChatGptEndpoints) {}

  async exchangeCode(input: {
    readonly code: string;
    readonly clientId: string;
    readonly verifier: string;
    readonly redirectUri: string;
  }) {
    return tokenSchema.parse(
      await ky
        .post(this.endpoints.tokenUrl, {
          timeout: 30_000,
          retry: { limit: 0 },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: input.code,
            client_id: input.clientId,
            code_verifier: input.verifier,
            redirect_uri: input.redirectUri,
            resource: RESOURCE,
          }),
        })
        .json(),
    );
  }

  async verifyIdentity(idToken: string, clientId: string) {
    return jwtVerify(idToken, createRemoteJWKSet(new URL(this.endpoints.jwksUrl)), {
      issuer: this.endpoints.issuer,
      audience: clientId,
      requiredClaims: ["exp", "sub", "nonce"],
    });
  }

  async refresh(grant: StoredGrant, now: number): Promise<StoredGrant> {
    const token = tokenSchema.parse(
      await ky
        .post(this.endpoints.tokenUrl, {
          timeout: 30_000,
          retry: { limit: 0 },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: grant.clientId,
            refresh_token: grant.refreshToken,
            resource: RESOURCE,
          }),
        })
        .json(),
    );
    if (token.id_token === undefined)
      throw new ApiError(502, "oauth_id_token_missing", "Refresh did not return identity");
    const idToken = token.id_token;
    await jwtVerify(idToken, createRemoteJWKSet(new URL(this.endpoints.jwksUrl)), {
      issuer: grant.issuer,
      audience: grant.clientId,
      subject: grant.subject,
      requiredClaims: ["exp", "sub"],
    });
    return {
      ...grant,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      idToken,
      scopes: token.scope?.split(" ").filter(Boolean) ?? grant.scopes,
      expiresAt: now + token.expires_in * 1_000,
    };
  }

  async models(accessToken: string) {
    const response = modelsSchema.parse(
      await ky
        .get(`${this.endpoints.apiBaseUrl.replace(/\/$/, "")}/models`, {
          timeout: 30_000,
          retry: { limit: 0 },
          headers: { authorization: `Bearer ${accessToken}` },
        })
        .json(),
    );
    return response.models
      .filter((model) => model.visibility === "list")
      .map((model) => ({ slug: model.slug, displayName: model.display_name }));
  }
}
