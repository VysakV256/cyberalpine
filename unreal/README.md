# Cyberquest — Unreal information universe

This Unreal Engine 5.8 C++ starter renders the checked-in `Content/Data/universe.json` into a traversable information landscape. The manifest remains the source of provenance, record identifiers, dates, mapping choices, authored transfers, and glacier semantics. No network request happens inside Unreal.

**Validation status:** source and bootstrap script are provided. A successful native build and an editor render are required before calling this Unreal implementation tested. The source does not include compiled binaries or a prebuilt `.umap`.

## Acquired snapshot and reproducible build

The checked-in selection window is **25 October 2025–25 October 2026**, inclusive. It contains **139 acquired source records**: 11 BLS CPI observations, 11 BLS unemployment observations, 78 Crossref journal-article metadata records, and 39 Crossref book metadata records. Monthly BLS reporting intervals are retained only if wholly inside the window; September 2026 is the latest returned period. Crossref is a bounded calendar-month-stratified sample, not an exhaustive or representative collection. No abstracts or full texts were fetched.

The six dataset homes include two derived collections: 22 economic observation objects and 329 deposited DOI reference edges. External reference targets remain identifiers unless already present in the acquired sample. Derived records do not count as additional acquired works. Each record retains source precision and acquisition provenance; the universe identifies its source snapshot by SHA-256.

```sh
python3 Scripts/fetch_sources.py --raw-dir /path/to/local/raw-cache
node Scripts/build_universe.cjs
```

To rebuild from a retained raw cache without provider requests, add `--offline` to the fetch command. Raw cache files are not bundled in this source starter; the normalized source snapshot is included. Re-running acquisition can return different provider values or metadata. Re-running the world builder on identical source bytes is deterministic. Copy `Content/Data/universe.json` to the web app's `public/assets/universe.json` to keep the views synchronized.

The web version uses sampled record identifiers for tree inspection. Native Unreal trees currently remain bounded illustrative proxies. Glacier caps identify the current acquired snapshot; a multi-vintage archive requires future storage integration.

## Open the universe

1. Install Unreal Engine 5.8 and its C++ development toolchain. On macOS, use a supported full Xcode installation; Command Line Tools alone may not satisfy Unreal's platform checks.
2. Open `CyberquestUnreal.uproject`, generate project files if prompted, and build the **CyberquestUnrealEditor** target.
3. In Unreal Editor, run **Tools → Execute Python Script**, selecting `Scripts/bootstrap_unreal.py`. It creates simple materials, an illuminated map, and the universe actor, then sets the startup map.
4. Press **Play**. The default spectator pawn supports Unreal's free-camera movement. Press **B** to board the first data lake's inspection boat, use WASD and the mouse to navigate, and press **B** to return to your prior camera position. This is an inspection camera; robot limbs, contact control, and autonomous decisions are deferred.

A local editor commandlet can run the same bootstrap after the native module has compiled:

```sh
UnrealEditor-Cmd CyberquestUnreal.uproject -run=pythonscript -script="/absolute/path/to/Scripts/bootstrap_unreal.py" -unattended
```

## Manifest contract

```json
{
  "window": {"start": "2025-10-25", "end": "2026-10-25"},
  "world": {"baseline": 8, "extent": 76},
  "datasets": [{
    "id": "source-id", "name": "Dataset name", "structure": "tabular",
    "form": "peak", "anchor": {"x": -20, "z": 20}, "radius": 14,
    "relief": 22, "abundance": 0.6, "sourceUrl": "https://example.org/",
    "records": []
  }],
  "flows": [{"from": "source-id", "to": "target-id", "kind": "authored-transfer", "transformation": "Explicitly described interpretation"}],
  "glaciers": [{"datasetId": "source-id", "radius": 4, "archive": "Versioned historical snapshots"}],
  "lakes": [{"id": "data-lake", "name": "Information reservoir", "center": {"x": 45, "z": -50}, "radius": 14, "depth": 4, "waterLevel": 7.4, "datasetIds": ["source-id"], "boathouses": []}]
}
```

