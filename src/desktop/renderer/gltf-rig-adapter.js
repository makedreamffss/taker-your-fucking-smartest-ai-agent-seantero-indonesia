"use strict";

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const REQUIRED_JOINTS = Object.freeze([
  "root", "pelvis", "spine", "chest", "collar", "neck", "head",
  "leftShoulder", "leftElbow", "leftHand",
  "rightShoulder", "rightElbow", "rightHand",
  "leftHip", "leftKnee", "leftFoot",
  "rightHip", "rightKnee", "rightFoot",
]);

export async function loadAuthoredRig(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const nodes = new Map();
  for (const name of REQUIRED_JOINTS) {
    const node = gltf.scene.getObjectByName(name);
    if (!node) throw new Error(`Authored embodiment is missing joint ${name}.`);
    nodes.set(name, node);
  }
  const root = nodes.get("root");
  gltf.scene.updateMatrixWorld(true);
  const initialBounds = new THREE.Box3().setFromObject(gltf.scene);
  const initialSize = initialBounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(initialSize.y) || initialSize.y <= 0) {
    throw new Error("Authored embodiment has invalid bounds.");
  }
  root.scale.multiplyScalar(Math.min(1, 4.05 / initialSize.y));
  gltf.scene.updateMatrixWorld(true);
  const center = new THREE.Box3().setFromObject(gltf.scene).getCenter(new THREE.Vector3());
  root.position.y += -0.12 - center.y;
  gltf.scene.updateMatrixWorld(true);
  const rest = new Map();
  for (const [name, node] of nodes) {
    rest.set(name, {
      position: node.position.clone(),
      rotation: node.rotation.clone(),
      scale: node.scale.clone(),
    });
  }
  const core = gltf.scene.getObjectByName("coreEmitter");
  const visor = gltf.scene.getObjectByName("visor");
  const coreRestScale = core?.scale.clone();
  const visorRestScale = visor?.scale.clone();
  const visualMaterials = [...new Set([core?.material, visor?.material].filter(Boolean))];
  const outlineMaterial = new THREE.LineBasicMaterial({
    color: 0x2bdcf2,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    toneMapped: false,
  });
  const outlinedMeshes = [];
  gltf.scene.traverse((object) => {
    object.frustumCulled = false;
    if (object.isMesh && !object.name.toLowerCase().includes("light") && object !== core && object !== visor) {
      outlinedMeshes.push(object);
    }
  });
  for (const mesh of outlinedMeshes) {
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 34),
      outlineMaterial,
    );
    outline.name = `${mesh.name}Outline`;
    mesh.add(outline);
  }

  return {
    root,
    sceneRoot: gltf.scene,
    nodes,
    rest,
    resetPose() {
      for (const [name, transform] of rest) {
        const node = nodes.get(name);
        node.position.copy(transform.position);
        node.rotation.copy(transform.rotation);
        node.scale.copy(transform.scale);
      }
      if (core) {
        core.rotation.y = 0;
        core.scale.copy(coreRestScale);
      }
    },
    updateVisuals(timeSeconds, speechEnergy, mood) {
      if (core) {
        core.rotation.y = timeSeconds * 0.75;
        core.scale
          .copy(coreRestScale)
          .multiplyScalar(1 + Math.sin(timeSeconds * 3.2) * 0.04 + speechEnergy * 0.22);
      }
      const color = moodColor(mood);
      for (const material of visualMaterials) {
        if (material.emissive) material.emissive.lerp(color, 0.08);
        if ("emissiveIntensity" in material) {
          material.emissiveIntensity = 3.2 + speechEnergy * 5;
        }
      }
      if (visor) {
        visor.scale.copy(visorRestScale);
        visor.scale.x *= 1 + speechEnergy * 0.1;
      }
    },
  };
}

function moodColor(mood) {
  switch (mood) {
    case "concerned": return new THREE.Color(0xffb347);
    case "severe": return new THREE.Color(0xff355d);
    case "confident": return new THREE.Color(0x8c7dff);
    case "calm": return new THREE.Color(0x43ffc3);
    default: return new THREE.Color(0x55eaff);
  }
}
