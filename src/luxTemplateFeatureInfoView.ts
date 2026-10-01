import { AbstractFeatureInfoView, WindowSlot } from '@vcmap/ui';
import type { FeatureInfoJSON } from '@geoportallux/feature-info-templates';
import LuxFeatureInfoWindow from './LuxFeatureInfoWindow.vue';
import { luxContentSymbol } from './luxWmsFeatureProvider.js';
import { I18N_NAMESPACE } from './model.js';

/*
 * @vcmap/ui re-exports the class but not the types around it, so they are
 * derived from the method being overridden — which also keeps them in sync.
 */
type GetWindowComponentOptions =
  AbstractFeatureInfoView['getWindowComponentOptions'];
type WindowComponentOptions = ReturnType<GetWindowComponentOptions>;
type WindowOptions = Pick<
  WindowComponentOptions,
  'state' | 'slot' | 'position'
>;
type FeatureInfoComponent = ConstructorParameters<
  typeof AbstractFeatureInfoView
>[1];

/**
 * Renders a lux GetFeatureInfo response with the shared geoportail templates.
 *
 * Unlike the built-in views this one does not render the feature's attributes
 * directly: the templates take a per-layer envelope, which `LuxWmsFeatureProvider`
 * builds and leaves on the feature under {@link luxContentSymbol}. Everything
 * else is the framework's — the provider tags the feature with
 * `featureInfoViewSymbol` so this view is selected without per-layer resolution,
 * and `featureInfo.selectFeature()` handles the window, the selection and the
 * toolbox session.
 */
class LuxTemplateFeatureInfoView extends AbstractFeatureInfoView {
  static get className(): string {
    return 'LuxTemplateFeatureInfoView';
  }

  constructor(options: object) {
    // The base class types the component against `FeatureInfoProps`, the
    // per-feature attribute bag every built-in view renders. This view renders
    // a whole multi-layer response instead, so its props deliberately differ.
    super(options, LuxFeatureInfoWindow as FeatureInfoComponent);
  }

  getWindowComponentOptions(
    ...args: Parameters<GetWindowComponentOptions>
  ): WindowComponentOptions {
    const [, featureInfo, layer] = args;
    const content =
      ((featureInfo.feature as unknown as Record<symbol, unknown>)[
        luxContentSymbol
      ] as FeatureInfoJSON[] | undefined) ?? [];
    const windowOptions = this.window as WindowOptions;
    return {
      state: {
        // Explicit, so the header stays "Information" instead of defaulting to
        // the (plugin-owned) layer's title.
        headerTitle: `${I18N_NAMESPACE}.title`,
        headerIcon: '$vcsInfo',
        ...windowOptions.state,
      },
      slot: windowOptions.slot ?? WindowSlot.DYNAMIC_RIGHT,
      component: LuxFeatureInfoWindow,
      position: windowOptions.position ?? { width: 400 },
      props: {
        content,
        // VC Map closes a feature info window when its layer is deactivated or
        // becomes unsupported, and matches on this prop.
        layerName: layer.name,
      },
    };
  }
}

export default LuxTemplateFeatureInfoView;
