import { Threebox } from 'threebox-plugin';
import { RemotePlayerData, RemotePlayerState } from './types/RemotePlayerTypes';
import { ThreeboxModelConfig } from '../player/PlayerController';
import mapboxgl from 'mapbox-gl';
import './styles/remote-player.css';
import * as THREE from 'three';
import { ModelClient } from '../api/ModelClient';
import { ZoomController } from '../ZoomController';
import { PlayerStore } from '../stores/PlayerStore';

export class RemotePlayer {
    private model: any = null;
    private mixer: THREE.AnimationMixer | null = null;
    private currentAnimation: THREE.AnimationAction | null = null;
    private marker!: mapboxgl.Marker;
    private nameElement!: HTMLElement;
    private floatingNameElement: HTMLElement | null = null;
    private messageElement: HTMLElement | null = null;
    private currentElevation: number = 0;
    private lastUpdateTime: number = Date.now();
    private messageTimeout: number | null = null;
    private messageUpdateInterval: number | null = null;
    private floatingNameUpdateInterval: number | null = null;
    private modelType: string = 'dino';
    private animationState: string = 'idle';
    private animationFrameId: number | null = null;
    private lastAnimationTime: number = 0;
    private readonly NAME_VISIBILITY_DISTANCE = 1; // Distance in kilometers
    
    // Minecraft character parts for remote players! 🧱
    private characterGroup: THREE.Group | null = null;
    private head: THREE.Mesh | null = null;
    private body: THREE.Mesh | null = null;
    private leftArm: THREE.Mesh | null = null;
    private rightArm: THREE.Mesh | null = null;
    private leftLeg: THREE.Mesh | null = null;
    private rightLeg: THREE.Mesh | null = null;
    private walkCycle: number = 0;

    constructor(
        private map: mapboxgl.Map,
        private tb: Threebox,
        private data: RemotePlayerData
    ) {
        this.createMarker();
        this.createFloatingNameElement();
        this.createMessageElement();
        this.loadModel();
    }

    private createMarker(): void {
        const el = document.createElement('div');
        el.className = 'remote-player-marker';

        this.nameElement = document.createElement('div');
        this.nameElement.className = 'remote-player-name';
        this.nameElement.textContent = this.data.name;
        el.appendChild(this.nameElement);

        this.marker = new mapboxgl.Marker({
            element: el,
            rotationAlignment: 'map',
            pitchAlignment: 'map'
        })
            .setLngLat([this.data.position.coordinates[0], this.data.position.coordinates[1]])
            .addTo(this.map);
    }

