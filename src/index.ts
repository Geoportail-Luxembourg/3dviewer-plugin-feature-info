import type { VcsPlugin, VcsUiApp, PluginConfigEditor } from '@vcmap/ui';
import { markVolatile, VectorLayer } from '@vcmap/core';
import type { Layer } from '@vcmap/core';
import { getLogger } from '@vcsuite/logger';
import { name, version, mapVersion } from '../package.json';
import {
  I18N_NAMESPACE,
  LUX_FEATURE_INFO_VIEW_NAME,
  ROW_TITLE_PROPERTY,
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
  let ownedView: LuxTemplateFeatureInfoView | null = null;
  let providerLayer: VectorLayer | null = null;
  const listeners: (() => void)[] = [];

  /**
   * Take a lux layer over: this plugin answers for it, nobody else.
   *
   * Two things, both required.
   *
   * The feature provider themesync configures (`featureInfo:
   * { responseType: 'text/html' }`) fabricates a placeholder feature per click
   * *without any request*, which is how the `featureInfo2d` iframe gets its
   * position. `FeatureProviderInteraction` asks it alongside this plugin's
   * aggregated provider, so leaving it in place means every click the aggregated
   * query answers nothing for — a click on a street, say — opens that iframe instead
   * of closing the panel. Clearing it has to be repeated, because
   * `WMSLayer.initialize()` rebuilds the configured provider on first activation
   * and fires no event of its own; `stateChanged` is the hook that covers it.
   *
   * `clusterFeatureTitleProperty` titles the cluster rows. It points at
   * {@link ROW_TITLE_PROPERTY}, a value the interaction derives per feature,
   * because the chain VC Map offers — `attributes[prop]`, `title`, `name`, the
   * feature id — takes a single configured key and lux layers do not agree on one.
   */
  function claimLayer(layer: Layer): void {
    if (!isLuxQueryLayer(layer)) {
      return;
    }
    if (layer.featureProvider) {
      layer.featureProvider.destroy();
      layer.featureProvider = undefined;
    }
    layer.properties.clusterFeatureTitleProperty = ROW_TITLE_PROPERTY;
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
     * themesync, whose layers it takes over.
     */
    async initialize(vcsUiApp: VcsUiApp): Promise<void> {
      app = vcsUiApp;
      getLuxProjection();
      app.featureInfoClassRegistry.registerClass(
        app.dynamicModuleId,
        LuxTemplateFeatureInfoView.className,
        LuxTemplateFeatureInfoView,
      );
      listeners.push(app.layers.stateChanged.addEventListener(claimLayer));
      runtime = await createLuxTplRuntime(app, pluginConfig);
    },

    onVcsAppMounted(vcsUiApp: VcsUiApp): void {
      app = vcsUiApp;

      // A module config may define its own instance; only fall back to a
      // default one when it did not. The provider resolves the view by name,
      // so it has to exist before the first click.
      if (!app.featureInfo.hasKey(LUX_FEATURE_INFO_VIEW_NAME)) {
        ownedView = new LuxTemplateFeatureInfoView({
          name: LUX_FEATURE_INFO_VIEW_NAME,
        });
        app.featureInfo.add(ownedView);
      }

      [...app.layers].forEach(claimLayer);

      // VC Map finds feature providers only through active layers, and this one
      // answers for every lux layer at once, so it gets a layer of its own: empty,
      // always active, supported in every map type. Volatile keeps it out of the
      // app state and share links; it is in no content tree, so it is invisible.
      providerLayer = new VectorLayer({ name: `${name}:provider` });
      markVolatile(providerLayer);
      providerLayer.featureProvider = new LuxAggregatedFeatureProvider(
        app,
        pluginConfig,
      );
      app.layers.add(providerLayer);
      providerLayer.activate().catch((e: unknown) => {
        getLogger(name).error(String(e));
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
        if (providerLayer) {
          app.layers.remove(providerLayer);
          providerLayer.destroy();
        }
        if (ownedView) {
          app.featureInfo.remove(ownedView);
          ownedView.destroy();
        }
        app.featureInfoClassRegistry.unregisterClass(
          app.dynamicModuleId,
          LuxTemplateFeatureInfoView.className,
        );
      }
      ownedView = null;
      providerLayer = null;
      app = null;
    },

    i18n,
  };
}

export { I18N_NAMESPACE, LUX_FEATURE_INFO_VIEW_NAME };
export type { PluginConfig, PluginState };
