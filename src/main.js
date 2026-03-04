/**
 * VMC Hands - Hand tracking/posing for VSeeFace
 */

import { Hands } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';

// ─── DOM Elements ──────────────────────────────────────────────────

const videoEl = document.getElementById('webcam');
const canvasEl = document.getElementById('canvas');
const ctx = canvasEl.getContext('2d');

const bridgeStatus = document.getElementById('bridge-status');
const bridgeText = document.getElementById('bridge-text');

const btnCamera = document.getElementById('btn-camera');
const btnConnect = document.getElementById('btn-connect');
const btnReset = document.getElementById('btn-reset');
const modeTrack = document.getElementById('mode-track');
const modePose = document.getElementById('mode-pose');

const curlMultInput = document.getElementById('curl-mult');
const thumbMultInput = document.getElementById('thumb-mult');
const smoothingInput = document.getElementById('smoothing');

// ─── State ─────────────────────────────────────────────────────────

let mode = 'track';  // 'track' or 'pose'
let cameraRunning = false;
let camera = null;
let hands = null;

// Manual pose values (degrees)
const pose = {
  right: {
    Thumb: [0, 0, 0, 0],   // [prox, int, dist, spread]
    Index: [0, 0, 0],
    Middle: [0, 0, 0],
    Ring: [0, 0, 0],
    Little: [0, 0, 0],
  },
  left: {
    Thumb: [0, 0, 0, 0],
    Index: [0, 0, 0],
    Middle: [0, 0, 0],
    Ring: [0, 0, 0],
    Little: [0, 0, 0],
  }
};

// Body bone poses (degrees) - { boneName: { x, y, z } }
const bodyPose = {
  Head: { x: 0, y: 0, z: 0 },
  Neck: { x: 0, y: 0, z: 0 },
  Spine: { x: 0, y: 0, z: 0 },
  Chest: { x: 0, y: 0, z: 0 },
  Hips: { x: 0, y: 0, z: 0 },
  RightShoulder: { x: 0, y: 0, z: 0 },
  RightUpperArm: { x: 0, y: 0, z: 0 },
  RightLowerArm: { x: 0, y: 0, z: 0 },
  LeftShoulder: { x: 0, y: 0, z: 0 },
  LeftUpperArm: { x: 0, y: 0, z: 0 },
  LeftLowerArm: { x: 0, y: 0, z: 0 },
  RightUpperLeg: { x: 0, y: 0, z: 0 },
  RightLowerLeg: { x: 0, y: 0, z: 0 },
  RightFoot: { x: 0, y: 0, z: 0 },
  LeftUpperLeg: { x: 0, y: 0, z: 0 },
  LeftLowerLeg: { x: 0, y: 0, z: 0 },
  LeftFoot: { x: 0, y: 0, z: 0 },
};

// Smoothed values for tracking mode
const smoothed = {
  right: {},
  left: {}
};

// Settings
const settings = {
  curlMultiplier: 0.75,
  thumbMultiplier: 0.75,
  smoothing: 0.5,
};

// ─── WebSocket / VMC Bridge ────────────────────────────────────────

let ws = null;
let wsConnected = false;

function connectBridge() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  
  ws = new WebSocket('ws://localhost:8765');
  
  ws.onopen = () => {
    wsConnected = true;
    bridgeStatus.classList.add('connected');
    bridgeText.textContent = 'Bridge: Connected';
    btnConnect.textContent = '🔌 Disconnect';
  };
  
  ws.onclose = () => {
    wsConnected = false;
    bridgeStatus.classList.remove('connected');
    bridgeText.textContent = 'Bridge: Disconnected';
    btnConnect.textContent = '🔌 Connect Bridge';
  };
  
  ws.onerror = () => {
    console.warn('[VMC] Connection error');
  };
}

function disconnectBridge() {
  if (ws) {
    ws.close();
    ws = null;
  }
}

function sendBones(bones) {
  if (!wsConnected || !ws) return;
  try {
    ws.send(JSON.stringify({ bones }));
  } catch (e) {
    console.warn('[VMC] Send error:', e);
  }
}

// ─── Math Helpers ──────────────────────────────────────────────────

const DEG2RAD = Math.PI / 180;

function quatFromAxisAngle(axis, angleDeg) {
  const angle = angleDeg * DEG2RAD;
  const half = angle / 2;
  const s = Math.sin(half);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) };
}

