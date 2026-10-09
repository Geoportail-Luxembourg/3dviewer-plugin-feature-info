import { describe, it, expect } from 'vitest';
import type { FeatureInfoJSON } from '@geoportallux/feature-info-templates';
import {
  deriveRowTitle,
  splitResponse,
  toSingleFeatureContent,
} from '../src/luxAggregatedFeatureProvider.js';
import { postProcessResponse } from '../src/luxQueryService.js';
import type { LuxQueryLayer } from '../src/luxQueryService.js';
import mixed from './fixtures/getfeatureinfo-communes-bus-cadastre.json';
import multiDefinition from './fixtures/getfeatureinfo-multi-definition-813.json';

/** Both fixtures are real responses from `map.geoportail.lu/getfeatureinfo`. */
const mixedResponse = mixed as unknown as FeatureInfoJSON[];
const multiResponse = multiDefinition as unknown as FeatureInfoJSON[];

const mixedLayers: LuxQueryLayer[] = [
  { luxId: '302', label: 'communes' },
  { luxId: '147', label: 'arrets_bus' },
  { luxId: '262', label: 'cadastre' },
];
const busLayers: LuxQueryLayer[] = [{ luxId: '813', label: 'cdt_lignes_all' }];

describe('aggregated response fan-out', () => {
  describe('splitResponse', () => {
    it('yields one item per feature, not per layer', () => {
      const content = postProcessResponse(mixedResponse, mixedLayers);
      const items = splitResponse(content);
      const featureCount = content.flatMap((e) => e.features).length;
      expect(items).toHaveLength(featureCount);
    });

    it('keeps each feature with the definition entry it came from', () => {
      const content = postProcessResponse(multiResponse, busLayers);
      const items = splitResponse(content);

      // Layer 813 has several rows in `lux_getfeature_definition`, so the backend
      // answers with several entries for the one layer. Two of them have features
      // here (3 and 17 at the captured point, trimmed to 2 each in the fixture).
      expect(content.length).toBeGreaterThan(1);
      expect(new Set(items.map((i) => i.entry))).toHaveProperty('size', 2);
      items.forEach((item) => {
        expect(item.entry.features).toContain(item.feature);
        expect(item.layerName).toBe('cdt_lignes_all');
      });
    });

    it('skips entries that did not resolve to a VC Map layer', () => {
      const orphan = [
        { ...multiResponse[2], layerLabel: undefined },
      ] as unknown as FeatureInfoJSON[];
      expect(splitResponse(orphan)).toHaveLength(0);
    });

    it('gives every feature an id, even where the backend sends none', () => {
      const content = postProcessResponse(multiResponse, busLayers);
      const items = splitResponse(content);
      // 813 answers with `fid: null`; without a fallback the cluster row title
      // falls through to the id and renders as `undefined`.
      expect(items.every((i) => i.feature.fid == null)).toBe(true);
      expect(items.every((i) => !!i.id)).toBe(true);
      expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    });

    it('prefers the backend fid where there is one', () => {
      const content = postProcessResponse(mixedResponse, mixedLayers);
      const parcel = splitResponse(content).find(
        (i) => i.layerName === 'cadastre',
      );
      expect(parcel!.id).toBe(parcel!.feature.fid);
    });

    it('contributes nothing for entries without features', () => {
      const empty = multiResponse.filter((e) => e.features.length === 0);
      expect(empty.length).toBeGreaterThan(0);
      expect(splitResponse(empty)).toHaveLength(0);
    });
  });

  describe('deriveRowTitle', () => {
    it('matches case-insensitively, which is what VC Map cannot do', () => {
      // 813's attributes are `Line` and `Name`. VC Map's own fallback checks
      // `title` and `name` exactly, so capital `Name` left rows titled by id.
      const content = postProcessResponse(multiResponse, busLayers);
      splitResponse(content).forEach((item) => {
        const attributes = item.feature.attributes as Record<string, unknown>;
        expect(Object.keys(attributes)).toContain('Name');
        expect(deriveRowTitle(attributes)).toBe(attributes.Name);
      });
    });

    it('prefers label, so layers that compose one keep it', () => {
      const content = postProcessResponse(mixedResponse, mixedLayers);
      const parcel = splitResponse(content).find(
        (i) => i.layerName === 'cadastre',
      );
      const attributes = parcel!.feature.attributes as Record<string, unknown>;
      expect(attributes.label).toBeTruthy();
      expect(deriveRowTitle(attributes)).toBe(attributes.label);
    });

    it('falls through to undefined, leaving the row titled by its id', () => {
      expect(deriveRowTitle({})).toBeUndefined();
      expect(deriveRowTitle({ Line: 'D07' })).toBeUndefined();
      expect(deriveRowTitle({ label: '   ' })).toBeUndefined();
      expect(deriveRowTitle({ label: { nested: true } })).toBeUndefined();
    });

    it('takes numbers, and trims', () => {
      expect(deriveRowTitle({ Label: 42 })).toBe('42');
      expect(deriveRowTitle({ TITLE: '  spaced  ' })).toBe('spaced');
    });

    it('skips an empty higher-priority key for a usable lower one', () => {
      expect(deriveRowTitle({ label: '', Name: 'bus 19' })).toBe('bus 19');
    });
  });

  describe('toSingleFeatureContent', () => {
    it('carries one feature with its own entry metadata', () => {
      const content = postProcessResponse(multiResponse, busLayers);
      const items = splitResponse(content);

      items.forEach((item) => {
        const envelope = toSingleFeatureContent(item);
        expect(envelope.features).toEqual([item.feature]);
        expect(envelope.template).toBe(item.entry.template);
        expect(envelope.ordered).toBe(item.entry.ordered);
        expect(envelope.layerLabel).toBe('cdt_lignes_all');
      });
    });

    it('keeps the parcel annotation the response was post-processed with', () => {
      const content = postProcessResponse(mixedResponse, mixedLayers);
      const parcel = splitResponse(content).find(
        (i) => i.layerName === 'cadastre',
      );
      expect(parcel).toBeDefined();
      const [feature] = toSingleFeatureContent(parcel!).features;
      expect(feature.properties).toMatchObject({
        // eslint-disable-next-line @typescript-eslint/naming-convention -- key read by the 2D highlight service
        layer_name: 'Parcelle',
        isParcel: true,
      });
    });

    it('renders the fid the backend composed, remap included', () => {
      const content = postProcessResponse(mixedResponse, mixedLayers);
      const parcel = splitResponse(content).find(
        (i) => i.layerName === 'cadastre',
      );
      // Layer 262 is remapped to 359 by the backend, so the fid cannot be
      // rebuilt client-side from the requested layer id.
      expect(parcel!.feature.fid).toMatch(/^359_/);
    });
  });
});
