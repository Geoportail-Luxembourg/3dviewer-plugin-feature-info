# The feature info trigger — five designs, and why this one

**Status: implemented.** This is the working record of how the plugin arrived at standard
per-layer WMS GetFeatureInfo, kept here so the reasoning travels with the code. The
canonical plan is `luxembourg-geoportail/docs/plan-3dviewer-featureinfo-plugin.md`; prefer
changing that and re-aligning this.

Two designs preceded it, both replaced:

1. **A custom persistent interaction** doing one aggregated call to the geoportail's
   `/getfeatureinfo`. Justified by a claim that turned out false — that VC Map's built-in
   flow "cannot express query all visible layers at a position, including empty-space
   clicks". `FeatureProviderInteraction` does exactly that.
2. **One aggregating `AbstractFeatureProvider`** on a plugin-owned layer, still calling the
   custom endpoint, returning a single envelope feature to keep the 2D stacked panel.

The move to candidate C traded the stacked panel for VC Map's cluster list and the
aggregated call for N standard ones, in exchange for the plugin no longer speaking the
custom endpoint's protocol at all.

> **Superseded by design 4, then design 5 (October 2026).** Everything below describes the
> per-layer WMS design and still explains why designs 1 and 2 were left. The route it argues
> _for_ was itself replaced; see "Design 4" and "Design 5" at the end of this file for what
> changed and why. Design 5 is what is implemented: design 2's provider mechanism with
> design 4's output.

## Context

The plugin currently makes one aggregated call to the geoportail's custom
`/getfeatureinfo` and renders every hit layer in one stacked panel. Candidate C replaces
that with **VC Map's own `WMSFeatureProvider` on each lux layer**, using
`responseType: 'application/json'`, so the plugin contains no query code at all. It was
rejected earlier over the two problems below; both are now accepted or solved:

- **Which template renders a layer** is server-side only (`lux_getfeature_definition.template`,
  keyed by numeric layer id, absent from the themes API). → A `templates` map in the plugin
  config, `default.html` for anything unmapped.
- **Several layers hitting at once** yields VC Map's cluster list rather than the stacked
  panel. → Accepted.

Measured facts this rests on (all against the live service):

- The geoportail's WMS answers `INFO_FORMAT=application/json` with a **lux-enriched**
  payload, not a stock one: each feature carries `fid` in the composite
  `<layerId>_<featureId>` form (with the backend's layer remap applied — 262 →
  `359_075F00503002288`), `id`, `alias`, and `properties` byte-identical to the aggregated
  endpoint's `attributes`, nested `PF` and `measurements[]` included. Geometry is EPSG:2169
  regardless of `SRS`. 709 of 732 queryable lux layers are advertised queryable.
- **Hit tolerance is ≈3 px × resolution.** For a real address point: at 0.5 m/px only an
  exact hit registers; at 1 m/px within 2 m; at 2 m/px within 5 m; at 5 m/px within 15 m.
  In a 3D camera view `getCurrentResolution()` goes sub-metre, which would make point
  layers unclickable — so the resolution passed to the provider must be clamped.
  `TileWMS.getFeatureInfoUrl()` turns resolution into a tile-grid level and sends that
  tile's extent as `BBOX` with `WIDTH`/`HEIGHT` = tile size, so a coarser resolution means
  bigger pixels and a wider tolerance. That is the only lever available.
- **Coverage, measured.** Of 732 queryable lux layers, 250 had data at one test point per
  the aggregated endpoint. Via WMS `application/json` at 2 m/px: **215 (86%) returned
  features, 30 returned empty, 5 returned HTTP 500**. Re-probing the 30 at coarser
  resolutions recovered **all 17 distinct ones**, so they were tolerance artifacts, not
  capability gaps — which makes the clamp below the single most important knob in this
  change. The genuine gap is **5 of 250 (2%)**: 1969/1970/2054 (`automatic_sols.html`,
  12 features each), 1531, and 504 — whose `template` is a URL
  (`getpoitemplate?layer=504`), i.e. `remote_template: true`, which the templates package
  does not support at any transport. Decision: **accept the loss** —
  `WMSFeatureProvider` swallows the error and those layers show nothing.

## Approach

Everything lives in the plugin. **No themesync change, no backend change**, so
`vcmplugin preview --vcm https://3d-staging.geoportail.lu/` keeps working unchanged.

The plugin already walks the lux layers to clear their feature providers
(`claimLayer()` in `src/index.ts`). That becomes _replacing_ them.

### `src/luxWmsFeatureProvider.ts` (new)

