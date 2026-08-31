"use strict";

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import {
  createVRMAnimationClip,
  VRMAnimationLoaderPlugin,
  VRMLookAtQuaternionProxy,
} from "@pixiv/three-vrm-animation";

export class VrmAvatarAdapter {
  constructor() {
    this.loader = new GLTFLoader();
    this.loader.register((parser) => new VRMLoaderPlugin(parser));
    this.loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    this.vrm = null;
    this.mixer = null;
  }

  async loadAvatar(url, scene) {
    const gltf = await this.loader.loadAsync(url);
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error("Asset is not a valid VRM avatar.");
    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    VRMUtils.combineSkeletons(vrm.scene);
    vrm.scene.traverse((object) => {
      object.frustumCulled = false;
    });
    if (vrm.lookAt) {
      const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
      proxy.name = "lookAtQuaternionProxy";
      vrm.scene.add(proxy);
    }
    this.vrm = vrm;
    scene.add(vrm.scene);
    return vrm;
  }

  async loadAnimation(url, THREE) {
    if (!this.vrm) throw new Error("Load a VRM avatar before loading VRMA.");
    const gltf = await this.loader.loadAsync(url);
    const animation = gltf.userData.vrmAnimations?.[0];
    if (!animation) throw new Error("Asset is not a valid VRMA animation.");
    const clip = createVRMAnimationClip(animation, this.vrm);
    this.mixer ??= new THREE.AnimationMixer(this.vrm.scene);
    return this.mixer.clipAction(clip);
  }

  update(deltaSeconds) {
    this.mixer?.update(deltaSeconds);
    this.vrm?.update(deltaSeconds);
  }
}
