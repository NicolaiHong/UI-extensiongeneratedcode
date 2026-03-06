import { rawPost, getApi } from "./client";

export interface AuthUser { id: string; email: string | null; displayName: string | null; avatarUrl: string | null; }
export interface AuthTokens { accessToken: string; refreshToken: string; }
export interface AuthResponse { user: AuthUser; tokens: AuthTokens; }

export const authApi = {
  login: async (emailOrUsername: string, password: string): Promise<AuthResponse> =>
    (await rawPost("/auth/login", { emailOrUsername, password })).data,

  register: async (email: string, password: string, displayName?: string): Promise<AuthResponse> =>
    (await rawPost("/auth/register", { email, password, displayName })).data,

  refresh: async (refreshToken: string): Promise<AuthTokens> =>
    (await rawPost("/auth/refresh", { refreshToken })).data,

  logout: async (refreshToken: string): Promise<void> => {
    await rawPost("/auth/logout", { refreshToken });
  },

  getMe: async (): Promise<AuthUser> => (await getApi().get("/auth/me")).data,
};
