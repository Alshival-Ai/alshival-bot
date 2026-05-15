import type { PlatformAdapter } from "./types.js";

export class PlatformManager {
  private readonly adapters = new Map<string, PlatformAdapter>();

  register(adapter: PlatformAdapter) {
    this.adapters.set(adapter.platform, adapter);
  }

  get(platform: string) {
    return this.adapters.get(platform);
  }

  async reconcileAll() {
    await Promise.all([...this.adapters.values()].map((adapter) => adapter.reconcile()));
  }
}
