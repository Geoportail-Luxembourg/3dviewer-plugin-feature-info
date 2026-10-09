import { AbstractFeatureInfoView, WindowSlot } from '@vcmap/ui';
import type {
  LuxTplContext,
  LuxTplI18n,
} from '@geoportallux/feature-info-templates';
import LuxWindow from './LuxWindow.vue';
import { luxContentSymbol } from './provider.js';

export type LuxRuntime = { context: LuxTplContext; i18n: LuxTplI18n };

type GetOptions = AbstractFeatureInfoView['getWindowComponentOptions'];

/** Renders a feature's own lux entry (see `luxContentSymbol`) with the shared templates. */
export default class LuxView extends AbstractFeatureInfoView {
  constructor(private _runtime: LuxRuntime) {
    // props deliberately differ from the attribute bag built-in views get
    super(
      { name: 'luxFeatureInfo' },
      LuxWindow as ConstructorParameters<typeof AbstractFeatureInfoView>[1],
    );
  }

  getWindowComponentOptions(
    ...[, { feature }, layer]: Parameters<GetOptions>
  ): ReturnType<GetOptions> {
    return {
      state: {
        headerTitle: 'lux3dviewerPluginFeatureInfo.title',
        headerIcon: '$vcsInfo',
      },
      slot: WindowSlot.DYNAMIC_RIGHT,
      component: LuxWindow,
      position: { width: 400 },
      props: {
        entry: (feature as unknown as Record<symbol, unknown>)[
          luxContentSymbol
        ],
        // VC Map closes the window when this layer is deactivated
        layerName: layer.name,
        runtime: this._runtime,
      },
    };
  }
}
