import type { VcsPlugin, VcsUiApp, PluginConfigEditor } from '@vcmap/ui';
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
import LuxWmsFeatureProvider from './luxWmsFeatureProvider.js';
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
    templates: {
      ...getDefaultOptions().templates,
      ...config.templates,
    },
  };

  let app: VcsUiApp | null = null;
  let runtime: LuxTplRuntime | null = null;
  let ownedView: LuxTemplateFeatureInfoView | null = null;
  const listeners: (() => void)[] = [];
  const claimed = new Set<Layer>();

  /**
   * Give every queryable lux layer a feature provider that asks for JSON.
   *
   * themesync configures `featureInfo: { responseType: 'text/html' }` on those
   * layers, which produces a provider that fabricates a placeholder feature per
   * click *without any request* — that is how the `featureInfo2d` iframe gets its
   * position. Replacing it with {@link LuxWmsFeatureProvider} is the whole
   * mechanism of this plugin: from there VC Map's own `FeatureProviderInteraction`
   * does the querying and `selectFeature()` the rendering.
   *
   * `WMSLayer.initialize()` builds the configured provider on first activation
   * and overwrites whatever is there, so claiming has to survive that: it runs
   * on every `stateChanged` and re-claims whenever the provider is not ours.
   * `claimed` only records which layers to hand back on destroy.
   */
  function claimLayer(layer: Layer): void {
    if (!app || !isLuxQueryLayer(layer)) {
      return;
    }
    // The `instanceof` check is the only idempotence guard on purpose: a layer
    // has to be re-claimable, because `WMSLayer.initialize()` rebuilds the
    // configured provider on first activation and would otherwise win.
    if (layer.featureProvider instanceof LuxWmsFeatureProvider) {
      return;
    }
    layer.featureProvider?.destroy();
    layer.featureProvider = new LuxWmsFeatureProvider(app, layer, pluginConfig);
    // Cluster rows fall back to `attributes.title`/`name`/the feature id; lux
    // features carry a composed `label`, so without this most rows show an id.
    layer.properties.clusterFeatureTitleProperty = 'label';
    claimed.add(layer);
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
      // default one when it did not. The providers resolve the view by name, so
      // it has to exist before the first click, not before the first layer.
      if (!app.featureInfo.hasKey(LUX_FEATURE_INFO_VIEW_NAME)) {
        ownedView = new LuxTemplateFeatureInfoView({
          name: LUX_FEATURE_INFO_VIEW_NAME,
        });
        app.featureInfo.add(ownedView);
      }

      [...app.layers].forEach(claimLayer);
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
      claimed.forEach((layer) => {
        if (layer.featureProvider instanceof LuxWmsFeatureProvider) {
          layer.featureProvider.destroy();
          layer.featureProvider = undefined;
        }
      });
      claimed.clear();
      if (app) {
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
      app = null;
    },

    i18n,
  };
}

export { I18N_NAMESPACE, LUX_FEATURE_INFO_VIEW_NAME };
export type { PluginConfig, PluginState };