Coordinates, radius, relief, and heights in the manifest are metres. Manifest `anchor.x` means east and `anchor.z` means north. Unreal world axes are **X east / Y north / Z up**, with 100 Unreal units per metre. The window states data selection boundaries; it does not guarantee every source has observations on the final date. Detailed source-specific availability belongs in the manifest.

Each dataset owns one summit, basin, or foothill. Tabular data forms peaks, relational records form valley forests, and nested object collections form higher forested foothills. Compact radial fields preserve exact local extrema when their support discs are disjoint. Overlapping custom discs blend; their anchors need not remain local extrema. Mountain heights and basin depths are explicit mapping choices, not objective importance or source quality.

## Geometry and dynamics

- `ACyberquestUniverse` builds a procedural triangle terrain mesh with collision. `GetHeightMetres` and `GetSurfaceNormal` query its analytic field; the sampled triangle surface approximates that field at grid resolution.
- Forests use instanced engine cylinder/cone meshes. Trees are illustrative proxies, not a claim that every visible tree is an actual fetched record.
- Information ribbons use real terrain heights. The current pass follows supplied manifest polylines for downhill drainage and declared transfers; legacy transfers without points fall back to straight horizontal routing. Uphill reaches are logged; they require transport energy. These ribbons are information pathways, not a claim of simulated gravity-driven hydrology or real provider pipelines.
- Glacier caps represent retained versioned history. They do not imply that old records are inaccurate. The cap's geometry is illustrative.
- `TriggerAvalanche(datasetId, particleCount)` runs an explicit slope-driven debris scenario using gravity projected onto the analytic terrain and simple drag. It is a visual scenario, not a rigid-body contact solver, measured instability model, or prediction about financial data. Debris instances have no collision. Trigger it from Blueprint on a peak dataset.
- Data lakes are explicitly carved reservoir basins with level water surfaces. Shore boundaries are sampled from the terrain; a simple open-front boathouse, timber dock, and stylized boat make them inspectable. The manifest retains dataset membership. These are information reservoirs; they do not create a storage backend or imply access authorization. One boathouse is currently generated per lake; detailed `boathouses` descriptors are retained but custom placements are deferred.
- **B** toggles the boat inspection mode. WASD movement is constrained to a horizontal plane and a conservative shoreline radius at 3 m/s. `EnterBoat(lakeId)`, `ExitBoat()`, `GetLakeNavigation(...)`, and `SetBoatPose(...)` are Blueprint callable. Boat flotation is a fixed water-level placement, with no buoyancy, waves, propulsion, hull collision, or robot kinematics.
- Forests, ribbons, glacier overlays, docks, and boats have no collision in this first pass. Terrain has collision; the spectator is an inspection camera.

Materials and lights come from the bootstrap script. No Marketplace assets are needed. Imported text is retained as data and is not executed. Runtime ingestion is limited to 64 dataset descriptors, eight lakes, and a 16 MB manifest; collision mesh resolution is bounded at 256 by 256 cells.

## External gaze boundary

`ACyberquestGazePawn::SetGaze` is Blueprint callable:

```cpp
SetGaze(FVector(EastMetres, NorthMetres, HeightMetres), YawRadians, PitchRadians, HorizontalFovDegrees);
```

Yaw is clockwise from north; pitch is positive up. This method exits boat inspection mode and places the camera directly. Your hyperemergence engine owns gaze selection and timing. A browser pose `{position:{x,y,z},yaw,pitch,fov}` maps to `FVector(x,z,y)` in this method. Capture this camera for downstream video generation; generated video must not replace the structured environment or act as its physics model.

## Implementation references

- [Epic: procedural mesh sections](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/ProceduralMeshComponent/UProceduralMeshComponent/CreateMeshSection)
- [Epic: material editing Python API](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/MaterialEditingLibrary?application_version=5.7)
