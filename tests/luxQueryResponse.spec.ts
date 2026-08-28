import { describe, it, expect } from 'vitest';
import { getTemplateComponent } from '@geoportallux/feature-info-templates';
import type { FeatureInfoJSON } from '@geoportallux/feature-info-templates';
import { postProcessResponse } from '../src/luxQueryService.js';
import fixture from './fixtures/getfeatureinfo-communes-bus-cadastre.json';

/*
 * A real https://map.geoportail.lu/getfeatureinfo response, captured with the
 * exact parameters `buildPositionParams` produces for a click in Luxembourg
 * City over the communes (302), arrets_bus (147) and cadastre (262) layers.
 * It pins the contract this plugin depends on: the response is an array of
 * per-layer entries, `layer` is the lux id as a string, and layers that matched
 * nothing still come back with an empty `features` array.
 */
describe('aggregated GetFeatureInfo response', () => {
  const response = fixture as unknown as FeatureInfoJSON[];
  const layers = [
    { luxId: '302', label: 'communes' },
    { luxId: '147', label: 'arrets_bus' },
    { luxId: '262', label: 'cadastre' },
  ];

  it('returns one entry per queried layer, including empty ones', () => {
    expect(response.map((entry) => entry.layer)).toEqual(['302', '147', '262']);
    expect(response[1].features).toHaveLength(0);
  });

  it('drops the empty layer and labels the rest', () => {
    const result = postProcessResponse(response, layers);

    expect(result.map((entry) => [entry.layer, entry.layerLabel])).toEqual([
      ['302', 'communes'],
      ['262', 'cadastre'],
    ]);
  });

  it('annotates the cadastre features as parcels', () => {
    const [communes, cadastre] = postProcessResponse(response, layers);

    expect(cadastre.features[0].properties).toMatchObject({
      // eslint-disable-next-line @typescript-eslint/naming-convention -- raw geoportail key
      layer_name: 'Parcelle',
      isParcel: true,
    });
    expect(communes.features[0].properties).toBeUndefined();
  });

  it('names templates the shared dispatcher can resolve', () => {
    response.forEach((entry) => {
      expect(entry.template).toMatch(/\.html$/);
      expect(getTemplateComponent(entry.template)).toBeDefined();
    });
    // both are explicitly mapped rather than falling back to the default
    expect(response.map((entry) => entry.template)).toContain('parcels.html');
  });
});
