import { Feature } from 'ol';
import Point from 'ol/geom/Point.js';
import {
  AbstractInteraction,
  EventType,
  markVolatile,
  mercatorProjection,
  ModificationKeyType,
  VectorLayer,
  vcsLayerName,
} from '@vcmap/core';
import type { EventFeature, InteractionEvent } from '@vcmap/core';
import {
  Cesium3DTileFeature,
  Cesium3DTilePointFeature,
} from '@vcmap-cesium/engine';
import { getLogger } from '@vcsuite/logger';
import { featureInfoViewSymbol, NotificationType } from '@vcmap/ui';
import type { VcsUiApp } from '@vcmap/ui';
import type { Coordinate } from 'ol/coordinate.js';
import {
  isLuxQueryLayer,
  queryLuxFeatureInfoAtPosition,
} from './luxQueryService.js';
import type LuxTemplateFeatureInfoView from './luxTemplateFeatureInfoView.js';
import {
  I18N_NAMESPACE,
  LUX_FEATURE_INFO_VIEW_NAME,
  type PluginConfig,
} from './model.js';

/** Toolbox button id of VC Map's own feature info toggle. */
const FEATURE_INFO_TOOL_ID = 'featureInfo';

const ANCHOR_LAYER_NAME = 'luxFeatureInfoAnchor';

/**
 * A never activated, non-pickable vector layer holding the point feature that
 * anchors an aggregated result.
 *
 * `featureInfo.selectFeature()` insists on a feature that belongs to a layer of
 * this app — it resolves the layer to highlight the feature on. Our result
 * belongs to a position, not to a feature, so we hand it a throwaway point at
 * the click. Leaving the layer inactive means it has no map implementation, so
 * the highlight VC Map dutifully applies to that point renders nowhere.
 */
export function createAnchorLayer(app: VcsUiApp): VectorLayer {
  const layer = new VectorLayer({
    name: ANCHOR_LAYER_NAME,
    projection: mercatorProjection.toJSON(),
    allowPicking: false,
  });
  markVolatile(layer);
  app.layers.add(layer);
  return layer;
}

/**
 * Whether a picked feature is already served by someone else's feature info
 * view — a 3D tileset's balloon, a search result, another plugin's layer. Those
 * clicks belong to VC Map's own exclusive interaction further down the chain.
 *
 * A feature on a lux layer this plugin queries is explicitly *not* foreign,
 * whatever `properties.featureInfo` names. Themesync only points those layers at
 * `luxFeatureInfo` once `useLuxFeatureInfoTemplates` is on; until then they say
 * `featureInfo2d` and still carry a `WMSFeatureProvider`, so a click can arrive
 * with a provided feature attached. Deferring to that per-layer view would hand
 * the click to the 2D iframe and silently disable this plugin — and only when a
 * single layer matched, because the provider wraps two or more hits into a
 * synthetic cluster feature belonging to no layer at all.
 */
function isForeignFeature(app: VcsUiApp, feature: EventFeature): boolean {
  if (
    feature instanceof Cesium3DTileFeature ||
    feature instanceof Cesium3DTilePointFeature
  ) {
    return true;
  }
  if ((feature as unknown as Record<symbol, unknown>)[featureInfoViewSymbol]) {
    return true;
  }
  const layerName = (feature as unknown as Record<symbol, unknown>)[
    vcsLayerName
  ];
  const layer =
    typeof layerName === 'string' ? app.layers.getByKey(layerName) : undefined;
  if (layer && isLuxQueryLayer(layer)) {
    return false;
  }
  const viewName = layer?.properties?.featureInfo;
  return (
    typeof viewName === 'string' && viewName !== LUX_FEATURE_INFO_VIEW_NAME
  );
}

/**
 * Persistent interaction that turns a click into one aggregated GetFeatureInfo
 * query over all visible queryable lux layers.
 *
 * Registered after `CoordinateAtPixel`/`FeatureAtPixel`/`FeatureProvider` and
 * before the exclusive `FeatureInfoInteraction`, so it sees both the position
 * and any picked feature, and can leave the event to VC Map by simply not
 * stopping propagation.
 *
 * `ModificationKeyType.NONE` drops the 2D portal's shift-click accumulation,
 * as decided for v1.
 */
class LuxFeatureInfoInteraction extends AbstractInteraction {
  private _app: VcsUiApp;

  private _view: LuxTemplateFeatureInfoView;

  private _anchorLayer: VectorLayer;

  private _config: PluginConfig;

  private _anchorCount = 0;

  constructor(
    app: VcsUiApp,
    view: LuxTemplateFeatureInfoView,
    anchorLayer: VectorLayer,
    config: PluginConfig,
  ) {
    super(EventType.CLICK, ModificationKeyType.NONE);
    this._app = app;
    this._view = view;
    this._anchorLayer = anchorLayer;
    this._config = config;
    this.setActive();
  }

  /**
   * Only query while VC Map's feature info tool is toggled on. This inherits
   * the framework's tool semantics for free: when draw or measure claim the
   * exclusive interaction slot the toggle switches off, and lux queries stop
   * with it.
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

  async pipe(event: InteractionEvent): Promise<InteractionEvent> {
    if (!event.position || !this._isToolActive()) {
      return event;
    }
    if (event.feature && isForeignFeature(this._app, event.feature)) {
      return event;
    }
    if (!event.feature && !this._config.queryEmptySpace) {
      return event;
    }

    const { target } = this._app.maps;
    const previousCursor = target?.style.cursor ?? '';
    if (target) {
      target.style.cursor = 'wait';
    }
    try {
      const content = await queryLuxFeatureInfoAtPosition(
        this._app,
        this._config,
        event.position,
      );
      if (content.length > 0) {
        // Leaving the rest of the chain untouched keeps the built-in
        // interaction from clearing what we just selected.
        event.stopPropagation = true;
        await this._select(event.position, event.windowPosition, content);
      }
      // On an empty result we fall through on purpose: a click that picked
      // nothing then reaches the built-in FeatureInfoInteraction, which clears
      // the selection and closes the window — the 2D portal's "click into
      // nothing closes the panel".
    } catch (e) {
      getLogger('luxFeatureInfo').error('GetFeatureInfo request failed', e);
      this._app.notifier.add({
        type: NotificationType.ERROR,
        message: `${I18N_NAMESPACE}.queryFailed`,
      });
    } finally {
      if (target) {
        target.style.cursor = previousCursor;
      }
    }
    return event;
  }

  private async _select(
    position: Coordinate,
    windowPosition: { x: number; y: number },
    content: Awaited<ReturnType<typeof queryLuxFeatureInfoAtPosition>>,
  ): Promise<void> {
    this._anchorCount += 1;
    const anchor = new Feature({ geometry: new Point(position) });
    anchor.setId(`${ANCHOR_LAYER_NAME}-${this._anchorCount}`);
    this._anchorLayer.removeAllFeatures();
    this._anchorLayer.addFeatures([anchor]);

    this._view.content = content;
    await this._app.featureInfo.selectFeature(
      anchor,
      position,
      [windowPosition.x, windowPosition.y],
      this._view,
    );
  }
}

export default LuxFeatureInfoInteraction;