    private async loadModel(): Promise<void> {
        this.modelType = this.data.state.modelType;
        this.animationState = this.data.state.animationState;

        // 🧱 SPECIAL HANDLING FOR MINECRAFT CHARACTERS! 
        if (this.modelType === 'minecraft') {
            await this.createMinecraftCharacter();
            return;
        }

        // If models aren't loaded yet, implement a backoff retry mechanism
        if (Object.keys(ModelClient.AVAILABLE_MODELS).length === 0) {

            // Define a backoff retry function with exponential delay
            const retryWithBackoff = async (maxRetries: number = 5, initialDelay: number = 500): Promise<void> => {
                let retryCount = 0;
                let delay = initialDelay;

                while (retryCount < maxRetries) {
                    // Wait for the current delay
                    await new Promise(resolve => setTimeout(resolve, delay));

                    // Check if models are now available
                    if (Object.keys(ModelClient.AVAILABLE_MODELS).length > 0 &&
                        ModelClient.AVAILABLE_MODELS[this.data.state.modelType]) {
                        return;
                    }

                    // Increase retry count and apply exponential backoff
                    retryCount++;
                    delay = Math.min(delay * 2, 10000); // Cap at 10 seconds
                }

                console.error('Failed to load models after maximum retry attempts');
            };

            // Wait for models to be loaded
            await retryWithBackoff();

            // Try to get the model again after retries
            this.modelType = this.data.state.modelType;
            this.animationState = this.data.state.animationState;
        }

        const model = ModelClient.AVAILABLE_MODELS[this.data.state.modelType];

        try {
            this.model = await new Promise((resolve, reject) => {
                const modelConfig: ThreeboxModelConfig = {
                    obj: model.modelUrl || model.config.model.obj,
                    type: 'glb',
                    scale: model.config.model.scale,
                    units: model.config.model.units as 'meters',
                    rotation: model.config.model.rotation,
                    anchor: model.config.model.anchor as 'center',
                    elevationOffset: model.config.model.elevationOffset
                };
                this.tb.loadObj(modelConfig, (model: any) => {
                    if (!model) {
                        reject(new Error('Failed to load model'));
                        return;
                    }

                    // Set up animation mixer if the model has animations
                    if (model.animations && model.animations.length > 0) {
                        console.log(`Model loaded with animations: ${model.animations.map((a: any) => a.name).join(', ')}`);
                        this.mixer = new THREE.AnimationMixer(model);
                        this.startAnimationLoop();
                    }

                    resolve(model);
                });
            });

            this.updatePosition(this.data.position.coordinates, this.data.position.rotation);
            this.tb.add(this.model);

            // Play initial animation if model has animations
            if (this.model.animations && this.model.animations.length > 0) {
                //this.playAnimation(this.animationState);
            }

        } catch (error) {
            console.error('Failed to load remote player model:', error);
        }
    }

    // Create a realistic Bob the Builder character for remote minecraft players! 👷‍♂️
    private async createMinecraftCharacter(): Promise<void> {
        this.characterGroup = new THREE.Group();

        // Bob the Builder colors for remote players! 👷‍♂️
        const headMaterial = new THREE.MeshPhongMaterial({ color: 0xffdd00, shininess: 30 }); // Shiny yellow hard hat
        const bodyMaterial = new THREE.MeshPhongMaterial({ color: 0x1177dd }); // Brighter blue overalls
        const armMaterial = new THREE.MeshPhongMaterial({ color: 0xffdbaa }); // Better skin color
        const legMaterial = new THREE.MeshPhongMaterial({ color: 0x654321 }); // Rich brown work pants
        const beltMaterial = new THREE.MeshPhongMaterial({ color: 0x333333 }); // Dark tool belt
        const eyeMaterial = new THREE.MeshPhongMaterial({ color: 0x000000 }); // Black eyes

        // Scale factor for remote Bob
        const scale = 1.8;

        // Build character in Z-up orientation - better proportions! 
        const headGeometry = new THREE.BoxGeometry(0.45 * scale, 0.45 * scale, 0.45 * scale);
        this.head = new THREE.Mesh(headGeometry, headMaterial);
        this.head.position.set(0, 0, 1.75 * scale);

        const bodyGeometry = new THREE.BoxGeometry(0.55 * scale, 0.3 * scale, 0.8 * scale);
        this.body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        this.body.position.set(0, 0, 1.1 * scale);

        const armGeometry = new THREE.BoxGeometry(0.22 * scale, 0.22 * scale, 0.7 * scale);
        this.leftArm = new THREE.Mesh(armGeometry, armMaterial);
        this.leftArm.position.set(-0.385 * scale, 0, 1.1 * scale);
        
        this.rightArm = new THREE.Mesh(armGeometry, armMaterial);
        this.rightArm.position.set(0.385 * scale, 0, 1.1 * scale);

        const legGeometry = new THREE.BoxGeometry(0.24 * scale, 0.24 * scale, 0.8 * scale);
        this.leftLeg = new THREE.Mesh(legGeometry, legMaterial);
        this.leftLeg.position.set(-0.15 * scale, 0, 0.4 * scale);
        
        this.rightLeg = new THREE.Mesh(legGeometry, legMaterial);
        this.rightLeg.position.set(0.15 * scale, 0, 0.4 * scale);

        // Add simple eyes and tool belt
        const eyeGeometry = new THREE.BoxGeometry(0.06 * scale, 0.06 * scale, 0.06 * scale);
        const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        leftEye.position.set(-0.1 * scale, 0.2 * scale, 1.82 * scale);
        
        const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        rightEye.position.set(0.1 * scale, 0.2 * scale, 1.82 * scale);

        const beltGeometry = new THREE.BoxGeometry(0.65 * scale, 0.18 * scale, 0.12 * scale);
        const toolBelt = new THREE.Mesh(beltGeometry, beltMaterial);
        toolBelt.position.set(0, 0, 0.85 * scale);

        // Add all parts to the group
        this.characterGroup.add(this.head);
        this.characterGroup.add(this.body);
        this.characterGroup.add(this.leftArm);
        this.characterGroup.add(this.rightArm);
        this.characterGroup.add(this.leftLeg);
        this.characterGroup.add(this.rightLeg);
        this.characterGroup.add(leftEye);
        this.characterGroup.add(rightEye);
        this.characterGroup.add(toolBelt);

        // Create the Threebox object
        const options = {
            obj: this.characterGroup,
            type: 'custom',
            units: 'meters',
            anchor: 'center'
        };

        this.model = this.tb.Object3D(options);
        
        if (this.model) {
            this.model.setCoords([
                this.data.position.coordinates[0], 
                this.data.position.coordinates[1], 
                this.data.position.coordinates[2]
            ]);
            this.model.setRotation(this.data.position.rotation);
            this.tb.add(this.model);
            
            // Start simple walking animation for remote minecraft characters
            this.startMinecraftAnimationLoop();
        }
    }

