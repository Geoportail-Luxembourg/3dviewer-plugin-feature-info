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
import LuxProvider, { isLuxQueryLayer, ROW_TITLE } from './provider.js';
import LuxView from './view.js';

type PluginConfig = {
  luxGetInfoUrl: string;
  luxLocalesUrl: string;
  templatesConfig: LuxTplConfig;
};

type AuthPlugin = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  userState?: { user?: { mail?: string; role_id?: number } | null };
};

const GEOPORTAIL = 'https://map.geoportail.lu';

// in code, not config.json: a deployed VC Map never reads the plugin's config.json
function getDefaultOptions(): PluginConfig {
  return {
    luxGetInfoUrl: `${GEOPORTAIL}/getfeatureinfo`,
    luxLocalesUrl: `${GEOPORTAIL}/assets/locales`,
    templatesConfig: {
      casipoUrl: `${GEOPORTAIL}/casipo`,
      forageVirtuelUrl: `${GEOPORTAIL}/getRapportForageVirtuel`,
      pagUrl: `${GEOPORTAIL}/pag`,
      pdsUrl: `${GEOPORTAIL}/pds`,
      shopUrl: 'https://shop.geoportail.lu',
      shopIpv6Url: 'https://shop.app.geoportail.lu',
      busWidgetUrl: `${GEOPORTAIL}/getbuswidget`,
      downloadPdfUrl: `${GEOPORTAIL}/downloadpdf`,
      downloadSketchUrl: `${GEOPORTAIL}/downloadsketch`,
      downloadMeasurementUrl: `${GEOPORTAIL}/downloadmeasurement`,
      thumbnailMeasurementUrl: `${GEOPORTAIL}/thumbnailmeasurement`,
      downloadPagReportUrl: `${GEOPORTAIL}/pagreport`,
      downloadResourceUrl: `${GEOPORTAIL}/downloadresource`,
      downloadPreviewUrl: `${GEOPORTAIL}/previewmeasurement`,
      qrUrl: `${GEOPORTAIL}/qr`,
      v3ApiHost: `${GEOPORTAIL}/`,
      solarEconomicAllowedRoleIds: [1, 1864],
    },
  };
}

// Takes a lux layer over: its own provider (themesync's text/html one) would open the
// featureInfo2d iframe on clicks the aggregated query finds nothing for.
function claimLayer(layer: Layer): void {
  if (isLuxQueryLayer(layer)) {
    layer.featureProvider?.destroy();
    layer.featureProvider = undefined;
    layer.properties.clusterFeatureTitleProperty = ROW_TITLE;
  }
}

export default function plugin(
  config: Partial<PluginConfig>,
): VcsPlugin<Partial<PluginConfig>, Record<never, never>> {
  const defaults = getDefaultOptions();
  const options: PluginConfig = {
    ...defaults,
    ...config,
    templatesConfig: { ...defaults.templatesConfig, ...config.templatesConfig },
  };
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
            const auth = app?.plugins.getByKey(
              '@geoportallux/lux-3dviewer-plugin-auth',
            ) as AuthPlugin | undefined;
            const user = auth?.userState?.user;
            return user ? { mail: user.mail, roleId: user.role_id } : null;
          }),
          notify: (message, type = 'info'): void => {
            app?.notifier.add({ message, type });
          },
          isThemeAvailable: (): boolean => false,
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
        view!,
      );
      vcsUiApp.layers.add(helperLayer);
      helperLayer.activate().catch((e: unknown) => {
        getLogger(name).error(String(e));
      });
    },
    getDefaultOptions,
    toJSON(): Partial<PluginConfig> {
      return { ...config };
    },
    // ponytail: lux layers keep no provider after destroy, the iframe fallback returns on reload
    destroy(): void {
      listeners.splice(0).forEach((remove) => {
        remove();
      });
      if (helperLayer) {
        app?.layers.remove(helperLayer);
        helperLayer.destroy();
      }
      helperLayer = undefined;
      view = undefined;
      app = undefined;
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
