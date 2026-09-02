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
 * Template the geoportail backend uses when a layer has no specific one, and
 * what the shared dispatcher falls back to for any name it does not know.
 */
export const DEFAULT_TEMPLATE = 'default.html';

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
  /**
   * Base URL of the geoportail's static locale files, e.g.
   * `https://map.geoportail.lu/assets/locales`. `{{ns}}.{{lng}}.json` is
   * appended to it.
   */
  luxLocalesUrl: string;
  /** URLs and role ids the feature info templates need. */
  templatesConfig: LuxTplConfig;
  /**
   * Lux layer id to template filename, merged over the generated seed in
   * `luxTemplates.ts`. Anything unmapped renders with {@link DEFAULT_TEMPLATE}.
   * The mapping exists only in the backend's `lux_getfeature_definition` table,
   * so it cannot be derived from the themes API or a WMS response.
   */
  templates: Record<string, string>;
  /**
   * Floor, in meters per pixel, for the resolution handed to the WMS
   * GetFeatureInfo request. The server's hit tolerance is a few pixels, so the
   * resolution is what sets it in ground units — and a tilted 3D camera reports
   * sub-metre resolutions, which would make point layers unclickable. The
   * default of 3 gives roughly the ±10 m the 2D portal searches.
   */
  minResolution: number;
  /**
   * Whether the templates keep the server's attribute order (`true`) or sort
   * alphabetically. The aggregated endpoint decided this per layer; a standard
   * WMS response cannot say, so it is one setting for all layers.
   */
  ordered: boolean;
  /** `FEATURE_COUNT` sent per layer. WMS servers default to 1. */
  featureCount: number;
};

export type PluginState = Record<never, never>;