function multiplyQuat(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// ─── Pose to Bones ─────────────────────────────────────────────────

const BONE_NAMES = ['Proximal', 'Intermediate', 'Distal'];
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];

// Convert euler angles (degrees) to quaternion
function eulerToQuat(x, y, z) {
  const DEG2RAD = Math.PI / 180;
  const cx = Math.cos(x * DEG2RAD / 2);
  const sx = Math.sin(x * DEG2RAD / 2);
  const cy = Math.cos(y * DEG2RAD / 2);
  const sy = Math.sin(y * DEG2RAD / 2);
  const cz = Math.cos(z * DEG2RAD / 2);
  const sz = Math.sin(z * DEG2RAD / 2);
  
  return {
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz
  };
}

function bodyPoseToBones() {
  const bones = [];
  for (const [boneName, rot] of Object.entries(bodyPose)) {
    const quat = eulerToQuat(rot.x, rot.y, rot.z);
    bones.push({ name: boneName, quat });
  }
  return bones;
}

function poseToBones(handPose, isLeft) {
  const side = isLeft ? 'Left' : 'Right';
  const bones = [];
  
  // Wrist
  bones.push({ name: `${side}Hand`, quat: { x: 0, y: 0, z: 0, w: 1 } });
  
  for (const finger of FINGERS) {
    const values = handPose[finger];
    
    for (let i = 0; i < 3; i++) {
      let quat;
      
      if (finger === 'Thumb') {
        // Thumb: curl on Y, spread on X for proximal
        const curl = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, values[i]);
        if (i === 0 && values[3] !== undefined) {
          const spread = quatFromAxisAngle({ x: 1, y: 0, z: 0 }, values[3]);
          quat = multiplyQuat(spread, curl);
        } else {
          quat = curl;
        }
      } else {
        // Other fingers: curl on Z
        quat = quatFromAxisAngle({ x: 0, y: 0, z: 1 }, -values[i]);
      }
      
      bones.push({ name: `${side}${finger}${BONE_NAMES[i]}`, quat });
    }
  }
  
  return bones;
}

// ─── MediaPipe Hand Tracking ───────────────────────────────────────

const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

const FINGER_CHAINS = {
  Thumb:  [LM.WRIST, LM.THUMB_CMC, LM.THUMB_MCP, LM.THUMB_IP, LM.THUMB_TIP],
  Index:  [LM.WRIST, LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP, LM.INDEX_TIP],
  Middle: [LM.WRIST, LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP],
  Ring:   [LM.WRIST, LM.RING_MCP, LM.RING_PIP, LM.RING_DIP, LM.RING_TIP],
  Little: [LM.WRIST, LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_DIP, LM.PINKY_TIP],
};

function vec3sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function vec3dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function vec3len(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
function vec3norm(v) { const l = vec3len(v); return l > 0 ? { x: v.x/l, y: v.y/l, z: v.z/l } : { x: 0, y: 0, z: 0 }; }

function calcAngle(lm, i1, i2, i3) {
  const v1 = vec3norm(vec3sub(lm[i1], lm[i2]));
  const v2 = vec3norm(vec3sub(lm[i3], lm[i2]));
  const d = Math.max(-1, Math.min(1, vec3dot(v1, v2)));
  return (Math.PI - Math.acos(d)) / DEG2RAD;  // Return degrees
}

function calcThumbSpread(lm) {
  const thumbTip = lm[LM.THUMB_TIP];
  const indexMcp = lm[LM.INDEX_MCP];
  const wrist = lm[LM.WRIST];
  const v1 = vec3norm(vec3sub(indexMcp, wrist));
  const v2 = vec3norm(vec3sub(thumbTip, wrist));
  const d = Math.max(-1, Math.min(1, vec3dot(v1, v2)));
  return (Math.acos(d) - 0.5) / DEG2RAD;
}

function landmarksToPose(landmarks, isLeft) {
  const side = isLeft ? 'left' : 'right';
  const result = {};
  
  for (const [finger, chain] of Object.entries(FINGER_CHAINS)) {
    const angles = [];
    for (let i = 0; i < 3; i++) {
      let angle = calcAngle(landmarks, chain[i], chain[i+1], chain[i+2]);
      const mult = finger === 'Thumb' ? settings.thumbMultiplier : settings.curlMultiplier;
      angle *= mult;
      
      // Smooth
      const key = `${finger}${i}`;
      if (smoothed[side][key] === undefined) smoothed[side][key] = angle;
      smoothed[side][key] = lerp(angle, smoothed[side][key], settings.smoothing);
      angles.push(smoothed[side][key]);
    }
    
    if (finger === 'Thumb') {
      let spread = calcThumbSpread(landmarks) * settings.thumbMultiplier;
      const spreadKey = `${finger}Spread`;
      if (smoothed[side][spreadKey] === undefined) smoothed[side][spreadKey] = spread;
      smoothed[side][spreadKey] = lerp(spread, smoothed[side][spreadKey], settings.smoothing);
      angles.push(smoothed[side][spreadKey]);
    }
    
    result[finger] = angles;
  }
  
  return result;
}

// ─── Hand Drawing ──────────────────────────────────────────────────

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],[0,17]
];

