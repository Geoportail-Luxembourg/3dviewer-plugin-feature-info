import { Projection } from '@vcmap/core';

/**
 * proj4 definition of the Luxembourg national grid. Constructing a
 * {@link Projection} also registers the definition with proj4 and ol, which is
 * what later makes `EPSG:2169` usable in ol's `GeoJSON` reader for the export.
 */
const LUX_PROJ4 =
  '+proj=tmerc +lat_0=49.83333333333334 +lon_0=6.166666666666667 +k=1 ' +
  '+x_0=80000 +y_0=100000 +ellps=intl ' +
  '+towgs84=-189.681,18.3463,-42.7695,-0.33746,-3.09264,2.53861,0.4598 ' +
  '+units=m +no_defs';

export const LUX_EPSG = 'EPSG:2169';

let projection: Projection | undefined;

/**
 * The EPSG:2169 projection, registered on first use. Idempotent — other lux
 * modules (e.g. the search-coordinate plugin) may register the same definition.
 */
export function getLuxProjection(): Projection {
  if (!projection) {
    projection = new Projection({ epsg: LUX_EPSG, proj4: LUX_PROJ4 });
  }
  return projection;
}
