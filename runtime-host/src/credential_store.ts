import type { DeviceCredential } from "./control_plane.ts";

export interface CredentialStore {
  readDeviceCredential(): Promise<DeviceCredential | null>;
  writeDeviceCredential(credential: DeviceCredential): Promise<void>;
  deleteDeviceCredential(): Promise<void>;
}

export class InMemoryCredentialStore implements CredentialStore {
  constructor(private credential: DeviceCredential | null = null) {}

  async readDeviceCredential(): Promise<DeviceCredential | null> {
    return this.credential === null ? null : { ...this.credential };
  }

  async writeDeviceCredential(credential: DeviceCredential): Promise<void> {
    this.credential = { ...credential };
  }

  async deleteDeviceCredential(): Promise<void> {
    this.credential = null;
  }
}