    private startAnimationLoop(): void {
        if (this.animationFrameId) return;
        const animate = (time: number) => {
            if (!this.mixer) return;

            if (this.lastAnimationTime === 0) {
                this.lastAnimationTime = time;
            }

            const delta = (time - this.lastAnimationTime) * 0.001;
            this.lastAnimationTime = time;

            this.mixer.update(delta);
            // Let Mapbox render loop drive view; throttle animation updates slightly
            this.animationFrameId = requestAnimationFrame(animate);
        };

        this.animationFrameId = requestAnimationFrame(animate);
    }

    // Simple walking animation for remote minecraft characters! 🚶‍♂️
    private startMinecraftAnimationLoop(): void {
        if (this.animationFrameId) return;
        
        const animate = (time: number) => {
            if (!this.characterGroup) return;

            if (this.lastAnimationTime === 0) {
                this.lastAnimationTime = time;
            }

            const deltaTime = (time - this.lastAnimationTime) * 0.001;
            this.lastAnimationTime = time;

            // Animate based on animation state
            if (this.animationState === 'walk' || this.animationState === 'running') {
                this.walkCycle += deltaTime * (this.animationState === 'running' ? 8 : 4);
                this.animateMinecraftWalking();
            } else {
                this.resetMinecraftPose();
            }

            this.animationFrameId = requestAnimationFrame(animate);
        };

        this.animationFrameId = requestAnimationFrame(animate);
    }

    private animateMinecraftWalking(): void {
        if (!this.leftArm || !this.rightArm || !this.leftLeg || !this.rightLeg) return;

        // Simple pendulum motion for arms and legs
        const armSwing = Math.sin(this.walkCycle) * 0.3;
        const legSwing = Math.sin(this.walkCycle) * 0.4;

        // Rotate arms opposite to legs (X-axis rotation)
        this.leftArm.rotation.x = armSwing;
        this.rightArm.rotation.x = -armSwing;

        // Rotate legs (X-axis rotation)
        this.leftLeg.rotation.x = legSwing;
        this.rightLeg.rotation.x = -legSwing;
    }

    private resetMinecraftPose(): void {
        if (!this.leftArm || !this.rightArm || !this.leftLeg || !this.rightLeg) return;

        // Reset all rotations to 0
        this.leftArm.rotation.x = 0;
        this.rightArm.rotation.x = 0;
        this.leftLeg.rotation.x = 0;
        this.rightLeg.rotation.x = 0;
    }

