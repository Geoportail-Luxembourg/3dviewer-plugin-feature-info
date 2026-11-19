import type { Feature } from 'ol';
import GeoJSON from 'ol/format/GeoJSON.js';
import KML from 'ol/format/KML.js';
import GPX from 'ol/format/GPX.js';
import { wgs84Projection } from '@vcmap/core';
import { extractLineParts } from '@geoportallux/feature-info-templates';
import type { FeatureJSON } from '@geoportallux/feature-info-templates';
import { luxProjection } from './provider.js';

// ol's GPX writer skips collections
export default function exportFeature(
  feature: FeatureJSON,
  format: 'kml' | 'gpx',
): void {
  const name = feature.attributes.name || 'profile';
  const olFeature = new GeoJSON().readFeature(
    {
      type: 'Feature',
      geometry: {
        type: 'MultiLineString',
        coordinates: extractLineParts(feature.geometry),
      },
      properties: { name },
    },
    {
      dataProjection: luxProjection.epsg,
      featureProjection: wgs84Projection.epsg,
    },
  ) as Feature;
  const content = (format === 'kml' ? new KML() : new GPX()).writeFeatures([
    olFeature,
  ]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(
    new Blob([content], {
      type:
        format === 'kml'
          ? 'application/vnd.google-earth.kml+xml'
          : 'application/gpx+xml',
    }),
  );
  a.download = `${name}.${format}`;
  a.click();
  URL.revokeObjectURL(a.href);
}
