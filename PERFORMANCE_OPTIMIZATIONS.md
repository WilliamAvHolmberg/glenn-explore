# Three.js + Mapbox Performance Optimizations

**Date:** 2025-10-07  
**Branch:** cursor/optimize-threejs-and-mapbox-rendering-performance-bf8c  
**Issue:** High CPU usage when camera is in "follow" mode, even with only one player online

---

## 🔍 ROOT CAUSE ANALYSIS

### Problems Identified:

1. **EXCESSIVE CAMERA API CALLS** (CRITICAL)
   - **Before:** 4 separate Mapbox API calls per frame at 60 FPS = **240 map updates/second**
   - Each call (`setCenter`, `setBearing`, `setPitch`, `setZoom`) triggers:
     - Map projection recalculation
     - Tile re-rendering
     - WebGL state updates
     - Multiple repaints
   
2. **NO THROTTLING**
   - Camera updates running at full 60 FPS
   - Human eye can't perceive camera movement differences beyond ~30 FPS
   - Wasted CPU cycles on imperceptible updates

3. **MISSING ANIMATION MIXER UPDATES**
   - CarState wasn't calling `mixer.update()` for vehicle animations
   - Could cause animation stuttering or frozen animations

4. **REMOTE PLAYER ANIMATION OVERHEAD**
   - Each remote player running animations at 60 FPS
   - Unnecessary overhead when 30 FPS is sufficient for remote entities

---

## ✅ OPTIMIZATIONS IMPLEMENTED

### 1. Camera Update Throttling (PlayerController.ts)

**Lines 73-75:** Added throttling constants
```typescript
private lastCameraUpdate: number = 0;
private readonly CAMERA_UPDATE_INTERVAL = 33; // ~30 FPS (33ms between updates)
```

**Lines 221-243:** Refactored update loop
- **Before:** Camera updated every frame (60 FPS)
- **After:** Camera updated every 33ms (~30 FPS)
- **Savings:** ~50% reduction in camera update frequency

```typescript
// Throttle camera updates to ~30 FPS for better performance
if (PlayerStore.isFollowingCar() && (currentTime - this.lastCameraUpdate) >= this.CAMERA_UPDATE_INTERVAL) {
    this.updateCamera();
    this.lastCameraUpdate = currentTime;
}
```

---

### 2. Batched Camera API Calls (PlayerController.ts)

**Lines 282-303:** Replaced 4 separate API calls with single `jumpTo()`

**Before (BAD):**
```typescript
CameraController.getMap().setCenter([lng, lat]);      // Triggers map update
CameraController.getMap().setPitch(pitch);            // Triggers map update
CameraController.getMap().setBearing(bearing);        // Triggers map update
CameraController.getMap().setZoom(zoom);             // Triggers map update
// Result: 4 map updates per frame × 60 FPS = 240 updates/second
```

**After (GOOD):**
```typescript
CameraController.getMap().jumpTo({
    center: [lng, lat],
    bearing: bearing,
    pitch: pitch,
    zoom: zoom
});
// Result: 1 map update per frame × 30 FPS = 30 updates/second
```

**Savings:** ~87.5% reduction in map updates (240 → 30 per second)

---

### 3. Early-Exit Optimization (PlayerController.ts)

**Lines 272-281:** Added change detection to skip unnecessary updates

```typescript
// Check if any values have changed significantly
const lngChanged = Math.abs(lng - this.lastLng) > 0.0000001;
const latChanged = Math.abs(lat - this.lastLat) > 0.0000001;
const bearingChanged = Math.abs(bearing - this.lastBearing) > 0.01;
const pitchChanged = Math.abs(pitch - this.lastPitch) > 0.01;
const zoomChanged = Math.abs(zoom - this.lastZoom) > 0.01;

// Only update if something actually changed
if (lngChanged || latChanged || bearingChanged || pitchChanged || zoomChanged) {
    // ... perform update
}
```

**Benefit:** Skips camera updates when values are effectively unchanged

---

### 4. Animation Mixer Updates (CarState.ts)

**Lines 83-86:** Added mixer.update() for vehicle animations

```typescript
// Update animation mixer with deltaTime for smooth animations
if (this.mixer) {
    this.mixer.update(deltaTime);
}
```

**Benefit:** Ensures vehicle driving animations play smoothly

---

### 5. Remote Player Animation Throttling (RemotePlayer.ts)

