import { AbstractFeatureInfoView, WindowSlot } from '@vcmap/ui';
import type { FeatureInfoJSON } from '@geoportallux/feature-info-templates';
import LuxFeatureInfoWindow from './LuxFeatureInfoWindow.vue';
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
 * Renders an aggregated lux GetFeatureInfo response with the shared geoportail
 * templates.
 *
 * Unlike the built-in views this one is not derived from a single feature — the
 * response covers every visible queryable layer at the clicked position. The
 * interaction stores it on the view right before calling
 * `featureInfo.selectFeature()` with this view as the explicit renderer, which
 * buys the whole built-in lifecycle (window position caching by class name,
 * selection clearing, toolbox session semantics) without the per-feature view
 * resolution that cannot express this query.
 */
class LuxTemplateFeatureInfoView extends AbstractFeatureInfoView {
  static get className(): string {
    return 'LuxTemplateFeatureInfoView';
  }

  private _content: FeatureInfoJSON[] = [];

  constructor(options: object) {
    // The base class types the component against `FeatureInfoProps`, the
    // per-feature attribute bag every built-in view renders. This view renders
    // a whole multi-layer response instead, so its props deliberately differ.
    super(options, LuxFeatureInfoWindow as FeatureInfoComponent);
  }

  /** The response the next window opened from this view will render. */
  get content(): FeatureInfoJSON[] {
    return this._content;
  }

  set content(content: FeatureInfoJSON[]) {
    this._content = content;
  }

  getWindowComponentOptions(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the aggregated result is carried by the view, not by the clicked feature
    ..._args: Parameters<GetWindowComponentOptions>
  ): WindowComponentOptions {
    const windowOptions = this.window as WindowOptions;
    return {
      state: {
        headerTitle: `${I18N_NAMESPACE}.title`,
        headerIcon: '$vcsInfo',
        ...windowOptions.state,
      },
      slot: windowOptions.slot ?? WindowSlot.DYNAMIC_RIGHT,
      component: LuxFeatureInfoWindow,
      position: windowOptions.position ?? { width: 400 },
      props: {
        content: this._content,
        currentUrl: window.location.href,
      },
    };
  }
}

export default LuxTemplateFeatureInfoView;
