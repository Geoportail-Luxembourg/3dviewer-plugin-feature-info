import { computed } from 'vue';
import { createInstance } from 'i18next';
import type { i18n as I18n } from 'i18next';
import HttpBackend from 'i18next-http-backend';
import { getLogger } from '@vcsuite/logger';
import { NotificationType } from '@vcmap/ui';
import type { VcsUiApp } from '@vcmap/ui';
import {
  createLuxTplI18n,
  createLuxTplI18next,
} from '@geoportallux/feature-info-templates';
import type {
  LuxTplContext,
  LuxTplI18n,
  LuxTplNotifyType,
} from '@geoportallux/feature-info-templates';
import { AUTH_PLUGIN_NAME } from './model.js';
import type { LuxAuthPluginLike, PluginConfig } from './model.js';

const NOTIFY_TYPE_MAP: Record<LuxTplNotifyType, NotificationType> = {
  info: NotificationType.INFO,
  warning: NotificationType.WARNING,
  error: NotificationType.ERROR,
};

/**
 * Everything the feature info templates need from their host, created once per
 * plugin instance and provided by the window wrapper component.
 */
export type LuxTplRuntime = {
  context: LuxTplContext;
  i18n: LuxTplI18n;
  i18next: I18n;
  destroy: () => void;
};

/**
 * Build the templates' dependency-injection context.
 *
 * `user` resolves the auth plugin lazily so login state stays reactive through
 * its `userState` and an absent auth plugin simply means anonymous. There is no
 * elevation profile in 3D yet (`profileComponent` unset, `has_profile` sections
 * stay hidden) and no theme catalogue to check against (`isThemeAvailable`).
 */
function createContext(app: VcsUiApp, config: PluginConfig): LuxTplContext {
  return {
    config: config.templatesConfig,
    user: computed(() => {
      const auth = app.plugins.getByKey(AUTH_PLUGIN_NAME) as
        LuxAuthPluginLike | undefined;
      const user = auth?.userState?.user;
      return user ? { mail: user.mail, roleId: user.role_id } : null;
    }),
    notify: (message, type = 'info'): void => {
      app.notifier.add({ message, type: NOTIFY_TYPE_MAP[type] });
    },
    isThemeAvailable: () => false,
  };
}

/**
 * Initialise i18next for the templates and wire it to the VC Map locale.
 *
 * A dedicated instance rather than the i18next singleton: the plugin shares its
 * Vue app with VC Map and every other plugin, and the templates read their
 * instance through the injected {@link LuxTplI18n}, so there is nothing to gain
 * from a global. Translations are the geoportail's deployed Transifex
 * artifacts, which means this needs CORS on `luxLocalesUrl`; a failure to load
 * them leaves keys untranslated rather than breaking the plugin.
 */
export async function createLuxTplRuntime(
  app: VcsUiApp,
  config: PluginConfig,
): Promise<LuxTplRuntime> {
  const instance = createInstance().use(HttpBackend);
  try {
    await createLuxTplI18next(
      instance,
      `${config.luxLocalesUrl.replace(/\/$/, '')}/{{ns}}.{{lng}}.json`,
      { lng: app.locale },
    );
  } catch (e) {
    // VC Map does not await `initialize`, so a rejection here would surface as
    // an unhandled rejection and cost us the interaction registration. Losing
    // the translations is survivable: the templates then render their keys.
    getLogger('luxFeatureInfo').error(
      'failed to initialise the feature info templates i18n',
      e,
    );
  }

  const localeListener = app.localeChanged.addEventListener((locale) => {
    instance.changeLanguage(locale).catch(() => {
      // a missing language falls back to `fallbackLng`, nothing to recover
    });
  });

  return {
    context: createContext(app, config),
    i18n: createLuxTplI18n(instance),
    i18next: instance,
    destroy(): void {
      localeListener();
    },
  };
}
