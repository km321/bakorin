/** Auth routes: setup, signup, login, sessions, password reset, verification, invites. */

import type { SchemaAST } from "@bakorin/core";
import { pascal, errorResponses } from "./schemas.ts";

export function authPaths(ast: SchemaAST): Record<string, unknown> {
  return {
    "/api/v1/auth/setup": {
      get: {
        tags: ["auth"],
        summary: "First-run setup status",
        description: "Public. Returns firstAdmin: true while the auth table has no admin, so the admin UI can show Create your first admin.",
        security: [],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "object",
                      properties: { firstAdmin: { type: "boolean" } },
                      required: ["firstAdmin"],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/auth/first-admin": {
      post: {
        tags: ["auth"],
        summary: "Create the first admin",
        description:
          "Public only while zero admins exist. Race-safe: a second call returns 409. After the first admin exists the endpoint stays closed. Alternative: BAKORIN_ADMIN_EMAIL and BAKORIN_ADMIN_PASSWORD on first boot.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string", format: "password", minLength: 8 },
                  name: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthSession" } } } },
          400: errorResponses[400],
          409: errorResponses[409],
          429: errorResponses[429],
        },
      },
    },
    "/api/v1/auth/signup": {
      post: {
        tags: ["auth"],
        summary: "Create an account",
        description:
          "Public signup. The auth role field is ignored and forced to the non-admin default. Prefer this over generic CRUD create on the auth entity. Answers 202 with the same body whether or not the email already has an account, and never returns a session: a new email gets a verification email, an existing owner gets a notice with a password reset link. Sign in with /auth/login afterwards.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${pascal(ast.auth.entity)}Write` },
            },
          },
        },
        responses: {
          202: {
            description: "Accepted. Same body for new and existing emails",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "object",
                      required: ["ok", "status", "requiresVerification", "message"],
                      properties: {
                        ok: { type: "boolean", enum: [true] },
                        status: { type: "string", enum: ["check_email"] },
                        requiresVerification: { type: "boolean" },
                        message: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          400: errorResponses[400],
          429: errorResponses[429],
        },
      },
    },
    "/api/v1/auth/login": {
      post: {
        tags: ["auth"],
        summary: "Log in",
        description: "Returns access and refresh tokens for the identity field on the auth entity.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: [ast.auth.identityField, ast.auth.passwordField],
                properties: {
                  [ast.auth.identityField]: { type: "string" },
                  [ast.auth.passwordField]: { type: "string", format: "password" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthSession" } } } },
          401: errorResponses[401],
          403: errorResponses[403],
          429: errorResponses[429],
        },
      },
    },
    "/api/v1/auth/refresh": {
      post: {
        tags: ["auth"],
        summary: "Rotate a refresh token",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["refreshToken"], properties: { refreshToken: { type: "string" } } },
            },
          },
        },
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthSession" } } } },
          400: errorResponses[400],
          401: errorResponses[401],
        },
      },
    },
    "/api/v1/auth/logout": {
      post: {
        tags: ["auth"],
        summary: "Revoke the current refresh token",
        description: "Pass refreshToken to revoke one session, or all=true with a bearer token to revoke every session for the user.",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { refreshToken: { type: "string" }, all: { type: "boolean" } },
              },
            },
          },
        },
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: { type: "object", properties: { data: { type: "object", properties: { ok: { type: "boolean" } } } } },
              },
            },
          },
          401: errorResponses[401],
        },
      },
    },
    "/api/v1/auth/me": {
      get: {
        tags: ["auth"],
        summary: "Current user",
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { data: { $ref: `#/components/schemas/${pascal(ast.auth.entity)}` } },
                },
              },
            },
          },
          401: errorResponses[401],
          404: errorResponses[404],
        },
      },
    },
    "/api/v1/auth/forgot-password": {
      post: {
        tags: ["auth"],
        summary: "Request a password reset",
        description: "Always returns 200. Does not reveal whether the account exists. Rate limited. Sends a one-hour single-use link.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { email: { type: "string", format: "email" } }, required: ["email"] },
            },
          },
        },
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: { type: "object", properties: { data: { type: "object", properties: { ok: { type: "boolean" } } } } },
              },
            },
          },
          429: errorResponses[429],
        },
      },
    },
    "/api/v1/auth/reset-password": {
      post: {
        tags: ["auth"],
        summary: "Reset password with a token",
        description: "Consumes a hashed one-hour token and revokes every refresh token for that user.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["token", "password"],
                properties: { token: { type: "string" }, password: { type: "string", format: "password", minLength: 8 } },
              },
            },
          },
        },
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: { type: "object", properties: { data: { type: "object", properties: { ok: { type: "boolean" } } } } },
              },
            },
          },
          400: errorResponses[400],
        },
      },
    },
    "/api/v1/auth/verify-email": {
      post: {
        tags: ["auth"],
        summary: "Verify email with a token",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["token"], properties: { token: { type: "string" } } },
            },
          },
        },
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: { type: "object", properties: { data: { type: "object", properties: { ok: { type: "boolean" } } } } },
              },
            },
          },
          400: errorResponses[400],
        },
      },
    },
    "/api/v1/auth/resend-verification": {
      post: {
        tags: ["auth"],
        summary: "Resend a verification email",
        description: "Signed-in users resend for themselves. Admins may pass userId. Passing only email does not reveal whether the account exists.",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { userId: { type: "string" }, email: { type: "string", format: "email" } },
              },
            },
          },
        },
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: { type: "object", properties: { data: { type: "object", properties: { ok: { type: "boolean" } } } } },
              },
            },
          },
          401: errorResponses[401],
          403: errorResponses[403],
          429: errorResponses[429],
        },
      },
    },
    "/api/v1/auth/invites": {
      post: {
        tags: ["auth"],
        summary: "Invite a user",
        description: "Admin only. Creates the account with the given role and emails a link to set a password.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: {
                  email: { type: "string", format: "email" },
                  role: { type: "string" },
                  name: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthSession" } } } },
          400: errorResponses[400],
          401: errorResponses[401],
          403: errorResponses[403],
          409: errorResponses[409],
        },
      },
    },
    "/api/v1/auth/accept-invite": {
      post: {
        tags: ["auth"],
        summary: "Accept an invite and set a password",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["token", "password"],
                properties: {
                  token: { type: "string" },
                  password: { type: "string", format: "password", minLength: 8 },
                  name: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthSession" } } } },
          400: errorResponses[400],
        },
      },
    },
  };
}
