import { Feature } from 'ol';
import Style from 'ol/style/Style.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import type { Coordinate } from 'ol/coordinate.js';
import {
  AbstractFeatureProvider,
  isProvidedFeature,
  mercatorProjection,
  vcsLayerName,
} from '@vcmap/core';
import { getLogger } from '@vcsuite/logger';
import { featureInfoViewSymbol, NotificationType } from '@vcmap/ui';
import type { VcsUiApp } from '@vcmap/ui';
import type {
  FeatureInfoJSON,
  FeatureJSON,
} from '@geoportallux/feature-info-templates';
import { queryLuxFeatureInfoAtPosition } from './luxQueryService.js';
import { LUX_EPSG } from './luxProjection.js';
import {
  I18N_NAMESPACE,
  LUX_FEATURE_INFO_VIEW_NAME,
  luxContentSymbol,
  ROW_TITLE_PROPERTY,
} from './model.js';
import type { PluginConfig } from './model.js';

/** Toolbox button id of VC Map's own feature info toggle. */
const FEATURE_INFO_TOOL_ID = 'featureInfo';

/** One response feature together with the definition entry it came from. */
export type LuxResponseFeature = {
  /** VC Map layer name — the cluster list groups on it. */
  layerName: string;
  entry: FeatureInfoJSON;
  feature: FeatureJSON;
  /**
   * Feature id, the backend's composite `fid` where there is one.
   *
   * Not every layer has one — 813's features come back with `fid: null` — and a
   * feature without an id leaves its cluster row titled `undefined`, because the
   * title falls back through `attributes[clusterFeatureTitleProperty]`,
   * `title`, `name` to exactly that id. `AbstractFeatureProvider.getProviderFeature()`
   * covers this with a uuid; this provider does not go through it, so the
   * fallback is here instead, and is positional rather than random so a row keeps
   * its identity across re-renders.
   */
  id: string;
};

/**
 * Flatten the response to one item per feature.
 *
 * The backend answers per *definition*, not per layer: `get_lux_feature_definition()`
 * collects every row matching the layer (and the user's role) and `get_info()`
 * appends one entry per row. So a single layer can return several entries with
 * different templates — layer 813 returns five, two of them with features. Keying
 * the flattening on the feature rather than the layer is what makes that fall out
 * for free: each row of the cluster list then renders with the template of the
 * definition that produced it.
 *
 * Entries whose `layerLabel` did not resolve to a VC Map layer are skipped —
 * `featureInfo.selectFeature()` discards a selection whose `vcsLayerName` is not
 * in `app.layers`.
 */
export function splitResponse(
  content: FeatureInfoJSON[],
): LuxResponseFeature[] {
  const items: LuxResponseFeature[] = [];
  content.forEach((entry, entryIndex) => {
    const layerName = entry.layerLabel;
    if (!layerName) {
      return;
    }
    (entry.features ?? []).forEach((feature, featureIndex) => {
      items.push({
        layerName,
        entry,
        feature,
        id: feature.fid || `${entry.layer}:${entryIndex}:${featureIndex}`,
      });
    });
  });
  return items;
}

/**
 * Attribute names that carry a human-readable title, best first, matched
 * case-insensitively.
 *
 * `label` is first because that is what most lux layers compose and what the
 * cluster rows showed before this existed. The rest only has to cover what VC
 * Map's own fallback misses — it checks `title` and `name` exactly, so layer 813's
 * `Name` never matched.
 */
const TITLE_ATTRIBUTES = ['label', 'name', 'title'];

/**
 * Pick a row title out of a feature's attributes.
 *
 * Returns undefined when nothing usable is there, which leaves the row titled by
 * the feature id — the same degradation as before.
 */
export function deriveRowTitle(
  attributes: Record<string, unknown>,
): string | undefined {
  const keys = Object.keys(attributes);
  for (const candidate of TITLE_ATTRIBUTES) {
    const key = keys.find((k) => k.toLowerCase() === candidate);
    const value = key !== undefined ? attributes[key] : undefined;
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (text) {
        return text;
      }
    }
  }
  return undefined;
}

/**
 * The envelope for a single row: its own definition entry, carrying only the one
 * feature that row stands for.
 *
 * `features_count` / `total_features_count` keep the entry's values — the shared
 * templates never read them.
 */
export function toSingleFeatureContent(
  item: LuxResponseFeature,
): FeatureInfoJSON {
  return { ...item.entry, features: [item.feature] };
}

