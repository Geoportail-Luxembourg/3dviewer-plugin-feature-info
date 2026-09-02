# v1.0.0

Initial release.

- Feature info via standard per-layer WMS GetFeatureInfo (`INFO_FORMAT=application/json`),
  which the geoportail answers with its enriched payload. The plugin replaces the feature
  provider on each queryable lux layer with a thin `WMSFeatureProvider` subclass and
  supplies the per-layer envelope the templates need; VC Map does the querying, the
  clustering and the window lifecycle.
- A generated layer id to template mapping (`src/luxTemplates.ts`, 622 layers), since that
  association exists only in the backend's `lux_getfeature_definition` table. Regenerate
  with `npm run harvest-templates`.
- `LuxTemplateFeatureInfoView`, registered in `app.featureInfoClassRegistry`, renders the
  response with `@geoportallux/feature-info-templates`.
- i18next instance for the templates, fed from the geoportail's deployed locale artifacts
  and kept in sync with the VC Map locale.
- Logged-in user read from `@geoportallux/lux-3dviewer-plugin-auth` when present.

Requires `@geoportallux/lux-3dviewer-themesync` >= 1.6 for `properties.luxQueryable`, and
must be listed before it in the app config's `plugins` array.
