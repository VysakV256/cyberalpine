# Cyberalpine

**Live:** [cyberalpine.web.app](https://cyberalpine.web.app)

**Gemini integration:** [Implementation and API plan](docs/gemini-integration.md). A private generation CLI and validated artifact loader are implemented. A validated six-dataset interpretation was generated with Gemini 2.5 Flash through GenerateContent; the public browser loads that artifact without making model calls. Omni video generation remains planned.

A buildless Three.js ecosystem for Cyberquest. Serve `public/` with an HTTP server; opening `index.html` as a local file will not load the JSON manifest or JavaScript modules.

```sh
python3 -m http.server 8766 --directory public
```

Open http://localhost:8766. No package installation, API key, or paid model call is needed. Three.js r180 and its MIT license are vendored locally.

## Geography

Tabular data becomes peaks; relational data becomes valley forests; nested objects become wooded foothills. Declared information transformations become rivers. Archive glaciers identify the acquired snapshot. A carved lake, boathouse, record buoys, and steerable inspection boat make retained collections traversable.

This prototype uses a 2025-10-25 through 2026-10-25 selection window. Its four acquired source collections contain 139 records: 11 BLS CPI observations, 11 BLS unemployment observations, 78 Crossref journal-article metadata records, and 39 Crossref book metadata records. Crossref samples are bounded by calendar month and are not exhaustive or representative of the literature. The latest available BLS month in this snapshot is September 2026. No abstracts or full texts were fetched.

There are two additional deterministic derived collections: 22 nested economic observation objects and 329 DOI reference edges. These are not additional acquired works. Heights, tree dimensions, placement, and force controls are declared visual mappings, not importance or truth scores.

## Controls and integration

Use the region buttons to visit peaks, forest, glaciers, and lake. Launch a boat, then steer with WASD, arrow keys, or the on-screen controls. Return to the boathouse to dock. Select a dataset buoy to inspect its provenance.

The external gaze interface is `window.Cyberalpine.setGaze({position:{x,y,z},yaw,pitch,fov,source})`. Coordinates use metres: +X east, +Y up, +Z north; yaw is clockwise from north in radians, pitch positive up, FOV horizontal degrees. Your future hyperemergence engine supplies gaze. This page does not implement robot kinematics or autonomous gaze selection.

Private collections, personal entitlements, cloud data storage, real buoyancy, and generative video are future integrations. The browser renders structured geometry; it does not call Gemini or generate video. The [planned Gemini integration](docs/gemini-integration.md) describes the provider boundary.

## Dataset visualizations

The **Landscape composer** lets each visitor select any of the six retained datasets, choose its native form or override it with a mountain peak or pine forest, then press **Generate landscape**. Only the selected dataset homes and their retained record overlays are built. Selecting an omitted dataset in the Data lens grows its home and focuses the camera.

Selected peaks have six physical ridges and gullies, with matching analytic height gradients. Each forest tree identifies a retained source or derived record; collections above 150 records use an evenly distributed deterministic sample. The full native selection creates two peaks and four forests with 289 record trees. Tree height, canopy size, ridges, and layout are display mappings. The source snapshot is immutable, and only declared transfers whose endpoints remain selected are displayed.

Generation animates the new landscape, respects reduced motion, reframes the selected homes, preserves an external gaze, and keeps the data lake accessible through its region control. Visitor selections apply to the current browser session.

The **Data lens** connects six dataset selectors, a monthly cutoff, source charts, and Three.js record landmarks:

- 22 ice columns show actual CPI and unemployment observations, each normalized within its own series. Their numeric baselines are truncated and exact source values remain inspectable.
- 139 constellation points show 22 derived observation objects, 78 research metadata records, and 39 book metadata records. The derived objects are not additional acquired works.
- 347 DOI identifiers and 329 deposited reference edges form a citation network. External targets remain identifiers; their metadata and publication dates are not invented.

Timeline filtering applies to record overlays and charts. Each selected geographic home represents its complete retained date window; the composer controls which homes exist. Select a dataset to focus its region, select a record to inspect provenance, or switch to Landscape to hide the data overlay.

## Generate a Gemini interpretation

Node.js 22 or later is required for the CLI; the static app still needs no package installation. Prepare the bounded context without making a provider request:

```sh
node scripts/generate-gemini-universe.mjs --prepare-only
```

For a real request, configure `GEMINI_API_KEY` privately in the process environment. For the hackathon, an ignored local `.env.local` can contain `GEMINI_API_KEY=...`; run it with Node’s environment loader:

```sh
node --env-file=.env.local scripts/generate-gemini-universe.mjs --api generate-content --model gemini-2.5-flash
```

The key file stays outside Firebase’s `public/` directory and Git. Alternatively use a Secret Manager secret through an authenticated Firebase CLI:

```sh
node scripts/generate-gemini-universe.mjs --secret-project infiniteutopia
```

The CLI calls the configured Gemini model (Argon through Interactions by default), validates exact dataset/record IDs and compatible visual roles, and atomically writes `public/assets/gemini-universe.json` only after a successful response. The browser verifies source, manifest, and context hashes before displaying generated annotations and highlighting selected records. The checked-in artifact records the successful Gemini 2.5 Flash request and its input hashes. Argon returned a zero free-tier daily quota during this hackathon run; newer Flash models returned capacity or project-quota errors. A pending or rejected artifact is deliberately labelled as pending. Gemini never replaces observed values, units, or deposited citations. Model calls can incur provider charges.

Run the offline contract tests with:

```sh
node --test scripts/*.test.mjs
```

## Rebuild data

The `unreal/` source project includes `Scripts/fetch_sources.py` and `Scripts/build_universe.cjs`. From `unreal/`, acquire records and run the offline builder with Python and Node.js, then copy the generated `Content/Data/universe.json` to `public/assets/universe.json` before deployment. Preserve provider attribution and coverage. Native Unreal compilation and editor rendering still require verification; the starter ZIP is also available in `public/downloads/`.

## Published site

Live at https://cyberalpine.web.app, a separate Hosting site under the explicitly selected `infiniteutopia` Firebase project.

## Firebase

`firebase.json` targets only the `cyberalpine` Hosting site. Set the explicitly selected Firebase parent project in `.firebaserc`, then run:

```sh
firebase deploy --only hosting --non-interactive
```

The site has no backend secrets. Files in `public/` are public on deployment.

## Ice and pine visual update

The header uses the supplied 60-second Runway export with its original H.264 video and AAC audio, remuxed for progressive playback without re-encoding. It starts muted, offers Play/Pause and Mute/Unmute, respects reduced motion, and pauses offscreen. The interactive atlas follows below.

The browser scene uses procedural granite and ice textures, seeded branching pine foliage, cool atmospheric lighting, and a planar-reflection water shader. Material detail leaves the source snapshot untouched. Selected dataset forms now produce physical ridged terrain through the same analytic field used to place trees and sample paths; the acquired canonical terrain remains reproducible. Neither the video nor decorative material detail changes source records or force calculations.

## Rights and attribution

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the vendored Three.js license, dataset provenance, and supplied media. Public availability does not apply a blanket license to the project code, film, or underlying publications.
