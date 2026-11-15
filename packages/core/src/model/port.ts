export interface ModelRequest {
  connection: string;
  model: string;
  system: string;
  user: string;
  temperature?: number;
  thinking?: "off" | "low" | "high";
  maxOutput?: number;
  json?: boolean;
}

export interface StreamEvent {
  type: "delta" | "done";
  text?: string;
}

export interface ModelAnswer {
  text: string;
  usage: {
    input: number;
    cachedInput: number;
    output: number;
  };
  cost: number | null;
}

export interface ModelPort {
  stream(
    req: ModelRequest,
    signal: AbortSignal,
    on: (e: StreamEvent) => void,
  ): Promise<ModelAnswer>;
}
