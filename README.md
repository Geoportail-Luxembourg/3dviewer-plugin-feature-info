# @geoportallux/lux-3dviewer-plugin-feature-info

> Part of the [VC Map Project](https://github.com/virtualcitySYSTEMS/map-ui)

This plugin shows feature info for the [Geoportail Luxembourg](https://map.geoportail.lu/) layers in the 3D viewer. On each click, while VC Map's feature info tool is active, it sends one aggregated `/getfeatureinfo` request for all active queryable lux layers. Each result is rendered with the same templates as the 2D portal (`@geoportallux/feature-info-templates`). A single hit opens its panel directly; several hits open VC Map's cluster list, grouped by layer.

## Development

To further develop the plugin run: `npm start` or `npm run preview -- --vcm [a-deployed-3dviewer-url]`

## Config parameters

All params are optional and default to the production geoportail:

- `luxGetInfoUrl` - URL to the aggregated feature info API (default `https://map.geoportail.lu/getfeatureinfo`)
- `luxLocalesUrl` - URL to the geoportail translation files used by the templates (default `https://map.geoportail.lu/assets/locales`)
- `templatesConfig` - URLs and role ids the templates need (report services, downloads, shop, QR, …). Entries given here are merged over the defaults
- `credentials` - RequestCredentials property for feature info requests: `omit`, `same-origin` or `include` (default). `include` is needed to get role-specific results when the viewer and the API are on different origins

## Feature info

The plugin answers for every lux layer with a `luxId` and `allowPicking` set by themesync (3D layers excluded). To get one request for all those layers instead of one per layer:

- its feature provider sits on a hidden, always-active helper layer, which keeps it out of the content tree and the app state
- it removes the lux layers' own feature providers (themesync's `text/html` one), so they neither send requests of their own nor open the `featureInfo2d` iframe

No themesync change is needed. Without this plugin, the layers keep the `featureInfo2d` iframe.

A click on an active 3D tileset (e.g. buildings) does not query the 2D layers: VC Map only asks feature providers when nothing in 3D was picked.

## Deploy plugin within map-ui

- Add plugin dependency in desired version to `plugins/package.json`:

```
"dependencies": {
  ...
  "@geoportallux/lux-3dviewer-plugin-feature-info": "...",
  ...
```

- Add plugin with desired values to map-ui module configuration:

```json
{
  "name": "@geoportallux/lux-3dviewer-plugin-feature-info",
  "entry": "plugins/@geoportallux/lux-3dviewer-plugin-feature-info/index.js",
  "credentials": "include"
}
```

> Note: logged-in users are read from `@geoportallux/lux-3dviewer-plugin-auth` if it is loaded; without it, the templates render for anonymous users.

## Build the npm package

Use the following commands to increase the version and push a new tag, which builds a new version as npm package:

```shell
npm version 1.0.0 --no-git-tag-version
git add .
git commit -m "1.0.0"
git tag v1.0.0
git push origin main v1.0.0 # replace "origin" with your remote repo name
```
