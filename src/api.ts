import type {
  PublicEntityControlsDto,
  PublicEntityDto,
  PublicEntityStatusDto,
  PublicDismissEntityAlertsDto,
  PublicEventEnvelope,
  PublicItemResponse,
  PublicListResponse,
  PublicSessionDto,
  PublicStatusDto,
  PublicWorkspaceDto,
} from "./types.js";

export class CrewLanApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number | null = null,
  ) {
    super(message);
    this.name = "CrewLanApiError";
  }
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new CrewLanApiError("Address is required.");
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    throw new CrewLanApiError(
      "Address must be a valid CrewLAN URL, for example http://192.168.1.20:4848.",
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CrewLanApiError("Address must start with http:// or https://.");
  }

  url.pathname = url.pathname.replace(/\/+$/u, "");

  if (url.pathname === "/api" || url.pathname === "/api/v1") {
    url.pathname = "";
  }

  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

export function parseServerSentEvents(chunk: string): PublicEventEnvelope[] {
  return chunk
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .split(/\n\n+/u)
    .map((eventChunk) => eventChunk.trim())
    .filter((eventChunk) => eventChunk.length > 0)
    .flatMap((eventChunk) => {
      const dataLines: string[] = [];

      for (const line of eventChunk.split("\n")) {
        if (line.startsWith(":")) {
          continue;
        }

        const separatorIndex = line.indexOf(":");
        const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
        let fieldValue = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : "";

        if (fieldValue.startsWith(" ")) {
          fieldValue = fieldValue.slice(1);
        }

        if (field === "data") {
          dataLines.push(fieldValue);
        }
      }

      if (dataLines.length === 0) {
        return [];
      }

      try {
        return [JSON.parse(dataLines.join("\n")) as PublicEventEnvelope];
      } catch {
        return [];
      }
    });
}

export class CrewLanApiClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(input: { baseUrl: string; token: string }) {
    this.baseUrl = normalizeBaseUrl(input.baseUrl);
    this.token = input.token.trim();

    if (this.token.length === 0) {
      throw new CrewLanApiError("CrewLAN entity token is required.");
    }
  }

  async getSession(signal?: AbortSignal): Promise<PublicSessionDto> {
    return (
      await this.request<PublicItemResponse<PublicSessionDto>>("/api/v1/session", {
        signal: signal ?? null,
      })
    ).data;
  }

  async getWorkspace(signal?: AbortSignal): Promise<PublicWorkspaceDto> {
    return (
      await this.request<PublicItemResponse<PublicWorkspaceDto>>("/api/v1/workspace", {
        signal: signal ?? null,
      })
    ).data;
  }

  async getEntity(entityId: string, signal?: AbortSignal): Promise<PublicEntityDto> {
    return (
      await this.request<PublicItemResponse<PublicEntityDto>>(
        `/api/v1/entities/${encodeURIComponent(entityId)}`,
        { signal: signal ?? null },
      )
    ).data;
  }

  async listStatuses(signal?: AbortSignal): Promise<PublicStatusDto[]> {
    return (
      await this.request<PublicListResponse<PublicStatusDto>>("/api/v1/statuses", {
        signal: signal ?? null,
      })
    ).data;
  }

  async getEntityStatus(entityId: string, signal?: AbortSignal): Promise<PublicEntityStatusDto> {
    return (
      await this.request<PublicItemResponse<PublicEntityStatusDto>>(
        `/api/v1/entities/${encodeURIComponent(entityId)}/status`,
        { signal: signal ?? null },
      )
    ).data;
  }

  async setEntityStatus(entityId: string, statusId: string): Promise<PublicEntityStatusDto> {
    await this.request(`/api/v1/entities/${encodeURIComponent(entityId)}/status`, {
      method: "PUT",
      body: JSON.stringify({ statusId }),
    });
    return await this.getEntityStatus(entityId);
  }

  async getEntityControls(entityId: string, signal?: AbortSignal): Promise<PublicEntityControlsDto> {
    return (
      await this.request<PublicItemResponse<PublicEntityControlsDto>>(
        `/api/v1/entities/${encodeURIComponent(entityId)}/controls`,
        { signal: signal ?? null },
      )
    ).data;
  }

  async patchEntityControls(
    entityId: string,
    payload: {
      shoutbox: {
        listen?: { muted?: boolean };
        talk?: { active?: boolean; controlMode?: "push" | "latch" | null };
      };
    },
  ): Promise<PublicEntityControlsDto> {
    return (
      await this.request<PublicItemResponse<PublicEntityControlsDto>>(
        `/api/v1/entities/${encodeURIComponent(entityId)}/controls`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        },
      )
    ).data;
  }

  async dismissEntityAlerts(entityId: string): Promise<PublicDismissEntityAlertsDto> {
    return (
      await this.request<PublicItemResponse<PublicDismissEntityAlertsDto>>(
        `/api/v1/entities/${encodeURIComponent(entityId)}/alerts/dismiss`,
        {
          method: "POST",
        },
      )
    ).data;
  }

  async streamEvents(
    signal: AbortSignal,
    onEvent: (event: PublicEventEnvelope) => void,
  ): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/events?types=status.changed,alert.triggered,entity.controls.changed`,
      {
        headers: this.headers({ accept: "text/event-stream" }),
        signal,
      },
    );

    if (!response.ok) {
      throw new CrewLanApiError(`CrewLAN event stream failed with HTTP ${String(response.status)}.`, response.status);
    }

    if (response.body === null) {
      throw new CrewLanApiError("CrewLAN event stream did not provide a response body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";

    while (!signal.aborted) {
      const result = await reader.read();

      if (result.done) {
        return;
      }

      buffered += decoder.decode(result.value, { stream: true });
      buffered = buffered.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
      const boundaryIndex = buffered.lastIndexOf("\n\n");

      if (boundaryIndex < 0) {
        continue;
      }

      const complete = buffered.slice(0, boundaryIndex + 2);
      buffered = buffered.slice(boundaryIndex + 2);

      for (const event of parseServerSentEvents(complete)) {
        onEvent(event);
      }
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: this.headers({
        accept: "application/json",
        ...(typeof init.body === "string" ? { "content-type": "application/json" } : {}),
        ...Object.fromEntries(new Headers(init.headers).entries()),
      }),
    });

    if (!response.ok) {
      let message = `CrewLAN API request failed with HTTP ${String(response.status)}.`;

      try {
        const body = (await response.json()) as { message?: unknown };

        if (typeof body.message === "string" && body.message.trim().length > 0) {
          message = body.message;
        }
      } catch {
        // Keep the HTTP fallback message.
      }

      throw new CrewLanApiError(message, response.status);
    }

    return (await response.json()) as T;
  }

  private headers(extra: Record<string, string>): Record<string, string> {
    return {
      ...extra,
      authorization: `Bearer ${this.token}`,
    };
  }
}