`extends WMSFeatureProvider`, constructed from the layer's public fields — the same nine
`WMSLayer._setFeatureProvider()` reads (`url`, `parameters`, `tilingSchema`, `version`,
`tileSize`, `minLevel`, `maxLevel`, `extent`, `headers`) — plus
`responseType: 'application/json'`, `projection` = EPSG:2169 with the full proj4 string
from `src/luxProjection.ts`, and `FEATURE_COUNT` added to `parameters` (never set
automatically; servers default to one feature).

Two overrides:

- `getFeaturesByCoordinate(coordinate, resolution, layer)` — return `[]` unless the
  `featureInfo` toolbox toggle is active and `layer.opacity > 0`, then delegate to `super`
  with `Math.max(resolution, minResolution)`. The gate is not optional:
  `FeatureProviderInteraction` sits in VC Map's immutable base chain and nothing in core or
  ui ever deactivates it, so providers are asked on every click — panning, drawing, tool
  off — and each one is now a real HTTP request.
- `featureResponseCallback(data, coordinate)` — `ol`'s GeoJSON reader keeps only
  `id`/`geometry`/`properties`, dropping `fid` and `alias`, and reprojects the geometry to
  mercator. So parse `data` once, let `super` build the features, then pair them up and
  stash the **raw** JSON feature on each under a symbol. That keeps `fid` exact (rebuilding
  it as `${luxId}_${id}` would be wrong for remapped layers), keeps the 2169 geometry the
  templates expect, and keeps `properties` free of the `olcs_*` keys
  `getProviderFeature()` adds. Also `setId(fid)` for a globally unique feature id
  (`id` alone is only unique per layer, and it keys the scratch layer and the cluster rows),
  and tag `featureInfoViewSymbol` so the lux view is selected without depending on
  `properties.featureInfo`.

Then build the single-entry `FeatureInfoJSON` and stash it under the existing
`luxContentSymbol`, so `LuxTemplateFeatureInfoView` needs almost no change.

### `src/luxFeatureInfoJson.ts` (new, ~40 lines)

`toFeatureInfoJson(rawJsonFeature, layer, config)`:

