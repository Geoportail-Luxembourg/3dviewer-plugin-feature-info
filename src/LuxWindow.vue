<script setup lang="ts">
  import { provide } from 'vue';
  import {
    getTemplateComponent,
    provideLuxTplContext,
    LUX_TPL_I18N,
  } from '@geoportallux/feature-info-templates';
  import type { FeatureInfoJSON } from '@geoportallux/feature-info-templates';
  import '@geoportallux/feature-info-templates/style.css';
  import type { LuxRuntime } from './view.js';

  const props = defineProps<{
    entry: FeatureInfoJSON;
    layerName: string;
    runtime: LuxRuntime;
  }>();
  provideLuxTplContext(props.runtime.context);
  provide(LUX_TPL_I18N, props.runtime.i18n);
</script>

<template>
  <!-- `lux-tpl-root` scopes the package's styles -->
  <div class="lux-tpl-root lux-window">
    <component :is="getTemplateComponent(entry.template)" :layers="entry" />
  </div>
</template>

<style scoped>
  .lux-window {
    padding: 8px;
    overflow-x: hidden;
    --lux-tpl-white-by-default: black;
  }
</style>
