import { describe, it, expect } from 'vitest';
import type { Layer } from '@vcmap/core';
import { toFeatureInfoJson } from '../src/luxFeatureInfoJson.js';
import type { LuxWmsFeature } from '../src/luxFeatureInfoJson.js';
import cadastre from './fixtures/wms-cadastre-262.json';
import addresses from './fixtures/wms-addresses-152.json';
import communes from './fixtures/wms-communes-302.json';

/*
 * The fixtures are real `wms.geoportail.lu/public_map_layers/service`
 * GetFeatureInfo responses with `INFO_FORMAT=application/json`. They pin the
 * contract this plugin depends on: the service answers with the *enriched* lux
 * payload rather than a stock GeoJSON one — features carry `fid`, `id` and
 * `alias` beside `properties`, and `properties` holds the nested objects and
 * arrays the templates read.
 */
function firstFeature(fixture: unknown): LuxWmsFeature {
  return (fixture as { features: LuxWmsFeature[] }).features[0];
}

function asLayer(name: string, luxId: string | number): Layer {
  return { name, properties: { luxId } } as unknown as Layer;
}

// eslint-disable-next-line @typescript-eslint/naming-convention -- keyed by lux layer id
const config = { templates: { '262': 'parcels.html' }, ordered: true };

describe('toFeatureInfoJson', () => {
  it('reads the template from the configured mapping', () => {
    const json = toFeatureInfoJson(
      firstFeature(cadastre),
      asLayer('cadastre', 262),
      config,
    );
    expect(json.template).toBe('parcels.html');
  });

  it('falls back to default.html for an unmapped layer', () => {
    // which is also how the backend signals "render generically", so an
    // incomplete mapping degrades rather than breaks
    const json = toFeatureInfoJson(
      firstFeature(communes),
      asLayer('communes', 302),
      config,
    );
    expect(json.template).toBe('default.html');
  });

  it('builds the envelope the templates expect', () => {
    const json = toFeatureInfoJson(
      firstFeature(communes),
      asLayer('communes', 302),
      config,
    );
    expect(json.layer).toBe('302');
    // the templates translate the label through the `layers` i18n namespace
    expect(json.layerLabel).toBe('communes');
    expect(json.ordered).toBe(true);
    // no profileComponent in 3D, so those template sections must stay hidden
    expect(json.has_profile).toBe(false);
    expect(json.features).toHaveLength(1);
  });

  it('maps WMS `properties` onto the templates `attributes`', () => {
    const json = toFeatureInfoJson(
      firstFeature(communes),
      asLayer('communes', 302),
      config,
    );
    expect(json.features[0].attributes).toMatchObject({
      name: 'Luxembourg',
      canton: 'Luxembourg',
    });
  });

  it('keeps nested attributes intact', () => {
    // `PF` and `measurements[]` are backend-enriched structures that
    // parcels-template.vue is entirely built on
    const json = toFeatureInfoJson(
      firstFeature(cadastre),
      asLayer('cadastre', 262),
      config,
    );
    const attributes = json.features[0].attributes as unknown as Record<
      string,
      unknown
    >;
    expect(attributes.PF).toBeTypeOf('object');
    expect(Array.isArray(attributes.measurements)).toBe(true);
    expect((attributes.PF as Record<string, unknown>).capacity).toBeTypeOf(
      'string',
    );
  });

  it('preserves the response fid even when the backend remaps the layer', () => {
    // layer 262 answers with fid `359_…`; rebuilding it as `${luxId}_${id}`
    // would produce a plausible-looking broken deep link
    const json = toFeatureInfoJson(
      firstFeature(cadastre),
      asLayer('cadastre', 262),
      config,
    );
    expect(json.features[0].fid).toBe('359_075F00498000399');
    expect(json.features[0].fid.startsWith('262_')).toBe(false);
    // and it must still satisfy the templates' hasValidFID
    expect(json.features[0].fid.split('_').length).toBeGreaterThanOrEqual(2);
  });

  it('annotates parcel features', () => {
    const parcels = toFeatureInfoJson(
      firstFeature(cadastre),
      asLayer('cadastre', 262),
      config,
    );
    expect(parcels.features[0].properties).toMatchObject({
      // eslint-disable-next-line @typescript-eslint/naming-convention -- raw geoportail key
      layer_name: 'Parcelle',
      isParcel: true,
    });

    const other = toFeatureInfoJson(
      firstFeature(addresses),
      asLayer('addresses', 152),
      config,
    );
    expect(other.features[0].properties).toBeUndefined();
  });

  it('keeps the EPSG:2169 geometry the templates and export assume', () => {
    const json = toFeatureInfoJson(
      firstFeature(addresses),
      asLayer('addresses', 152),
      config,
    );
    const geometry = json.features[0].geometry as unknown as {
      type: string;
      coordinates: number[];
    };
    expect(geometry.type).toBe('Point');
    // lux national grid, not mercator or lon/lat
    expect(geometry.coordinates[0]).toBeGreaterThan(48000);
    expect(geometry.coordinates[0]).toBeLessThan(110000);
  });

  it('respects the ordered flag', () => {
    const json = toFeatureInfoJson(
      firstFeature(communes),
      asLayer('communes', 302),
      { ...config, ordered: false },
    );
    expect(json.ordered).toBe(false);
  });
});
