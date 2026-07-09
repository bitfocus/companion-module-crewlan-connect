export interface PublicResponseMeta {
  apiVersion: "v1";
  revision: number;
  nextCursor?: number | null;
}

export interface PublicItemResponse<T> {
  data: T;
  meta: PublicResponseMeta;
}

export interface PublicListResponse<T> {
  data: T[];
  meta: PublicResponseMeta;
}

export interface PublicSessionDto {
  workspace: {
    required: boolean;
    granted: boolean;
  };
  entities: Array<{
    entityId: string;
    granted: boolean;
  }>;
}

export interface PublicWorkspaceDto {
  id: string | null;
  name: string;
  listenMode: "local-only" | "lan";
  protected: boolean;
  features: string[];
}

export interface PublicStatusDto {
  id: string;
  kind: "system" | "custom";
  label: string;
  paletteKey: string;
  colors: {
    backgroundColor: string;
    foregroundColor: string;
  };
  alertType: string | null;
  motionPreset: string;
  selectable: boolean;
}

export interface PublicEntityDto {
  id: string;
  type: "participant" | "device";
  displayName: string;
  position: string | null;
  credentialRequired: boolean;
  lastSeenAt: string;
  status: PublicStatusDto;
}

export interface PublicEntityStatusDto {
  entityId: string;
  status: PublicStatusDto;
  selectedStatusId: string;
  updatedAt: string | null;
}

export interface PublicEntityControlsDto {
  entityId: string;
  shoutbox: {
    listen: {
      enabled: boolean;
      muted: boolean;
      available: boolean;
    };
    talk: {
      enabled: boolean;
      active: boolean;
      live: boolean;
      controlMode: "push" | "latch" | null;
      latchedPreference: boolean;
      available: boolean;
    };
  };
  updatedAt: string | null;
}

export interface PublicDismissEntityAlertsDto {
  status: "updated";
  entityId: string;
  dismissedCount: number;
}

export type PublicEventType = "status.changed" | "alert.triggered" | "entity.controls.changed";

export interface PublicEntitySummaryDto {
  id: string;
  type: "participant" | "device";
  displayName: string;
  position: string | null;
}

export interface PublicStatusChangedEventData extends PublicEntityStatusDto {
  entity: PublicEntitySummaryDto;
}

export interface PublicAlertTriggeredEventData {
  scope: "workspace" | "entities";
  targetEntityIds: string[] | null;
}

export interface PublicEntityControlsChangedEventData extends PublicEntityControlsDto {
  entity: PublicEntitySummaryDto;
}

export interface PublicEventEnvelope<TData = unknown> {
  id: string;
  type: PublicEventType;
  occurredAt: string;
  data: TData;
  meta: PublicResponseMeta;
}

export interface CrewLanState {
  connected: boolean;
  entityId: string | null;
  workspace: PublicWorkspaceDto | null;
  entity: PublicEntityDto | null;
  statuses: PublicStatusDto[];
  status: PublicEntityStatusDto | null;
  controls: PublicEntityControlsDto | null;
  lastAlert: string;
  lastError: string;
}

export interface CrewLanStatusChoice {
  id: string;
  label: string;
}
