import { Threebox } from 'threebox-plugin';
import { IFollowable } from '../types/IFollowable';
import { PlayerState } from './states/PlayerState';
import { WalkingState } from './states/WalkingState';
import { CameraController } from '../CameraController';
import { PlayerUI } from './ui/PlayerUI';
import { CarState } from './states/CarState';
import { VehicleStatsController } from '../VehicleStats/VehicleStatsController';
import { PlayerStore } from '../stores/PlayerStore';
import { MinimapController } from '../minimap/MinimapController';
import { NavigationUI } from '../NavigationUI';
import { NavigationController } from '../NavigationController';
import * as THREE from 'three';
import { PitchController } from '../PitchController';
import { ZoomController } from '../ZoomController';
import mapboxgl from 'mapbox-gl'
import { InputUtils } from '../InputUtils';
import { TeleportOptions } from '../../types/teleport';
import { DEFAULT_COORDINATES } from '../../config';
import { BearingController } from '../BearingController';
import { ModelConfig, CarModelConfig, PlayerModelConfig, ModelResponse, CarPhysics, CarDrivingAnimation } from '../api/types/ModelTypes';

// Add type definition for Threebox model config
export interface ThreeboxModelConfig {
    obj: string;                   // Path to the model file
    type: 'glb' | 'gltf' | 'obj'; // Type of model file
    scale?: number | {            // Scale can be number or object
        x: number;
        y: number;
        z: number;
    };
    units?: 'meters';             // Units for the model
    rotation?: {                  // Initial rotation
        x: number;
        y: number;
        z: number;
    };
    anchor?: 'center';           // Anchor point
    elevationOffset?: number;    // Offset from ground
}

export class PlayerController implements IFollowable {
    private model: ModelResponse | null = null;
    private currentAction: THREE.AnimationAction | null = null;
    private isAnimationPlaying: boolean = false;
    private currentState: PlayerState<ModelConfig> | null = null;
    private _coordinates: [number, number] = [0, 0];
    private _rotation: { x: number; y: number; z: number } = { x: 0, y: 0, z: 40 };
    private _elevation: number = 0;
    private animationFrameId: number | null = null;
    private lastUpdateTime: number = 0;
    private ui: PlayerUI | null = null;
    private keyStates: Record<string, boolean> = {
        w: false,    // Forward
        a: false,    // Left
        s: false,    // Backward
        d: false,    // Right
        shift: false, // Run (walking state)
        space: false  // Jump (walking state) / Fly up (flying mode)
    };
    private tb: Threebox | null = null;
    private map: mapboxgl.Map | null = null;
    private hasSetZoom: boolean = false;
    private lastBearing: number = 0;
    private lastPitch: number = 0;
    private lastZoom: number = 0;
    private lastLng: number = 0;
    private lastLat: number = 0;

    constructor() {
        new VehicleStatsController();
        this.setupChatListener();
        this.setupStateSwitch();
        document.addEventListener('keydown', this.handleKeyDown);
        document.addEventListener('keyup', this.handleKeyUp);
    }

    private setupChatListener(): void {
        // Listen for chat messages
        window.addEventListener('chat:send_message', ((event: CustomEvent) => {
            const { message } = event.detail;
            // Show message above player
            this.showMessage(message);
        }) as EventListener);

        // // Optional: Listen for system messages if needed
        // window.addEventListener('chat:system_message', ((event: CustomEvent) => {
        //     const { message } = event.detail;
        //     this.showMessage(`System: ${message}`, 3000); // Shorter duration for system messages
        // }) as EventListener);
    }