function drawHand(landmarks, color) {
  drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color, lineWidth: 3 });
  drawLandmarks(ctx, landmarks, { color, lineWidth: 1, radius: 4 });
}

// ─── MediaPipe Results Handler ─────────────────────────────────────

function onResults(results) {
  canvasEl.width = videoEl.videoWidth;
  canvasEl.height = videoEl.videoHeight;
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  
  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    return;
  }
  
  const allBones = [];
  
  for (let i = 0; i < results.multiHandLandmarks.length; i++) {
    const landmarks = results.multiHandLandmarks[i];
    const handedness = results.multiHandedness[i];
    const isLeft = handedness.label === 'Right';  // Mirrored
    
    drawHand(landmarks, isLeft ? '#ff6b35' : '#4ade80');
    
    if (mode === 'track') {
      const handPose = landmarksToPose(landmarks, isLeft);
      const bones = poseToBones(handPose, isLeft);
      allBones.push(...bones);
      
      // Update sliders to show tracked values
      updateSlidersFromPose(handPose, isLeft ? 'left' : 'right');
    }
  }
  
  if (mode === 'track' && allBones.length > 0) {
    sendBones(allBones);
  }
}

// ─── Camera Control ────────────────────────────────────────────────

async function startCamera() {
  if (!hands) {
    hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });
    
    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.5
    });
    
    hands.onResults(onResults);
  }
  
  if (!camera) {
    camera = new Camera(videoEl, {
      onFrame: async () => {
        if (hands) await hands.send({ image: videoEl });
      },
      width: 640,
      height: 480
    });
  }
  
  await camera.start();
  cameraRunning = true;
  btnCamera.textContent = '📷 Stop Camera';
}

function stopCamera() {
  if (camera) camera.stop();
  cameraRunning = false;
  btnCamera.textContent = '📷 Start Camera';
}

// ─── Slider Handling ───────────────────────────────────────────────

function updateSlidersFromPose(handPose, hand) {
  for (const [finger, values] of Object.entries(handPose)) {
    for (let i = 0; i < values.length; i++) {
      const joint = i < 3 ? i : 'spread';
      const slider = document.querySelector(`input[data-hand="${hand}"][data-finger="${finger}"][data-joint="${joint}"]`);
      if (slider) {
        const rounded = Math.round(values[i]);
        slider.value = rounded;
        slider.nextElementSibling.textContent = `${rounded}°`;
      }
    }
  }
}

function onSliderChange(e) {
  const slider = e.target;
  const value = parseFloat(slider.value);
  
  slider.nextElementSibling.textContent = `${Math.round(value)}°`;
  
  // Body bone slider
  if (slider.dataset.bone) {
    const bone = slider.dataset.bone;
    const axis = slider.dataset.axis;
    if (bodyPose[bone]) {
      bodyPose[bone][axis] = value;
    }
  }
  // Hand slider
  else if (slider.dataset.hand) {
    const hand = slider.dataset.hand;
    const finger = slider.dataset.finger;
    const joint = slider.dataset.joint;
    
    if (joint === 'spread') {
      pose[hand][finger][3] = value;
    } else {
      pose[hand][finger][parseInt(joint)] = value;
    }
  }
  
  // In pose mode, send immediately
  if (mode === 'pose') {
    sendPose();
  }
}

