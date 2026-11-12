export interface NathChatOptions {
  /** Origin of NathChat. HTTPS only (http allowed for localhost with allowInsecureLocalhost). */
  baseUrl?: string;
  /** If set, baseUrl's origin must be one of these. */
  allowedOrigins?: string[];
  allowInsecureLocalhost?: boolean;
  /** Required Server.access_key_id for an active integration. */
  clientId: string;
  /** DOM element that receives the widget host (defaults to document.body). */
  container?: HTMLElement;
  /** Expanded widget dimensions in CSS pixels. Minimums: 280 by 360. */
  width?: number;
  height?: number;
  startCollapsed?: boolean;
  /** Do not load the NathChat frame until the widget is first opened (default true). */
  lazy?: boolean;
  /** Remember position and collapsed state in localStorage (default true). Never stores credentials. */
  rememberUi?: boolean;
  /** iframe Permissions-Policy delegation, e.g. "clipboard-write; microphone; camera". */
  permissions?: string;
  title?: string;
  locale?: string;
  theme?: "auto" | "light" | "dark";
  /** CSP nonce for the fallback style element when adoptedStyleSheets is unavailable. */
  nonce?: string;
  zIndex?: number;
  offset?: number;
}

export interface NathChatState {
  collapsed: boolean;
  ready: boolean;
  loggedIn: boolean;
  nathlink: string | null;
  unread: number;
  position: { x: number; y: number };
}

export type NathChatEvent = "ready" | "login" | "logout" | "unread" | "unlocked" | "expand" | "collapse" | "error";

export class NathChatWidget {
  constructor(options: NathChatOptions);
  readonly destroyed: boolean;
  on(event: NathChatEvent, listener: (detail: any) => void): () => void;
  expand(): void;
  collapse(): void;
  toggle(): void;
  moveTo(x: number, y: number): void;
  logout(): void;
  getState(): NathChatState;
  destroy(): void;
}

export function init(options: NathChatOptions): NathChatWidget;
export function getInstance(): NathChatWidget | null;
export function resolveOrigin(baseUrl: string, opts?: { allowedOrigins?: string[]; allowInsecureLocalhost?: boolean }): string;
export function clampPosition(x: number, y: number, w: number, h: number, vw: number, vh: number, margin?: number): { x: number; y: number };
export function resizeKeepingCorner(rect: { x: number; y: number; w: number; h: number }, newW: number, newH: number, vw: number, vh: number): { x: number; y: number };
export function parseMessage(data: unknown): { type: string; [k: string]: unknown } | null;
export const version: string;
