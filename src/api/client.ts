import axios, { AxiosInstance, InternalAxiosRequestConfig } from "axios";
import * as vscode from "vscode";

let _instance: AxiosInstance | null = null;
let _getToken: (() => Promise<string | undefined>) | null = null;
let _onAuthFailed: (() => void) | null = null;

export function getServerUrl(): string {
  return vscode.workspace
    .getConfiguration("uigenai")
    .get<string>("serverUrl", "http://localhost:3000");
}

export function initApiClient(opts: {
  getToken: () => Promise<string | undefined>;
  onAuthFailed: () => void;
}): void {
  _getToken = opts.getToken;
  _onAuthFailed = opts.onAuthFailed;
  _instance = null; // reset so next getApi() creates fresh instance
}

export function getApi(): AxiosInstance {
  if (!_instance) {
    _instance = axios.create({
      baseURL: getServerUrl(),
      headers: { "Content-Type": "application/json" },
      timeout: 120_000,
    });

    _instance.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        if (_getToken) {
          const token = await _getToken();
          if (token) {
            config.headers.Authorization = `Bearer ${token}`;
          }
        }
        return config;
      },
    );

    _instance.interceptors.response.use(
      (r) => r,
      async (error) => {
        if (error.response?.status === 401 && !error.config._retry) {
          error.config._retry = true;
          _onAuthFailed?.();
        }
        return Promise.reject(error);
      },
    );
  }
  return _instance;
}

/** Extract payload from backend `{ success, data: T }` response wrapper. */
export function unwrap(response: { data: any }): any {
  return response.data?.data ?? response.data;
}

/** Raw axios without auth — for login/register/refresh */
export function rawPost(path: string, body: any) {
  return axios.post(`${getServerUrl()}${path}`, body, {
    headers: { "Content-Type": "application/json" },
    timeout: 30_000,
  });
}
