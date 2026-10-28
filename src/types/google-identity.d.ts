/**
 * Minimal types for the Google Identity Services (GIS) `google.accounts.id` API, loaded at
 * runtime from https://accounts.google.com/gsi/client. Only the parts BrejaMap uses.
 * Reference: https://developers.google.com/identity/gsi/web/reference/js-reference
 */

export type GsiCredentialResponse = {
  /** Google ID token (JWT); empty/missing when the flow failed. */
  credential?: string;
  select_by?: string;
};

export type GsiIdConfiguration = {
  client_id: string;
  callback: (response: GsiCredentialResponse) => void;
  /** Sent back inside the ID token; we pass the SHA-256 hex of a raw nonce. */
  nonce?: string;
  context?: "signin" | "signup" | "use";
  ux_mode?: "popup" | "redirect";
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  itp_support?: boolean;
  use_fedcm_for_prompt?: boolean;
  use_fedcm_for_button?: boolean;
};

export type GsiButtonConfiguration = {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
  /** Pixels, at most 400. */
  width?: number;
  locale?: string;
};

export type GsiAccountsId = {
  initialize(config: GsiIdConfiguration): void;
  renderButton(parent: HTMLElement, options: GsiButtonConfiguration): void;
  cancel(): void;
  disableAutoSelect(): void;
};

/** `window` once the GIS script ran (the Maps script also defines `window.google`). */
export type GsiWindow = Window & { google?: { accounts?: { id?: GsiAccountsId } } };