    public getCoordinates(): [number, number, number] {
        return this.data.position.coordinates;
    }

    public updatePosition(coordinates: [number, number, number], rotation: { x: number, y: number, z: number }): void {
        this.lastUpdateTime = Date.now();
        // console.log(this.modelType)
        this.data.position = {
            coordinates,
            rotation,
            timestamp: Date.now().toString()
        };

        this.marker.setLngLat([coordinates[0], coordinates[1]]);
        this.currentElevation = coordinates[2];

        if (this.model) {
            this.model.visible = true;
            this.model.setCoords([coordinates[0], coordinates[1], this.currentElevation]);
            this.model.setRotation(rotation);
        }

        if (this.messageElement?.style.display !== 'none') {
            this.updateMessagePosition();
        }
    }

    public async updateState(state: RemotePlayerState): Promise<void> {

        // Check if model type has changed
        const modelChanged = this.modelType !== state.modelType ||
            this.data.state.stateType !== state.stateType;

        this.data.state = state;

        // console.log(this.model)

        // Handle model change
        if (modelChanged) {
            if (this.model) {
                this.tb.remove(this.model);
                this.model = null;
                this.mixer = null;
                this.currentAnimation = null;
            }

            // Clean up minecraft character parts if switching away from minecraft
            if (this.characterGroup) {
                this.characterGroup = null;
                this.head = null;
                this.body = null;
                this.leftArm = null;
                this.rightArm = null;
                this.leftLeg = null;
                this.rightLeg = null;
                this.walkCycle = 0;
            }

            this.modelType = state.modelType;
            setTimeout(async () => {
                await this.loadModel();
            }, 100);
        }
        // Handle animation change
        else if (this.animationState !== state.animationState) {
            this.animationState = state.animationState;
            this.playAnimation(this.animationState);
        }
    }

    private playAnimation(animationName: string): void {
        // For minecraft characters, animation is handled by startMinecraftAnimationLoop
        if (this.modelType === 'minecraft') {
            this.animationState = animationName;
            return;
        }

        if (!this.model || !this.mixer) return;


        if (!this.model.animations || this.model.animations.length === 0) {
            console.warn(`No animations available for this model`);
            return;
        }

        // Find the animation clip
        const clip = this.model.animations.find((anim: any) =>
            anim.name === animationName ||
            anim.name.toLowerCase() === animationName.toLowerCase()
        );

        if (!clip) {
            console.warn(`Animation "${animationName}" not found for model. Available animations: ${this.model.animations.map((a: any) => a.name).join(', ')
                }`);
            return;
        }

        // Stop current animation if playing
        if (this.currentAnimation) {
            this.currentAnimation.stop();
        }

        // Play new animation
        this.currentAnimation = this.mixer.clipAction(clip);
        this.currentAnimation.setLoop(THREE.LoopRepeat, Infinity);
        this.currentAnimation.clampWhenFinished = false;

        // Get animation speed from model config
        let animationSpeed = 1.0;
        // const modelConfig = this.data.state.stateType === 'car'
        //     ? ModelClient.AVAILABLE_MODELS[this.data.state.modelType].config.model.walkingAnimation
        //     : ModelClient.AVAILABLE_MODELS[this.data.state.modelType].config.model.walkingAnimation;

        // const animation = modelConfig.walkingAnimation;
        // if (animation) {
        //     if (animationName === animation.walkAnimation) {
        //         animationSpeed = 1.0;
        //     } else if (animationName === animation.runAnimation) {
        //         animationSpeed = 3.0;
        //     } else if (animationName === animation.idleAnimation) {
        //         animationSpeed = 1.0;
        //     }
        // }

        // this.currentAnimation.setEffectiveTimeScale(animationSpeed);
        // this.currentAnimation.play();
    }

