"""Build Taker's original project-owned 3D embodiment as a deterministic GLB.

This script is invoked explicitly with Blender 5.2 LTS. It contains no network,
shell, package-install, or dynamic-code operations.
"""

from __future__ import annotations

import json
import hashlib
import math
import sys
from pathlib import Path

import bpy


JOINT_NAMES = (
    "root", "pelvis", "spine", "chest", "collar", "neck", "head",
    "leftShoulder", "leftElbow", "leftHand",
    "rightShoulder", "rightElbow", "rightHand",
    "leftHip", "leftKnee", "leftFoot",
    "rightHip", "rightKnee", "rightFoot",
)


def project_root() -> Path:
    marker = "--"
    arguments = sys.argv[sys.argv.index(marker) + 1 :] if marker in sys.argv else []
    if len(arguments) != 1:
        raise RuntimeError("Expected exactly one project-root argument after --")
    root = Path(arguments[0]).resolve()
    if root.name != "Taker Takeover":
        raise RuntimeError(f"Refusing unexpected project root: {root}")
    return root


ROOT = project_root()
OUTPUT_DIR = ROOT / "assets" / "embodiment" / "runtime"
SOURCE_DIR = ROOT / "assets" / "embodiment" / "source"
OUTPUT_PATH = OUTPUT_DIR / "taker-agent.glb"


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        if collection is not bpy.data.materials:
            for item in list(collection):
                collection.remove(item)


def material(name: str, base: tuple[float, float, float, float], metallic: float,
             roughness: float, emission: tuple[float, float, float, float] | None = None,
             emission_strength: float = 0.0) -> bpy.types.Material:
    value = bpy.data.materials.new(name)
    value.diffuse_color = base
    value.use_nodes = True
    principled = value.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = base
    principled.inputs["Metallic"].default_value = metallic
    principled.inputs["Roughness"].default_value = roughness
    if emission:
        principled.inputs["Emission Color"].default_value = emission
        principled.inputs["Emission Strength"].default_value = emission_strength
    return value


def empty(name: str, parent: bpy.types.Object | None, location=(0.0, 0.0, 0.0)) -> bpy.types.Object:
    node = bpy.data.objects.new(name, None)
    node.empty_display_type = "PLAIN_AXES"
    node.empty_display_size = 0.08
    bpy.context.collection.objects.link(node)
    node.parent = parent
    node.location = location
    return node


