import { MinimapOptions, MinimapState, OtherVehicleData } from './MinimapTypes';
import { MinimapUI } from './MinimapUI';
import './minimap.css';
import { PlayerStore } from '../stores/PlayerStore';

export class MinimapController {
  private state: MinimapState = {
    isExpanded: false,
    userHasZoomed: false,
    autoFollowVehicle: true,
    rotateWithVehicle: true,
    lastAutoUpdateTime: 0,
    otherVehicleMarkers: new Map()
  };

  private ui: MinimapUI;
  private updateInterval: number | null = null;

  constructor(
    map: mapboxgl.Map,
    private options: MinimapOptions = {}
  ) {
    // Initialize UI with controller methods
    this.ui = new MinimapUI(map, options, {
      onExpand: () => this.expand(),
      onCollapse: () => this.collapse(),
      onZoomIn: () => this.zoomIn(),
      onZoomOut: () => this.zoomOut(),
      onResetView: () => this.resetView()
    });

    // Start auto updates
    this.startAutoUpdates();
  }

  private startAutoUpdates(): void {
    // Reduce minimap update frequency to ease main thread load
    const UPDATE_INTERVAL_MS = 250; // 4x per second is enough
    this.updateInterval = window.setInterval(() => {
      this.updateVehicleState();
      //if (!this.dependencies.vehiclesController) return;
      //const players = this.dependencies.vehiclesController.getAllPlayers();
      //this.updateOtherVehicles(players);
    }, UPDATE_INTERVAL_MS);
  }

  private updateOtherVehicles(players: Array<{
    id: string;
    name: string;
    position: {
      coordinates: [number, number];
    };
    lastUpdate: number;
  }>): void {
    const activePlayerIds = new Set<string>();

    // Update or add markers for current players
    players.forEach(player => {
      activePlayerIds.add(player.id);

      const vehicleData: OtherVehicleData = {
        id: player.id,
        name: player.name,
        coordinates: player.position.coordinates,
        rotation: { x: 0, y: 0, z: 0 } // We might need to add rotation to the players data
      };

      this.ui.updateOtherVehicle(vehicleData);
    });

  }

  public removeOtherVehicle(playerId: string): void {
    this.ui.removeOtherVehicle(playerId);
    this.state.otherVehicleMarkers.delete(playerId);
  }

  private updateVehicleState(): void {
    const coords = PlayerStore.getCoordinates();
    const rotation = PlayerStore.getRotation();

    if (coords && coords.length >= 2 && rotation) {
      // Convert vehicle's Z rotation to bearing degrees
      const bearing = -(rotation.z * 180 / Math.PI);

      // Update UI with new position and bearing
      this.ui.updateVehiclePosition([coords[0], coords[1]], bearing);
    }
  }

  // Public methods for UI actions
  public expand(): void {
    if (this.state.isExpanded) return;
    this.state.isExpanded = true;
    this.state.autoFollowVehicle = false;
    this.ui.setExpanded(true);
  }

  public collapse(): void {
    if (!this.state.isExpanded) return;
    this.state.isExpanded = false;
    this.state.autoFollowVehicle = true;
    this.ui.setExpanded(false);
  }

  public zoomIn(): void {
    if (!this.state.isExpanded) return;
    this.state.userHasZoomed = true;
    this.ui.zoomIn();
  }

  public zoomOut(): void {
    if (!this.state.isExpanded) return;
    this.state.userHasZoomed = true;
    this.ui.zoomOut();
  }

  public resetView(): void {
    this.state.userHasZoomed = false;
    this.state.autoFollowVehicle = true;
    this.state.rotateWithVehicle = true;
    this.ui.resetView();
  }

  public toggleAutoFollow(): void {
    this.state.autoFollowVehicle = !this.state.autoFollowVehicle;
    if (this.state.autoFollowVehicle) {
      this.updateVehicleState();
    }
  }

  public toggleRotateWithVehicle(): void {
    this.state.rotateWithVehicle = !this.state.rotateWithVehicle;
    if (this.state.rotateWithVehicle) {
      this.updateVehicleState();
    }
  }

  public resetState(): void {
    this.state = {
      isExpanded: this.state.isExpanded,
      userHasZoomed: false,
      autoFollowVehicle: true,
      rotateWithVehicle: true,
      lastAutoUpdateTime: 0,
      otherVehicleMarkers: new Map()
    };
    this.updateVehicleState();
  }

  public resize(): void {
    this.ui.resize();
  }

  public destroy(): void {
    // Clear update interval
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    // Clean up UI
    this.ui.destroy();

    // Reset state
    this.state = {
      isExpanded: false,
      userHasZoomed: false,
      autoFollowVehicle: true,
      rotateWithVehicle: true,
      lastAutoUpdateTime: 0,
      otherVehicleMarkers: new Map()
    };
  }

  // Add public method to get navigation container
  public getNavigationContainer(): HTMLElement | undefined {
    return this.ui.getNavigationContainer();
  }
} 