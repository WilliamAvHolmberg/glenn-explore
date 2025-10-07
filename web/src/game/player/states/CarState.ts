import { PlayerState } from './PlayerState';
import { PlayerController } from '../PlayerController';
import { CameraController } from '../../CameraController';
import * as THREE from 'three';
import { Threebox } from 'threebox-plugin';
import { CarModelConfig, CarPhysics } from '../../api/types/ModelTypes';
import { PlayerStore } from '../../stores/PlayerStore';
import { Toast } from '../../toast/ToastController';

export class CarState implements PlayerState<CarModelConfig> {
    currentSpeed: number = 0;
    mixer: THREE.AnimationMixer | null = null;
    model: any;
    modelType: string = 'golfCart';
    verticalPosition: number | null = null;
    animationState: string = 'idle';
    stateType: 'car' | 'walking' = 'car';
    private lastFrameTime: number = 0;
    private readonly TARGET_FRAME_RATE = 60;
    private readonly TIME_STEP = 1 / this.TARGET_FRAME_RATE;
    private readonly MAX_DELTA_TIME = 0.1; // Cap deltaTime to prevent spiral of death
    private timeAccumulator: number = 0; // Accumulator for fixed timestep
    private lastSpaceMessageTime: number = 0;
    private readonly SPACE_MESSAGE_COOLDOWN = 10000; // 10 seconds in milliseconds

    // Cruise Control Properties
    private cruiseControlActive: boolean = false;
    private cruiseControlTargetSpeed: number = 0; // In km/h
    private readonly MIN_CRUISE_SPEED_KMH = 20; // Minimum cruise control speed in km/h
    private readonly CRUISE_CONTROL_SMOOTHING = 0.8; // How aggressively to maintain speed

    // Get config from PlayerController
    modelConfig: CarModelConfig;

    // Car state
    private velocity: number = 0;
    private currentSpeedKmh: number = 0;
    private steeringAngle: number = 0;

    // Flying mode constants
    private readonly FLYING_SMOOTHING = 0.05; // Smoother transitions

    // Remove local keys object and use controller's key states instead
    private controller?: PlayerController;

    // Update elevation properties to match vehicle-copy.ts
    private currentElevation: number = 0;
    private terrainEnabled: boolean = true;

    // Add distance tracking properties
    private lastPosition: [number, number] | null = null;
    private lastDistanceCalculation: number = 0;
    private distanceAccumulator: number = 0;

    constructor(private tb: Threebox, modelId: string, config: CarModelConfig) {
        this.modelConfig = config;
        this.modelType = modelId;
        // Initialize kilometers from PlayerStore
        this.distanceAccumulator = PlayerStore.getKilometersDriven();
    }

    async enter(player: PlayerController): Promise<void> {
        this.controller = player;
        
        // Check if flying mode should be enabled based on saved state
        if (PlayerStore.getCarMode() === 'fly' && !PlayerStore.isPlayerFlying()) {
            // Restore flying mode if it was enabled
            PlayerStore.setIsFlying(true);
            console.log('🚗✈️ Restored flying mode from saved state');
        }
        // Remove setup controls, no longer needed as controller handles input
    }

    update(player: PlayerController): void {
        // Calculate delta time
        const currentTime = performance.now();
        let deltaTime = (currentTime - this.lastFrameTime) / 1000;
        this.lastFrameTime = currentTime;

        // Cap deltaTime to prevent physics explosion on slow frames
        deltaTime = Math.min(deltaTime, this.MAX_DELTA_TIME);

        // Update animation mixer with deltaTime for smooth animations
        if (this.mixer) {
            this.mixer.update(deltaTime);
        }

        // Add to accumulator
        this.timeAccumulator += deltaTime;

        // Perform fixed timestep updates
        while (this.timeAccumulator >= this.TIME_STEP) {
            this.fixedUpdate(player);
            this.timeAccumulator -= this.TIME_STEP;
        }

        // After moving, calculate distance traveled
        if (this.model) {
            const currentCoords = this.model.coordinates;
            const now = Date.now();

            // Only calculate if we have a last position
            if (this.lastPosition) {
                const [lastLng, lastLat] = this.lastPosition;
                const [currentLng, currentLat] = currentCoords;

                // Calculate distance using Haversine formula
                const distance = this.calculateDistance(lastLat, lastLng, currentLat, currentLng);
                this.distanceAccumulator += distance;
                PlayerStore.setKilometersDriven(this.distanceAccumulator);
                this.lastDistanceCalculation = now;
            }

            // Update last position
            this.lastPosition = [currentCoords[0], currentCoords[1]];
        }
    }

