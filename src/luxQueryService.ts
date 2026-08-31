import { mercatorProjection, Projection } from '@vcmap/core';
import type { Layer } from '@vcmap/core';
import type { VcsUiApp } from '@vcmap/ui';
import type { Coordinate } from 'ol/coordinate.js';
import type {
  FeatureInfoJSON,
  FeatureJSON,
} from '@geoportallux/feature-info-templates';
import { getLuxProjection } from './luxProjection.js';
import type { PluginConfig } from './model.js';

/** Resolution of web mercator zoom level 0, i.e. `2 * pi * a / 256`. */
const ZOOM_0_RESOLUTION = 156543.03392804097;

/** Highest zoom level the geoportail backend is queried with. */
const MAX_ZOOM = 22;

/**
 * Fallback viewport size in pixels, used when the map element has not been laid
 * out yet. Only feeds the synthetic `WIDTH`/`HEIGHT`/`BBOX` parameters.
 */
const FALLBACK_MAP_SIZE: [number, number] = [512, 512];

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

/** A visible, queryable lux layer, reduced to what the query needs. */
export type LuxQueryLayer = {
  /** `properties.luxId`, the id the backend knows the layer under. */
  luxId: string;
  /** VC Map layer name, used as the `layers` i18n key by the templates. */
  label: string;
};

export function isParcelLayerIdent(value?: string | number | null): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  const candidate = String(value).toLowerCase();
  return PARCEL_LAYER_IDENTS.some((ident) => candidate.includes(ident));
}

/**
 * Whether this is a lux layer the aggregated query covers, regardless of
 * whether it happens to be active right now.
 *
 * `properties.luxQueryable` is written by themesync from
 * `metadata.is_queryable`. Older themesync builds carried that same bit only as
 * the layer's `allowPicking`, so it is the fallback — restricted to 2D layers,
 * because themesync forces `allowPicking` on for 3D tilesets, whose ids the 2D
 * GetFeatureInfo backend does not serve.
 */
export function isLuxQueryLayer(layer: Layer): boolean {
  const { luxId, luxQueryable, is3DLayer } = layer.properties ?? {};
  if (luxId == null || is3DLayer) {
    return false;
  }
  return luxQueryable !== undefined ? !!luxQueryable : layer.allowPicking;
}

/**
 * All lux layers currently eligible for an aggregated query: active, not fully
 * transparent, carrying a `luxId` and flagged queryable by themesync.
 *
 * Iterated back to front so the response order matches the 2D geoportail, which
 * walks its ol layer stack top down.
 */
export function collectQueryableLayers(app: VcsUiApp): LuxQueryLayer[] {
  const byLuxId = new Map<string, LuxQueryLayer>();
  const layers = [...app.layers].reverse();
  layers.forEach((layer: Layer) => {
    const opacity = (layer as Layer & { opacity?: number }).opacity ?? 1;
    if (!layer.active || opacity <= 0 || !isLuxQueryLayer(layer)) {
      return;
    }
    const key = String(layer.properties.luxId);
    if (!byLuxId.has(key)) {
      byLuxId.set(key, { luxId: key, label: layer.name });
    }
  });
  return [...byLuxId.values()];
}

/** Viewport size in CSS pixels of the currently active map. */
function getMapSize(app: VcsUiApp): [number, number] {
  const element = app.maps.activeMap?.mapElement;
  const width = element?.offsetWidth ?? 0;
  const height = element?.offsetHeight ?? 0;
  return width > 0 && height > 0 ? [width, height] : FALLBACK_MAP_SIZE;
}

/**
 * Web mercator zoom level matching the given resolution, the way an ol view
 * with default resolutions reports it.
 */
export function resolutionToZoom(resolution: number): number {
  if (!(resolution > 0)) {
    return MAX_ZOOM;
  }
  const zoom = Math.round(Math.log2(ZOOM_0_RESOLUTION / resolution));
  return Math.min(Math.max(zoom, 0), MAX_ZOOM);
}

/**
 * Build the GetFeatureInfo query the geoportail's coordinate path sends
 * (`feature-info.composable.ts`, `getFeatureInfoAtCoordinate`).
 *
 * `box1`/`box2` are fixed-size boxes in EPSG:2169 around the clicked point,
 * while `srs` announces EPSG:3857 — that asymmetry is the server's contract,
 * not an oversight. `WIDTH`/`HEIGHT`/`X`/`Y`/`BBOX` describe a synthetic
 * north-up viewport with the clicked point at its center; the 2D app falls back
 * to exactly that whenever the real pixel is off screen, which is what proves
 * the backend tolerates it. In a tilted 3D view no real pixel extent exists, so
 * the synthetic one is all we can send.
 */
