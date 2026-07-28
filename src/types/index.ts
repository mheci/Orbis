/**
 * Shared type definitions for G-Container.
 *
 * Everything that crosses a module boundary is typed here so that the
 * background worker, the popup and the options page all agree on the shape of
 * the data they exchange. No runtime code lives in this file.
 */

/** Schema version of the persisted settings object. Bump on breaking changes. */
export const SETTINGS_SCHEMA_VERSION = 1 as const;

/** Firefox contextual identity colours accepted by `contextualIdentities`. */
export const CONTAINER_COLORS = [
  'blue',
  'turquoise',
  'green',
  'yellow',
  'orange',
  'red',
  'pink',
  'purple',
  'toolbar',
] as const;
export type ContainerColor = (typeof CONTAINER_COLORS)[number];

/** Firefox contextual identity icons accepted by `contextualIdentities`. */
export const CONTAINER_ICONS = [
  'fingerprint',
  'briefcase',
  'dollar',
  'cart',
  'circle',
  'gift',
  'vacation',
  'food',
  'fruit',
  'pet',
  'tree',
  'chill',
  'fence',
] as const;
export type ContainerIcon = (typeof CONTAINER_ICONS)[number];

/** How a rule was produced, used for diagnostics and precedence reporting. */
export type MatchSource =
  | 'never-list'
  | 'always-list'
  | 'exception'
  | 'builtin-never'
  | 'domain-set'
  | 'brand-tld'
  | 'cctld'
  | 'none';

/** Result of asking the matcher about a URL. */
export interface MatchResult {
  /** True when the URL should live inside the Google container. */
  readonly isGoogle: boolean;
  /** Which rule decided the outcome. */
  readonly source: MatchSource;
  /** The registrable pattern or literal that matched, for diagnostics. */
  readonly pattern?: string;
}

/** A user-defined exception: a site that must never be pulled into the container. */
export interface ExceptionRule {
  /** Host or host+path prefix, e.g. "mail.example.com" or "example.com/sso". */
  readonly pattern: string;
  /** Free-form user note. */
  readonly note?: string;
  /** Disabled rules are kept but ignored. */
  readonly enabled: boolean;
  /** Creation timestamp (epoch ms). */
  readonly created: number;
}

/** Per-domain-set enablement, keyed by the set's `id`. */
export type DomainSetToggles = Record<string, boolean>;

/** Aggregate, strictly local usage counters. Never leaves the browser. */
export interface Statistics {
  /** Navigations redirected into the container. */
  containedNavigations: number;
  /** Navigations released from the container back to normal browsing. */
  releasedNavigations: number;
  /** Redirector links unwrapped to their real destination. */
  unwrappedLinks: number;
  /** Times an exception or never-rule prevented containerization. */
  exceptionsApplied: number;
  /** Epoch ms of the first counted event. */
  since: number;
  /** Epoch ms of the most recent counted event. */
  lastEvent: number;
}

/** The full persisted settings document. */
export interface Settings {
  readonly schemaVersion: number;
  /** Master switch. When false the extension performs no redirection at all. */
  enabled: boolean;
  /** Temporary pause; epoch ms at which protection resumes, or 0 when not paused. */
  pausedUntil: number;
  /** Container presentation. */
  container: {
    name: string;
    color: ContainerColor;
    icon: ContainerIcon;
  };
  /** Behaviour flags. */
  behaviour: {
    /** Unwrap google.com/url?q=... links to their real destination. */
    unwrapRedirectors: boolean;
    /** Let third-party "Sign in with Google" flows stay outside the container. */
    oauthPassthrough: boolean;
    /** Push non-Google navigations that start inside the container back out. */
    releaseNonGoogle: boolean;
    /** Also containerize in private windows (Firefox keeps them separate anyway). */
    handlePrivateWindows: boolean;
    /** Record local statistics. */
    collectStatistics: boolean;
    /** Mirror settings through Firefox Sync when available. */
    useSync: boolean;
  };
  /** Which optional domain sets are active. */
  domainSets: DomainSetToggles;
  /** Hosts the user always wants contained, in addition to the database. */
  alwaysContainerize: string[];
  /** Hosts the user never wants contained; wins over everything else. */
  neverContainerize: string[];
  /** Structured exceptions with metadata. */
  exceptions: ExceptionRule[];
  /** Local counters. */
  statistics: Statistics;
}

/** The exported/imported backup envelope. */
export interface BackupDocument {
  readonly format: 'g-container-backup';
  readonly version: number;
  readonly exportedAt: string;
  readonly settings: Settings;
}

/** Messages exchanged between UI surfaces and the background worker. */
export type Message =
  | { type: 'get-state' }
  | { type: 'get-settings' }
  | { type: 'set-settings'; patch: DeepPartial<Settings> }
  | { type: 'match-url'; url: string }
  | { type: 'move-tab'; tabId: number; into: boolean }
  | { type: 'pause'; minutes: number }
  | { type: 'resume' }
  | { type: 'add-rule'; list: 'always' | 'never'; pattern: string }
  | { type: 'remove-rule'; list: 'always' | 'never'; pattern: string }
  | { type: 'export' }
  | { type: 'import'; document: unknown }
  | { type: 'reset' }
  | { type: 'diagnostics' };

/** Snapshot of runtime state used to render the popup. */
export interface RuntimeState {
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly pausedUntil: number;
  readonly containerName: string;
  readonly containerColor: ContainerColor;
  readonly containerIcon: ContainerIcon;
  readonly cookieStoreId: string | null;
  readonly currentUrl: string | null;
  readonly currentHost: string | null;
  readonly currentTabInContainer: boolean;
  readonly currentMatch: MatchResult;
  readonly statistics: Statistics;
  readonly domainCount: number;
}

/** Diagnostics payload for the options page. */
export interface Diagnostics {
  readonly version: string;
  readonly userAgent: string;
  readonly cookieStoreId: string | null;
  readonly containerExists: boolean;
  readonly domainCount: number;
  readonly ruleCounts: Record<string, number>;
  readonly storage: { local: boolean; sync: boolean };
  readonly matcherBuildMs: number;
  readonly recentErrors: string[];
}

/** Recursive partial, used for settings patches. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};