| field         | value                                                                     |
| ------------- | ------------------------------------------------------------------------- |
| `template`    | `config.templates[String(luxId)] ?? 'default.html'`                       |
| `layer`       | `String(layer.properties.luxId)`                                          |
| `layerLabel`  | `layer.name` — the templates translate it via the `layers` namespace      |
| `ordered`     | `config.ordered` (default `true`, i.e. keep the server's attribute order) |
| `has_profile` | `false` — no `profileComponent` in 3D                                     |
| `features`    | `[{ type, geometry, fid, id, alias, attributes: raw.properties }]`        |

Plus the parcel annotation (`layer_name`/`isParcel`) lifted out of
`postProcessResponse()`, reusing `isParcelLayerIdent()`.

### `src/index.ts`

`claimLayer()` replaces rather than clears, idempotently (skip if the provider already is a
`LuxWmsFeatureProvider`). It must run **after** `WMSLayer.initialize()`, which builds the
config provider and would overwrite an earlier assignment — so hook
`app.layers.stateChanged` (fires around activation) plus a sweep in `onVcsAppMounted`.
Also set `layer.properties.clusterFeatureTitleProperty = 'label'`: cluster rows fall back
`attributes[titleProp] || attributes.title || attributes.name || feature.getId()`, and lux
features carry `label`, so without this most rows show a raw id.

Delete the plugin-owned `VectorLayer` and `LuxAggregatedFeatureProvider`.

### Template map

`PluginConfig.templates: Record<string, string>`, keyed by numeric lux layer id, merged
over a generated default in `src/luxTemplates.ts` (imported by `src/defaultOptions.ts` —
defaults must live in code, since a deployed VC Map never reads the plugin's shipped
`config.json`).

Seed it with `scripts/harvest-templates.mjs`: probe the aggregated endpoint over a grid of
points across Luxembourg with a wide `box1`, collect `layer → template` from the responses,
emit the module. Committed output plus the script, so it can be re-run. The authoritative
list is one `SELECT layer, template FROM lux_getfeature_definition` away whenever someone
with admin-DB access can run it — worth asking for, because the harvest only sees layers
that have data at a probed point.

### Config changes

Added: `templates`, `minResolution` (default **`3`** → ≈9 m tolerance, matching the
aggregated endpoint's ±10 m `box1`; at 2 m/px 12% of layers-with-data missed), `ordered`
(default `true`).
Removed: `luxGetInfoUrl`, `bigBuffer`, `smallBuffer` (no aggregated call left) and
`credentials` (the WMS request's credentials come from Cesium's `TrustedServers`, which
themesync already registers for the proxy URL — the option no longer controls anything).

### Deletions

- `src/luxAggregatedFeatureProvider.ts`
- most of `src/luxQueryService.ts` — keep only `isLuxQueryLayer()` and
  `isParcelLayerIdent()`; drop `buildPositionParams`, `requestLuxFeatureInfo`,
  `postProcessResponse`, `queryLuxFeatureInfoAtPosition`, `queryLuxFeatureInfoByFid`,
  `buildFidParams`, `resolutionToZoom`, `collectQueryableLayers`
- `tests/luxQueryResponse.spec.ts` and `tests/fixtures/getfeatureinfo-*.json`, plus the
  parts of `tests/luxQueryService.spec.ts` that pin the aggregated request

Net: roughly −350 lines of the ~1014 now in `src/`, and the plugin stops speaking the
custom endpoint's protocol entirely.

## Accepted losses

Consequences of the decisions above, all deliberate:

- Layers whose WMS GetFeatureInfo 500s show nothing — 5 of 250 layers-with-data (2%), plus
  147 and 1813 found by spot check. One of them (504) uses a remote template the templates
  package cannot render anyway.
- `template` cannot be role-dependent, but the backend's lookup is
  (`LuxGetfeatureDefinition.role == user.role` with a role-less fallback), so a
  role-specific template variant will render as the default one.
- Hit tolerance becomes pixel-based (≈3 px × clamped resolution) instead of the ±10 m /
  ±1 m two-box filter, so which features a click catches will differ from the 2D portal.
- N requests per click instead of one.
- The `?fid=` by-id query has no WMS equivalent, so `fid` deep links would need the custom
  endpoint back.
- `WMSLayer.reload()` / `setLayers()` destroy `layer.featureProvider` and rebuild from the
  layer config with no event to hook, so a themesync reload reverts the plugin's provider.
  Not handled.

## What deviated from the plan

- **The `claimed` set must not gate re-claiming.** `WMSLayer.initialize()` rebuilds the
  configured provider on first activation and overwrites ours; an "already claimed" early
  return meant `stateChanged` never put it back, so every layer silently kept its
  `text/html` provider and the 2D iframe opened. The `instanceof` check is the only
  idempotence guard now.
- **Provided features need an empty `Style`.** Returning the real geometries — which the
  plan wanted, since highlighting then comes almost free — makes the clone `selectFeature()`
  puts on its scratch layer pickable, and `FeatureProviderInteraction` skips every provider
  once something was picked. Measured: a second click inside a selected commune issued no
  request at all. Highlighting is back to being a Phase 7 item needing its own layer.
- **32 layers answer with a remote-template URL** (`getpoitemplate?layer=…`,
  `remote_template: true`) which the templates package cannot render, so the harvest filters
  them out and they fall back to the default template. The seed covers **622** of 732
  layers; 655 answered at all.
- **`featureCount` became a config option** (default 50, matching the backend's own OGC
  path) rather than a constant.
- **The 3D tileset veto is broader than described.** `FeatureProviderInteraction` runs only
  when nothing was picked, so wherever a tileset is active and hit — LOD2 buildings are on
  by default — _no_ 2D lux layer is queried, not merely "3D building clicks don't reach the
  templates". Same in the two earlier designs, but structural here. This is what made the
  point-layer test read as a clamp failure until the tilesets were switched off.

## Verification

1. `npm run lint`, `npm run type-check`, `npx vitest run`, `npm run build`.
2. New unit tests: `toFeatureInfoJson()` against a **captured WMS `application/json`
   fixture** — capture three during step 3 (cadastre with `PF` + `measurements`, an address
   point, a multi-feature layer). Assert `template` resolution incl. the `default.html`
   fallback, `attributes` from `properties`, exact `fid` for a remapped layer, and the
   parcel annotation. Keep the `isLuxQueryLayer` tests.
3. `npm run preview -- --vcm https://3d-staging.geoportail.lu/` with a CORS-bypass
   extension (the geoportail answers `localhost` with `Access-Control-Allow-Origin: *` and
   `Access-Control-Allow-Credentials: true`, which browsers reject; themesync's own
   `/themes` call fails the same way). Restart preview after each edit — `--watch` rebuilds
   `dist/` but the dev server keeps serving the previous transform.
4. Behavioural checks over CDP, each of which has broken at some point in this work:
   - **one** queryable layer active → its lux template renders directly, no cluster;
   - **several** active → cluster list grouped by layer, rows titled from `label` not raw
     ids, selecting a row renders that layer's template;
   - request count per click equals the number of active queryable layers, and is **zero**
     with the feature info tool toggled off;
   - a **point** layer (152 addresses) is still clickable when zoomed in close — this is
     the `minResolution` clamp; without it the tolerance collapses to centimetres;
   - `parcels` renders `PF` and the measurements table, i.e. nested attributes survive;
   - attribute values render, not just labels (sanitized by the package itself);
   - a click into empty space closes the panel.
5. Confirm nothing is needed from themesync: the run above is against a deployment whose
   themesync writes `featureInfo: { responseType: 'text/html' }` and
   `properties.featureInfo: 'featureInfo2d'`, i.e. the unmodified one.

## Follow-ups, not in this change

- Get the authoritative template mapping by SQL and replace the harvested seed.
- Phase 7: highlighting (now free — the provider returns real geometries, and
  `selectFeature()` clones provided features onto its scratch layer and highlights them),
  3D building clicks, `fid` deep links, elevation profile.
- `docs/plan-3dviewer-featureinfo-plugin.md` and `PLAN.md` both describe the aggregated
  provider and will need rewriting once this lands.

## Design 4 — back to the aggregated endpoint

The per-layer WMS design was correct about the mechanics and wrong about the endpoint. What
settled it was reading the backend rather than measuring the symptoms.

**`/getfeatureinfo` is a dispatcher.** For each layer, `get_info()` reads
`lux_getfeature_definition` and takes one of three branches
(`geoportailv3/geoportal/geoportailv3_geoportal/views/getfeatureinfo.py`):

| branch | condition      | what it does                                                                 |
| ------ | -------------- | ---------------------------------------------------------------------------- |
| REST   | `rest_url` set | queries an ArcGIS REST service                                               |
| SQL    | `query` set    | runs the definition's SQL against the geodata DB                             |
| WMS    | neither        | `_ogc_getfeatureinfo()` — relays a standard WMS GetFeatureInfo _server-side_ |

That third branch sends exactly what design 3 sent: `VERSION=1.1.1`, `STYLES=''`,
`INFO_FORMAT=application/json`, `FEATURE_COUNT=50`, `SRS` defaulting to EPSG:2169, with the
caller's `X/Y/WIDTH/HEIGHT/BBOX` passed through. So design 3 was not an approximation of the
aggregated endpoint — it was one of its three branches, reimplemented client-side, and blind
to the other two. The "~2% of layers 500 on a hit" finding and
`docs/wms-getfeatureinfo-gaps.md` were measuring exactly that blindness.

Where the WMS branch does apply, design 3 was faithful: of 60 layers with data, **58 had
identical attribute key sets** on both paths.

**Two things design 3 could not represent at all:**

1. **Multiple definitions per layer.** `get_lux_feature_definition()` collects with `.all()`
   and `get_info()` appends one result per row, so `layers=813` returns five entries with
   two distinct templates, two of them carrying features. `src/luxTemplates.ts` was 1:1 by
   construction and held `bus_wo_title.html` for 813, while the entries with data wanted
   `default_table.html`. Widening it to `Record<string, string[]>` does not help: the split
   is defined by each definition's own SQL, so nothing client-side can assign features to
   definitions. Measured across 618 layers enumerated anonymously: 38 return more than one
   entry, 2 (813, 817) more than one distinct template.
2. **Role-dependent definitions**, which replace the anonymous rows wholesale — template,
   query and attribute handling together.

**The UI did not have to change.** VC Map's cluster list groups purely on
`feature[vcsLayerName]`, a plain string the plugin sets, and
`FeatureProviderInteraction.pipe()` skips its entire fan-out when `event.feature` is already
set. So an interaction at chain index 3 can make one request and build the result itself,
and the stock list renders it unchanged.

**The shape that makes multi-definition layers free:** one VC Map feature per _response
feature_, each carrying its own entry (`splitResponse` + `toSingleFeatureContent`). Rows are
per feature already, so each renders with the template of the definition that produced it.
There is no branch for the multi-definition case.

Latency, measured for 1/3/10/30 layers: one aggregated request takes 438/508/1070/2093 ms
against 645 ms/93 s/768/3135 ms for N parallel WMS calls — comparable at small N, better at
30, and without the tail-latency exposure of needing all N to resolve.

### What deviated from design 4 as planned

- **`luxFeatureInfoJson.ts` was deleted rather than shrunk.** The restored
  `postProcessResponse()` already annotates entries; the per-feature envelope is a two-line
  spread in the interaction.
- **Clearing the layers' feature providers turned out to be required**, which the plan did
  not anticipate. Without it, every click the query answers nothing for falls through to
  themesync's `text/html` provider and opens the 2D iframe instead of closing the panel.
- **Features need an explicit id.** Not every layer returns a `fid` (813 returns `null`), and
  bypassing `getProviderFeature()` loses its uuid fallback, leaving cluster rows titled
  `undefined`.
- **The box semantics are not coarse/fine.** `box1` is intersected against ring-less
  geometries (points, lines) and `box2` against polygons. The 2D portal scales both with map
  resolution (`20 *`, `1 *`); fixed metres are used here because a tilted 3D camera reports
  sub-metre resolutions from hundreds of metres up.
- **A clone-exemption was written and then removed.** A second click inside a selected
  geometry appeared to issue no request, which looked like the scratch-layer clone being
  re-picked. It was a flaw in the CDP harness (a synthetic click needs a preceding
  `mouseMoved`). Measured afterwards: the clone is never picked, the empty style is enough,
  and the exemption was dead code.

## Design 5 — the aggregating provider, returning one feature per response feature

Design 4 put its trigger in a persistent interaction inserted at **index 3** of the event
handler's chain, just before `FeatureProviderInteraction`. It worked, but it was off the
framework's path in three ways:

- the index depends on core's internal four-entry chain (`EventHandler` constructor) and
  has no public way to be looked up — the chain is a private `_interactionChain`. Even
  core's own docs disagree with the code about the default (`[index=3]` documented, `4`
  implemented);
- `addPersistentInteraction()` is documented for "non-interfering interactions", and this
  one interferes by design: it sets `event.feature` so `FeatureProviderInteraction` skips
  its fan-out. Nothing in `@vcmap/core`, `@vcmap/ui` or the showcase plugins passes an
  index at all;
- setting `event.feature` first also discarded every **other** layer's provider results
  whenever lux returned anything.

**Why design 2 was not a dead end.** It was left for its output — one envelope feature, to
keep the 2D stacked panel — not for its mechanism. Nothing ties a provided feature to the
layer whose provider returned it: the cluster grouping, the window title and
`selectFeature()` read only `feature[vcsLayerName]`, a plain string. So one provider can
return design 4's features, each naming its own lux layer, and the stock cluster list
renders them exactly as before.

**The helper layer.** `FeatureProviderInteraction` finds providers only through
`event.map.layerCollection`, filtered to active, supported layers with a provider. There is
no registry. The provider therefore needs a layer that is always active and independent of
which lux layers are on:

- on one lux layer it would come and go with that layer, and `WMSLayer.initialize()`
  overwrites providers;
- on every lux layer it would need per-click request coalescing to stay at one request;
- on a base map it would couple to the deployment's config.

So the plugin adds an empty `VectorLayer` (supported in Cesium, Oblique, OL and panorama;
renders nothing), marked volatile so `app.getState()` and share links skip it, and in no
content tree. VC Map's own feature info does the same for its highlight scratch layer.
Themesync's `reloadThemes()` removes only its own module, so the helper layer survives it.

**What moved, what did not.** The class became `LuxAggregatedFeatureProvider`
(`git mv` from the interaction); `splitResponse`, `deriveRowTitle`,
`toSingleFeatureContent`, the empty `Style`, the id fallback and the toolbox gate are
unchanged — `FeatureProviderInteraction` is never gated, so the provider gates itself just
as the interaction did. `getProviderFeature()` is still not used: it would stamp the helper
layer's name over each feature's `vcsLayerName`. Clearing the lux layers' own providers is
still required, for the same reason as in design 4. The request is unchanged: one
aggregated `/getfeatureinfo` per click.

**Unchanged limitation.** A 3D tileset click still vetoes the 2D query —
`FeatureProviderInteraction` also does nothing once `event.feature` is set — so it is now a
constraint again rather than a choice, as it was in design 2.

### Verified

Same harness as design 4 (CDP, `https://3d-staging.geoportail.lu`, layers 813, 262 and 152
active): one request per click; the cluster list grouped by layer with both 813 definitions
as rows, the second rendering `default_table.html`; a single parcel opening `parcels.html`
directly with the `359_…` fid; a second click inside the selected parcel querying again; an
empty click closing everything with no `featureInfo2d` iframe; zero requests with the tool
off; the helper layer supported in Cesium and Oblique, and an Oblique click returning the
clicked parcel.

Two observations, neither caused by this change:

- **The highlight did not show** in headless SwiftShader screenshots, although the feature
  is on VC Map's scratch layer and registered as highlighted. Design 4 run side by side
  behaved identically. Needs a look in a real browser.
- **In the Oblique map the lux WMS layers report `isSupported() === false`** and are not
  drawn, yet they are queried and answer, because `collectQueryableLayers()` checks only
  `active`. Both designs do this.
