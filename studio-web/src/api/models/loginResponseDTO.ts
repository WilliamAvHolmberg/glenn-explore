/**
 * Generated by orval v7.8.0 🍺
 * Do not edit manually.
 * api
 * OpenAPI spec version: v1
 */
import type { LastPositionDTO } from './lastPositionDTO';

export interface LoginResponseDTO {
  /** @nullable */
  playerId?: string | null;
  /** @nullable */
  username?: string | null;
  /** @nullable */
  firstName?: string | null;
  /** @nullable */
  lastName?: string | null;
  /** @nullable */
  email?: string | null;
  isGuest?: boolean;
  isAdmin?: boolean;
  lastPosition?: LastPositionDTO;
  /** @nullable */
  guestKey?: string | null;
  hasPaid?: boolean;
}