def finish_mesh(obj: bpy.types.Object, parent: bpy.types.Object, name: str,
                mat: bpy.types.Material, location=(0.0, 0.0, 0.0),
                scale=(1.0, 1.0, 1.0), bevel=0.04) -> bpy.types.Object:
    obj.name = name
    obj.data.name = f"{name}Mesh"
    obj.parent = parent
    obj.location = location
    obj.scale = scale
    obj.data.materials.append(mat)
    if bevel > 0:
        modifier = obj.modifiers.new("Production bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
        modifier.limit_method = "ANGLE"
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def cube(parent, name, mat, location, scale, bevel=0.05):
    bpy.ops.mesh.primitive_cube_add(size=1)
    return finish_mesh(bpy.context.object, parent, name, mat, location, scale, bevel)


def sphere(parent, name, mat, location, scale, segments=32, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings)
    return finish_mesh(bpy.context.object, parent, name, mat, location, scale, 0.0)


def cylinder(parent, name, mat, location, radius, depth, scale=(1.0, 1.0, 1.0), vertices=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth)
    return finish_mesh(bpy.context.object, parent, name, mat, location, scale, 0.025)


def torus(parent, name, mat, location, major_radius, minor_radius, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=40,
        minor_segments=8,
        location=(0.0, 0.0, 0.0),
        rotation=rotation,
    )
    return finish_mesh(bpy.context.object, parent, name, mat, location, (1, 1, 1), 0.0)


def mirror_name(side: str, part: str) -> str:
    return f"{side}{part[0].upper()}{part[1:]}Armor"


def build() -> dict:
    clear_scene()
    graphite = material("GraphiteArmor", (0.018, 0.032, 0.042, 1), 0.9, 0.2)
    graphite_2 = material("GraphitePanels", (0.035, 0.075, 0.09, 1), 0.82, 0.28)
    joint_mat = material("JointCeramic", (0.008, 0.014, 0.018, 1), 0.72, 0.34)
    cyan = material(
        "TakerCyan", (0.005, 0.09, 0.12, 1), 0.45, 0.15,
        (0.03, 0.85, 1.0, 1), 2.4,
    )
    violet = material(
        "TakerViolet", (0.03, 0.015, 0.08, 1), 0.5, 0.18,
        (0.34, 0.16, 1.0, 1), 1.6,
    )

    root = empty("root", None, (0, 0, 0))
    pelvis = empty("pelvis", root, (0, 0, 1.22))
    spine = empty("spine", pelvis, (0, 0, 0.46))
    chest = empty("chest", spine, (0, 0, 0.5))
    collar = empty("collar", chest, (0, 0, 0.54))
    neck = empty("neck", collar, (0, 0, 0.18))
    head = empty("head", neck, (0, 0, 0.34))

    cube(pelvis, "PelvisArmor", graphite_2, (0, 0, 0), (0.52, 0.27, 0.23), 0.12)
    cube(pelvis, "PelvisInset", joint_mat, (0, -0.23, 0.02), (0.3, 0.05, 0.13), 0.025)
    cube(spine, "Abdomen", graphite, (0, 0, 0.12), (0.34, 0.23, 0.44), 0.11)
    cube(chest, "ChestArmor", graphite_2, (0, 0, 0.03), (0.69, 0.34, 0.5), 0.16)
    cube(chest, "ChestKeel", graphite, (0, -0.3, 0.02), (0.32, 0.075, 0.34), 0.06)
    torus(chest, "CoreRingOuter", cyan, (0, -0.385, 0.05), 0.245, 0.028, (math.pi / 2, 0, 0))
    torus(chest, "CoreRingInner", violet, (0, -0.398, 0.05), 0.145, 0.018, (math.pi / 2, 0, 0))
    sphere(chest, "coreEmitter", cyan, (0, -0.41, 0.05), (0.1, 0.055, 0.1), 24, 12)
    cube(collar, "CollarLeft", graphite, (0.35, 0, 0), (0.35, 0.28, 0.09), 0.08)
    cube(collar, "CollarRight", graphite, (-0.35, 0, 0), (0.35, 0.28, 0.09), 0.08)
    cylinder(neck, "NeckColumn", joint_mat, (0, 0, 0.07), 0.13, 0.28)

    cube(head, "HeadShell", graphite, (0, 0.01, 0.03), (0.34, 0.27, 0.32), 0.12)
    cube(head, "visor", cyan, (0, -0.265, 0.05), (0.29, 0.028, 0.075), 0.035)
    cube(head, "VisorBrow", graphite_2, (0, -0.283, 0.15), (0.35, 0.038, 0.055), 0.025)
    torus(head, "Halo", violet, (0, 0.04, 0.12), 0.42, 0.012, (math.pi / 2, 0, 0))

    for side, sign in (("left", 1), ("right", -1)):
        shoulder = empty(f"{side}Shoulder", chest, (sign * 0.7, 0, 0.31))
        elbow = empty(f"{side}Elbow", shoulder, (0, 0, -0.72))
        hand = empty(f"{side}Hand", elbow, (0, 0, -0.63))
        sphere(shoulder, mirror_name(side, "shoulderJoint"), joint_mat, (0, 0, 0), (0.19, 0.2, 0.19))
        sphere(shoulder, mirror_name(side, "shoulderCap"), graphite_2, (sign * 0.07, 0.01, 0.02), (0.25, 0.29, 0.18))
        cylinder(shoulder, mirror_name(side, "upperArm"), graphite, (0, 0, -0.35), 0.14, 0.55, (1.0, 0.85, 1.0))
        torus(shoulder, mirror_name(side, "bicepLight"), cyan, (0, 0, -0.52), 0.145, 0.018)
        sphere(elbow, mirror_name(side, "elbowJoint"), cyan, (0, 0, 0), (0.13, 0.13, 0.13), 20, 10)
        cylinder(elbow, mirror_name(side, "forearm"), graphite_2, (0, 0, -0.3), 0.15, 0.48, (1.15, 0.9, 1.0))
        cube(hand, mirror_name(side, "hand"), joint_mat, (0, -0.015, -0.02), (0.17, 0.15, 0.2), 0.07)
        cube(hand, mirror_name(side, "handLight"), cyan, (0, -0.15, 0.0), (0.09, 0.025, 0.075), 0.018)

        hip = empty(f"{side}Hip", pelvis, (sign * 0.31, 0, -0.14))
        knee = empty(f"{side}Knee", hip, (0, 0, -0.83))
        foot = empty(f"{side}Foot", knee, (0, 0, -0.78))
        sphere(hip, mirror_name(side, "hipJoint"), joint_mat, (0, 0, 0), (0.18, 0.19, 0.18))
        cylinder(hip, mirror_name(side, "thigh"), graphite_2, (0, 0, -0.4), 0.18, 0.63, (1.08, 0.9, 1))
        cube(knee, mirror_name(side, "kneeCap"), cyan, (0, -0.13, 0), (0.15, 0.08, 0.15), 0.035)
        cylinder(knee, mirror_name(side, "shin"), graphite, (0, 0, -0.37), 0.14, 0.58, (1.0, 0.82, 1))
        cube(foot, mirror_name(side, "boot"), graphite_2, (0, -0.1, -0.03), (0.22, 0.34, 0.16), 0.08)
        cube(foot, mirror_name(side, "toeLight"), cyan, (0, -0.39, -0.01), (0.12, 0.035, 0.045), 0.02)

    found = {obj.name for obj in bpy.context.scene.objects}
    missing = sorted(set(JOINT_NAMES) - found)
    if missing:
        raise RuntimeError(f"Missing required rig nodes: {missing}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.engine = "BLENDER_EEVEE"
    bpy.context.scene.render.film_transparent = True
    bpy.context.preferences.filepaths.save_version = 0
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE_DIR / "taker-agent.blend"))
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT_PATH),
        export_format="GLB",
        export_apply=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
    )
    digest = hashlib.sha256(OUTPUT_PATH.read_bytes()).hexdigest()
    return {
        "schemaVersion": 1,
        "generator": "Blender 5.2.1 LTS deterministic project recipe",
        "sourceScript": "scripts/blender/build_taker_embodiment.py",
        "output": str(OUTPUT_PATH.relative_to(ROOT)).replace("\\", "/"),
        "sha256": digest,
        "license": "LicenseRef-Taker-Project",
        "requiredJoints": list(JOINT_NAMES),
        "thirdPartyAssets": [],
    }


manifest = build()
(OUTPUT_DIR / "taker-agent.source.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
(OUTPUT_DIR / "taker-agent.license.txt").write_text(
    "Original project-authored Taker embodiment. No third-party meshes, textures, "
    "motions, or likenesses are included. Distribution terms follow the repository "
    "license; the repository owner must declare that license before redistribution.\n",
    encoding="utf-8",
)
print(json.dumps(manifest, indent=2))
