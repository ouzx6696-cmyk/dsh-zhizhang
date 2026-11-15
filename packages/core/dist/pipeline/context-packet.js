export function renderContextPacket(packet) {
    const system = packet.prefix.map((b) => b.text).filter(Boolean).join("\n\n");
    const user = packet.suffix.map((b) => b.text).filter(Boolean).join("\n\n");
    return { system, user };
}
