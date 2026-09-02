import type { Layer } from '@vcmap/core';
import type { FeatureInfoJSON } from '@geoportallux/feature-info-templates';
import { isParcelLayerIdent } from './luxQueryService.js';
import { DEFAULT_TEMPLATE } from './model.js';
import type { PluginConfig } from './model.js';

/**
 * One feature of a geoportail WMS `INFO_FORMAT=application/json` response.
 *
 * Not stock GeoJSON: alongside `geometry` and `properties` the service returns
 * the same `fid`/`id`/`alias` the aggregated `/getfeatureinfo` endpoint does,
 * and `properties` is byte-identical to that endpoint's `attributes`, nested
 * `PF` object and `measurements[]` array included. Geometry is EPSG:2169.
 */
export type LuxWmsFeature = {
  type?: string;
  geometry?: unknown;
  fid?: string;
  id?: string | number;
  alias?: Record<string, unknown>;
  properties?: Record<string, unknown>;
};

type ConfigSubset = Pick<PluginConfig, 'templates' | 'ordered'>;

/**
 * Wrap one WMS feature in the per-layer envelope the shared templates expect.
 *
 * A standard WMS response carries no envelope, so the three fields the
 * aggregated endpoint used to supply are reconstructed here: `template` from the
 * configured mapping, `layerLabel` from the VC Map layer name (which the
 * templates translate through the `layers` i18n namespace), and `ordered` from
 * the plugin config. `has_profile` is always false — this plugin provides no
 * `profileComponent`, so those template sections never render anyway.
 */
export function toFeatureInfoJson(
  raw: LuxWmsFeature,
  layer: Layer,
  config: ConfigSubset,
): FeatureInfoJSON {
  const rawLuxId = layer.properties?.luxId;
  const luxId =
    typeof rawLuxId === 'string' || typeof rawLuxId === 'number'
      ? String(rawLuxId)
      : '';
  const attributes = { ...(raw.properties ?? {}) };

  // The 2D portal annotates parcel features so downstream highlighting can
  // recognise them; the templates read `isParcel` through the same shape.
  const properties =
    isParcelLayerIdent(layer.name) || isParcelLayerIdent(luxId)
      ? {
          // eslint-disable-next-line @typescript-eslint/naming-convention -- key read by the 2D highlight service
          layer_name: 'Parcelle',
          isParcel: true,
        }
      : undefined;

  const feature = {
    type: raw.type ?? 'Feature',
    geometry: raw.geometry,
    fid: raw.fid ?? '',
    id: raw.id != null ? String(raw.id) : '',
    alias: raw.alias ?? {},
    attributes,
    ...(properties && { properties }),
  };

  return {
    template: config.templates[luxId] ?? DEFAULT_TEMPLATE,
    layer: luxId,
    layerLabel: layer.name,
    ordered: config.ordered,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- raw geoportail response shape
    has_profile: false,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- raw geoportail response shape
    remote_template: false,
    features: [feature],
    // eslint-disable-next-line @typescript-eslint/naming-convention -- raw geoportail response shape
    features_count: 1,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- raw geoportail response shape
    total_features_count: 1,
  } as unknown as FeatureInfoJSON;
}
