type SSEListener = (event: string, data: unknown) => void;

export class SSEHub {
  private listeners = new Set<SSEListener>();

  subscribe(listener: SSEListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  broadcast(event: string, data: unknown): void {
    for (const listener of this.listeners) {
      listener(event, data);
    }
  }
}
