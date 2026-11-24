export interface ModelRequest {
  connection: string;
  model: string;
  system: string;
  user: string;
  temperature?: number;
  thinking?: "off" | "low" | "high";
  maxOutput?: number;
  json?: boolean;
  /** 稳定会话/运行标识，供 PI 内核开启供应商侧提示词缓存与亲和路由。 */
  sessionId?: string;
  /** 提示词缓存保留策略，透传给 PI streamSimple。 */
  cacheRetention?: "none" | "short" | "long";
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
