# VMC Hands - TODO

## Normalization / Quality
- [ ] Normalize hand data (wrist-centered, scale-invariant, palm-oriented)
- [ ] Add dead zone to ignore tiny movements
- [ ] Clamp rotations to valid human joint limits
- [ ] Better noise filtering (beyond simple lerp smoothing)

## Features
- [ ] Wrist rotation tracking (currently sending identity)
- [ ] IK validation (ensure rotations are physically possible)
- [ ] Presets for common poses (fist, open, point, etc.)
- [ ] MIDI input for pose control
- [ ] Keyboard shortcuts for animation controls

## Known Issues
- [ ] Thumb tracking is finicky (lateral movement limited)
- [ ] No face tracking integration yet

## Maybe
- [ ] Look into HEVA_Portal for Blender animation import
- [ ] WebRTC for remote streaming
