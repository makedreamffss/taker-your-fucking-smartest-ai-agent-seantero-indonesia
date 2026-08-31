"use strict";

import * as THREE from "three";

const JOINT_COLOR = 0x071216;
const ARMOR_COLOR = 0x10262d;
const ACCENT_COLOR = 0x55eaff;

export function createOriginalTakerRig() {
  const root = joint("root");
  root.position.y = -1.72;

  const materials = createMaterials();
  const nodes = new Map([[root.name, root]]);

  const pelvis = addJoint(root, nodes, "pelvis", [0, 1.28, 0]);
  addMesh(pelvis, new THREE.CapsuleGeometry(0.28, 0.34, 4, 10), materials.armor, {
    scale: [1.08, 0.72, 0.72],
  });

  const spine = addJoint(pelvis, nodes, "spine", [0, 0.46, 0]);
  const chest = addJoint(spine, nodes, "chest", [0, 0.46, 0]);
  addMesh(chest, new THREE.CapsuleGeometry(0.43, 0.5, 6, 12), materials.armor, {
    scale: [1.08, 1, 0.62],
  });
  addMesh(chest, new THREE.TorusGeometry(0.24, 0.025, 6, 32), materials.accent, {
    position: [0, 0.05, 0.36],
  });
  const core = addMesh(chest, new THREE.OctahedronGeometry(0.115, 1), materials.core, {
    position: [0, 0.05, 0.37],
    rotation: [0, 0, Math.PI / 4],
  });

  const collar = addJoint(chest, nodes, "collar", [0, 0.58, 0]);
  addMesh(collar, new THREE.TorusGeometry(0.31, 0.035, 6, 24, Math.PI), materials.accent, {
    rotation: [Math.PI / 2, 0, 0],
  });
  const neck = addJoint(collar, nodes, "neck", [0, 0.18, 0]);
  addMesh(neck, new THREE.CylinderGeometry(0.12, 0.15, 0.24, 10), materials.joint);

  const head = addJoint(neck, nodes, "head", [0, 0.34, 0]);
  addMesh(head, new THREE.DodecahedronGeometry(0.34, 1), materials.armor, {
    scale: [0.82, 1.05, 0.78],
  });
  const visor = addMesh(head, new THREE.BoxGeometry(0.44, 0.09, 0.075), materials.visor, {
    position: [0, 0.05, 0.285],
  });
  addMesh(head, new THREE.TorusGeometry(0.405, 0.012, 4, 24, Math.PI * 1.48), materials.accentDim, {
    rotation: [Math.PI / 2, 0, Math.PI * 0.26],
  });

  createArm(chest, nodes, materials, "left", 1);
  createArm(chest, nodes, materials, "right", -1);
  createLeg(pelvis, nodes, materials, "left", 1);
  createLeg(pelvis, nodes, materials, "right", -1);

  root.traverse((object) => {
    object.castShadow = false;
    object.receiveShadow = false;
    if (object.isMesh) object.frustumCulled = false;
  });

  const rest = new Map();
  for (const [name, node] of nodes) {
    rest.set(name, {
      position: node.position.clone(),
      rotation: node.rotation.clone(),
      scale: node.scale.clone(),
    });
  }

  return {
    root,
    nodes,
    rest,
    materials,
    resetPose() {
      for (const [name, transform] of rest) {
        const node = nodes.get(name);
        node.position.copy(transform.position);
        node.rotation.copy(transform.rotation);
        node.scale.copy(transform.scale);
      }
      core.rotation.y = 0;
      core.scale.setScalar(1);
    },
    updateVisuals(timeSeconds, speechEnergy, mood) {
      const pulse = 1 + Math.sin(timeSeconds * 3.2) * 0.055 + speechEnergy * 0.28;
      core.scale.setScalar(pulse);
      core.rotation.y = timeSeconds * 0.85;
      materials.core.emissiveIntensity = 4.2 + speechEnergy * 8;
      materials.visor.emissiveIntensity = 2.4 + speechEnergy * 6;
      const target = moodColor(mood);
      materials.visor.emissive.lerp(target, 0.08);
      materials.core.emissive.lerp(target, 0.08);
      visor.scale.x = 1 + speechEnergy * 0.12;
    },
  };
}

