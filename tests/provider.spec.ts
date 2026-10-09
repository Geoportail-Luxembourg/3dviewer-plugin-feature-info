import { describe, it, expect, beforeAll } from 'vitest';
import type { FeatureInfoJSON } from '@geoportallux/feature-info-templates';
import { rowTitle, splitResponse } from '../src/provider.js';
import type { LuxItem } from '../src/provider.js';

function entry(
  layer: string,
  template: string,
  fids: (string | null)[],
): FeatureInfoJSON {
  return {
    layer,
    template,
    layerLabel: `server-${layer}`,
    features: fids.map((fid) => ({ fid, attributes: {} })),
  };
}

describe('provider', () => {
  describe('splitResponse', () => {
    let items: LuxItem[];

    beforeAll(() => {
      const names = new Map([
        ['813', 'bus'],
        ['262', 'parcels'],
      ]);
      items = splitResponse(
        [
          entry('813', 'bus_wo_title.html', []),
          entry('813', 'default_table.html', [null, null]),
          entry('262', 'parcels.html', ['359_1']),
          entry('999', 'default.html', ['x']),
        ],
        (e) => names.get(e.layer),
      );
    });

    it('yields one item per feature, each with its own definition entry', () => {
      expect(items.map((i) => [i.layerName, i.entry.template])).toEqual([
        ['bus', 'default_table.html'],
        ['bus', 'default_table.html'],
        ['parcels', 'parcels.html'],
      ]);
      expect(items.every((i) => i.entry.features.length === 1)).toBe(true);
      expect(items[2].entry.layerLabel).toBe('parcels');
    });

    it('uses the fid, else a positional id', () => {
      expect(items.map((i) => i.id)).toEqual(['813:1:0', '813:1:1', '359_1']);
    });
  });

  describe('rowTitle', () => {
    it('prefers label, then name, then title, case-insensitively', () => {
      expect(rowTitle({ Name: 'n', label: 'l' })).toBe('l');
      expect(rowTitle({ Name: 'n', title: 't' })).toBe('n');
      expect(rowTitle({ label: ' ', TITLE: 7 })).toBe('7');
      expect(rowTitle({ other: 'x' })).toBeUndefined();
    });
  });
});