function sendPose() {
  const bones = [
    ...bodyPoseToBones(),
    ...poseToBones(pose.right, false),
    ...poseToBones(pose.left, true)
  ];
  sendBones(bones);
}

function resetPose() {
  // Reset hands
  for (const hand of ['right', 'left']) {
    for (const finger of FINGERS) {
      const len = finger === 'Thumb' ? 4 : 3;
      pose[hand][finger] = new Array(len).fill(0);
    }
  }
  
  // Reset body
  for (const bone of Object.keys(bodyPose)) {
    bodyPose[bone] = { x: 0, y: 0, z: 0 };
  }
  
  // Reset all sliders
  document.querySelectorAll('input[type="range"]').forEach(slider => {
    slider.value = 0;
    slider.nextElementSibling.textContent = '0°';
  });
  
  if (mode === 'pose') sendPose();
}

// ─── Mode Toggle ───────────────────────────────────────────────────

function setMode(newMode) {
  mode = newMode;
  modeTrack.classList.toggle('active', mode === 'track');
  modePose.classList.toggle('active', mode === 'pose');
  
  // Disable sliders in track mode
  document.querySelectorAll('input[type="range"]').forEach(slider => {
    slider.disabled = mode === 'track';
  });
}

// ─── Pose Loop (for pose mode) ─────────────────────────────────────

function poseLoop() {
  if (mode === 'pose') {
    sendPose();
  }
  requestAnimationFrame(poseLoop);
}

// ─── Animation System ──────────────────────────────────────────────

const animation = {
  keyframes: [],      // Array of { time, pose, bodyPose }
  duration: 0,
  playing: false,
  recording: false,
  recordStart: 0,
  playStart: 0,
  speed: 1.0,
  loop: true,
};

// Animation elements - grabbed in init() to ensure DOM ready
let btnRec, btnKey, btnPlay, btnStop, btnClearAnim, btnSaveAnim, btnLoadAnim;
let animFile, animSpeed, animLoop, speedVal, timelineBar, timelineProgress, keyframesEl, timelineInfo;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function getCurrentPoseSnapshot() {
  return {
    pose: deepClone(pose),
    bodyPose: deepClone(bodyPose)
  };
}

function addKeyframe() {
  const time = animation.recording 
    ? (Date.now() - animation.recordStart) / 1000
    : animation.duration;
  
  animation.keyframes.push({
    time,
    ...getCurrentPoseSnapshot()
  });
  
  // Sort by time
  animation.keyframes.sort((a, b) => a.time - b.time);
  
  // Update duration
  if (animation.keyframes.length > 0) {
    animation.duration = animation.keyframes[animation.keyframes.length - 1].time;
  }
  
  updateTimelineUI();
}

function startRecording() {
  animation.recording = true;
  animation.recordStart = Date.now();
  animation.keyframes = [];
  animation.duration = 0;
  if (btnRec) {
    btnRec.classList.add('recording');
    btnRec.textContent = '⏺ Recording...';
  }
  updateTimelineUI();
}

function stopRecording() {
  animation.recording = false;
  if (btnRec) {
    btnRec.classList.remove('recording');
    btnRec.textContent = '⏺ Record';
  }
  
  if (animation.keyframes.length > 0) {
    animation.duration = animation.keyframes[animation.keyframes.length - 1].time;
  }
  updateTimelineUI();
}

function startPlayback() {
  if (animation.keyframes.length < 2) {
    alert('Need at least 2 keyframes to play');
    return;
  }
  
  animation.playing = true;
  animation.playStart = Date.now();
  if (btnPlay) {
    btnPlay.classList.add('playing');
    btnPlay.textContent = '▶ Playing';
  }
}