**Lines 244-268:** Throttled remote player animations to 30 FPS

```typescript
const ANIMATION_UPDATE_INTERVAL = 33; // ~30 FPS

// Only update every ~33ms (30 FPS) instead of every frame (60 FPS)
if (time - lastUpdate >= ANIMATION_UPDATE_INTERVAL) {
    const delta = (time - this.lastAnimationTime) * 0.001;
    this.mixer.update(delta);
}
```

**Benefit:** ~50% reduction in animation update CPU overhead per remote player

---

### 6. Minecraft Character Animation Throttling (RemotePlayer.ts)

**Lines 275-300:** Applied same 30 FPS throttling to Minecraft character animations

**Benefit:** Consistent performance for custom character animations

---

## 📊 EXPECTED PERFORMANCE GAINS

| Optimization | CPU Reduction | Details |
|-------------|---------------|---------|
| Camera throttling (60→30 FPS) | ~50% | Halved camera update frequency |
| Batched API calls (4→1) | ~75% | 75% fewer Mapbox re-renders |
| Early-exit checks | ~10-20% | Skips updates when values unchanged |
| Remote player throttling | ~50% per player | Halved animation update frequency |

**Combined Estimate:** **60-80% CPU reduction** when camera is in follow mode

---

## 🎯 WHY FOLLOW MODE WAS SLOW

### Without Optimizations:
- Camera following at 60 FPS
- 4 API calls per frame = 240 Mapbox updates/second
- Each update recalculates:
  - Map projection
  - Tile positions
  - WebGL state
  - Multiple repaints
- Result: **CPU constantly maxed out**

### With Optimizations:
- Camera following at 30 FPS
- 1 API call per frame = 30 Mapbox updates/second (max)
- Early-exit reduces actual updates further
- Result: **CPU has breathing room**

---

## 🔬 ARCHITECTURE NOTES

### Threebox/Mapbox Rendering Pattern:

1. **Mapbox Render Callback** (main.ts:273-276)
   ```typescript
   render: function (_gl, _matrix) {
       window.tb?.update()  // Renders Three.js scene
   }
   ```
   - Called by Mapbox GL automatically every frame
   - Handles Three.js → Mapbox synchronization
   - **Must** call `tb.update()` for rendering

2. **Game Loop** (PlayerController.ts:221-243)
   - Separate `requestAnimationFrame` loop
   - Updates game state, physics, animations
   - Now throttles camera updates to 30 FPS

3. **Animation Mixers**
   - Updated in game loop with `deltaTime`
   - Not in render callback (better separation of concerns)

---

## 🧪 TESTING RECOMMENDATIONS

1. **Visual Quality Check:**
   - ✅ Camera movement should still feel smooth at 30 FPS
   - ✅ No visible stuttering during normal driving
   - ✅ Flying mode camera transitions remain smooth

2. **Performance Metrics:**
   - Monitor CPU usage before/after (should see 60-80% reduction)
   - Check frame rate stability
   - Test with multiple remote players

3. **Edge Cases:**
   - Fast camera movements during turns
   - Rapid elevation changes in flying mode
   - High-speed driving with boost

4. **Browser DevTools:**
   - Use Performance profiler to verify reduced Mapbox render calls
   - Check for reduced time in camera update functions

---

## 📝 FILES MODIFIED

1. **web/src/game/player/PlayerController.ts**
   - Added camera throttling (30 FPS)
   - Batched camera API calls
   - Added change detection
   - Refactored `startUpdateLoop()` and added `updateCamera()`

2. **web/src/game/player/states/CarState.ts**
   - Added `mixer.update()` call for vehicle animations

3. **web/src/game/players/RemotePlayer.ts**
   - Throttled animation updates to 30 FPS
   - Applied to both regular and Minecraft character animations

---

## 🚀 NEXT STEPS

1. Test the changes in development environment
2. Monitor CPU usage and frame rate
3. Gather user feedback on camera smoothness
4. Consider additional optimizations if needed:
   - Adjustable quality settings for low-end devices
   - Further throttling on mobile devices
   - Level-of-detail (LOD) for remote players at distance

---

## 📚 REFERENCES

- [Threebox Documentation](https://github.com/jscastro76/threebox)
- [Mapbox GL JS Custom Layers](https://docs.mapbox.com/mapbox-gl-js/api/properties/#customlayerinterface)
- [Three.js Animation System](https://threejs.org/docs/#manual/en/introduction/Animation-system)