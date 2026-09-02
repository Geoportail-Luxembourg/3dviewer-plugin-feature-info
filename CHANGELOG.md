# v1.0.0

Initial release.

- Aggregated per-position GetFeatureInfo over all visible queryable lux layers, triggered by
  a custom `AbstractFeatureProvider` on a plugin-owned layer, gated on VC Map's feature info
  toolbox toggle.
- `LuxTemplateFeatureInfoView`, registered in `app.featureInfoClassRegistry`, renders the
  response with `@geoportallux/feature-info-templates`.
- i18next instance for the templates, fed from the geoportail's deployed locale artifacts
  and kept in sync with the VC Map locale.
- Logged-in user read from `@geoportallux/lux-3dviewer-plugin-auth` when present.

Requires `@geoportallux/lux-3dviewer-themesync` >= 1.6 for `properties.luxQueryable`, and
must be listed before it in the app config's `plugins` array.
