import type { LuxTplConfig } from '@geoportallux/feature-info-templates';

/**
 * Package name of the optional auth plugin this plugin reads the logged in user
 * from. Loose coupling via `app.plugins.getByKey` and a string contract, as
 * between the auth plugin and themesync.
 */
export const AUTH_PLUGIN_NAME = '@geoportallux/lux-3dviewer-plugin-auth';

/** Name of the feature info view instance the plugin registers and renders with. */
export const LUX_FEATURE_INFO_VIEW_NAME = 'luxFeatureInfo';

/** i18n namespace of this plugin (camel-cased, unscoped package name). */
export const I18N_NAMESPACE = 'lux3dviewerPluginFeatureInfo';

/**
 * Minimal view of the auth plugin's public API. Only `userState` is read, and
 * only when that plugin happens to be loaded.
 */
export type LuxAuthPluginLike = {
  readonly userState: {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- raw geoportail API shape
    user: { mail?: string; role_id?: number } | null;
  };
};

export type PluginConfig = {
  /** GetFeatureInfo endpoint, e.g. `https://map.geoportail.lu/getfeatureinfo`. */
  luxGetInfoUrl: string;
  /**
   * Base URL of the geoportail's static locale files, e.g.
   * `https://map.geoportail.lu/assets/locales`. `{{ns}}.{{lng}}.json` is
   * appended to it.
   */
  luxLocalesUrl: string;
  /** URLs and role ids the feature info templates need. */
  templatesConfig: LuxTplConfig;
  /** Credentials mode for the GetFeatureInfo and locale requests. */
  credentials?: RequestCredentials;
  /**
   * Buffer in meters (EPSG:2169) around the clicked point sent as `box1`. The
   * geoportail's coordinate query path uses 10.
   */
  bigBuffer: number;
  /** Buffer in meters sent as `box2`. The geoportail uses 1. */
  smallBuffer: number;
  /**
   * Whether a click that picked no feature still triggers an aggregated query.
   * True reproduces the 2D geoportail; false restricts queries to clicks that
   * hit something.
   */
  queryEmptySpace: boolean;
};

export type PluginState = Record<never, never>;
