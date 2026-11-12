import { Feature } from 'ol';
import { Point } from 'ol/geom.js';
import { Circle, Fill, Stroke, Style } from 'ol/style.js';
import {
  AbstractInteraction,
  EventType,
  mercatorProjection,
  Projection,
  wgs84Projection,
} from '@vcmap/core';
import type { EventHandler, InteractionEvent, VectorLayer } from '@vcmap/core';
import type { LuxTplProfileMapAdapter } from '@geoportallux/feature-info-templates';
import { luxProjection } from './provider.js';

const MARKER_ID = 'luxProfileMarker';

class PointerMove extends AbstractInteraction {
  constructor(private _onMove: (event: InteractionEvent) => void) {
    super(EventType.MOVE);
  }

  pipe(event: InteractionEvent): Promise<InteractionEvent> {
    this._onMove(event);
    return Promise.resolve(event);
  }
}

/** The 3D map's part of the templates' elevation profile; the marker goes on `layer` (mercator). */
export default function createProfileMapAdapter(
  layer: VectorLayer,
  eventHandler: EventHandler,
): LuxTplProfileMapAdapter {
  const marker = new Feature(new Point([0, 0]));
  marker.setId(MARKER_ID);
  marker.setStyle(
    new Style({
      image: new Circle({
        radius: 6,
        fill: new Fill({ color: 'white' }),
        stroke: new Stroke({ color: 'black', width: 2 }),
      }),
    }),
  );

  return {
    setPosition(xy): void {
      if (!xy) {
        layer.removeFeaturesById([MARKER_ID]);
        return;
      }
      (marker.getGeometry() as Point).setCoordinates(
        Projection.transform(mercatorProjection, luxProjection, xy),
      );
      if (!layer.getFeatureById(MARKER_ID)) {
        layer.addFeatures([marker]);
      }
    },
    onPointerMove(cb): () => void {
      const interaction = new PointerMove(({ position, map }) => {
        if (position) {
          cb(
            Projection.transform(
              luxProjection,
              mercatorProjection,
              position.slice(0, 2),
            ),
            map.getCurrentResolution(position),
          );
        }
      });
      const remove = eventHandler.addPersistentInteraction(interaction);
      return () => {
        remove();
        interaction.destroy();
      };
    },
    toLonLat: (xy) => Projection.transform(wgs84Projection, luxProjection, xy),
  };
}