function createArm(chest, nodes, materials, side, sign) {
  const shoulder = addJoint(chest, nodes, `${side}Shoulder`, [sign * 0.55, 0.36, 0]);
  shoulder.rotation.z = -sign * 0.12;
  addMesh(shoulder, new THREE.SphereGeometry(0.17, 10, 8), materials.joint);
  addMesh(shoulder, new THREE.CapsuleGeometry(0.13, 0.43, 4, 8), materials.armor, {
    position: [0, -0.31, 0],
  });
  const elbow = addJoint(shoulder, nodes, `${side}Elbow`, [0, -0.64, 0]);
  addMesh(elbow, new THREE.SphereGeometry(0.115, 8, 6), materials.accentDim);
  addMesh(elbow, new THREE.CapsuleGeometry(0.105, 0.4, 4, 8), materials.armor, {
    position: [0, -0.29, 0],
  });
  const hand = addJoint(elbow, nodes, `${side}Hand`, [0, -0.58, 0]);
  addMesh(hand, new THREE.OctahedronGeometry(0.14, 0), materials.joint, {
    scale: [0.8, 1.15, 0.75],
  });
}

function createLeg(pelvis, nodes, materials, side, sign) {
  const hip = addJoint(pelvis, nodes, `${side}Hip`, [sign * 0.23, -0.12, 0]);
  addMesh(hip, new THREE.SphereGeometry(0.15, 10, 8), materials.joint);
  addMesh(hip, new THREE.CapsuleGeometry(0.16, 0.54, 4, 9), materials.armor, {
    position: [0, -0.38, 0],
  });
  const knee = addJoint(hip, nodes, `${side}Knee`, [0, -0.76, 0]);
  addMesh(knee, new THREE.OctahedronGeometry(0.15, 0), materials.accentDim);
  addMesh(knee, new THREE.CapsuleGeometry(0.13, 0.48, 4, 9), materials.armor, {
    position: [0, -0.35, 0],
  });
  const foot = addJoint(knee, nodes, `${side}Foot`, [0, -0.69, 0.09]);
  addMesh(foot, new THREE.BoxGeometry(0.3, 0.16, 0.52), materials.joint, {
    position: [0, -0.03, 0.11],
  });
}

function createMaterials() {
  return {
    armor: new THREE.MeshStandardMaterial({
      color: ARMOR_COLOR,
      roughness: 0.27,
      metalness: 0.92,
    }),
    joint: new THREE.MeshStandardMaterial({
      color: JOINT_COLOR,
      roughness: 0.42,
      metalness: 0.75,
    }),
    accent: new THREE.MeshStandardMaterial({
      color: 0x0a3138,
      emissive: ACCENT_COLOR,
      emissiveIntensity: 2.8,
      roughness: 0.2,
      metalness: 0.76,
    }),
    accentDim: new THREE.MeshStandardMaterial({
      color: 0x0b242a,
      emissive: 0x178b9d,
      emissiveIntensity: 1.1,
      roughness: 0.32,
      metalness: 0.68,
    }),
    core: new THREE.MeshStandardMaterial({
      color: 0x07161a,
      emissive: ACCENT_COLOR,
      emissiveIntensity: 4.2,
      roughness: 0.1,
      metalness: 0.35,
    }),
    visor: new THREE.MeshStandardMaterial({
      color: 0x02090b,
      emissive: ACCENT_COLOR,
      emissiveIntensity: 2.4,
      roughness: 0.16,
      metalness: 0.72,
    }),
  };
}

function moodColor(mood) {
  switch (mood) {
    case "concerned": return new THREE.Color(0xffb347);
    case "severe": return new THREE.Color(0xff355d);
    case "confident": return new THREE.Color(0x8c7dff);
    case "calm": return new THREE.Color(0x43ffc3);
    default: return new THREE.Color(ACCENT_COLOR);
  }
}

function joint(name) {
  const group = new THREE.Group();
  group.name = name;
  return group;
}

function addJoint(parent, nodes, name, position) {
  const group = joint(name);
  group.position.set(...position);
  parent.add(group);
  nodes.set(name, group);
  return group;
}

function addMesh(parent, geometry, material, options = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  if (options.position) mesh.position.set(...options.position);
  if (options.rotation) mesh.rotation.set(...options.rotation);
  if (options.scale) mesh.scale.set(...options.scale);
  parent.add(mesh);
  return mesh;
}
