import {
  InstanceBase,
  InstanceStatus,
  type InstanceTypes,
  type SomeCompanionConfigField,
} from "@companion-module/base";
import { CrewLanApiClient, CrewLanApiError } from "./api.js";
import {
  GetConfigFields,
  migrateLegacyEntityToken,
  resolveEntityToken,
  type ModuleConfig,
  type ModuleSecrets,
} from "./config.js";
import { UpdateActions, type ActionsSchema } from "./actions.js";
import { UpdateFeedbacks, type FeedbacksSchema } from "./feedbacks.js";
import { UpdatePresets } from "./presets.js";
import { getCompanionStatusLabel } from "./status-labels.js";
import type {
  CrewLanState,
  CrewLanStatusChoice,
  PublicAlertTriggeredEventData,
  PublicEntityControlsChangedEventData,
  PublicEventEnvelope,
  PublicStatusChangedEventData,
  PublicStatusDto,
} from "./types.js";
import { UpgradeScripts } from "./upgrades.js";
import {
  UpdateVariableDefinitions,
  UpdateVariableValues,
  type VariablesSchema,
} from "./variables.js";

const feedbackIds: (keyof FeedbacksSchema)[] = [
  "connection_ok",
  "status_is",
  "status_style",
  "listen_enabled",
  "listen_available",
  "listen_muted",
  "talk_enabled",
  "talk_available",
  "talk_push_active",
  "talk_latch_active",
  "talk_active",
  "talk_live",
];

const defaultState: CrewLanState = {
  connected: false,
  entityId: null,
  workspace: null,
  entity: null,
  statuses: [],
  status: null,
  controls: null,
  lastAlert: "",
  lastError: "",
};

export const authenticationFailedConnectionMessage =
  "Could not establish a connection because authentication failed.";

function cloneState(): CrewLanState {
  return {
    ...defaultState,
    statuses: [],
  };
}

