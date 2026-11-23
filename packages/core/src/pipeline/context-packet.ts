export interface ContextBlock {
  id: string;
  layer: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  required: boolean;
  tokens: number;
  reason: string;
  source: {
    kind:
      | "outline"
      | "chapter"
      | "bible"
      | "plan"
      | "retrieval"
      | "reference"
      | "author"
      | "library"
      | "source";
    ref: string;
  };
}

export interface ContextPacket {
  prefix: ContextBlock[];
  suffix: ContextBlock[];
  omitted: { id: string; why: string }[];
  estimate: number;
}

export function renderContextPacket(packet: ContextPacket): { system: string; user: string } {
  const system = packet.prefix
    .map((b) => b.text)
    .filter(Boolean)
    .join("\n\n");
  const user = packet.suffix
    .map((b) => b.text)
    .filter(Boolean)
    .join("\n\n");
  return { system, user };
}
