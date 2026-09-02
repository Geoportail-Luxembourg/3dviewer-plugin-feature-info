import type { Feature } from 'ol';
import Style from 'ol/style/Style.js';
import type { Coordinate } from 'ol/coordinate.js';
import { WMSFeatureProvider } from '@vcmap/core';
import type {
  Layer,
  TilingScheme,
  WMSFeatureProviderOptions,
} from '@vcmap/core';
import { featureInfoViewSymbol } from '@vcmap/ui';
import type { VcsUiApp } from '@vcmap/ui';
import { LUX_EPSG, LUX_PROJ4 } from './luxProjection.js';
import { toFeatureInfoJson } from './luxFeatureInfoJson.js';
import type { LuxWmsFeature } from './luxFeatureInfoJson.js';
import { LUX_FEATURE_INFO_VIEW_NAME } from './model.js';
import type { PluginConfig } from './model.js';

/** Carries the rendered envelope; read by `LuxTemplateFeatureInfoView`. */
export const luxContentSymbol = Symbol('luxFeatureInfoContent');

/** Carries the untouched response feature between the two overrides below. */
const luxRawSymbol = Symbol('luxWmsRawFeature');

/** Toolbox button id of VC Map's own feature info toggle. */
const FEATURE_INFO_TOOL_ID = 'featureInfo';

type WmsLayerLike = Layer & {
  parameters?: Record<string, string>;
  tilingSchema?: TilingScheme;
  version?: string;
  tileSize?: [number, number];
  minLevel?: number;
  maxLevel?: number;
  opacity?: number;
};

/**
 * Queries one lux layer with a standard OGC WMS GetFeatureInfo, asking for
 * `application/json`.
 *
 * The geoportail's WMS answers that with the *same* enriched payload its custom
 * aggregated endpoint returns — `fid`, `id`, `alias` and a `properties` bag
 * identical to the aggregated `attributes`, nested objects and arrays included —
 * so the plugin needs no request building or response parsing of its own. What a
 * standard response cannot carry is the per-layer envelope, which
 * {@link toFeatureInfoJson} reconstructs.
 *
 * Built from the layer's own public options, mirroring what
 * `WMSLayer._setFeatureProvider()` does, so it inherits url, tiling, version and
 * headers from whatever themesync configured.
 */
class LuxWmsFeatureProvider extends WMSFeatureProvider {
  static get className(): string {
    return 'LuxWmsFeatureProvider';
  }

  /**
   * Provider options equivalent to the layer's own, but asking for JSON.
   *
   * `FEATURE_COUNT` has to be set explicitly — neither ol nor VC Map ever does,
   * and WMS servers default to a single feature. The projection must carry the
   * full proj4 string: `new Projection({ epsg })` alone silently falls back to
   * the default projection, and ol would then read the response's 2169 metres as
   * degrees.
   */
  static optionsFromLayer(
    layer: Layer,
    config: Pick<PluginConfig, 'featureCount'>,
  ): WMSFeatureProviderOptions {
    const wms = layer as WmsLayerLike;
    const options: WMSFeatureProviderOptions = {
      url: layer.url,
      tilingSchema: wms.tilingSchema,
      version: wms.version,
      tileSize: wms.tileSize,
      minLevel: wms.minLevel,
      maxLevel: wms.maxLevel,
      extent: layer.extent?.isValid() ? layer.extent : undefined,
      headers: layer.headers,
      parameters: {
        ...wms.parameters,
        FEATURE_COUNT: String(config.featureCount),
      },
      responseType: 'application/json',
      projection: { epsg: LUX_EPSG, proj4: LUX_PROJ4 },
    };
    return options;
  }

  private _app: VcsUiApp;

  private _config: PluginConfig;

  constructor(app: VcsUiApp, layer: Layer, config: PluginConfig) {
    super({
      name: `${LuxWmsFeatureProvider.className}-${layer.name}`,
      ...LuxWmsFeatureProvider.optionsFromLayer(layer, config),
    });
    this._app = app;
    this._config = config;
  }

