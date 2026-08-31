import { describe, it, expect } from 'vitest';
import type { VcsUiApp } from '@vcmap/ui';
import type { FeatureInfoJSON } from '@geoportallux/feature-info-templates';
import type { Layer } from '@vcmap/core';
import {
  buildPositionParams,
  collectQueryableLayers,
  isLuxQueryLayer,
  isParcelLayerIdent,
  postProcessResponse,
  resolutionToZoom,
} from '../src/luxQueryService.js';

describe('lux query service', () => {
  /** Web mercator coordinate of a point in Luxembourg City. */
  const POSITION = [682439, 6379152];

  type FakeLayer = {
    name: string;
    active: boolean;
    opacity?: number;
    allowPicking?: boolean;
    properties: Record<string, unknown>;
  };

  function fakeLayer(
    name: string,
    properties: Record<string, unknown>,
    overrides: Partial<FakeLayer> = {},
  ): FakeLayer {
    return {
      name,
      active: true,
      opacity: 1,
      allowPicking: false,
      properties,
      ...overrides,
    };
  }

  function fakeApp(
    layers: FakeLayer[],
    { resolution = 1, width = 800, height = 600 } = {},
  ): VcsUiApp {
    return {
      layers,
      maps: {
        activeMap: {
          mapElement: { offsetWidth: width, offsetHeight: height },
          getCurrentResolution: (): number => resolution,
        },
      },
    } as unknown as VcsUiApp;
  }

  describe('collectQueryableLayers', () => {
    it('keeps only active, queryable layers carrying a luxId', () => {
      const app = fakeApp([
        fakeLayer('queryable', { luxId: 1, luxQueryable: true }),
        fakeLayer('notQueryable', { luxId: 2, luxQueryable: false }),
        fakeLayer('noLuxId', { luxQueryable: true }),
        fakeLayer(
          'inactive',
          { luxId: 3, luxQueryable: true },
          { active: false },
        ),
        fakeLayer(
          'transparent',
          { luxId: 4, luxQueryable: true },
          { opacity: 0 },
        ),
      ]);

      expect(collectQueryableLayers(app)).toEqual([
        { luxId: '1', label: 'queryable' },
      ]);
    });

    it('falls back to allowPicking for 2D layers of a pre-luxQueryable themesync', () => {
      const app = fakeApp([
        fakeLayer('wms', { luxId: 1 }, { allowPicking: true }),
        fakeLayer('notPickable', { luxId: 2 }, { allowPicking: false }),
        fakeLayer(
          'tileset',
          { luxId: 3, is3DLayer: true },
          { allowPicking: true },
        ),
      ]);

      expect(collectQueryableLayers(app).map((l) => l.label)).toEqual(['wms']);
    });

    it('prefers an explicit luxQueryable over allowPicking', () => {
      const app = fakeApp([
        fakeLayer(
          'a',
          { luxId: 1, luxQueryable: false },
          { allowPicking: true },
        ),
        fakeLayer(
          'b',
          { luxId: 2, luxQueryable: true },
          { allowPicking: false },
        ),
      ]);

      expect(collectQueryableLayers(app).map((l) => l.label)).toEqual(['b']);
    });

    it('returns layers top down and deduplicates shared luxIds', () => {
      const app = fakeApp([
        fakeLayer('bottom', { luxId: 1, luxQueryable: true }),
        fakeLayer('middle', { luxId: 2, luxQueryable: true }),
        fakeLayer('topSharingId', { luxId: 1, luxQueryable: true }),
      ]);

      expect(collectQueryableLayers(app).map((l) => l.label)).toEqual([
        'topSharingId',
        'middle',
      ]);
    });
  });

  describe('isLuxQueryLayer', () => {
    /*
     * This predicate also decides ownership of a *picked* feature: a feature on
     * a layer the aggregated query covers belongs to this plugin even when the
     * layer still names `featureInfo2d`, which is what themesync writes until
     * `useLuxFeatureInfoTemplates` is turned on. Getting that wrong hands single
     * layer hits to the 2D iframe.
     */
    const asLayer = (l: FakeLayer): Layer => l as unknown as Layer;

    it('covers a lux 2D layer flagged queryable', () => {
      expect(
        isLuxQueryLayer(
          asLayer(fakeLayer('a', { luxId: 1, luxQueryable: true })),
        ),
      ).toBe(true);
    });

    it('covers a lux 2D layer of a pre-luxQueryable themesync via allowPicking', () => {
      expect(
        isLuxQueryLayer(
          asLayer(fakeLayer('a', { luxId: 1 }, { allowPicking: true })),
        ),
      ).toBe(true);
    });

    it('ignores 3D layers, non-lux layers and layers flagged not queryable', () => {
      expect(
        isLuxQueryLayer(
          asLayer(
            fakeLayer(
              'tileset',
              { luxId: 1, luxQueryable: true, is3DLayer: true },
              { allowPicking: true },
            ),
          ),
        ),
      ).toBe(false);
      expect(
        isLuxQueryLayer(
          asLayer(fakeLayer('foreign', {}, { allowPicking: true })),
        ),
      ).toBe(false);
      expect(
        isLuxQueryLayer(
          asLayer(fakeLayer('a', { luxId: 1, luxQueryable: false })),
        ),
      ).toBe(false);
    });

    it('does not depend on the layer being active', () => {
      expect(
        isLuxQueryLayer(
          asLayer(
            fakeLayer('a', { luxId: 1, luxQueryable: true }, { active: false }),
          ),
        ),
      ).toBe(true);
    });
  });

  describe('resolutionToZoom', () => {
    it('matches the ol default web mercator resolution ladder', () => {
      expect(resolutionToZoom(156543.03392804097)).toBe(0);
      expect(resolutionToZoom(156543.03392804097 / 2 ** 15)).toBe(15);
    });

    it('clamps to the queryable zoom range', () => {
      expect(resolutionToZoom(1e9)).toBe(0);
      expect(resolutionToZoom(1e-9)).toBe(22);
      expect(resolutionToZoom(0)).toBe(22);
    });
  });

  describe('buildPositionParams', () => {
    const layers = [
      { luxId: '117', label: 'parcels' },
      { luxId: '204', label: 'bus' },
    ];
    const buffers = { bigBuffer: 10, smallBuffer: 1 };

    it('joins the lux ids and announces web mercator as srs', () => {
      const params = buildPositionParams(
        fakeApp([]),
        layers,
        POSITION,
        buffers,
      );
      expect(params.layers).toBe('117,204');
      // The boxes are in EPSG:2169 while srs stays 3857 — that asymmetry is the
      // server's contract, verified against the 2D portal's coordinate path.
      expect(params.srs).toBe('EPSG:3857');
    });

    it('sends fixed-size boxes around the point in EPSG:2169', () => {
      const params = buildPositionParams(
        fakeApp([]),
        layers,
        POSITION,
        buffers,
      );
      const big = params.box1.split(',').map(Number);
      const small = params.box2.split(',').map(Number);

      expect(big).toHaveLength(4);
      // Luxembourg's national grid puts the country around x 50-105km, y 55-140km.
      const [x, y] = [(big[0] + big[2]) / 2, (big[1] + big[3]) / 2];
      expect(x).toBeGreaterThan(50000);
      expect(x).toBeLessThan(110000);
      expect(y).toBeGreaterThan(50000);
      expect(y).toBeLessThan(140000);

      // upper left then lower right, as the 2D portal builds them
      expect(big[0]).toBeCloseTo(x - 10, 6);
      expect(big[1]).toBeCloseTo(y + 10, 6);
      expect(big[2]).toBeCloseTo(x + 10, 6);
      expect(big[3]).toBeCloseTo(y - 10, 6);
      expect(small[0]).toBeCloseTo(x - 1, 6);
      expect(small[1]).toBeCloseTo(y + 1, 6);
    });

    it('describes a synthetic viewport centred on the clicked point', () => {
      const params = buildPositionParams(
        fakeApp([], { resolution: 2, width: 800, height: 600 }),
        layers,
        POSITION,
        buffers,
      );

      expect(params.WIDTH).toBe('800');
      expect(params.HEIGHT).toBe('600');
      expect(params.X).toBe('400');
      expect(params.Y).toBe('300');

      const [minX, minY, maxX, maxY] = params.BBOX.split(',').map(Number);
      expect((minX + maxX) / 2).toBeCloseTo(POSITION[0], 6);
      expect((minY + maxY) / 2).toBeCloseTo(POSITION[1], 6);
      expect(maxX - minX).toBeCloseTo(800 * 2, 6);
      expect(maxY - minY).toBeCloseTo(600 * 2, 6);
      expect(params.zoom).toBe(String(resolutionToZoom(2)));
    });
  });

  describe('postProcessResponse', () => {
    const layers = [
      { luxId: '117', label: 'parcels' },
      { luxId: '204', label: 'bus' },
    ];

    function response(layer: string, featureCount: number): FeatureInfoJSON {
      const json: unknown = {
        layer,
        template: 'default_template.html',
        features: Array.from({ length: featureCount }, (_unused, i) => ({
          fid: `${layer}_${i}`,
        })),
      };
      return json as FeatureInfoJSON;
    }

    it('drops layers that returned no feature and resolves the label', () => {
      const result = postProcessResponse(
        [response('117', 1), response('204', 0)],
        layers,
      );

      expect(result).toHaveLength(1);
      expect(result[0].layerLabel).toBe('parcels');
    });

    it('annotates features of parcel layers', () => {
      const [parcels, bus] = postProcessResponse(
        [response('117', 1), response('204', 1)],
        layers,
      );

      expect(parcels.features[0].properties).toMatchObject({
        // eslint-disable-next-line @typescript-eslint/naming-convention -- raw geoportail key
        layer_name: 'Parcelle',
        isParcel: true,
      });
      expect(bus.features[0].properties).toBeUndefined();
    });
  });

  describe('isParcelLayerIdent', () => {
    it('recognizes the 2D portal parcel layer identifiers', () => {
      expect(isParcelLayerIdent('parcels_labels')).toBe(true);
      expect(isParcelLayerIdent('CADASTRE')).toBe(true);
      expect(isParcelLayerIdent('bus')).toBe(false);
      expect(isParcelLayerIdent(null)).toBe(false);
    });
  });
});