function stopPlayback() {
  animation.playing = false;
  if (btnPlay) {
    btnPlay.classList.remove('playing');
    btnPlay.textContent = '▶ Play';
  }
  if (timelineProgress) timelineProgress.style.width = '0%';
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpPose(poseA, poseB, t) {
  const result = {};
  for (const hand of ['right', 'left']) {
    result[hand] = {};
    for (const finger of FINGERS) {
      result[hand][finger] = poseA[hand][finger].map((v, i) => 
        lerp(v, poseB[hand][finger][i], t)
      );
    }
  }
  return result;
}

function lerpBodyPose(bodyA, bodyB, t) {
  const result = {};
  for (const bone of Object.keys(bodyA)) {
    result[bone] = {
      x: lerp(bodyA[bone].x, bodyB[bone].x, t),
      y: lerp(bodyA[bone].y, bodyB[bone].y, t),
      z: lerp(bodyA[bone].z, bodyB[bone].z, t),
    };
  }
  return result;
}

function getInterpolatedPose(time) {
  const kfs = animation.keyframes;
  
  if (kfs.length === 0) return null;
  if (kfs.length === 1) return { pose: kfs[0].pose, bodyPose: kfs[0].bodyPose };
  
  // Find surrounding keyframes
  let prev = kfs[0];
  let next = kfs[kfs.length - 1];
  
  for (let i = 0; i < kfs.length - 1; i++) {
    if (time >= kfs[i].time && time <= kfs[i + 1].time) {
      prev = kfs[i];
      next = kfs[i + 1];
      break;
    }
  }
  
  // Interpolate
  const duration = next.time - prev.time;
  const t = duration > 0 ? (time - prev.time) / duration : 0;
  
  return {
    pose: lerpPose(prev.pose, next.pose, t),
    bodyPose: lerpBodyPose(prev.bodyPose, next.bodyPose, t)
  };
}

function updateAnimation() {
  if (!animation.playing) return;
  
  let elapsed = ((Date.now() - animation.playStart) / 1000) * animation.speed;
  
  if (animation.loop && animation.duration > 0) {
    elapsed = elapsed % animation.duration;
  } else if (elapsed >= animation.duration) {
    stopPlayback();
    return;
  }
  
  // Update progress bar
  const progress = animation.duration > 0 ? (elapsed / animation.duration) * 100 : 0;
  if (timelineProgress) timelineProgress.style.width = `${progress}%`;
  
  // Get interpolated pose and apply
  const interpolated = getInterpolatedPose(elapsed);
  if (interpolated) {
    // Apply to local state
    Object.assign(pose.right, interpolated.pose.right);
    Object.assign(pose.left, interpolated.pose.left);
    for (const bone of Object.keys(bodyPose)) {
      Object.assign(bodyPose[bone], interpolated.bodyPose[bone]);
    }
    
    // Send to VMC
    sendPose();
    
    // Update sliders to reflect current pose
    updateAllSliders();
  }
}

function updateAllSliders() {
  // Update hand sliders
  for (const hand of ['right', 'left']) {
    for (const [finger, values] of Object.entries(pose[hand])) {
      for (let i = 0; i < values.length; i++) {
        const joint = i < 3 ? i : 'spread';
        const slider = document.querySelector(`input[data-hand="${hand}"][data-finger="${finger}"][data-joint="${joint}"]`);
        if (slider) {
          slider.value = Math.round(values[i]);
          slider.nextElementSibling.textContent = `${Math.round(values[i])}°`;
        }
      }
    }
  }
  
  // Update body sliders
  for (const [bone, rot] of Object.entries(bodyPose)) {
    for (const axis of ['x', 'y', 'z']) {
      const slider = document.querySelector(`input[data-bone="${bone}"][data-axis="${axis}"]`);
      if (slider) {
        slider.value = Math.round(rot[axis]);
        slider.nextElementSibling.textContent = `${Math.round(rot[axis])}°`;
      }
    }
  }
}

function updateTimelineUI() {
  if (!keyframesEl || !timelineInfo) return;
  
  // Update keyframe markers
  keyframesEl.innerHTML = '';
  const duration = animation.duration || 1;
  
  for (const kf of animation.keyframes) {
    const marker = document.createElement('div');
    marker.className = 'keyframe-marker';
    marker.style.left = `${(kf.time / duration) * 100}%`;
    keyframesEl.appendChild(marker);
  }
  
  // Update info
  timelineInfo.textContent = `${animation.keyframes.length} keyframes, ${animation.duration.toFixed(1)}s`;
}

function clearAnimation() {
  if (animation.keyframes.length > 0 && !confirm('Clear all keyframes?')) return;
  animation.keyframes = [];
  animation.duration = 0;
  stopPlayback();
  stopRecording();
  updateTimelineUI();
}

function saveAnimation() {
  if (animation.keyframes.length === 0) {
    alert('No keyframes to save');
    return;
  }
  
  const data = {
    version: 1,
    duration: animation.duration,
    keyframes: animation.keyframes
  };
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `animation-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function loadAnimation(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.keyframes && Array.isArray(data.keyframes)) {
        animation.keyframes = data.keyframes;
        animation.duration = data.duration || 0;
        updateTimelineUI();
      }
    } catch (err) {
      alert('Invalid animation file');
    }
  };
  reader.readAsText(file);
}

// Animation loop
function animationLoop() {
  updateAnimation();
  requestAnimationFrame(animationLoop);
}

// ─── Init ──────────────────────────────────────────────────────────

function init() {
  // Grab animation elements
  btnRec = document.getElementById('btn-rec');
  btnKey = document.getElementById('btn-key');
  btnPlay = document.getElementById('btn-play');
  btnStop = document.getElementById('btn-stop');
  btnClearAnim = document.getElementById('btn-clear-anim');
  btnSaveAnim = document.getElementById('btn-save-anim');
  btnLoadAnim = document.getElementById('btn-load-anim');
  animFile = document.getElementById('anim-file');
  animSpeed = document.getElementById('anim-speed');
  animLoop = document.getElementById('anim-loop');
  speedVal = document.getElementById('speed-val');
  timelineBar = document.getElementById('timeline-bar');
  timelineProgress = document.getElementById('timeline-progress');
  keyframesEl = document.getElementById('keyframes');
  timelineInfo = document.getElementById('timeline-info');
  
  // Button events
  btnCamera.addEventListener('click', () => {
    cameraRunning ? stopCamera() : startCamera();
  });
  
  btnConnect.addEventListener('click', () => {
    wsConnected ? disconnectBridge() : connectBridge();
  });
  
  btnReset.addEventListener('click', resetPose);
  
  modeTrack.addEventListener('click', () => setMode('track'));
  modePose.addEventListener('click', () => setMode('pose'));
  
  // Slider events
  document.querySelectorAll('input[type="range"]').forEach(slider => {
    slider.addEventListener('input', onSliderChange);
  });
  
  // Settings
  curlMultInput.addEventListener('change', (e) => {
    settings.curlMultiplier = parseFloat(e.target.value);
  });
  thumbMultInput.addEventListener('change', (e) => {
    settings.thumbMultiplier = parseFloat(e.target.value);
  });
  smoothingInput.addEventListener('change', (e) => {
    settings.smoothing = parseFloat(e.target.value);
  });
  
  // Animation controls
  btnRec.addEventListener('click', () => {
    animation.recording ? stopRecording() : startRecording();
  });
  
  btnKey.addEventListener('click', addKeyframe);
  
  btnPlay.addEventListener('click', () => {
    animation.playing ? stopPlayback() : startPlayback();
  });
  
  btnStop.addEventListener('click', () => {
    stopPlayback();
    stopRecording();
  });
  
  btnClearAnim.addEventListener('click', clearAnimation);
  btnSaveAnim.addEventListener('click', saveAnimation);
  btnLoadAnim.addEventListener('click', () => animFile.click());
  animFile.addEventListener('change', (e) => {
    if (e.target.files[0]) loadAnimation(e.target.files[0]);
  });
  
  animSpeed.addEventListener('input', (e) => {
    animation.speed = parseFloat(e.target.value);
    speedVal.textContent = `${animation.speed.toFixed(1)}x`;
  });
  
  animLoop.addEventListener('change', (e) => {
    animation.loop = e.target.checked;
  });
  
  timelineBar.addEventListener('click', (e) => {
    if (animation.keyframes.length < 2) return;
    const rect = timelineBar.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const time = x * animation.duration;
    
    // Jump to this time
    animation.playStart = Date.now() - (time * 1000 / animation.speed);
    if (!animation.playing) {
      const interpolated = getInterpolatedPose(time);
      if (interpolated) {
        Object.assign(pose.right, interpolated.pose.right);
        Object.assign(pose.left, interpolated.pose.left);
        for (const bone of Object.keys(bodyPose)) {
          Object.assign(bodyPose[bone], interpolated.bodyPose[bone]);
        }
        sendPose();
        updateAllSliders();
        timelineProgress.style.width = `${x * 100}%`;
      }
    }
  });
  
  // Start loops
  poseLoop();
  animationLoop();
  
  // Auto-connect bridge
  connectBridge();
  
  setMode('track');
}

init();
