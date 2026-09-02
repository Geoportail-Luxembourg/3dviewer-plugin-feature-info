<script setup lang="ts">
  import { getCurrentInstance, inject, provide } from 'vue';
  import { buildVueDompurifyHTMLDirective } from 'vue-dompurify-html';
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

  const DOMPURIFY_DIRECTIVE = 'dompurify-html';

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

  /*
   * Six templates — `default` among them — render attribute values through
   * `v-dompurify-html`. That directive is not part of the templates package;
   * the geoportail registers it app-wide in its `main.ts`, so the package has an
   * undeclared host requirement. Until it owns the directive itself, the host
   * has to supply it, or those values render empty.
   *
   * Registered on the shared VC Map Vue app because a directive used inside
   * child components cannot be registered locally on this wrapper. Guarded so a
   * second window does not trigger Vue's duplicate-registration warning.
   */
  const vueApp = getCurrentInstance()?.appContext.app;
  if (vueApp && !vueApp.directive(DOMPURIFY_DIRECTIVE)) {
    vueApp.directive(DOMPURIFY_DIRECTIVE, buildVueDompurifyHTMLDirective());
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
  }
</style>
