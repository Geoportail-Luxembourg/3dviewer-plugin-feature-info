# v1.0.0

Initial release.

- Feature info via **one aggregated request per click** to the geoportail's own
  `/getfeatureinfo`. A single interaction, registered immediately before VC Map's
  `FeatureProviderInteraction`, asks about every active queryable lux layer at once and
  hands the framework one feature per returned feature; VC Map does the clustering, the
  selection and the window lifecycle.
- The response carries the template per definition, so there is no layer-id to template
  mapping to maintain. This also makes layers with several definitions work — layer 813
  answers with five entries and two distinct templates — and lets role-specific definitions
  arrive for a logged-in user.
- `LuxTemplateFeatureInfoView`, registered in `app.featureInfoClassRegistry`, renders each
  feature with `@geoportallux/feature-info-templates`.
- Clears the `text/html` feature provider themesync configures on those layers, so a click
  that finds nothing closes the panel instead of opening the 2D iframe.
- i18next instance for the templates, fed from the geoportail's deployed locale artifacts
  and kept in sync with the VC Map locale.
- Logged-in user read from `@geoportallux/lux-3dviewer-plugin-auth` when present.

Requires no themesync change — it reads only properties themesync already writes — but must
be listed before themesync in the app config's `plugins` array, so the feature info view
class is registered before themesync's layers are parsed.