export function buildPositionParams(
  app: VcsUiApp,
  layers: LuxQueryLayer[],
  positionMercator: Coordinate,
  config: Pick<PluginConfig, 'bigBuffer' | 'smallBuffer'>,
): Record<string, string> {
  const pointLux = Projection.transform(
    getLuxProjection(),
    mercatorProjection,
    positionMercator,
  );
  const [x, y] = pointLux;
  const { bigBuffer, smallBuffer } = config;
  const bigBox = [
    [x - bigBuffer, y + bigBuffer],
    [x + bigBuffer, y - bigBuffer],
  ];
  const smallBox = [
    [x - smallBuffer, y + smallBuffer],
    [x + smallBuffer, y - smallBuffer],
  ];

  const [width, height] = getMapSize(app);
  const pixelX = Math.round(width / 2);
  const pixelY = Math.round(height / 2);
  const resolution =
    app.maps.activeMap?.getCurrentResolution(positionMercator) || 1;
  const extent = [
    positionMercator[0] - pixelX * resolution,
    positionMercator[1] - (height - pixelY) * resolution,
    positionMercator[0] + (width - pixelX) * resolution,
    positionMercator[1] + pixelY * resolution,
  ];

  return {
    layers: layers.map((l) => l.luxId).join(),
    box1: bigBox.flat().join(','),
    box2: smallBox.flat().join(','),
    srs: mercatorProjection.epsg,
    zoom: String(resolutionToZoom(resolution)),
    BBOX: extent.join(','),
    WIDTH: String(width),
    HEIGHT: String(height),
    X: String(pixelX),
    Y: String(pixelY),
  };
}

/**
 * The by-id query shape, `?fid=<layerId>_<featureId>`. Not used by the click
 * flow; it is the entry point for permalink deep links shared with the 2D
 * portal.
 */
export function buildFidParams(fid: string): Record<string, string> {
  return { fid };
}

/** Plain GET against `luxGetInfoUrl`, params as query string. */
export async function requestLuxFeatureInfo(
  url: string,
  params: Record<string, string>,
  credentials?: RequestCredentials,
): Promise<FeatureInfoJSON[]> {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${url}?${query}`, {
    method: 'GET',
    credentials: credentials ?? 'same-origin',
  });
  if (!response.ok) {
    throw new Error(`GetFeatureInfo failed with status ${response.status}`);
  }
  return (await response.json()) as FeatureInfoJSON[];
}

/**
 * Bring the raw response into the shape the templates expect: resolve the
 * layer label, drop empty results and annotate parcel features. Mirrors
 * `showInfo()` in the 2D composable, minus the shift-key accumulation, which
 * v1 deliberately drops.
 */
export function postProcessResponse(
  data: FeatureInfoJSON[],
  layers: LuxQueryLayer[],
): FeatureInfoJSON[] {
  const labels = new Map(layers.map((l) => [l.luxId, l.label]));
  return data
    .filter((item) => Array.isArray(item.features) && item.features.length > 0)
    .map((item) => {
      const layerLabel = labels.get(item.layer) ?? item.layerLabel;
      const isParcelLayer =
        isParcelLayerIdent(layerLabel) || isParcelLayerIdent(item.layer);
      if (isParcelLayer) {
        item.features.forEach((feature: FeatureJSON) => {
          feature.properties = {
            ...feature.properties,
            // eslint-disable-next-line @typescript-eslint/naming-convention -- key read by the 2D highlight service
            layer_name: 'Parcelle',
            isParcel: true,
          };
        });
      }
      return { ...item, layerLabel };
    });
}

/**
 * Run the aggregated query for a clicked position. Returns an empty array when
 * no layer is queryable, so callers can treat "nothing to ask" and "nothing
 * found" alike.
 */
export async function queryLuxFeatureInfoAtPosition(
  app: VcsUiApp,
  config: PluginConfig,
  positionMercator: Coordinate,
): Promise<FeatureInfoJSON[]> {
  const layers = collectQueryableLayers(app);
  if (layers.length === 0) {
    return [];
  }
  const data = await requestLuxFeatureInfo(
    config.luxGetInfoUrl,
    buildPositionParams(app, layers, positionMercator, config),
    config.credentials,
  );
  return postProcessResponse(data, layers);
}

/** Run the by-id query behind a `fid` permalink. */
export async function queryLuxFeatureInfoByFid(
  app: VcsUiApp,
  config: PluginConfig,
  fid: string,
): Promise<FeatureInfoJSON[]> {
  const data = await requestLuxFeatureInfo(
    config.luxGetInfoUrl,
    buildFidParams(fid),
    config.credentials,
  );
  return postProcessResponse(data, collectQueryableLayers(app));
}
