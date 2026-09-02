import { describe, it, expect } from 'vitest';
import type { Layer } from '@vcmap/core';
import { isLuxQueryLayer, isParcelLayerIdent } from '../src/luxQueryService.js';

type FakeLayer = {
  name: string;
  allowPicking?: boolean;
  properties: Record<string, unknown>;
};

function asLayer(
  properties: Record<string, unknown>,
  allowPicking = false,
): Layer {
  const layer: FakeLayer = { name: 'fake', allowPicking, properties };
  return layer as unknown as Layer;
}

describe('lux layer predicates', () => {
  /*
   * `isLuxQueryLayer` decides which layers the plugin takes feature info over
   * for — i.e. whose provider it replaces with a JSON one. Getting it wrong
   * either leaves the 2D iframe in place or hijacks a layer that is not lux.
   */
  describe('isLuxQueryLayer', () => {
    it('accepts a lux 2D layer flagged queryable', () => {
      expect(isLuxQueryLayer(asLayer({ luxId: 1, luxQueryable: true }))).toBe(
        true,
      );
    });

    it('falls back to allowPicking for a pre-luxQueryable themesync', () => {
      expect(isLuxQueryLayer(asLayer({ luxId: 1 }, true))).toBe(true);
      expect(isLuxQueryLayer(asLayer({ luxId: 1 }, false))).toBe(false);
    });

    it('prefers an explicit luxQueryable over allowPicking', () => {
      expect(
        isLuxQueryLayer(asLayer({ luxId: 1, luxQueryable: false }, true)),
      ).toBe(false);
    });

    it('rejects 3D layers and non-lux layers', () => {
      // themesync forces allowPicking on for tilesets, whose ids the
      // GetFeatureInfo backend does not serve
      expect(
        isLuxQueryLayer(
          asLayer({ luxId: 1, luxQueryable: true, is3DLayer: true }, true),
        ),
      ).toBe(false);
      expect(isLuxQueryLayer(asLayer({}, true))).toBe(false);
    });

    it('does not depend on the layer being active', () => {
      // claiming happens on state change, before `active` is necessarily set
      expect(isLuxQueryLayer(asLayer({ luxId: 1, luxQueryable: true }))).toBe(
        true,
      );
    });
  });

  describe('isParcelLayerIdent', () => {
    it('recognizes the 2D portal parcel layer identifiers', () => {
      expect(isParcelLayerIdent('parcels_labels')).toBe(true);
      expect(isParcelLayerIdent('CADASTRE')).toBe(true);
      expect(isParcelLayerIdent('bus')).toBe(false);
      expect(isParcelLayerIdent(null)).toBe(false);
      expect(isParcelLayerIdent(undefined)).toBe(false);
    });
  });
});
