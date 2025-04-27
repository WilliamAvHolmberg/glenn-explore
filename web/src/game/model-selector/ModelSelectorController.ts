import { PlayerStore } from '../stores/PlayerStore';
import { PlayerController } from '../player/PlayerController';
import { ModelClient } from '../api/ModelClient';
import { ModelResponse, ModelConfig } from '../api/types/ModelTypes';
import { trackQuestEvent } from '../quests/engine/trackQuestEvent';
import './model-selector-dialog.css';
import { Toast } from '../toast/ToastController';

export class ModelSelectorController {
    private dialogElement: HTMLElement | null = null;
    private onClose?: () => void;
    private modelClient: ModelClient;
    private availableModels: ModelResponse[] = [];
    private isLoading: boolean = false;

    constructor(
        private map: mapboxgl.Map,
        private playerController: PlayerController
    ) {
        // Bind methods
        this.handleModelSelect = this.handleModelSelect.bind(this);
        this.close = this.close.bind(this);
        this.handlePurchaseClick = this.handlePurchaseClick.bind(this);

        // Initialize model client
        this.modelClient = new ModelClient();

        // Check URL for model purchase success
        this.checkPurchaseSuccess();
    }

    private async checkPurchaseSuccess(): Promise<void> {
        // Check URL parameters for model purchase success
        const urlParams = new URLSearchParams(window.location.search);
        const modelPurchased = urlParams.get('modelPurchased');

        if (modelPurchased) {
            // Remove the parameter from URL without reloading the page
            const newUrl = window.location.pathname + window.location.hash;
            window.history.replaceState({}, document.title, newUrl);

            // Show success message
            Toast.show({
                message: `Model ${modelPurchased} purchased successfully!`,
                type: 'success',
                duration: 5000
            });

            // Refresh unlocked models
            await this.refreshUnlockedModels();
        }
    }

    private async refreshUnlockedModels(): Promise<void> {
        try {
            const models = await this.modelClient.getUnlockedModels();
            PlayerStore.setUnlockedModels(models);
        } catch (error) {
            console.error('Failed to refresh unlocked models:', error);
        }
    }

    public async show(onClose?: () => void): Promise<void> {
        this.onClose = onClose;
        this.isLoading = true;

        // Create dialog first to show loading state
        this.createDialog();

        try {
            // Fetch available models from API
            this.availableModels = await this.modelClient.getAvailableModels();

            // Store unlocked models in PlayerStore
            const unlockedModels = this.availableModels
                .filter(model => model.isUnlocked)
                .map(model => ({
                    modelId: model.modelId,
                    purchasedAt: new Date().toISOString()
                }));

            PlayerStore.setUnlockedModels(unlockedModels);

            // Update dialog with model data
            this.updateDialogContent();
        } catch (error) {
            console.error('Failed to load model data:', error);
            Toast.show({
                message: 'Failed to load models. Please try again.',
                type: 'warning',
                duration: 3000
            });
        } finally {
            this.isLoading = false;
            this.updateDialogContent();
        }
    }

    private createDialog(): void {
        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'model-selector-overlay';

        // Create dialog
        const dialog = document.createElement('div');
        dialog.className = 'model-selector-dialog';

        // Create header section
        const header = document.createElement('div');
        header.className = 'model-selector-header';
        header.innerHTML = `
            <div class="header-content">
                <h2>Choose your model</h2>
                <div class="model-selector-subtitle">Premium models can be purchased with real money</div>
            </div>
        `;

        // Add promo text
        const promoText = document.createElement('div');
        promoText.className = 'model-selector-promo';
        promoText.innerHTML = `
            Want your own model or car in the game? Send me an image of what you want!<br>
            <a href="mailto:mail@playglenn.com">mail@playglenn.com</a> - I'll turn it into a 3D model for you <span class="price">2USD/model</span><br>
            <a href="https://discord.gg/ZaWdh6g4DU " target="_blank">Join our Discord community!</a>
            <p>https://discord.gg/ZaWdh6g4DU </p>
        `;

        // Create content with loading indicator
        const content = document.createElement('div');
        content.innerHTML = this.isLoading
            ? `<div class="model-selector-loading">Loading models...</div>`
            : this.createContent();

        // Add event listeners
        header.querySelector('.model-selector-close')?.addEventListener('click', this.close);
        content.addEventListener('click', this.handleModelSelect);

        // Assemble dialog
        dialog.appendChild(header);
        dialog.appendChild(promoText);
        dialog.appendChild(content);
        overlay.appendChild(dialog);

        // Add to document
        document.body.appendChild(overlay);
        this.dialogElement = overlay;
    }

    private updateDialogContent(): void {
        if (!this.dialogElement) return;

        const content = this.dialogElement.querySelector('.model-selector-dialog > div:last-child');
        if (!content) return;

        content.innerHTML = this.isLoading
            ? `<div class="model-selector-loading">Loading models...</div>`
            : this.createContent();

        // Reattach event listeners
        content.addEventListener('click', this.handleModelSelect);
    }

