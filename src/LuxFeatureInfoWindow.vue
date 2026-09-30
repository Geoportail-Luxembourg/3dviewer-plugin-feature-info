<script setup lang="ts">
  import { inject, provide } from 'vue';
  import type { VcsUiApp } from '@vcmap/ui';
  import {
    getTemplateComponent,
    provideLuxTplContext,
    LUX_TPL_I18N,
  } from '@geoportallux/feature-info-templates';
  import type { FeatureInfoJSON } from '@geoportallux/feature-info-templates';
  import '@geoportallux/feature-info-templates/style.css';
  import { name } from '../package.json';
  import type { LuxFeatureInfoPlugin } from './index.js';

  defineProps<{
    /** One entry per layer that returned features, in 2D response order. */
    content: FeatureInfoJSON[];
    /** Permalink the templates offer as "link to this feature". */
    currentUrl: string;
    /**
     * Declared so VC Map can match the window against its layer when that
     * layer is deactivated. Not rendered.
     */
    layerName?: string;
  }>();

  /*
   * The templates mount directly into the VC Map component tree — no child app.
   * All they need is their context and their i18n instance, both owned by the
   * plugin (the view class may be constructed from a module config, so it
   * cannot hand them down itself).
   */
  const app = inject('vcsApp') as VcsUiApp;
  const plugin = app.plugins.getByKey(name) as LuxFeatureInfoPlugin | undefined;
  const runtime = plugin?.tplRuntime;
  if (runtime) {
    provideLuxTplContext(runtime.context);
    provide(LUX_TPL_I18N, runtime.i18n);
  }
</script>

<template>
  <!--
    `lux-tpl-root` scopes the package's Tailwind utilities and carries its
    design tokens; without it the templates render unstyled.
  -->
  <div class="lux-tpl-root lux-feature-info-window">
    <component
      :is="getTemplateComponent(layers.template)"
      v-for="(layers, index) in content"
      :key="index"
      :layers="layers"
      :current-url="currentUrl"
    />
  </div>
</template>

<style scoped>
  .lux-feature-info-window {
    padding: 8px;
    overflow-x: hidden;
    --lux-tpl-white-by-default: black;
  }
</style>