    private setupStateSwitch(): void {
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (InputUtils.isInputElementFocused()) {
                return;
            }

            const key = e.key.toLowerCase();

            // if (key === 'e') {
            //     // Toggle between car and walking state
            //     if (this.currentState instanceof CarState) {
            //         this.switchToWalking();
            //         this.showMessage("Switched to walking mode", 2000);
            //     } else {
            //         this.switchToCar();
            //         this.showMessage("Switched to car mode", 2000);
            //     }
            // }

            // // Toggle flying mode with F key
            // if (key === 'f') {
            //     this.toggleFlyingMode();
            // }
        });
    }

    // IFollowable implementation
    get coordinates(): [number, number] { return this._coordinates; }
    get rotation(): { x: number; y: number; z: number } { return this._rotation; }
    get elevation(): number { return this._elevation; }
    get threebox(): Threebox { return this.tb!; }

    public async initializeState(tb: Threebox, map: mapboxgl.Map, initialPosition: [number, number]): Promise<void> {
        this.tb = tb;
        this.map = map;

        const defaultConfig =
        {

            model: {
                obj: '/lambo.glb',
                type: 'glb',
                scale: 5,
                units: 'meters',
                rotation: { x: 90, y: 0, z: 0 },
                anchor: 'center',
                elevationOffset: 0.7,
                screenshot: '/lambo.png'
            },
            physics: {
                maxSpeed: 0.1,         // Reduced from 5
                acceleration: 0.0003,      // Reduced from 1.2
                brakeForce: 0.004,       // Reduced from 60
                reverseSpeed: 0.01,      // Reduced from 20
                turnSpeed: 1,        // Reduced from 2.0
                friction: 0.99         // Slightly increased from 0.95 for smoother deceleration
            },
            drivingAnimation: {
                drivingAnimation: 'Body.001Action.001'
            }
        }

        this.currentState = new CarState(this.tb, PlayerStore.getState().modelType, defaultConfig);


        const minimapController = new MinimapController(this.map!);
        const navigationController = new NavigationController(this.map!);
        new NavigationUI(this.map!, navigationController, (teleportOptions: TeleportOptions) => {
            this.teleport(teleportOptions);
        }, {
            position: 'top-right',
            container: minimapController.getNavigationContainer()
        });
        this.ui = new PlayerUI(this.map, this);
        this._coordinates = initialPosition ?? [DEFAULT_COORDINATES.lng, DEFAULT_COORDINATES.lat];

        // Make sure current state matches saved movement mode
        this.currentState = new CarState(this.tb, 'lambo', defaultConfig);

        await this.setState(this.currentState);
        this.startUpdateLoop();
        setInterval(() => {
            PlayerStore.setCurrentSpeed(this.currentState!.currentSpeed);
            PlayerStore.setCoordinates([this._coordinates[0], this._coordinates[1], this.currentState!.verticalPosition ?? this._elevation]);
            PlayerStore.setRotation(this._rotation);
        }, 200);
    }

    private startUpdateLoop(): void {
        this.lastUpdateTime = performance.now();
        const animate = () => {
            const currentTime = performance.now();
            const deltaTime = currentTime - this.lastUpdateTime;
            this.lastUpdateTime = currentTime;
            this.update();
            this.animationFrameId = requestAnimationFrame(animate);
            if (PlayerStore.isFollowingCar()) {
                if (PlayerStore.isPlayerFlying() && this.currentState!.verticalPosition && this.currentState!.verticalPosition > this._elevation + 5) {
                    const camera = CameraController.getMap().getFreeCameraOptions();

                    // Get current zoom and elevation data
                    const zoomLevel = ZoomController.getZoom();
                    const elevationDifference = this.currentState!.verticalPosition - this._elevation;

                    // Convert rotation to bearing (0 = north, clockwise)
                    // Mapbox uses 0 = north, clockwise positive
                    // We need to handle the conversion carefully
                    const bearingDegrees = (-this._rotation.z + 360) % 360;

                    // For camera behind the car, we need to offset bearing by 180 degrees
                    const cameraBearingDegrees = (bearingDegrees + 180) % 360;
                    const cameraBearingRadians = (cameraBearingDegrees * Math.PI) / 180;

                    // Distance increases with elevation and zoom level
                    const baseDistance = 0.0015;
                    const elevationFactor = 1 + (elevationDifference / 200);
                    const zoomFactor = Math.pow(0.75, (zoomLevel - 14));
                    const distance = baseDistance * elevationFactor * zoomFactor;

                    // Use standard cartographic formula for offset calculation
                    // We use sin for longitude and cos for latitude when calculating from bearing
                    const offsetLng = this._coordinates[0] + Math.sin(cameraBearingRadians) * distance;
                    const offsetLat = this._coordinates[1] + Math.cos(cameraBearingRadians) * distance;

                    // Set camera elevation - slightly above vehicle for better visibility
                    const cameraElevation = this.currentState!.verticalPosition + (zoomLevel * 0.3);

                    // Position camera at calculated position
                    camera.position = mapboxgl.MercatorCoordinate.fromLngLat(
                        [offsetLng, offsetLat],
                        cameraElevation
                    );

                    // Look directly at the player's position
                    camera.lookAtPoint([this._coordinates[0], this._coordinates[1]]);

                    // Set the camera orientation
                    // Use original bearing for camera direction, not offset bearing
                    camera.setPitchBearing(PitchController.getPitch(), bearingDegrees);

                    CameraController.getMap().setFreeCameraOptions(camera);
                } else {
                    const zoom = ZoomController.getZoom();
                    const bearing = -this._rotation.z + BearingController.getBearing();
                    const pitch = PitchController.getPitch();
                    const lng = this._coordinates[0];
                    const lat = this._coordinates[1];
                    if (lng !== this.lastLng || lat !== this.lastLat) {
                        CameraController.getMap().setCenter([lng, lat]);
                        this.lastLng = lng;
                        this.lastLat = lat;
                    }
                    if (pitch !== this.lastPitch) {
                        CameraController.getMap().setPitch(pitch);
                        this.lastPitch = pitch;
                    }

                    if (bearing !== this.lastBearing || pitch !== this.lastPitch) {
                        CameraController.getMap().setBearing(bearing);
                        this.lastBearing = bearing;
                    }

                    //if(zoom !== this.lastZoom) {
                    CameraController.getMap().setZoom(zoom);
                    this.lastZoom = zoom;
                    //}

                    // CameraController.getMap().jumpTo({
                    //     center: [this._coordinates[0], this._coordinates[1]],
                    //     bearing: -this._rotation.z + ZoomController.getZoom(),
                    //     pitch: PitchController.getPitch(),
                    //     //...(PlayerStore.getLockZoom() || !this.hasSetZoom ? { zoom: 20 } : {})
                    // });
                    this.hasSetZoom = true;
                }
            }
        };
        animate();
    }

    public async setState(state: PlayerState<ModelConfig>): Promise<void> {
        CameraController.stopFollowing();
        PlayerStore.setModelType(state.modelType);
        PlayerStore.setAnimationState(state.animationState);
        PlayerStore.setStateType(state.stateType);
        PlayerStore.setAllowedToDrive(false);
        this.currentState!.exit(this);
        this.currentState = state;
        await this.loadModel();
        await this.currentState.enter(this);
        if (state.getModel()?.animations && state.getModel().animations.length > 0) {
            console.log('WalkingState: Animations found:', state.getModel().animations.map((anim: any) => anim.name));
        }
        PlayerStore.setAllowedToDrive(true)
        this.currentState.follow()
        PlayerStore.setFollowCar(true)
    }

    public update(): void {
        if (!PlayerStore.getAllowedToDrive()) return;

        // If in flying mode and car state, check for space key
        if (PlayerStore.isPlayerFlying() && this.currentState instanceof CarState) {
            const spacePressed = this.getKeyState('space');
            // Constants from CarState
            const FLYING_ASCEND_SPEED = 50;
            const FLYING_DESCEND_SPEED = 20;

            // Update flying elevation
            const currentElevation = PlayerStore.getFlyingElevation();
            const delta = 1 / 60; // Approximate time step

            if (spacePressed) {
                // Rise when space is pressed
                PlayerStore.setFlyingElevation(currentElevation + FLYING_ASCEND_SPEED * delta);
            } else {
                // Apply gravity when space is not pressed
                const newElevation = Math.max(0, currentElevation - FLYING_DESCEND_SPEED * delta);
                PlayerStore.setFlyingElevation(newElevation);
            }
        }

        this.currentState!.update(this);
    }

    public setPosition(position: [number, number]): void {
        this._coordinates = position;
    }

    public setRotation(rotation: { x: number; y: number; z: number }): void {
        this._rotation = rotation;
    }

    public getElevation(): number {
        const elevation = this.map!.queryTerrainElevation([this._coordinates[0], this._coordinates[1]], {
            exaggerated: true // Match the exaggeration setting
        });
        this._elevation = elevation || 0;
        return elevation || 0;
    }

    // Public method to show messages (delegates to UI)
    public showMessage(message: string, duration?: number): void {
        this.ui?.showMessage(message, duration);
    }

    public destroy(): void {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        // Clean up event listeners
        window.removeEventListener('chat:send_message', this.setupChatListener);
        window.removeEventListener('chat:system_message', this.setupChatListener);
        document.removeEventListener('keydown', this.setupStateSwitch);
        document.removeEventListener('keydown', this.handleKeyDown);
        document.removeEventListener('keyup', this.handleKeyUp);

        this.ui?.destroy();
        this.currentState!.exit(this);
        CameraController.stopFollowing();
    }

    public async switchState(
        modelId: string,
        type: 'car' | 'walking',
        model: ModelResponse
    ): Promise<void> {
        this.model = model;
        const state = type === 'car'
            ? new CarState(this.tb!, modelId, model.config as CarModelConfig)
            : new WalkingState(this.tb!, modelId, model.config as PlayerModelConfig);

        PlayerStore.setMovementMode(type);
        PlayerStore.setModelType(modelId);

        await this.setState(state);
    }

    public async switchToCar(): Promise<void> {
    }

    public async switchToWalking(): Promise<void> {
    }

    public async teleport(teleportOptions: TeleportOptions): Promise<void> {
        this.currentState!.exit(this);
        CameraController.stopFollowing();
        this._coordinates = [teleportOptions.position.lng, teleportOptions.position.lat];
        if (teleportOptions.rotation) {
            this._rotation = { x: 0, y: 0, z: teleportOptions.rotation.z ?? -CameraController.getBearing() };
        }
        // if (teleportOptions.zoom) {
        //     ZoomController.setZoom(teleportOptions.zoom);
        // }
        if (teleportOptions.pitch) {
            PitchController.setPitch(teleportOptions.pitch);
        }
        if (teleportOptions.bearing) {
            CameraController.setBearing(teleportOptions.bearing);
        }
        await this.setState(this.currentState!);
    }

    public playAnimation(animationName: string, speed: number = 1.0): void {
        if (!this.currentState!.mixer || !this.currentState!.getModel().animations) return;

        if (PlayerStore.getState().animationState !== animationName) {
            PlayerStore.setAnimationState(animationName);
        }
        const clip = this.currentState!.getModel().animations.find((anim: any) => anim.name === animationName);
        if (clip) {
            if (this.currentAction) {
                this.currentAction.setEffectiveTimeScale(speed);
                return;
            }

            this.currentAction = this.currentState!.mixer.clipAction(clip);
            this.currentAction.setLoop(THREE.LoopRepeat, Infinity);
            this.currentAction.clampWhenFinished = false;
            this.currentAction.setEffectiveTimeScale(speed);
            this.currentAction.play();

            this.isAnimationPlaying = true;
        }
    }

    public stopAnimation(): void {
        if (this.currentAction && this.isAnimationPlaying) {
            this.currentAction.stop();
            this.currentAction = null;
            this.isAnimationPlaying = false;
        }
    }

    private async loadModel(): Promise<void> {
        console.log("Loading model", this.model);
        if(this.model) {
        try {
            this.currentState!.model = await new Promise((resolve, reject) => {
                if (!this.model) {
                    reject(new Error('No model found'));
                    return;
                }
                const modelConfig: ThreeboxModelConfig = {
                    obj: this.model.modelUrl || this.model.config.model.obj,
                    type: 'glb',
                    scale: this.model.config.model.scale,
                    units: this.model.config.model.units as 'meters',
                    rotation: this.model.config.model.rotation,
                    anchor: this.model.config.model.anchor as 'center',
                    elevationOffset: this.model.config.model.elevationOffset
                };
                
                this.tb!.loadObj(modelConfig, (model: any) => {
                    if (!model) {
                        reject(new Error('No model returned'));
                        return;
                    }
                    console.log("Model loaded", model.animations);
                    if (model.animations && model.animations.length > 0) {
                        this.currentState!.mixer = new THREE.AnimationMixer(model);
                    }

                    resolve(model);
                    model.setCoords(this._coordinates, this.getElevation());
                    model.setRotation({
                        x: 0,
                        y: 0,
                        z: this._rotation.z // Start facing north
                    });
                });
            });

            this.tb!.add(this.currentState!.model);
        } catch (error) {
            console.error('Failed to load model:', error);
            throw error;
        }
    }
    }

    // New method to toggle flying mode
    public toggleFlyingMode(): void {
        // Only works in car state
        if (!(this.currentState instanceof CarState)) {
            this.showMessage("Flying mode only available in car mode", 2000);
            return;
        }

        const isCurrentlyFlying = PlayerStore.isPlayerFlying();
        PlayerStore.setIsFlying(!isCurrentlyFlying);

        // Update car mode in PlayerStore for persistence
        PlayerStore.setCarMode(!isCurrentlyFlying ? 'fly' : 'normal');

        const statusMessage = !isCurrentlyFlying ? 'ENABLED 🛸' : 'DISABLED';
        console.log('🔄 Flying mode:', !isCurrentlyFlying ? 'ENABLED 🛸' : 'DISABLED');
        this.showMessage(`Flying mode ${statusMessage}`, 2000);
    }

    // Add key pressed check
    private isKeyPressed(key: string): boolean {
        return this.keyStates[key] === true;
    }

    // Setup key handling for flying controls
    private handleKeyDown = (e: KeyboardEvent): void => {
        if (InputUtils.isInputElementFocused()) {
            return;
        }

        const key = e.key.toLowerCase();

        // Check if this is a key we're tracking
        if (key in this.keyStates) {
            this.setKeyState(key, true);
        } else if (key === ' ') {
            // Handle space bar specifically
            this.setKeyState('space', true);

            if (PlayerStore.isPlayerFlying()) {
                console.log('🚀 SPACE pressed in flying mode!');
            }
        }
    };

    private handleKeyUp = (e: KeyboardEvent): void => {
        if (InputUtils.isInputElementFocused()) {
            return;
        }

        const key = e.key.toLowerCase();

        // Check if this is a key we're tracking
        if (key in this.keyStates) {
            this.setKeyState(key, false);
        } else if (key === ' ') {
            // Handle space bar specifically
            this.setKeyState('space', false);

            if (PlayerStore.isPlayerFlying()) {
                console.log('🛬 SPACE released in flying mode!');
            }
        }
    };

    // Add method to get key state
    public getKeyState(key: string): boolean {
        return this.keyStates[key] || false;
    }

    // Add method to set key state (to be used by MovementControlsPanel)
    public setKeyState(key: string, isPressed: boolean): void {
        if (key in this.keyStates) {
            this.keyStates[key] = isPressed;
        }
    }
} 