    public showMessage(message: string, duration: number = 5000): void {
        if (!this.messageElement) {
            this.createMessageElement();
        }

        if (!this.messageElement) return;

        if (this.messageUpdateInterval) {
            window.cancelAnimationFrame(this.messageUpdateInterval);
            this.messageUpdateInterval = null;
        }

        this.messageElement.textContent = message;
        this.messageElement.style.display = 'block';

        this.updateMessagePosition();

        const updateMessageLoop = () => {
            if (this.messageElement && this.messageElement.style.display !== 'none') {
                this.updateMessagePosition();
                this.messageUpdateInterval = window.requestAnimationFrame(updateMessageLoop);
            } else {
                this.messageUpdateInterval = null;
            }
        };

        this.messageUpdateInterval = window.requestAnimationFrame(updateMessageLoop);

        setTimeout(() => {
            if (this.messageElement) {
                this.messageElement.style.opacity = '1';
            }
        }, 10);

        if (this.messageTimeout) {
            window.clearTimeout(this.messageTimeout);
        }

        this.messageTimeout = window.setTimeout(() => {
            if (this.messageElement) {
                this.messageElement.style.opacity = '0';

                setTimeout(() => {
                    if (this.messageElement) {
                        this.messageElement.style.display = 'none';
                    }

                    if (this.messageUpdateInterval) {
                        window.cancelAnimationFrame(this.messageUpdateInterval);
                        this.messageUpdateInterval = null;
                    }
                }, 300);
            }
            this.messageTimeout = null;
        }, duration);
    }

    private createMessageElement(): void {
        this.messageElement = document.createElement('div');
        this.messageElement.className = 'remote-player-message';
        document.body.appendChild(this.messageElement);
    }

    private createFloatingNameElement(): void {
        this.floatingNameElement = document.createElement('div');
        this.floatingNameElement.className = 'remote-player-floating-name';
        this.floatingNameElement.textContent = this.data.name;
        document.body.appendChild(this.floatingNameElement);

        // Add styles if they don't exist yet
        if (!document.querySelector('#remote-player-floating-name-style')) {
            const style = document.createElement('style');
            style.id = 'remote-player-floating-name-style';
            style.textContent = `
                .remote-player-floating-name {
                    position: absolute;
                    padding: 2px 8px;
                    background-color: rgba(31, 41, 55, 0.95);
                    color: white;
                    border-radius: 4px;
                    font-size: 14px;
                    pointer-events: none;
                    white-space: nowrap;
                    text-align: center;
                    transform: translate(-50%, 0);
                    z-index: 10;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    text-shadow: 0 0 2px rgba(0, 0, 0, 0.8);
                    opacity: 0;
                    transition: opacity 0.3s ease;
                }
            `;
            document.head.appendChild(style);
        }

        // Start the update loop for the floating name
        this.startFloatingNameUpdateLoop();
    }

    private startFloatingNameUpdateLoop(): void {
        if (this.floatingNameUpdateInterval) {
            window.cancelAnimationFrame(this.floatingNameUpdateInterval);
        }

        const updateLoop = () => {
            if (this.floatingNameElement) {
                this.updateFloatingNamePosition();
                this.floatingNameUpdateInterval = window.requestAnimationFrame(updateLoop);
            } else {
                this.floatingNameUpdateInterval = null;
            }
        };

        this.floatingNameUpdateInterval = window.requestAnimationFrame(updateLoop);

        // Show the name after a small delay to ensure positioning is correct
        setTimeout(() => {
            if (this.floatingNameElement) {
                this.floatingNameElement.style.opacity = '1';
            }
        }, 100);
    }

