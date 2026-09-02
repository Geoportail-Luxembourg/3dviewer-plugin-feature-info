import type { Layer } from '@vcmap/core';

/**
 * Layer identifiers the 2D geoportail treats as cadastral parcels. Features of
 * such a layer are annotated so the templates and any downstream highlighting
 * can recognize them.
 */
const PARCEL_LAYER_IDENTS = [
  'parcels',
  'parcels_labels',
  'parcels_go',
  'parcels_prof',
  'parcels_labels_go',
  'parcels_labels_prof',
  'cadastre',
];

export function isParcelLayerIdent(value?: string | number | null): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  const candidate = String(value).toLowerCase();
  return PARCEL_LAYER_IDENTS.some((ident) => candidate.includes(ident));
}

/**
 * Whether this is a lux layer the plugin takes feature info over for.
 *
 * `properties.luxQueryable` is written by themesync from
 * `metadata.is_queryable`. Older themesync builds carried that same bit only as
 * the layer's `allowPicking`, so it is the fallback — restricted to 2D layers,
 * because themesync forces `allowPicking` on for 3D tilesets, whose ids the
 * GetFeatureInfo backend does not serve.
 */
export function isLuxQueryLayer(layer: Layer): boolean {
  const { luxId, luxQueryable, is3DLayer } = layer.properties ?? {};
  if (luxId == null || is3DLayer) {
    return false;
  }
  return luxQueryable !== undefined ? !!luxQueryable : layer.allowPicking;
}