    private createContent(): string {
        const currentModel = PlayerStore.getState().modelType;
        const movementMode = PlayerStore.getMovementMode();

        const carModels = this.availableModels.filter(m => m.type.toLowerCase() === 'car' && m.isFeatured);
        const characterModels = this.availableModels.filter(m => m.type.toLowerCase() === 'walking' && m.isFeatured);
        return `
            <div class="model-selector-section">
                <h3>🚗 Cars</h3>
                <div class="model-grid">
                    ${carModels.map(model => {
                        const config = model.config;
                        return `
                            <div class="model-card ${movementMode === 'car' && currentModel === model.modelId ? 'selected' : ''} ${!model.isUnlocked ? 'locked' : ''}" 
                                data-model-id="${model.modelId}" 
                                data-model-type="car"
                                data-is-premium="${model.isPremium}"
                                data-is-unlocked="${model.isUnlocked}">
                                <div class="model-preview ${!model.thumbnailUrl ? 'no-image' : ''}">
                                    ${model.thumbnailUrl
                                        ? `<img src="${model.thumbnailUrl}" alt="${model.name}">`
                                        : model.name
                                    }
                                    ${!model.isUnlocked ? `<div class="model-lock-overlay">🔒</div>` : ''}
                                </div>
                                <p class="model-name">${model.name}</p>
                                <div class="model-price">
                                    ${model.isUnlocked
                                        ? `<span class="model-owned">Owned</span>`
                                        : `<span class="price-tag">$${model.price.toFixed(2)}</span>
                                           <button class="purchase-button" data-model-id="${model.modelId}">Purchase</button>`
                                    }
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <div class="model-selector-section">
                <h3>🚶 Characters</h3>
                <div class="model-grid">
                    ${characterModels.map(model => {
                        const config = model.config;
                        return `
                            <div class="model-card ${movementMode === 'walking' && currentModel === model.modelId ? 'selected' : ''} ${!model.isUnlocked ? 'locked' : ''}" 
                                data-model-id="${model.modelId}" 
                                data-model-type="character"
                                data-is-premium="${model.isPremium}"
                                data-is-unlocked="${model.isUnlocked}">
                                <div class="model-preview ${!model.thumbnailUrl ? 'no-image' : ''}">
                                    ${model.thumbnailUrl
                                        ? `<img src="${model.thumbnailUrl}" alt="${model.name}">`
                                        : model.name
                                    }
                                    ${!model.isUnlocked ? `<div class="model-lock-overlay">🔒</div>` : ''}
                                </div>
                                <p class="model-name">${model.name}</p>
                                <div class="model-price">
                                    ${model.isUnlocked
                                        ? `<span class="model-owned">Owned</span>`
                                        : `<span class="price-tag">$${model.price.toFixed(2)}</span>
                                           <button class="purchase-button" data-model-id="${model.modelId}">Purchase</button>`
                                    }
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    private async handleModelSelect(event: Event): Promise<void> {
        const target = event.target as HTMLElement;

        // Check if it's a purchase button
        if (target.classList.contains('purchase-button')) {
            event.stopPropagation(); // Prevent the model selection
            await this.handlePurchaseClick(target);
            return;
        }

        const card = target.closest('.model-card') as HTMLElement;
        if (!card) return;

        const modelId = card.dataset.modelId;
        const modelType = card.dataset.modelType as 'car' | 'walking';
        const isUnlocked = card.dataset.isUnlocked === 'true';

        if (!modelId || !modelType || !isUnlocked) {
            if (!isUnlocked) {
                Toast.show({
                    message: 'This model is locked. Purchase it to use it.',
                    type: 'warning',
                    duration: 2000
                });
            }
            return;
        }

        const selectedModel = this.availableModels.find(m => m.modelId === modelId);
        if (!selectedModel?.config) {
            Toast.show({
                message: 'Model configuration not found.',
                type: 'warning',
                duration: 2000
            });
            return;
        }


        // Switch to the selected model
        await this.playerController.switchState(modelId, modelType, selectedModel);
        // Track the model selection for quest
        trackQuestEvent('MODEL_SELECTED');
        // Close the dialog
        this.close();
    }

    private async handlePurchaseClick(button: HTMLElement): Promise<void> {
        const modelId = button.dataset.modelId;
        if (!modelId) return;

        try {
            button.textContent = 'Processing...';
            (button as HTMLButtonElement).disabled = true;

            // Call the API to get checkout URL
            const { checkoutUrl } = await this.modelClient.purchaseModel(modelId);

            // Open Stripe checkout in a new window
            window.location.href = checkoutUrl;
        } catch (error) {
            console.error('Failed to initiate purchase:', error);
            Toast.show({
                message: 'Failed to process purchase. Please try again.',
                type: 'warning',
                duration: 3000
            });

            // Reset button
            button.textContent = 'Purchase';
            (button as HTMLButtonElement).disabled = false;
        }
    }

    public close(): void {
        if (this.dialogElement) {
            this.dialogElement.remove();
            this.dialogElement = null;
        }
        if (this.onClose) {
            this.onClose();
        }
    }

    public destroy(): void {
        this.close();
    }
} 