    private updateFloatingNamePosition(): void {
        if (!this.floatingNameElement || !this.data.position.coordinates) return;

        // Get current player position
        const currentPlayerCoords = PlayerStore.getCoordinates();
        let isVisible = ZoomController.getZoom() >= 15;

        // Check distance if we have current player coordinates
        if (currentPlayerCoords && isVisible) {
            const distance = this.calculateDistance(
                currentPlayerCoords[1], currentPlayerCoords[0],
                this.data.position.coordinates[1], this.data.position.coordinates[0]
            );
            isVisible = isVisible && distance <= this.NAME_VISIBILITY_DISTANCE;
        }

        // Update visibility based on zoom level
        if (isVisible) {
            if (this.floatingNameElement.style.display === 'none') {
                this.floatingNameElement.style.display = 'block';
                // Fade in when becoming visible
                setTimeout(() => {
                    if (this.floatingNameElement) {
                        this.floatingNameElement.style.opacity = '1';
                    }
                }, 10);
            }

            const screenCoords = this.map.project([
                this.data.position.coordinates[0],
                this.data.position.coordinates[1]
            ]);

            // Position above the vehicle (40px higher than message position)
            this.floatingNameElement.style.transform = `translate(-50%, 0) translate(0, ${screenCoords.y - 50}px)`;
            this.floatingNameElement.style.top = '0';
            this.floatingNameElement.style.left = `${screenCoords.x}px`;
        } else if (this.floatingNameElement.style.display !== 'none') {
            // Hide when zoom is too low
            this.floatingNameElement.style.opacity = '0';

            // Remove from DOM flow after fade out animation completes
            setTimeout(() => {
                if (this.floatingNameElement && ZoomController.getZoom() < 15) {
                    this.floatingNameElement.style.display = 'none';
                }
            }, 300);
        }
    }

    private updateMessagePosition(): void {
        if (!this.messageElement || !this.data.position.coordinates) return;

        const screenCoords = this.map.project([
            this.data.position.coordinates[0],
            this.data.position.coordinates[1]
        ]);

        this.messageElement.style.transform = `translate(-50%, 0) translate(0, ${screenCoords.y - 100}px)`;
        this.messageElement.style.top = '0';
        this.messageElement.style.left = `${screenCoords.x}px`;
    }

    public remove(): void {
        if (this.messageTimeout) {
            window.clearTimeout(this.messageTimeout);
            this.messageTimeout = null;
        }

        if (this.messageUpdateInterval) {
            window.cancelAnimationFrame(this.messageUpdateInterval);
            this.messageUpdateInterval = null;
        }

        if (this.floatingNameUpdateInterval) {
            window.cancelAnimationFrame(this.floatingNameUpdateInterval);
            this.floatingNameUpdateInterval = null;
        }

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.model) {
            this.tb.remove(this.model);
            this.model = null;
        }

        // Clean up minecraft character parts
        this.characterGroup = null;
        this.head = null;
        this.body = null;
        this.leftArm = null;
        this.rightArm = null;
        this.leftLeg = null;
        this.rightLeg = null;
        this.walkCycle = 0;

        this.mixer = null;
        this.currentAnimation = null;
        this.lastAnimationTime = 0;

        this.marker.remove();

        if (this.messageElement) {
            document.body.removeChild(this.messageElement);
            this.messageElement = null;
        }

        if (this.floatingNameElement) {
            document.body.removeChild(this.floatingNameElement);
            this.floatingNameElement = null;
        }
    }

    public getLastUpdateTime(): number {
        return this.lastUpdateTime;
    }

    public getSpeed(): number {
        return this.data.stats.currentSpeed;
    }

    public getId(): string {
        return this.data.playerId;
    }

    public getName(): string {
        return this.data.name;
    }

    public getModelType(): string {
        return this.modelType;
    }

    public getAnimationState(): string {
        return this.animationState;
    }

    public getCurrentSpeed(): number {
        return this.data.stats.currentSpeed;
    }


    public getStateType(): string {
        return this.data.state.stateType;
    }

    private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371; // Earth's radius in kilometers
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

    public setName(name: string): void {
        this.data.name = name;
        this.nameElement.textContent = name;

        if (this.floatingNameElement) {
            this.floatingNameElement.textContent = name;
        }
    }
} 