    private fixedUpdate(player: PlayerController): void {
        const { physics } = this.modelConfig;

        // Check for space key press when not flying
        if (this.controller?.getKeyState('space') && !PlayerStore.isPlayerFlying()) {
            const currentTime = Date.now();
            if (currentTime - this.lastSpaceMessageTime >= this.SPACE_MESSAGE_COOLDOWN) {
                Toast.show({
                    message: 'Go to settings and activate "fly car" so you can fly!',
                    duration: 3000,
                    type: 'info'
                });
                this.lastSpaceMessageTime = currentTime;
            }
        }

        // Handle input and physics at fixed timestep
        this.handleDriving(physics);
        this.handleSteering(physics);

        // Apply movement
        if (this.model) {
            // Apply forward/backward movement at fixed timestep
            const translation = new THREE.Vector3(
                0,
                -this.velocity,
                0
            );

            this.model.set({ worldTranslate: translation });

            // Apply steering at fixed timestep
            if (Math.abs(this.steeringAngle) > 0.001) {
                const zAxis = new THREE.Vector3(0, 0, 1);
                this.model.set({
                    quaternion: [zAxis, this.model.rotation.z + (this.steeringAngle * Math.PI / 180), 50]
                });
            }

            // Always update elevation through one method
            this.updateElevation(this.TIME_STEP);

            // Update player position and rotation
            const currentCoords = this.model.coordinates;
            player.setPosition([currentCoords[0], currentCoords[1]]);
            player.setRotation({
                x: 0,
                y: 0,
                z: this.model.rotation.z * 180 / Math.PI
            });
        }

        // Update camera bearing
        if (this.model?.rotation?.z !== undefined) {
            CameraController.setBearing(-this.model.rotation.z * 180 / Math.PI);
        }
    }

    private handleDriving(physics: CarPhysics): void {
        // Simplified driving physics with fixed timestep
        let animationName: string | undefined = this.modelConfig.drivingAnimation?.drivingAnimation;
        
        // Check for boost (shift key)
        const isBoost = this.controller?.getKeyState('shift');
        const boostMultiplier = isBoost ? 4 : 1;
        
        // Check for braking - disable cruise control if braking
        const isBraking = this.controller?.getKeyState('s');
        if (isBraking && this.cruiseControlActive) {
            this.disableCruiseControl();
        }
        
        // Check for acceleration input during cruise control
        const isAccelerating = this.controller?.getKeyState('w');
        
        // Handle cruise control logic
        if (this.cruiseControlActive && !isBraking) {
            // If W is pressed during cruise control, incrementally increase target speed
            if (isAccelerating) {
                // Increase cruise control target speed by 2 km/h per second (smooth increment)
                const increaseRate = 30; // km/h per second (will be scaled by physics timestep)
                const increment = increaseRate * this.TIME_STEP;
                this.cruiseControlTargetSpeed = Math.min(
                    this.cruiseControlTargetSpeed + increment,
                    physics.maxSpeed * boostMultiplier * 1000 // Convert max speed to km/h and apply boost
                );
            }
            
            this.maintainCruiseSpeed(physics, boostMultiplier);
            this.animationState = 'driving';
        } else {
            // Normal driving logic
            if (isAccelerating) {
                // Accelerate forward with boost
                this.velocity = Math.min(
                    this.velocity + physics.acceleration * boostMultiplier,
                    physics.maxSpeed * boostMultiplier
                );
                this.animationState = 'driving';
            } else if (isBraking) {
                if (this.velocity > 0) {
                    // Braking
                    this.velocity = Math.max(
                        this.velocity - physics.brakeForce,
                        0
                    );
                    this.animationState = 'braking';
                } else {
                    // Reverse
                    this.velocity = Math.max(
                        this.velocity - physics.acceleration,
                        -physics.reverseSpeed
                    );
                    this.animationState = 'reversing';
                }
            } else {
                animationName = this.modelConfig.drivingAnimation?.drivingAnimation;
                this.animationState = 'idle';
                // Natural slowdown with fixed timestep
                this.velocity *= physics.friction;
                if (Math.abs(this.velocity) < 0.01) this.velocity = 0;
            }
        }

        if (animationName) {
            this.controller?.playAnimation(animationName, 10);
        } else {
            this.controller?.stopAnimation();
        }

        // Convert to km/h for display
        this.currentSpeedKmh = Math.abs(this.velocity) * 1000;
        this.currentSpeed = this.currentSpeedKmh;
    }

