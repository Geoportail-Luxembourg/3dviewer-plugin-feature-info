<script setup lang="ts">
  import { provide } from 'vue';
  import type { Feature } from 'ol';
  import GeoJSON from 'ol/format/GeoJSON.js';
  import KML from 'ol/format/KML.js';
  import GPX from 'ol/format/GPX.js';
  import { wgs84Projection } from '@vcmap/core';
  import {
    getTemplateComponent,
    extractLineParts,
    provideLuxTplContext,
    LUX_TPL_I18N,
  } from '@geoportallux/feature-info-templates';
  import type {
    FeatureInfoJSON,
    FeatureJSON,
  } from '@geoportallux/feature-info-templates';
  import '@geoportallux/feature-info-templates/style.css';
  import type { LuxRuntime } from './view.js';
  import { luxProjection } from './provider.js';

  const props = defineProps<{
    entry: FeatureInfoJSON;
    layerName: string;
    runtime: LuxRuntime;
  }>();
  provideLuxTplContext(props.runtime.context);
  provide(LUX_TPL_I18N, props.runtime.i18n);

  // ol's GPX writer skips collections
  function exportFeature({
    feature,
    format,
  }: {
    feature: FeatureJSON;
    format: 'kml' | 'gpx';
  }): void {
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
</script>

<template>
  <!-- `lux-tpl-root` scopes the package's styles -->
  <div class="lux-tpl-root lux-window">
    <component
      :is="getTemplateComponent(entry.template)"
      :layers="entry"
      @export="exportFeature"
    />
  </div>
</template>

<style scoped>
  .lux-window {
    padding: 8px;
    overflow-x: hidden;
    --lux-tpl-white-by-default: black;
  }
</style>
