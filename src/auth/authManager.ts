import * as vscode from "vscode";
import { authApi, AuthUser, AuthTokens } from "../api/auth.api";
import { initApiClient } from "../api/client";

const AT_KEY = "uigenai.accessToken";
const RT_KEY = "uigenai.refreshToken";
const USER_KEY = "uigenai.user";

export class AuthManager {
  private _user: AuthUser | null = null;
  private _onDidChange = new vscode.EventEmitter<AuthUser | null>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private secrets: vscode.SecretStorage,
    private state: vscode.Memento,
  ) {}

  async init(): Promise<void> {
    const at = await this.secrets.get(AT_KEY);
    const raw = this.state.get<string>(USER_KEY);
    if (at && raw) {
      try {
        this._user = JSON.parse(raw);
      } catch {
        this._user = null;
      }
    }
    this.reinitClient();
    this._onDidChange.fire(this._user);
  }

  get user() {
    return this._user;
  }
  get isLoggedIn() {
    return !!this._user;
  }

  async login(email: string, pw: string): Promise<AuthUser> {
    const r = await authApi.login(email, pw);
    await this.save(r.user, r.tokens);
    return r.user;
  }

  async register(email: string, pw: string, name?: string): Promise<AuthUser> {
    const r = await authApi.register(email, pw, name);
    await this.save(r.user, r.tokens);
    return r.user;
  }

  async loginWithTokens(tokens: AuthTokens): Promise<AuthUser> {
    await this.secrets.store(AT_KEY, tokens.accessToken);
    await this.secrets.store(RT_KEY, tokens.refreshToken);
    this.reinitClient();
    try {
      const user = await authApi.getMe();
      this._user = user;
      await this.state.update(USER_KEY, JSON.stringify(user));
      this._onDidChange.fire(user);
      return user;
    } catch (e) {
      // Token verification failed — roll back stored credentials
      await this.secrets.delete(AT_KEY);
      await this.secrets.delete(RT_KEY);
      throw e;
    }
  }

  async logout(): Promise<void> {
    const rt = await this.secrets.get(RT_KEY);
    if (rt) {
      try {
        await authApi.logout(rt);
      } catch {}
    }
    await this.secrets.delete(AT_KEY);
    await this.secrets.delete(RT_KEY);
    await this.state.update(USER_KEY, undefined);
    this._user = null;
    this._onDidChange.fire(null);
  }

  private async save(user: AuthUser, tokens: AuthTokens) {
    this._user = user;
    await this.secrets.store(AT_KEY, tokens.accessToken);
    await this.secrets.store(RT_KEY, tokens.refreshToken);
    await this.state.update(USER_KEY, JSON.stringify(user));
    this.reinitClient();
    this._onDidChange.fire(user);
  }

  private reinitClient(): void {
    initApiClient({
      getToken: async () => this.secrets.get(AT_KEY),
      onAuthFailed: () => this.onAuthFailed(),
    });
  }

  private onAuthFailed() {
    this.logout();
    vscode.window
      .showWarningMessage("Session expired. Please login again.", "Login")
      .then((a) => {
        if (a === "Login") {
          vscode.commands.executeCommand("uigenai.login");
        }
      });
  }

  dispose() {
    this._onDidChange.dispose();
  }
}
