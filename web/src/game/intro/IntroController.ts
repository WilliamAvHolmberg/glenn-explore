import { PlayerStore } from '../stores/PlayerStore';
import { AuthClient } from '../realtime/AuthClient';
import { IntroOptions} from './IntroTypes';
import { IntroUI } from './IntroUI';
import { LoginResponse } from '../realtime/types/Auth';

export class IntroController {
  private introUI: IntroUI;
  private authClient: AuthClient;
  private playerIdKey = 'playerId';
  private introViewedKey = 'introViewed';
  private selectedVehicle: 'car' | 'dinosaur' = 'car';

  constructor(authClient: AuthClient, private onNameChange?: (name: string) => void) {
    this.introUI = new IntroUI();
    this.authClient = authClient;
  }

  /**
   * Show the intro UI with authentication requirements
   */
  public async showIntro(loginResponse: LoginResponse | null, onComplete: (coords: [number, number]) => void): Promise<void> {
    const options: IntroOptions = {
      isAuthenticated: !!loginResponse,
      //hasPaid: loginResponse?.hasPaid ?? false,
      hasPaid: true,
      email: loginResponse?.email,
      onStartGame: onComplete,
      onVehicleSelect: (vehicleType) => {
        this.selectedVehicle = vehicleType;
        PlayerStore.setMovementMode(vehicleType === 'car' ? 'car' : 'walking');
      },
      onRequestOtp: async (email) => {
        try {
          const response = await this.authClient.requestOtp(email);
          if (response.success) {
            this.introUI.updateState('login', {
              currentStep: 'login',
              loginState: { email, isVerified: false, otpSent: true, isLoading: false },
              paymentState: { isProcessing: false },
              instructionsState: { playerName: '', selectedVehicle: this.selectedVehicle }
            });
          }
          return response;
        } catch (error) {
          console.error('Failed to request OTP:', error);
          throw error;
        }
      },
      onVerifyOtp: async (_email, otpCode) => {
        try {
          const response = await this.authClient.verifyOtp(otpCode);

          if (!response) {
            window.alert('Something went wrong. Please try again.');
            return null;
          }
          
          // Update player store with data from login response
          PlayerStore.setPlayerName(response.username);
          PlayerStore.setIsGuest(response.isGuest);
          
          // Store player ID for future sessions
          localStorage.setItem(this.playerIdKey, response.username);
          
          // If user hasn't paid, show payment UI
          // if (!response.hasPaid) {
          //   return response;
          // }
          
          // If user has paid, mark intro as viewed and proceed
          this.markIntroAsViewed();
          return response;
        } catch (error) {
          console.error('Failed to verify OTP:', error);
          return null;
        }
      },
      onSetName: (name) => {
        if (this.onNameChange) {
          this.onNameChange(name);
        }
      },
      onInitiatePayment: async () => {
        try {
          const response = await fetch('/api/payment/create-checkout-session', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
          });

          if (!response.ok) {
            throw new Error('Failed to create checkout session');
          }

          const { url } = await response.json();
          window.location.href = url;
          
          return { success: true };
        } catch (error) {
          console.error('Payment failed:', error);
          throw error;
        }
      }
    };

    this.introUI.show(options, {
      currentStep: loginResponse ? 'payment' : 'login',
      loginState: { email: '', isVerified: false, otpSent: false, isLoading: false },
      paymentState: { isProcessing: false },
      instructionsState: { playerName: '', selectedVehicle: this.selectedVehicle }
    });
  }

  /**
   * Mark the intro as viewed in local storage
   */
  private markIntroAsViewed(): void {
    localStorage.setItem(this.introViewedKey, 'true');
  }

  /**
   * Check if the intro has been viewed
   */
  public hasViewedIntro(): boolean {
    return localStorage.getItem(this.introViewedKey) === 'true';
  }
} 