    private handleSteering(physics: CarPhysics): void {
        // Increased base turning responsiveness
        const baseTurnMultiplier = 1.5;

        if (this.controller?.getKeyState('a')) {
            this.steeringAngle = physics.turnSpeed * baseTurnMultiplier * (this.velocity >= 0 ? 1 : -1);
        } else if (this.controller?.getKeyState('d')) {
            this.steeringAngle = -physics.turnSpeed * baseTurnMultiplier * (this.velocity >= 0 ? 1 : -1);
        } else {
            this.steeringAngle = 0;
        }

        // Less reduction at higher speeds for better control
        const speedFactor = 1 - (Math.abs(this.velocity) / physics.maxSpeed * 0.9); // Reduced from 0.7
        this.steeringAngle *= Math.max(speedFactor, 0.4); // Minimum factor increased
    }

    exit(_player: PlayerController): void {
        // Remove removeControls, no longer needed
        if (this.model) {
            this.tb.remove(this.model);
            this.model = null;
        }
        this.velocity = 0;
        this.steeringAngle = 0;
        this.lastPosition = null;
    }

    private updateElevation(_deltaTime: number): void {
        if (!this.model) return;

        const coords = this.model.coordinates;
        const groundElevation = this.controller?.getElevation() ?? 0;
        const modelOffset = this.modelConfig.model.elevationOffset ?? 0;

        // Use PlayerStore to check flying state
        if (PlayerStore.isPlayerFlying()) {
            // Use the flying elevation from PlayerStore
            const flyingElevation = PlayerStore.getFlyingElevation();

            const targetElevation = groundElevation + modelOffset + flyingElevation;
            this.currentElevation += (targetElevation - this.currentElevation) * this.FLYING_SMOOTHING;
        } else {
            // Simplified ground elevation handling, matching walking state
            this.currentElevation = groundElevation + modelOffset;
        }

        this.verticalPosition = this.currentElevation
        
        // Set coordinates
        this.model.setCoords([
            coords[0],
            coords[1],
            this.currentElevation
        ]);
    }

    // Add helper methods for distance calculation
    private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371; // Earth's radius in km
        const dLat = this.toRad(lat2 - lat1);
        const dLon = this.toRad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    private toRad(degrees: number): number {
        return degrees * (Math.PI / 180);
    }

    public getModel(): any {
        return this.model;
    }

    public follow(): void {
        if (!this.controller) return;
        //CameraController.follow(this.controller, 'car');
    }

    // Cruise Control Methods
    public toggleCruiseControl(): void {
        if (this.cruiseControlActive) {
            this.disableCruiseControl();
        } else {
            this.enableCruiseControl();
        }
    }

    public enableCruiseControl(): void {
        // Use PlayerStore.getCurrentSpeed() to match the displayed speed values
        const currentDisplaySpeed = PlayerStore.getCurrentSpeed();
        const targetSpeed = Math.max(currentDisplaySpeed, this.MIN_CRUISE_SPEED_KMH);
        this.cruiseControlTargetSpeed = targetSpeed;
        this.cruiseControlActive = true;
        
        // If current speed is too low, accelerate to minimum speed
        if (currentDisplaySpeed < this.MIN_CRUISE_SPEED_KMH) {
            // Convert km/h back to velocity units for the physics
            this.velocity = this.MIN_CRUISE_SPEED_KMH / 1000;
        }
    }

    public disableCruiseControl(): void {
        this.cruiseControlActive = false;
        this.cruiseControlTargetSpeed = 0;
    }

    public adjustCruiseSpeed(deltaKmh: number): void {
        if (!this.cruiseControlActive) return;
        
        this.cruiseControlTargetSpeed = Math.max(
            this.MIN_CRUISE_SPEED_KMH,
            this.cruiseControlTargetSpeed + deltaKmh
        );
    }

    public isCruiseControlActive(): boolean {
        return this.cruiseControlActive;
    }

    public getCruiseControlTargetSpeed(): number {
        return this.cruiseControlTargetSpeed;
    }

    private maintainCruiseSpeed(physics: CarPhysics, boostMultiplier: number): void {
        const targetVelocity = this.cruiseControlTargetSpeed / 1000; // Convert km/h to velocity units
        const currentVelocity = this.velocity;
        const velocityDifference = targetVelocity - currentVelocity;
        
        // Apply smooth adjustment to reach target speed
        if (Math.abs(velocityDifference) > 0.001) {
            const adjustment = velocityDifference * this.CRUISE_CONTROL_SMOOTHING * physics.acceleration;
            this.velocity += adjustment;
            
            // Apply boost multiplier if shift is held during cruise control
            if (boostMultiplier > 1) {
                this.velocity = Math.min(this.velocity, physics.maxSpeed * boostMultiplier);
            }
        }
    }
} 