import type { VcsPlugin, VcsUiApp, PluginConfigEditor } from '@vcmap/ui';
import { markVolatile, mercatorProjection, VectorLayer } from '@vcmap/core';
import type { Layer } from '@vcmap/core';
import { name, version, mapVersion } from '../package.json';
import {
  I18N_NAMESPACE,
  LUX_FEATURE_INFO_VIEW_NAME,
  type PluginConfig,
  type PluginState,
} from './model.js';
import getDefaultOptions from './defaultOptions.js';
import { getLuxProjection } from './luxProjection.js';
import { isLuxQueryLayer } from './luxQueryService.js';
import LuxTemplateFeatureInfoView from './luxTemplateFeatureInfoView.js';
import LuxAggregatedFeatureProvider from './luxAggregatedFeatureProvider.js';
import { createLuxTplRuntime } from './luxTplRuntime.js';
import type { LuxTplRuntime } from './luxTplRuntime.js';
import i18n from './i18n.js';

const QUERY_LAYER_NAME = 'luxAggregatedFeatureInfo';

export type LuxFeatureInfoPlugin = VcsPlugin<PluginConfig, PluginState> & {
  /** Context and i18n the window component provides to the templates. */
  readonly tplRuntime: LuxTplRuntime | null;
};

export default function lux3dviewerPluginFeatureInfo(
  config: Partial<PluginConfig>,
): LuxFeatureInfoPlugin {
  const pluginConfig: PluginConfig = {
    ...getDefaultOptions(),
    ...config,
    templatesConfig: {
      ...getDefaultOptions().templatesConfig,
      ...config.templatesConfig,
    },
  };

  let app: VcsUiApp | null = null;
  let runtime: LuxTplRuntime | null = null;
  let queryLayer: VectorLayer | null = null;
  let ownedView: LuxTemplateFeatureInfoView | null = null;
  const listeners: (() => void)[] = [];

  /**
   * Take over feature info for the lux layers.
   *
   * With themesync's `useLuxFeatureInfoTemplates` off, its WMS layers keep a
   * `text/html` `WMSFeatureProvider`, which fabricates a placeholder feature on
   * every click *without issuing a request* — that is how the `featureInfo2d`
   * iframe gets its position. Left in place, each of those placeholders joins
   * this plugin's envelope feature and VC Map opens its cluster list instead of
   * the stacked panel, and clicks into empty space stop clearing the selection.
   *
   * The provider only exists once a layer has been activated (`WMSLayer`
   * creates it in `initialize()`), hence the state listener rather than a
   * one-off sweep.
   */
  function claimLayer(layer: Layer): void {
    if (!isLuxQueryLayer(layer)) {
      return;
    }
    const drop = (): void => {
      if (layer.featureProvider) {
        layer.featureProvider.destroy();
        layer.featureProvider = undefined;
      }
    };
    drop();
    listeners.push(layer.stateChanged.addEventListener(drop));
  }

  return {
    get name(): string {
      return name;
    },
    get version(): string {
      return version;
    },
    get mapVersion(): string {
      return mapVersion;
    },
    get tplRuntime(): LuxTplRuntime | null {
      return runtime;
    },

    /**
     * Registration happens here because plugins are parsed before a module's
     * `featureInfo` items: a module may then reference
     * `LuxTemplateFeatureInfoView` by class name. Plugins also initialize
     * serially in config order, so this plugin has to be listed before
     * themesync, whose layers this one claims.
     */
    async initialize(vcsUiApp: VcsUiApp): Promise<void> {
      app = vcsUiApp;
      getLuxProjection();
      app.featureInfoClassRegistry.registerClass(
        app.dynamicModuleId,
        LuxTemplateFeatureInfoView.className,
        LuxTemplateFeatureInfoView,
      );
      listeners.push(app.layers.added.addEventListener(claimLayer));
      runtime = await createLuxTplRuntime(app, pluginConfig);
    },

    onVcsAppMounted(vcsUiApp: VcsUiApp): void {
      app = vcsUiApp;
      [...app.layers].forEach(claimLayer);

      // A module config may define its own instance; only fall back to a
      // default one when it did not.
      if (!app.featureInfo.hasKey(LUX_FEATURE_INFO_VIEW_NAME)) {
        ownedView = new LuxTemplateFeatureInfoView({
          name: LUX_FEATURE_INFO_VIEW_NAME,
        });
        app.featureInfo.add(ownedView);
      }
      const view = app.featureInfo.getByKey(
        LUX_FEATURE_INFO_VIEW_NAME,
      ) as LuxTemplateFeatureInfoView;

      /*
       * `FeatureProviderInteraction` only asks providers of layers that are
       * *active*, so this one has to be. It renders nothing: the provider gives
       * its features an empty style, and no feature is ever added to the layer
       * itself — it exists solely to host the provider and to give
       * `selectFeature()` the layer it insists a feature must belong to.
       */
      queryLayer = new VectorLayer({
        name: QUERY_LAYER_NAME,
        projection: mercatorProjection.toJSON(),
        allowPicking: false,
      });
      queryLayer.featureProvider = new LuxAggregatedFeatureProvider(
        app,
        pluginConfig,
        view,
      );
      markVolatile(queryLayer);
      app.layers.add(queryLayer);
      queryLayer.activate().catch(() => {
        // an inactive layer is simply never asked for features
      });
    },

    getDefaultOptions,

    toJSON(): PluginConfig {
      return { ...pluginConfig };
    },

    getState(): PluginState {
      return {};
    },

    getConfigEditors(): PluginConfigEditor<object>[] {
      return [];
    },

    destroy(): void {
      listeners.forEach((cb) => {
        cb();
      });
      listeners.length = 0;
      runtime?.destroy();
      runtime = null;
      if (app) {
        if (ownedView) {
          app.featureInfo.remove(ownedView);
          ownedView.destroy();
        }
        app.featureInfoClassRegistry.unregisterClass(
          app.dynamicModuleId,
          LuxTemplateFeatureInfoView.className,
        );
        if (queryLayer) {
          app.layers.remove(queryLayer);
          queryLayer.destroy();
        }
      }
      ownedView = null;
      queryLayer = null;
      app = null;
    },

    i18n,
  };
}

export { I18N_NAMESPACE, LUX_FEATURE_INFO_VIEW_NAME };
export type { PluginConfig, PluginState };
