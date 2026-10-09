import { Feature } from 'ol';
import Style from 'ol/style/Style.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import type { Coordinate } from 'ol/coordinate.js';
import {
  AbstractFeatureProvider,
  isProvidedFeature,
  mercatorProjection,
  Projection,
  vcsLayerName,
} from '@vcmap/core';
import type { Layer, VcsMap } from '@vcmap/core';
import { featureInfoViewSymbol, NotificationType } from '@vcmap/ui';
import type { AbstractFeatureInfoView, VcsUiApp } from '@vcmap/ui';
import { getLogger } from '@vcsuite/logger';
import type { FeatureInfoJSON } from '@geoportallux/feature-info-templates';

/** Carries a feature's own `FeatureInfoJSON` entry to the view. */
export const luxContentSymbol = Symbol('luxContent');
/** Synthetic attribute the cluster rows are titled from. */
export const ROW_TITLE = 'luxRowTitle';

const lux = new Projection({
  epsg: 'EPSG:2169',
  proj4:
    '+proj=tmerc +lat_0=49.83333333333334 +lon_0=6.166666666666667 +k=1 +x_0=80000 +y_0=100000 +ellps=intl +towgs84=-189.681,18.3463,-42.7695,-0.33746,-3.09264,2.53861,0.4598 +units=m +no_defs',
});
const geoJson = new GeoJSON({
  dataProjection: lux.epsg,
  featureProjection: mercatorProjection.epsg,
});

export type LuxItem = { layerName: string; id: string; entry: FeatureInfoJSON };

// themesync derives `allowPicking` from `is_queryable`, but forces it on for 3D tilesets.
export function isLuxQueryLayer(layer: Layer): boolean {
  const { luxId, is3DLayer } = layer.properties;
  return luxId != null && !is3DLayer && layer.allowPicking;
}

/** One item per response feature: a layer with several definitions yields one row per definition's feature. */
export function splitResponse(
  content: FeatureInfoJSON[],
  layerName: (entry: FeatureInfoJSON) => string | undefined,
): LuxItem[] {
  return content.flatMap((entry, i) => {
    const name = layerName(entry);
    return name
      ? (entry.features ?? []).map((feature, j) => ({
          layerName: name,
          // 813 answers `fid: null`, and an id-less row is titled `undefined`
          id: feature.fid || `${entry.layer}:${i}:${j}`,
          entry: { ...entry, layerLabel: name, features: [feature] },
        }))
      : [];
  });
}

/** VC Map only falls back to exact `title`/`name`; lux layers use `label`, `Name`, … */
export function rowTitle(
  attributes: Record<string, unknown>,
): string | undefined {
  for (const candidate of ['label', 'name', 'title']) {
    const key = Object.keys(attributes).find(
      (k) => k.toLowerCase() === candidate,
    );
    const value = key && attributes[key];
    if (
      (typeof value === 'string' || typeof value === 'number') &&
      String(value).trim()
    ) {
      return String(value).trim();
    }
  }
  return undefined;
}

// Mirrors the 2D client: fixed metre boxes in 2169 (box1 points/lines, box2 polygons)
// plus a synthetic viewport centred on the click for the backend's WMS relay.
// ponytail: fixed 10 m / 1 m boxes, make them config if a deployment needs other values
function buildParams(
  map: VcsMap,
  layers: string,
  position: Coordinate,
): Record<string, string> {
  const [x, y] = Projection.transform(lux, mercatorProjection, position);
  const box = (b: number): string => [x - b, y + b, x + b, y - b].join();
  const w = map.mapElement.offsetWidth || 512;
  const h = map.mapElement.offsetHeight || 512;
  const cx = Math.round(w / 2);
  const cy = Math.round(h / 2);
  const res = map.getCurrentResolution(position) || 1;
  const zoom = Math.round(Math.log2(156543.03392804097 / res));
  return {
    layers,
    box1: box(10),
    box2: box(1),
    srs: mercatorProjection.epsg,
    zoom: String(Math.min(Math.max(zoom, 0), 22)),
    BBOX: [
      position[0] - cx * res,
      position[1] - (h - cy) * res,
      position[0] + (w - cx) * res,
      position[1] + cy * res,
    ].join(),
    WIDTH: String(w),
    HEIGHT: String(h),
    X: String(cx),
    Y: String(cy),
  };
}

/**
 * Answers for every active lux layer with one aggregated `/getfeatureinfo` request.
 * Sits on a hidden helper layer; each feature names its own lux layer in `vcsLayerName`.
 */
export default class LuxProvider extends AbstractFeatureProvider {
  constructor(
    private _app: VcsUiApp,
    private _url: string,
    private _view: AbstractFeatureInfoView,
  ) {
    super({});
  }

  async getFeaturesByCoordinate(position: Coordinate): Promise<Feature[]> {
    const map = this._app.maps.activeMap;
    // FeatureProviderInteraction asks on every click, tool on or off
    const tool = this._app.toolboxManager.get('featureInfo') as
      { action?: { active?: boolean } } | undefined;
    if (!map || !tool?.action?.active) {
      return [];
    }
    const names = new Map(
      [...this._app.layers]
        .filter((l) => l.active && l.isSupported(map) && isLuxQueryLayer(l))
        .reverse() // top-down, like the 2D portal
        .map((l) => [String(l.properties.luxId), l.name]),
    );
    if (!names.size) {
      return [];
    }

    let content: FeatureInfoJSON[];
    map.mapElement.style.cursor = 'wait';
    try {
      const params = new URLSearchParams(
        buildParams(map, [...names.keys()].join(), position),
      );
      // credentials let the backend return role-specific definitions
      const response = await fetch(`${this._url}?${params}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`getfeatureinfo: HTTP ${response.status}`);
      }
      content = (await response.json()) as FeatureInfoJSON[];
    } catch (e) {
      this._app.notifier.add({
        message: 'lux3dviewerPluginFeatureInfo.queryFailed',
        type: NotificationType.ERROR,
      });
      getLogger('LuxProvider').error(String(e));
      return [];
    } finally {
      map.mapElement.style.cursor = '';
    }

    return splitResponse(content, (e) => {
      const name = names.get(e.layer) ?? e.layerLabel;
      return this._app.layers.hasKey(name) ? name : undefined;
    }).map(({ layerName, id, entry }) => {
      const attributes = entry.features[0].attributes ?? {};
      const feature = new Feature({
        ...attributes,
        [ROW_TITLE]: rowTitle(attributes),
      });
      if (entry.features[0].geometry) {
        feature.setGeometry(geoJson.readGeometry(entry.features[0].geometry));
      }
      feature.setId(id);
      // a visible clone on selectFeature()'s scratch layer would be picked and veto the next query
      feature.setStyle(new Style({}));
      Object.assign(feature, {
        [vcsLayerName]: layerName,
        [isProvidedFeature]: true,
        [featureInfoViewSymbol]: this._view,
        [luxContentSymbol]: entry,
      });
      return feature;
    });
  }
}
