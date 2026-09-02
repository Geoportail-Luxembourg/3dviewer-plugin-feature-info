import type { PluginConfig } from './model.js';

/**
 * Production defaults, pointing at the deployed geoportail.
 *
 * These live in code rather than in `config.json` on purpose. `config.json` is
 * read by `@vcmap/plugin-cli` during development and merged into the served app
 * config, but a deployed VC Map takes a plugin's config from the app config
 * alone — so code is the only place a default reaches both.
 */
const GEOPORTAIL = 'https://map.geoportail.lu';

export default function getDefaultOptions(): PluginConfig {
  return {
    luxGetInfoUrl: `${GEOPORTAIL}/getfeatureinfo`,
    luxLocalesUrl: `${GEOPORTAIL}/assets/locales`,
    bigBuffer: 10,
    smallBuffer: 1,
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
