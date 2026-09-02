import { Feature } from 'ol';
import Point from 'ol/geom/Point.js';
import Style from 'ol/style/Style.js';
import type { Coordinate } from 'ol/coordinate.js';
import { AbstractFeatureProvider } from '@vcmap/core';
import type { Layer } from '@vcmap/core';
import { getLogger } from '@vcsuite/logger';
import { featureInfoViewSymbol, NotificationType } from '@vcmap/ui';
import type { VcsUiApp } from '@vcmap/ui';
import type { FeatureInfoJSON } from '@geoportallux/feature-info-templates';
import { queryLuxFeatureInfoAtPosition } from './luxQueryService.js';
import { I18N_NAMESPACE } from './model.js';
import type { PluginConfig } from './model.js';
import type LuxTemplateFeatureInfoView from './luxTemplateFeatureInfoView.js';

/**
 * Carries the aggregated response on the feature the provider returns. A symbol
 * rather than a feature property so it cannot leak into `getAttributes()`.
 */
export const luxContentSymbol = Symbol('luxFeatureInfoContent');

/** Toolbox button id of VC Map's own feature info toggle. */
const FEATURE_INFO_TOOL_ID = 'featureInfo';

/**
 * Turns a click into the geoportail's aggregated GetFeatureInfo — one request
 * covering every visible queryable lux layer.
 *
 * This is the framework's seam for exactly this problem: "a layer which cannot
 * provide features directly, but can provide features for a given location".
 * VC Map's built-in `FeatureProviderInteraction` calls it whenever a click
 * picked no feature, which is what makes empty-space clicks work without a
 * custom interaction, and it skips providers entirely once something *was*
 * picked, so 3D tileset clicks reach their balloon by construction.
 *
 * The aggregated response covers many layers but belongs to one position, so a
 * single envelope feature is returned carrying the whole array. Returning one
 * feature is also what keeps the 2D portal's stacked panel: two or more would
 * make VC Map open its cluster list instead.
 */
class LuxAggregatedFeatureProvider extends AbstractFeatureProvider {
  static get className(): string {
    return 'LuxAggregatedFeatureProvider';
  }

  private _app: VcsUiApp;

  private _config: PluginConfig;

  private _view: LuxTemplateFeatureInfoView;

  constructor(
    app: VcsUiApp,
    config: PluginConfig,
    view: LuxTemplateFeatureInfoView,
  ) {
    super({
      name: LuxAggregatedFeatureProvider.className,
      vectorProperties: { allowPicking: false },
    });
    this._app = app;
    this._config = config;
    this._view = view;
  }

  /**
   * Only query while VC Map's feature info tool is toggled on.
   *
   * `FeatureProviderInteraction` is part of the immutable base interaction
   * chain and nothing in core or ui ever deactivates it, so providers are asked
   * on *every* click — while panning, drawing, measuring, or with the tool off.
   * That costs nothing for the built-in WMS provider, which answers `text/html`
   * clicks without a request at all, but it would hit the backend on every
   * click here. This gate is part of the contract, not an optimisation.
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
    _resolution: number,
    layer: Layer,
  ): Promise<Feature[]> {
    if (!this._isToolActive()) {
      return [];
    }

    const { target } = this._app.maps;
    const previousCursor = target?.style.cursor ?? '';
    if (target) {
      target.style.cursor = 'wait';
    }
    let content: FeatureInfoJSON[] = [];
    try {
      content = await queryLuxFeatureInfoAtPosition(
        this._app,
        this._config,
        coordinate,
      );
    } catch (e) {
      getLogger('luxFeatureInfo').error('GetFeatureInfo request failed', e);
      this._app.notifier.add({
        type: NotificationType.ERROR,
        message: `${I18N_NAMESPACE}.queryFailed`,
      });
      return [];
    } finally {
      if (target) {
        target.style.cursor = previousCursor;
      }
    }

    if (content.length === 0) {
      // No feature means the built-in interaction clears the selection, which
      // is the 2D portal's "click into nothing closes the panel".
      return [];
    }

    const feature = this.getProviderFeature(
      new Feature({ geometry: new Point(coordinate) }),
      layer,
    );
    // An empty style renders nothing, so neither the envelope nor the clone
    // VC Map highlights on its scratch layer is visible or pickable — without
    // it the highlight would swallow the next click at the same spot.
    feature.setStyle(new Style({}));
    const tagged = feature as unknown as Record<symbol, unknown>;
    tagged[luxContentSymbol] = content;
    // Beats any per-layer `properties.featureInfo` in
    // `getFeatureInfoViewForFeature()`, so no view resolution is needed.
    tagged[featureInfoViewSymbol] = this._view;
    return [feature];
  }
}

export default LuxAggregatedFeatureProvider;
