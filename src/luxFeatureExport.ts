import GeoJSON from 'ol/format/GeoJSON.js';
import KML from 'ol/format/KML.js';
import GPX from 'ol/format/GPX.js';
import { downloadText } from '@vcmap/ui';
import type { FeatureJSON } from '@geoportallux/feature-info-templates';
import { LUX_EPSG, getLuxProjection } from './luxProjection.js';

export type LuxExportFormat = 'kml' | 'gpx';

export type LuxExportPayload = {
  feature: FeatureJSON;
  format: LuxExportFormat;
};

/** KML and GPX both carry WGS84 coordinates. */
const EXPORT_EPSG = 'EPSG:4326';

/**
 * Download a single feature of a GetFeatureInfo response as KML or GPX.
 *
 * Geometries arrive in EPSG:2169 and are reprojected on read. GPX has no
 * polygon representation, so ol drops polygonal features from that output —
 * the same limitation the 2D portal has.
 *
 * Reachable once a `profileComponent` is wired: the templates forward `export`
 * from the elevation profile only, and 3D has no profile component yet.
 */
export function exportLuxFeature({ feature, format }: LuxExportPayload): void {
  getLuxProjection(); // ensures EPSG:2169 is known to proj4/ol
  const olFeatures = new GeoJSON().readFeatures(
    {
      type: 'Feature',
      geometry: feature.geometry,
      properties: feature.properties ?? feature.attributes ?? {},
    },
    { dataProjection: LUX_EPSG, featureProjection: EXPORT_EPSG },
  );

  const writer = format === 'gpx' ? new GPX() : new KML();
  const name = feature.attributes?.name ?? feature.fid ?? format;
  downloadText(writer.writeFeatures(olFeatures), `${name}.${format}`);
}
