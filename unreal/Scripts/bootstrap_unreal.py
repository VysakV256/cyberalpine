"""Run inside Unreal Editor after compiling the CyberquestUnreal module.
Creates local material and level assets; no network requests or source ingestion.
Commandlet: UnrealEditor-Cmd project.uproject -run=pythonscript -script=.../bootstrap_unreal.py
"""
import pathlib
import unreal

ROOT = "/Game/Cyberquest"
MATERIALS = ROOT + "/Materials"
MAP = ROOT + "/Maps/InformationUniverse"
actor_class = unreal.load_class(None, "/Script/CyberquestUnreal.CyberquestUniverse")
if actor_class is None:
    raise RuntimeError("Compile CyberquestUnreal first. The native universe actor is unavailable.")

assets = unreal.AssetToolsHelpers.get_asset_tools()
for folder in (ROOT, MATERIALS, ROOT + "/Maps"):
    unreal.EditorAssetLibrary.make_directory(folder)


def material(name, color=None, roughness=0.8):
    path = MATERIALS + "/" + name
    result = unreal.EditorAssetLibrary.load_asset(path)
    if result is not None:
        return result
    result = assets.create_asset(name, MATERIALS, unreal.Material, unreal.MaterialFactoryNew())
    if result is None:
        raise RuntimeError("Cannot create material: " + path)
    if color is None:
        node = unreal.MaterialEditingLibrary.create_material_expression(result, unreal.MaterialExpressionVertexColor, -350, 0)
        unreal.MaterialEditingLibrary.connect_material_property(node, "RGB", unreal.MaterialProperty.MP_BASE_COLOR)
    else:
        node = unreal.MaterialEditingLibrary.create_material_expression(result, unreal.MaterialExpressionConstant3Vector, -350, 0)
        node.set_editor_property("constant", unreal.LinearColor(*color, 1.0))
        unreal.MaterialEditingLibrary.connect_material_property(node, "", unreal.MaterialProperty.MP_BASE_COLOR)
    scalar = unreal.MaterialEditingLibrary.create_material_expression(result, unreal.MaterialExpressionConstant, -350, 160)
    scalar.set_editor_property("r", roughness)
    unreal.MaterialEditingLibrary.connect_material_property(scalar, "", unreal.MaterialProperty.MP_ROUGHNESS)
    result.set_editor_property("two_sided", True)
    unreal.MaterialEditingLibrary.recompile_material(result)
    unreal.EditorAssetLibrary.save_loaded_asset(result)
    return result


material("M_Terrain")
material("M_Water", (0.05, 0.48, 0.70), 0.2)
material("M_Ice", (0.65, 0.84, 0.95), 0.3)
material("M_Bark", (0.12, 0.06, 0.025), 0.95)
material("M_Leaves", (0.035, 0.22, 0.10), 0.9)
material("M_Rock", (0.40, 0.34, 0.28), 0.85)
material("M_Boat", (0.46, 0.13, 0.045), 0.6)

levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
if unreal.EditorAssetLibrary.does_asset_exist(MAP):
    if not levels.load_level(MAP):
        raise RuntimeError("Cannot load starter map")
else:
    if not levels.new_level(MAP):
        raise RuntimeError("Cannot create starter map")

existing = actors.get_all_level_actors()
universe = next((a for a in existing if a.get_class() == actor_class), None)
if universe is None:
    universe = actors.spawn_actor_from_class(actor_class, unreal.Vector(0, 0, 0))
    universe.set_actor_label("Cyberquest — Dataset Universe")
if not universe.rebuild_universe():
    raise RuntimeError("Universe manifest could not be loaded. Check Content/Data/universe.json and Output Log.")

if not any(isinstance(a, unreal.DirectionalLight) for a in existing):
    sun = actors.spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector(0, 0, 18000), unreal.Rotator(-40, -30, 0))
    sun.set_actor_label("Cyberquest sun")
    sun.get_component_by_class(unreal.DirectionalLightComponent).set_editor_property("intensity", 4.0)
if not any(isinstance(a, unreal.SkyLight) for a in existing):
    sky = actors.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0, 0, 8000))
    sky.get_component_by_class(unreal.SkyLightComponent).set_editor_property("intensity", 1.0)
if not any(isinstance(a, unreal.SkyAtmosphere) for a in existing):
    actors.spawn_actor_from_class(unreal.SkyAtmosphere, unreal.Vector(0, 0, 0))

unreal.EditorLevelLibrary.set_level_viewport_camera_info(unreal.Vector(0, -10000, 6500), unreal.Rotator(-30, 90, 0))
if not levels.save_current_level():
    raise RuntimeError("The starter map did not save")
unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)

# Persist the starter map without requiring a binary map in the source archive.
config = pathlib.Path(unreal.Paths.project_config_dir()) / "DefaultEngine.ini"
text = config.read_text() if config.exists() else ""
header = "[/Script/EngineSettings.GameMapsSettings]"
settings = "\nEditorStartupMap=" + MAP + "\nGameDefaultMap=" + MAP + "\n"
if "EditorStartupMap=" not in text:
    text = text.replace(header, header + settings) if header in text else text + "\n" + header + settings
    config.write_text(text)
unreal.log("Cyberquest starter map created. Press Play; WASD and mouse operate the spectator camera. External gaze is SetGaze.")
