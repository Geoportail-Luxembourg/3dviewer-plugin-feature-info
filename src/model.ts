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
 * Carries the per-feature envelope from the interaction to
 * `LuxTemplateFeatureInfoView`. Lives here rather than next to its producer so
 * the view does not import the interaction.
 */
export const luxContentSymbol = Symbol('luxFeatureInfoContent');

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
   * The geoportail's aggregated GetFeatureInfo endpoint, e.g.
   * `https://map.geoportail.lu/getfeatureinfo`. One request covers every active
   * layer, and the backend answers per *definition* — a layer with several rows
   * in `lux_getfeature_definition` yields several entries, each with its own
   * template. That is why this is not a standard per-layer WMS call.
   */
  luxGetInfoUrl: string;
  /**
   * Half-width in metres of `box1`, which the backend intersects against
   * geometries with no rings — points and lines (`ST_NRings(geom) = 0`). Those
   * need a generous box to be clickable at all.
   */
  bigBuffer: number;
  /**
   * Half-width in metres of `box2`, used for ringed geometries, i.e. polygons
   * (`ST_NRings(geom) > 0`). Small on purpose: a click inside a polygon already
   * intersects it, and widening this starts returning the neighbours too.
   *
   * The 2D portal scales both with the map resolution (`20 *` and `1 *`), which
   * a tilted 3D camera cannot supply meaningfully — it reports sub-metre values
   * from a few hundred metres up. Fixed metres instead.
   */
  smallBuffer: number;
  /**
   * Credentials mode for the query. `include` is what lets the backend see the
   * session and return role-specific definitions; it needs the endpoint to
   * answer with a matching `Access-Control-Allow-Origin`.
   */
  credentials?: RequestCredentials;
};

export type PluginState = Record<never, never>;
