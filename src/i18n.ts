/**
 * VC Map (vue-i18n) strings of the plugin's own chrome. Everything inside the
 * feature info panel is translated by the templates through their own i18next
 * instance, against the geoportail's `layers`/`tooltips`/`app` namespaces.
 *
 * The namespace has to be the camel-cased, unscoped package name — the plugin
 * interface spec test asserts it.
 */
export default {
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
};
