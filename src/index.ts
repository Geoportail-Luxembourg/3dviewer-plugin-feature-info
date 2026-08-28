import type { VcsPlugin, VcsUiApp, PluginConfigEditor } from '@vcmap/ui';
import type { VectorLayer } from '@vcmap/core';
import type { FeatureInfoJSON } from '@geoportallux/feature-info-templates';
import { name, version, mapVersion } from '../package.json';
import {
  I18N_NAMESPACE,
  LUX_FEATURE_INFO_VIEW_NAME,
  type PluginConfig,
  type PluginState,
} from './model.js';
import getDefaultOptions from './defaultOptions.js';
import { getLuxProjection } from './luxProjection.js';
import LuxTemplateFeatureInfoView from './luxTemplateFeatureInfoView.js';
import LuxFeatureInfoInteraction, {
  createAnchorLayer,
} from './luxFeatureInfoInteraction.js';
import { createLuxTplRuntime } from './luxTplRuntime.js';
import type { LuxTplRuntime } from './luxTplRuntime.js';
import { queryLuxFeatureInfoByFid } from './luxQueryService.js';
import i18n from './i18n.js';

export type LuxFeatureInfoPlugin = VcsPlugin<PluginConfig, PluginState> & {
  /** Context and i18n the window component provides to the templates. */
  readonly tplRuntime: LuxTplRuntime | null;
  /** Run the `fid` query behind a permalink shared with the 2D portal. */
  queryByFid(fid: string): Promise<FeatureInfoJSON[]>;
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
  let anchorLayer: VectorLayer | null = null;
  let removeInteraction: (() => number) | null = null;
  let ownedView: LuxTemplateFeatureInfoView | null = null;

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

    async queryByFid(fid: string): Promise<FeatureInfoJSON[]> {
      if (!app) {
        return [];
      }
      return queryLuxFeatureInfoByFid(app, pluginConfig, fid);
    },

    /**
     * Registration happens here because plugins are parsed before a module's
     * `featureInfo` items: a module may then reference
     * `LuxTemplateFeatureInfoView` by class name. Plugins also initialize
     * serially in config order, so this plugin has to be listed before
     * themesync, whose layers carry the `featureInfo` property pointing at the
     * view.
     */
    async initialize(vcsUiApp: VcsUiApp): Promise<void> {
      app = vcsUiApp;
      getLuxProjection();
      app.featureInfoClassRegistry.registerClass(
        app.dynamicModuleId,
        LuxTemplateFeatureInfoView.className,
        LuxTemplateFeatureInfoView,
      );
      runtime = await createLuxTplRuntime(app, pluginConfig);
    },

    onVcsAppMounted(vcsUiApp: VcsUiApp): void {
      app = vcsUiApp;
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
      anchorLayer = createAnchorLayer(app);
      removeInteraction = app.maps.eventHandler.addPersistentInteraction(
        new LuxFeatureInfoInteraction(app, view, anchorLayer, pluginConfig),
      );
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
      removeInteraction?.();
      removeInteraction = null;
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
        if (anchorLayer) {
          app.layers.remove(anchorLayer);
          anchorLayer.destroy();
        }
      }
      ownedView = null;
      anchorLayer = null;
      app = null;
    },

    i18n,
  };
}

export { I18N_NAMESPACE, LUX_FEATURE_INFO_VIEW_NAME };
export type { PluginConfig, PluginState };
