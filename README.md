Development
-----------

Satellite imagery via Cesium ion
- Create a free Cesium ion account and generate an access token.
- Create a file named `.env.local` in the project root and add:

```
VITE_CESIUM_ION_TOKEN=YOUR_TOKEN_HERE
```

If no token is set, the app falls back to OpenStreetMap tiles.