/**
 * Queries the geoportail's aggregated GetFeatureInfo on click and hands VC Map
 * features it can render.
 *
 * Lives on a hidden helper layer the plugin owns, not on the lux layers: VC Map
 * finds providers only through active layers, and this one has to answer for
 * all of them at once. One request per click covers every active lux layer and
 * reaches all three backend branches (ArcGIS REST, SQL and the server-side WMS
 * relay), where a per-layer WMS call only ever reaches the last of them.
 *
 * Every returned feature names its *lux* layer in `vcsLayerName`, not the helper
 * layer — that is all VC Map's cluster list groups on, and what
 * `selectFeature()` resolves. So `getProviderFeature()` is not used: it would
 * stamp the helper layer's name over it.
 */
class LuxAggregatedFeatureProvider extends AbstractFeatureProvider {
  static get className(): string {
    return 'LuxAggregatedFeatureProvider';
  }

  private _app: VcsUiApp;

  private _config: PluginConfig;

  constructor(app: VcsUiApp, config: PluginConfig) {
    super({});
    this._app = app;
    this._config = config;
  }

  /**
   * Only query while VC Map's feature info tool is toggled on.
   *
   * `FeatureProviderInteraction` sits in the persistent chain and asks every
   * provider on every click — panning, drawing, tool off — and each call here
   * would be a real HTTP request.
   */
  private _isToolActive(): boolean {
    if (!this._app.toolboxManager.has(FEATURE_INFO_TOOL_ID)) {
      return false;
    }
    const tool = this._app.toolboxManager.get(FEATURE_INFO_TOOL_ID) as {
      action?: { active?: boolean };
    };
    return !!tool?.action?.active;
  }

  /**
   * Build the ol feature a cluster row (or a direct panel) is made of.
   *
   * The lux attributes become the feature's own properties because the cluster
   * list titles rows from `attributes[clusterFeatureTitleProperty]`, which the
   * plugin points at {@link ROW_TITLE_PROPERTY}. The geometry arrives in
   * EPSG:2169 and is reprojected for the map. The empty style matters:
   * `selectFeature()` clones a provided feature onto its scratch layer forcing
   * `olcs_allowPicking`, and a *visible* clone is then picked on the next click,
   * which makes `FeatureProviderInteraction` skip every provider.
   */
  private _toOlFeature(item: LuxResponseFeature): Feature {
    const attributes = (item.feature.attributes ?? {}) as Record<
      string,
      unknown
    >;
    const rowTitle = deriveRowTitle(attributes);
    const feature = new Feature({
      ...attributes,
      ...(rowTitle !== undefined && { [ROW_TITLE_PROPERTY]: rowTitle }),
    });
    if (item.feature.geometry) {
      feature.setGeometry(
        new GeoJSON().readGeometry(item.feature.geometry, {
          dataProjection: LUX_EPSG,
          featureProjection: mercatorProjection.epsg,
        }),
      );
    }
    feature.setId(item.id);
    feature.setStyle(new Style({}));

    const tagged = feature as unknown as Record<symbol, unknown>;
    tagged[vcsLayerName] = item.layerName;
    tagged[isProvidedFeature] = true;
    tagged[luxContentSymbol] = [toSingleFeatureContent(item)];
    const view = this._app.featureInfo.getByKey(LUX_FEATURE_INFO_VIEW_NAME);
    if (view) {
      tagged[featureInfoViewSymbol] = view;
    }
    return feature;
  }

  async getFeaturesByCoordinate(coordinate: Coordinate): Promise<Feature[]> {
    if (!this._isToolActive()) {
      return [];
    }

    const mapElement = this._app.maps.activeMap?.mapElement;
    if (mapElement) {
      mapElement.style.cursor = 'wait';
    }
    let content: FeatureInfoJSON[] = [];
    try {
      content = await queryLuxFeatureInfoAtPosition(
        this._app,
        this._config,
        coordinate,
      );
    } catch (e) {
      this._app.notifier.add({
        message: `${I18N_NAMESPACE}.queryFailed`,
        type: NotificationType.ERROR,
      });
      getLogger('LuxAggregatedFeatureProvider').error(String(e));
    } finally {
      if (mapElement) {
        mapElement.style.cursor = '';
      }
    }

    // One or several, `FeatureProviderInteraction` does the rest: a single
    // feature opens its panel, two or more — merged with whatever other layers'
    // providers returned — become VC Map's cluster list.
    return splitResponse(content).map((item) => this._toOlFeature(item));
  }
}

export default LuxAggregatedFeatureProvider;