  /**
   * Only query while VC Map's feature info tool is toggled on.
   *
   * `FeatureProviderInteraction` is part of the immutable base interaction chain
   * and nothing in core or ui ever calls
   * `featureProviderInteraction.setActive(…)` — `createFeatureInfoSession()` only
   * touches `featureInteraction`. So providers are asked on *every* click, while
   * panning, drawing, or with the tool off. The built-in `text/html` provider
   * answers those without a request; this one would hit the backend once per
   * active layer. The gate is part of the contract, not an optimisation.
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

  async getFeaturesByCoordinate(
    coordinate: Coordinate,
    resolution: number,
    layer: Layer,
  ): Promise<Feature[]> {
    if (!this._isToolActive()) {
      return [];
    }
    // `FeatureProviderInteraction` filters on `active` only, so a layer turned
    // fully transparent would still answer.
    if (((layer as WmsLayerLike).opacity ?? 1) <= 0) {
      return [];
    }

    /*
     * The server's hit tolerance is a handful of pixels, and ol derives the
     * queried pixel from this resolution — so the resolution is what sets the
     * tolerance in ground units. A tilted Cesium camera reports sub-metre
     * values, which measured out at a tolerance of centimetres: point layers
     * became unclickable. Flooring it widens the pixel instead.
     */
    const features = await super.getFeaturesByCoordinate(
      coordinate,
      Math.max(resolution, this._config.minResolution),
      layer,
    );

    const view = this._app.featureInfo.getByKey(LUX_FEATURE_INFO_VIEW_NAME);
    features.forEach((feature) => {
      /*
       * Render nothing. `selectFeature()` clones a provided feature onto its
       * internal scratch layer and forces `olcs_allowPicking: true` on the
       * clone; with a visible style that clone is then picked by
       * `FeatureAtPixelInteraction` on the next click, which makes
       * `FeatureProviderInteraction` skip every provider — i.e. the selected
       * geometry becomes a dead zone until the panel is closed. Measured: a
       * second click inside a selected commune issued no request at all.
       * Highlighting the real geometries is a Phase 7 item and needs its own
       * layer, not this clone.
       */
      feature.setStyle(new Style({}));
      const tagged = feature as unknown as Record<symbol, unknown>;
      const raw = (tagged[luxRawSymbol] ?? {}) as LuxWmsFeature;
      tagged[luxContentSymbol] = [toFeatureInfoJson(raw, layer, this._config)];
      // Beats the layer's own `properties.featureInfo`, which themesync points
      // at the 2D iframe view unless `useLuxFeatureInfoTemplates` is on.
      if (view) {
        tagged[featureInfoViewSymbol] = view;
      }
    });
    return features;
  }

  /**
   * Keep what ol's GeoJSON reader throws away.
   *
   * `readFeatureFromObject()` retains only `id`, `geometry` and `properties`, so
   * `fid` and `alias` are lost and the geometry is reprojected to mercator —
   * while the templates want the composite `fid` and the original EPSG:2169
   * geometry. Rebuilding the fid as `${luxId}_${id}` would be wrong for the
   * layers the backend remaps (262 answers with `359_…`), so the untouched
   * response feature is stashed instead and read back in
   * `getFeaturesByCoordinate`.
   *
   * The id is also promoted to the composite fid: the bare `id` is only unique
   * per layer, yet it keys the highlight scratch layer and the cluster list rows.
   */
  featureResponseCallback(data: unknown, coordinate: Coordinate): Feature[] {
    const features = super.featureResponseCallback(data, coordinate);
    let raws: LuxWmsFeature[] = [];
    try {
      raws = (JSON.parse(String(data))?.features ?? []) as LuxWmsFeature[];
    } catch {
      return features; // not the JSON shape; leave super's result alone
    }
    if (raws.length !== features.length) {
      return features; // cannot pair them up reliably
    }
    features.forEach((feature, index) => {
      const raw = raws[index];
      (feature as unknown as Record<symbol, unknown>)[luxRawSymbol] = raw;
      if (raw.fid) {
        feature.setId(raw.fid);
      }
    });
    return features;
  }
}

export default LuxWmsFeatureProvider;
