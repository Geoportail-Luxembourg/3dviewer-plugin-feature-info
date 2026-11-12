import { computed } from 'vue';
import { createInstance } from 'i18next';
import HttpBackend from 'i18next-http-backend';
import { markVolatile, VectorLayer } from '@vcmap/core';
import type { Layer } from '@vcmap/core';
import type { VcsPlugin, VcsUiApp } from '@vcmap/ui';
import { getLogger } from '@vcsuite/logger';
import {
  createLuxTplI18n,
  createLuxTplI18next,
} from '@geoportallux/feature-info-templates';
import type { LuxTplConfig } from '@geoportallux/feature-info-templates';
import { name, version, mapVersion } from '../package.json';
import LuxProvider, { isLux2dLayer, ROW_TITLE } from './provider.js';
import LuxView from './view.js';

type PluginConfig = {
  credentials: RequestCredentials;
  luxGetInfoUrl: string;
  luxLocalesUrl: string;
  templatesConfig: LuxTplConfig;
};

type AuthPlugin = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  userState?: { user?: { mail?: string; role_id?: number } | null };
};

// Takes every 2D lux layer over: its own provider (themesync's text/html one) would open the
// featureInfo2d iframe, and VC Map asks it even when the layer isn't queryable (allowPicking).
function claimLayer(layer: Layer): void {
  if (isLux2dLayer(layer)) {
    layer.featureProvider?.destroy();
    layer.featureProvider = undefined;
    layer.properties.clusterFeatureTitleProperty = ROW_TITLE;
  }
}

export default function plugin(
  options: PluginConfig,
): VcsPlugin<PluginConfig, Record<never, never>> {
  const listeners: (() => void)[] = [];
  let view: LuxView | undefined;
  let helperLayer: VectorLayer | undefined;
  let app: VcsUiApp | undefined;

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
    async initialize(vcsUiApp: VcsUiApp): Promise<void> {
      app = vcsUiApp;
      // WMSLayer.initialize() rebuilds the configured provider on activation
      listeners.push(app.layers.stateChanged.addEventListener(claimLayer));

      const i18next = createInstance().use(HttpBackend);
      listeners.push(
        app.localeChanged.addEventListener((locale) => {
          i18next.changeLanguage(locale).catch(() => {});
        }),
      );
      view = new LuxView({
        context: {
          config: options.templatesConfig,
          user: computed(() => {
            const auth = vcsUiApp.plugins.getByKey(
              '@geoportallux/lux-3dviewer-plugin-auth',
            ) as AuthPlugin | undefined;
            const user = auth?.userState?.user;
            return user ? { mail: user.mail, roleId: user.role_id } : null;
          }),
          notify: (message, type = 'info'): void => {
            vcsUiApp.notifier.add({ message, type });
          },
        },
        i18n: createLuxTplI18n(i18next),
      });
      // without translations the templates render their keys
      await createLuxTplI18next(
        i18next,
        `${options.luxLocalesUrl}/{{ns}}.{{lng}}.json`,
        { lng: app.locale },
      ).catch((e: unknown) => {
        getLogger(name).error(String(e));
      });
    },
    onVcsAppMounted(vcsUiApp: VcsUiApp): void {
      [...vcsUiApp.layers].forEach(claimLayer);
      // VC Map finds providers only on active layers, so this one gets an empty,
      // always-active layer of its own, kept out of app state by markVolatile
      helperLayer = new VectorLayer({ name: `${name}:provider` });
      markVolatile(helperLayer);
      helperLayer.featureProvider = new LuxProvider(
        vcsUiApp,
        options.luxGetInfoUrl,
        options.credentials,
        view!,
      );
      vcsUiApp.layers.add(helperLayer);
      helperLayer.activate().catch((e: unknown) => {
        getLogger(name).error(String(e));
      });
    },
    toJSON(): PluginConfig {
      return { ...options };
    },
    // Lux layers get no provider back on destroy; the iframe fallback returns on reload.
    destroy(): void {
      listeners.splice(0).forEach((remove) => {
        remove();
      });
      if (helperLayer) {
        app?.layers.remove(helperLayer);
        helperLayer.destroy();
      }
    },
    i18n: {
      en: {
        lux3dviewerPluginFeatureInfo: {
          title: 'Information',
          queryFailed: 'Could not retrieve feature information.',
        },
      },
      fr: {
        lux3dviewerPluginFeatureInfo: {
          title: 'Informations',
          queryFailed: 'Impossible de récupérer les informations.',
        },
      },
      de: {
        lux3dviewerPluginFeatureInfo: {
          title: 'Informationen',
          queryFailed: 'Informationen konnten nicht abgerufen werden.',
        },
      },
      lb: {
        lux3dviewerPluginFeatureInfo: {
          title: 'Informatiounen',
          queryFailed: 'Informatioune konnten net ofgeruff ginn.',
        },
      },
    },
  };
}