function describeError(error: unknown): string {
  if (error instanceof CrewLanApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown CrewLAN error.";
}

export function statusForError(error: unknown): InstanceStatus {
  if (error instanceof CrewLanApiError) {
    if (error.statusCode === 401) {
      return InstanceStatus.AuthenticationFailure;
    }

    if (error.statusCode === 403) {
      return InstanceStatus.AuthenticationFailure;
    }

    if (error.statusCode === 400 || error.statusCode === 404) {
      return InstanceStatus.BadConfig;
    }

    if (error.statusCode !== null) {
      return InstanceStatus.ConnectionFailure;
    }

    const message = error.message.toLowerCase();

    if (message.includes("address") || message.includes("url")) {
      return InstanceStatus.BadConfig;
    }

    if (message.includes("token") || message.includes("capability")) {
      return InstanceStatus.AuthenticationFailure;
    }
  }

  if (error instanceof Error) {
    return InstanceStatus.ConnectionFailure;
  }

  return InstanceStatus.UnknownError;
}

export function describeCompanionErrorForDisplay(error: unknown): string {
  if (statusForError(error) === InstanceStatus.AuthenticationFailure) {
    return authenticationFailedConnectionMessage;
  }

  return describeError(error);
}

export { UpgradeScripts };

export interface ModuleSchema extends InstanceTypes {
  config: ModuleConfig;
  secrets: ModuleSecrets | undefined;
  actions: ActionsSchema;
  feedbacks: FeedbacksSchema;
  variables: VariablesSchema;
}

export class ModuleInstance extends InstanceBase<ModuleSchema> {
  config!: ModuleConfig;

  private entityToken = "";
  private api: CrewLanApiClient | null = null;
  private state: CrewLanState = cloneState();
  private eventAbortController: AbortController | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(internal: unknown) {
    super(internal);
  }

  async init(
    config: ModuleConfig,
    _isFirstInit: boolean,
    secrets: ModuleSecrets | undefined,
  ): Promise<void> {
    this.applyConfig(config, secrets);
    this.updateActions();
    this.updateFeedbacks();
    this.updatePresets();
    this.updateVariableDefinitions();
    await this.connect();
  }

  async destroy(): Promise<void> {
    this.cleanupConnection();
  }

  async configUpdated(
    config: ModuleConfig,
    secrets: ModuleSecrets | undefined,
  ): Promise<void> {
    this.applyConfig(config, secrets);
    this.cleanupConnection();
    await this.connect();
  }

  getConfigFields(): SomeCompanionConfigField[] {
    return GetConfigFields();
  }

  updateActions(): void {
    UpdateActions(this);
  }

  updateFeedbacks(): void {
    UpdateFeedbacks(this);
  }

  updatePresets(): void {
    UpdatePresets(this);
  }

  updateVariableDefinitions(): void {
    UpdateVariableDefinitions(this);
    UpdateVariableValues(this);
  }

  getCrewLanState(): CrewLanState {
    return this.state;
  }

  getSelectableStatuses(): PublicStatusDto[] {
    return this.state.statuses.filter((status) => status.selectable);
  }

  getStatusChoices(): CrewLanStatusChoice[] {
    const choices = this.getSelectableStatuses().map((status) => ({
      id: status.id,
      label: getCompanionStatusLabel(status),
    }));

    if (choices.length > 0) {
      return choices;
    }

    return [{ id: "", label: "No selectable statuses loaded" }];
  }

  getDefaultStatusChoice(): string {
    return this.getStatusChoices()[0]?.id ?? "";
  }

  async refreshCrewLan(): Promise<void> {
    await this.connect();
  }

  async runCrewLanAction(actionName: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.handleOperationError(actionName, error);
    }
  }

  async setCrewLanStatus(statusId: string): Promise<void> {
    if (statusId.trim().length === 0) {
      return;
    }

    const api = this.requireApi();
    const entityId = this.requireEntityId();
    const status = await api.setEntityStatus(entityId, statusId);
    this.state = { ...this.state, status, lastError: "" };
    this.publishState();
  }

  async setListenMuteMode(mode: "toggle" | "on" | "off"): Promise<void> {
    const currentMuted = this.state.controls?.shoutbox.listen.muted === true;
    const nextMuted = mode === "toggle" ? !currentMuted : mode === "on";
    await this.patchControls({
      shoutbox: {
        listen: {
          muted: nextMuted,
        },
      },
    });
  }

  async setTalkLatchMode(mode: "toggle" | "on" | "off"): Promise<void> {
    const currentActive = this.state.controls?.shoutbox.talk.active === true;
    const nextActive = mode === "toggle" ? !currentActive : mode === "on";
    await this.setTalkState(nextActive, "latch");
  }

  async setTalkState(active: boolean, controlMode: "push" | "latch"): Promise<void> {
    await this.patchControls({
      shoutbox: {
        talk: {
          active,
          controlMode: active ? controlMode : null,
        },
      },
    });
  }

  async dismissAlerts(): Promise<void> {
    const api = this.requireApi();
    const entityId = this.requireEntityId();

    await api.dismissEntityAlerts(entityId);
    this.state = {
      ...this.state,
      lastAlert: "",
      lastError: "",
    };
    this.publishState();
  }

  private applyConfig(
    config: ModuleConfig,
    secrets: ModuleSecrets | undefined,
  ): void {
    const migration = migrateLegacyEntityToken(config, secrets);
    this.config = migration.config;
    this.entityToken = resolveEntityToken(migration.config, migration.secrets);

    if (migration.migrated) {
      this.saveConfig(migration.config, migration.secrets);
    }
  }

  private async connect(): Promise<void> {
    this.cleanupConnection();
    this.state = cloneState();
    this.publishState();

    try {
      this.api = new CrewLanApiClient({
        baseUrl: this.config.baseUrl,
        token: this.entityToken,
      });
      this.updateStatus(InstanceStatus.Connecting);
      await this.loadSnapshot();
      this.updateStatus(InstanceStatus.Ok);
      this.startEventStream();
      this.startPolling();
    } catch (error) {
      this.api = null;
      this.handleConnectionError(error);
      this.scheduleReconnect();
    }
  }

  private cleanupConnection(): void {
    this.api = null;

    if (this.eventAbortController !== null) {
      this.eventAbortController.abort();
      this.eventAbortController = null;
    }

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async loadSnapshot(signal?: AbortSignal): Promise<void> {
    const api = this.requireApi();
    const session = await api.getSession(signal);
    const grantedEntities = session.entities.filter((entity) => entity.granted);

    if (grantedEntities.length !== 1) {
      throw new CrewLanApiError(
        "The token must grant exactly one CrewLAN entity capability.",
      );
    }

    const entityId = grantedEntities[0]?.entityId;

    if (entityId === undefined || entityId.length === 0) {
      throw new CrewLanApiError("The token did not contain a CrewLAN entity id.");
    }

    const [workspace, entity, statuses, status, controls] = await Promise.all([
      api.getWorkspace(signal),
      api.getEntity(entityId, signal),
      api.listStatuses(signal),
      api.getEntityStatus(entityId, signal),
      api.getEntityControls(entityId, signal),
    ]);

    this.state = {
      ...this.state,
      connected: true,
      entityId,
      workspace,
      entity,
      statuses,
      status,
      controls,
      lastError: "",
    };
    this.publishState();
  }

  private startEventStream(): void {
    const api = this.requireApi();
    const controller = new AbortController();
    this.eventAbortController = controller;

    void api.streamEvents(controller.signal, (event) => this.applyEvent(event)).catch((error) => {
      if (controller.signal.aborted) {
        return;
      }

      this.handleConnectionError(error);
      this.scheduleReconnect();
    });
  }

  private startPolling(): void {
    const intervalMs = Math.max(1000, Number(this.config.pollIntervalMs) || 5000);
    this.pollTimer = setInterval(() => {
      void this.loadSnapshot().catch((error) => {
        this.handleConnectionError(error);
        this.scheduleReconnect();
      });
    }, intervalMs);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, Math.max(1000, Number(this.config.pollIntervalMs) || 5000));
  }

  private applyEvent(event: PublicEventEnvelope): void {
    if (event.type === "status.changed") {
      this.applyStatusEvent(event as PublicEventEnvelope<PublicStatusChangedEventData>);
      return;
    }

    if (event.type === "entity.controls.changed") {
      this.applyControlsEvent(
        event as PublicEventEnvelope<PublicEntityControlsChangedEventData>,
      );
      return;
    }

    if (event.type === "alert.triggered") {
      this.applyAlertEvent(event as PublicEventEnvelope<PublicAlertTriggeredEventData>);
    }
  }

  private applyStatusEvent(event: PublicEventEnvelope<PublicStatusChangedEventData>): void {
    if (event.data.entityId !== this.state.entityId) {
      return;
    }

    this.state = {
      ...this.state,
      status: {
        entityId: event.data.entityId,
        status: event.data.status,
        selectedStatusId: event.data.selectedStatusId,
        updatedAt: event.data.updatedAt,
      },
      lastError: "",
    };
    this.publishState();
  }

  private applyControlsEvent(
    event: PublicEventEnvelope<PublicEntityControlsChangedEventData>,
  ): void {
    if (event.data.entityId !== this.state.entityId) {
      return;
    }

    this.state = {
      ...this.state,
      controls: event.data,
      lastError: "",
    };
    this.publishState();
  }

  private applyAlertEvent(event: PublicEventEnvelope<PublicAlertTriggeredEventData>): void {
    const targetEntityIds = event.data.targetEntityIds;
    const shouldShow =
      targetEntityIds === null ||
      (this.state.entityId !== null && targetEntityIds.includes(this.state.entityId));

    if (!shouldShow) {
      return;
    }

    this.state = {
      ...this.state,
      lastAlert:
        event.data.scope === "workspace"
          ? `Workspace alert ${event.occurredAt}`
          : `Entity alert ${event.occurredAt}`,
      lastError: "",
    };
    this.publishState();
  }

  private async patchControls(payload: {
    shoutbox: {
      listen?: {
        muted?: boolean;
      };
      talk?: {
        active?: boolean;
        controlMode?: "push" | "latch" | null;
      };
    };
  }): Promise<void> {
    const api = this.requireApi();
    const entityId = this.requireEntityId();
    const controls = await api.patchEntityControls(entityId, payload);
    this.state = {
      ...this.state,
      controls,
      lastError: "",
    };
    this.publishState();
  }

  private requireApi(): CrewLanApiClient {
    if (this.api === null) {
      throw new CrewLanApiError("CrewLAN API client is not configured.");
    }

    return this.api;
  }

  private requireEntityId(): string {
    if (
      !this.state.connected ||
      this.state.entityId === null ||
      this.state.entityId.length === 0
    ) {
      throw new CrewLanApiError("CrewLAN entity capability is not connected.");
    }

    return this.state.entityId;
  }

  private handleConnectionError(error: unknown): void {
    const status = statusForError(error);
    const message = describeCompanionErrorForDisplay(error);
    this.state = {
      ...this.state,
      connected: false,
      lastError: message,
    };
    this.updateStatus(status, message);
    this.publishState();
    this.log("warn", message);
  }

  private handleOperationError(actionName: string, error: unknown): void {
    const status = statusForError(error);
    const message = `${actionName}: ${describeCompanionErrorForDisplay(error)}`;
    this.state = {
      ...this.state,
      lastError: message,
    };
    this.updateStatus(status, message);
    this.publishState();
    this.log("warn", message);
  }

  private publishState(): void {
    UpdateVariableValues(this);
    this.updateActions();
    this.updateFeedbacks();
    this.updatePresets();

    const [firstFeedbackId, ...remainingFeedbackIds] = feedbackIds;

    if (firstFeedbackId !== undefined) {
      this.checkFeedbacks(firstFeedbackId, ...remainingFeedbackIds);
    }
  }
}

export default ModuleInstance;
